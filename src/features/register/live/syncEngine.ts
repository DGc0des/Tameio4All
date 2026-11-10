import { isShopConfig } from '../../../core/config';
import { savePending, saveSnapshot } from '../../../data/local/openClosing';
import type { KeyValueStore } from '../../../data/local/storage';
import type { DResult, DeviceError } from '../../../data/remote/deviceApi';
import type { LiveChannel, LiveFieldEvent, LiveHandlers, LiveStatus } from '../../../data/remote/live';
import { deviceErrorMessage } from '../../phone/model/messages';
import type { Draft } from '../draft';
import { isFieldKey, isFieldValue, type FieldKey, type PendingEdit, type ServerField, type Snapshot } from './fields';
import { applyServerField, draftFromFields, fieldLabel } from './merge';

/**
 * The client side of the live shared closing: `snapshot` (what the server holds, as last seen) plus
 * `pending` (this client's edits not yet acknowledged, persisted). Everything that decides is a pure
 * function over `EngineState` below; `createSyncEngine` is the effects runner (writer calls, timers,
 * storage, the channel) and has no React in it. `useLiveClosing` is the thin React binding.
 *
 * Rules (see the stage-2 plan, Task 6):
 * - Every edit is in the persisted queue at once. While a box is being typed (debounce, 400 ms per key,
 *   or until flush/blur) its latest queue item is "debouncing": its key is in `debouncing` (memory only,
 *   never persisted) and further typing replaces that item's value in place (same seq). The sender skips
 *   debouncing keys. After a remount nothing is debouncing, so a persisted item is simply sendable.
 * - One write in flight at a time, in `seq` order, only while `statusOf(s) === 'live'` (channel live AND a
 *   load succeeded since it became live AND no network failure since). So every live after
 *   connecting/offline resyncs before anything is sent.
 * - An edit made while not live is `queuedOffline` with `baseVersion` = the snapshot's version of that key
 *   (0 when absent: the server compares against 0 for a missing row); online edits send `baseVersion: null`
 *   (last write to reach the server wins).
 * - The draft shows the pending value of a key (highest seq) over the snapshot until it is acknowledged,
 *   including while in flight; broadcasts only update the snapshot (older/equal versions are ignored).
 */

export const WRITE_DEBOUNCE_MS = 400;
/** A network failure while the channel still reports live: retry (resync, then send) after this long. */
export const NETWORK_RETRY_MS = 3000;
export const WRONG_DAY_NOTICE = 'Η ημέρα άλλαξε — οι αλλαγές εκτός σύνδεσης δεν αποθηκεύτηκαν';
export const staleNotice = (label: string, name: string): string => `Το πεδίο ${label} άλλαξε από ${name || 'άλλον'}`;

/**
 * The server side the engine talks to (phone: DeviceApi with the staff token; owner: OwnerApi adapted).
 * Errors are DeviceError values; an adapter maps anything else to `{code:'unknown', detail}`, which is
 * treated as fatal like every code the engine does not handle itself.
 */
export interface Writer {
  load(): Promise<DResult<Snapshot>>;
  write(e: PendingEdit): Promise<DResult<{ version: number; revision: number }>>;
  live(h: LiveHandlers): LiveChannel;
}

export type Presence = { name: string; focus: FieldKey | null }[];

export interface LiveState {
  snapshot: Snapshot | null;
  pending: PendingEdit[];
  status: LiveStatus;
  presence: Presence;
  notice: string | null;
}

export interface EngineState {
  snapshot: Snapshot | null;
  pending: PendingEdit[];
  /** Keys whose latest queue item is still being typed (not sent yet). Memory only. */
  debouncing: FieldKey[];
  /** Last status the channel reported. */
  channel: LiveStatus;
  /** A load succeeded since the channel last became live. */
  fresh: boolean;
  /** The last write or load failed with `network` (cleared by a successful load). */
  netDown: boolean;
  /** seq of the write in flight. */
  inflight: number | null;
  loading: boolean;
  /** A fatal error stopped the sender (onFatal was called). */
  halted: boolean;
  presence: Presence;
  notice: string | null;
  nextSeq: number;
}

// ---------------------------------------------------------------- pure state

export function initialEngineState(snapshot: Snapshot | null, pending: PendingEdit[]): EngineState {
  const sorted = [...pending].sort((a, b) => a.seq - b.seq);
  return {
    snapshot, pending: sorted, debouncing: [], channel: 'connecting', fresh: false, netDown: false,
    inflight: null, loading: false, halted: false, presence: [], notice: null,
    nextSeq: sorted.reduce((m, p) => Math.max(m, p.seq), 0) + 1,
  };
}

export function statusOf(s: EngineState): LiveStatus {
  if (s.netDown || s.channel === 'offline') return 'offline';
  return s.channel === 'live' && s.fresh ? 'live' : 'connecting';
}

export function toLiveState(s: EngineState): LiveState {
  return { snapshot: s.snapshot, pending: s.pending, status: statusOf(s), presence: s.presence, notice: s.notice };
}

/** Snapshot + this day's pending edits (edits of another business date never overlay it). */
export function visibleDraft(s: Pick<EngineState, 'snapshot' | 'pending'>): Draft | null {
  if (!s.snapshot) return null;
  const date = s.snapshot.businessDate;
  return draftFromFields(s.snapshot, s.pending.filter((p) => p.businessDate === date));
}

const versionOf = (snap: Snapshot, key: FieldKey): number => snap.fields[key]?.version ?? 0;

export function reduceEdit(s: EngineState, key: FieldKey, value: unknown): EngineState {
  if (!s.snapshot || !isFieldKey(key) || !isFieldValue(key, value)) return s;
  const offline = statusOf(s) !== 'live';
  const date = s.snapshot.businessDate;
  const base = offline ? versionOf(s.snapshot, key) : null;
  if (s.debouncing.includes(key)) {
    const p = [...s.pending].reverse().find((x) => x.key === key && x.seq !== s.inflight && x.businessDate === date);
    if (p) {
      const merged: PendingEdit = { ...p, value, queuedOffline: p.queuedOffline || offline, baseVersion: p.baseVersion ?? base };
      return { ...s, pending: s.pending.map((x) => (x === p ? merged : x)) };
    }
  }
  const item: PendingEdit = { key, value, businessDate: date, baseVersion: base, queuedOffline: offline, seq: s.nextSeq };
  return {
    ...s,
    pending: [...s.pending, item],
    debouncing: s.debouncing.includes(key) ? s.debouncing : [...s.debouncing, key],
    nextSeq: s.nextSeq + 1,
  };
}

/** Ends typing for one key (or all): its item becomes sendable. */
export function reduceCommit(s: EngineState, key?: FieldKey): EngineState {
  if (s.debouncing.length === 0) return s;
  if (key === undefined) return { ...s, debouncing: [] };
  return s.debouncing.includes(key) ? { ...s, debouncing: s.debouncing.filter((k) => k !== key) } : s;
}

/** The next item to send, or null when the sender must wait. */
export function nextToSend(s: EngineState): PendingEdit | null {
  if (!s.snapshot || s.halted || s.loading || s.inflight !== null || statusOf(s) !== 'live') return null;
  const date = s.snapshot.businessDate;
  return s.pending.find((p) => p.businessDate === date && !s.debouncing.includes(p.key)) ?? null;
}

export function reduceChannelStatus(s: EngineState, st: LiveStatus): { state: EngineState; resync: boolean } {
  if (st === 'live') {
    if (s.channel === 'live') return { state: s, resync: false };
    return { state: { ...s, channel: 'live', fresh: false }, resync: true };
  }
  return { state: { ...s, channel: st, fresh: false }, resync: false };
}

/** A realtime field event. Another business date is not applied: the caller resyncs instead. */
export function reduceBroadcast(s: EngineState, f: LiveFieldEvent): { state: EngineState; resync: boolean } {
  if (!s.snapshot) return { state: s, resync: true };
  if (f.businessDate !== s.snapshot.businessDate) return { state: s, resync: true };
  const { businessDate: _d, ...field } = f;
  const next = applyServerField(s.snapshot, field);
  return { state: next === s.snapshot ? s : { ...s, snapshot: next }, resync: false };
}

/**
 * A loaded snapshot replaces ours (fields we already hold at a higher version — broadcasts that arrived
 * during the load — are kept). Pending edits of another business date are dropped with the wrong-day notice.
 */
export function reduceLoaded(s: EngineState, loaded: Snapshot): EngineState {
  let snapshot = loaded;
  const old = s.snapshot;
  if (old && old.id === loaded.id && old.businessDate === loaded.businessDate) {
    const fields = { ...loaded.fields };
    for (const [k, f] of Object.entries(old.fields)) {
      if (fields[k] === undefined || fields[k].version < f.version) fields[k] = f;
    }
    snapshot = { ...loaded, fields, revision: Math.max(old.revision, loaded.revision), lastSubmit: loaded.lastSubmit ?? old.lastSubmit };
  }
  const keep = s.pending.filter((p) => p.businessDate === snapshot.businessDate);
  const dropped = keep.length !== s.pending.length;
  return {
    ...s,
    snapshot,
    pending: dropped ? keep : s.pending,
    fresh: s.channel === 'live',
    netDown: false,
    notice: dropped ? WRONG_DAY_NOTICE : s.notice,
  };
}

export type Effect = { kind: 'none' } | { kind: 'resync' } | { kind: 'retry' } | { kind: 'fatal'; error: DeviceError };
const NONE: Effect = { kind: 'none' };

/** Errors the engine handles itself; any other code is fatal. */
function failureEffect(s: EngineState, error: DeviceError): { state: EngineState; effect: Effect } {
  if (error.code === 'network') return { state: { ...s, netDown: true }, effect: { kind: 'retry' } };
  if (s.halted) return { state: s, effect: NONE };
  return { state: { ...s, halted: true }, effect: { kind: 'fatal', error } };
}

export function reduceLoadFailed(s: EngineState, error: DeviceError): { state: EngineState; effect: Effect } {
  return failureEffect(s, error);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Our write landed as `version`: snapshot gets our value (unless something newer is already there). */
function acked(s: EngineState, item: PendingEdit, version: number, revision: number, me: string, nowIso: string): EngineState {
  const pending = s.pending
    .filter((p) => p.seq !== item.seq)
    // Later offline edits of the same box were typed on top of this one.
    .map((p) => (p.key === item.key && p.baseVersion !== null ? { ...p, baseVersion: version } : p));
  let snapshot = s.snapshot;
  if (snapshot && snapshot.businessDate === item.businessDate) {
    snapshot = applyServerField(snapshot, { key: item.key, value: item.value, version, updatedByName: me, updatedAt: nowIso, revision });
    if (snapshot.revision < revision) snapshot = { ...snapshot, revision };
  }
  return { ...s, pending, snapshot };
}

export function reduceWriteResult(
  s0: EngineState,
  item: PendingEdit,
  r: DResult<{ version: number; revision: number }>,
  me: string,
  nowIso: string,
): { state: EngineState; effect: Effect } {
  const s: EngineState = { ...s0, inflight: s0.inflight === item.seq ? null : s0.inflight };
  if (r.ok) return { state: acked(s, item, r.data.version, r.data.revision, me, nowIso), effect: NONE };
  const e = r.error;
  const drop = (st: EngineState) => ({ ...st, pending: st.pending.filter((p) => p.seq !== item.seq) });
  switch (e.code) {
    case 'stale': {
      const cur: ServerField = { ...e.current, key: item.key };
      // The box already holds what we sent (e.g. our own write re-sent after a remount): that's an ack.
      if (deepEqual(cur.value, item.value)) {
        return { state: acked(s, item, cur.version, s.snapshot?.revision ?? 0, cur.updatedByName, cur.updatedAt), effect: NONE };
      }
      let st = drop(s);
      // Other offline edits of this box were made on the same outdated view: dropped too.
      st = { ...st, pending: st.pending.filter((p) => !(p.key === item.key && p.baseVersion !== null)) };
      if (st.snapshot && st.snapshot.businessDate === item.businessDate) {
        st = { ...st, snapshot: applyServerField(st.snapshot, { ...cur, revision: st.snapshot.revision }) };
      }
      const config = st.snapshot ? st.snapshot.config : null;
      const label = isShopConfig(config) ? fieldLabel(item.key, config, visibleDraft(st) ?? undefined) : item.key;
      return { state: { ...st, notice: staleNotice(label, cur.updatedByName) }, effect: NONE };
    }
    case 'wrong_day':
      return {
        state: { ...s, pending: s.pending.filter((p) => p.businessDate !== item.businessDate), notice: WRONG_DAY_NOTICE },
        effect: { kind: 'resync' },
      };
    case 'bad_field':
    case 'too_many_expenses':
      return { state: { ...drop(s), notice: deviceErrorMessage(e) }, effect: { kind: 'resync' } };
    default:
      // network: the item stays and is retried after a resync; anything else stops the sender.
      return failureEffect(s, e);
  }
}

// ---------------------------------------------------------------- effects runner

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface EngineDeps {
  /** Getters, so a re-rendered caller's latest writer / clock is used. */
  writer(): Writer;
  now(): Date;
  store: KeyValueStore;
  shopId: string;
  me: { name: string };
  initial: EngineState;
  onChange(s: EngineState): void;
  onFatal(e: DeviceError): void;
  timers?: Timers;
}

export interface SyncEngine {
  start(): void;
  dispose(): void;
  edit(key: FieldKey, value: unknown): void;
  flush(key?: FieldKey): void;
  focus(key: FieldKey | null): void;
  resync(): Promise<void>;
  clearNotice(): void;
  getState(): EngineState;
}

/**
 * After dispose() nothing is called again (no onChange/onFatal, no storage writes, no new requests):
 * late results are ignored. Their effect is not lost: the queue item stays persisted and is re-sent by
 * the next mount (an identical value comes back `stale`-equal and is taken as an ack).
 */
export function createSyncEngine(deps: EngineDeps): SyncEngine {
  const timers = deps.timers ?? realTimers;
  let s = deps.initial;
  let disposed = false;
  let channel: LiveChannel | null = null;
  const debounce = new Map<FieldKey, unknown>();
  let retryTimer: unknown = null;
  let loadP: Promise<void> | null = null;
  let again = false;

  const set = (next: EngineState) => {
    if (disposed || next === s) return;
    const prev = s;
    s = next;
    if (next.pending !== prev.pending) savePending(deps.store, deps.shopId, next.pending);
    if (next.snapshot !== prev.snapshot && next.snapshot) saveSnapshot(deps.store, deps.shopId, next.snapshot);
    deps.onChange(next);
  };

  const clearRetry = () => {
    if (retryTimer !== null) timers.clear(retryTimer);
    retryTimer = null;
  };

  const run = (effect: Effect) => {
    if (disposed) return;
    switch (effect.kind) {
      case 'resync':
        void resync();
        break;
      case 'retry':
        // While the channel says live nothing else will wake us up: retry on a timer.
        if (s.channel === 'live' && retryTimer === null) {
          retryTimer = timers.set(() => { retryTimer = null; void resync(); }, NETWORK_RETRY_MS);
        }
        break;
      case 'fatal':
        deps.onFatal(effect.error);
        break;
      case 'none':
        break;
    }
  };

  const kick = () => {
    if (disposed) return;
    const item = nextToSend(s);
    if (!item) return;
    set({ ...s, inflight: item.seq });
    let p: Promise<DResult<{ version: number; revision: number }>>;
    try {
      p = deps.writer().write(item);
    } catch {
      p = Promise.resolve({ ok: false, error: { code: 'network' } });
    }
    void p.then(
      (r) => r,
      (): DResult<{ version: number; revision: number }> => ({ ok: false, error: { code: 'network' } }),
    ).then((r) => {
      if (disposed) return;
      const out = reduceWriteResult(s, item, r, deps.me.name, deps.now().toISOString());
      set(out.state);
      run(out.effect);
      kick();
    });
  };

  const loadOnce = async (): Promise<void> => {
    let r: DResult<Snapshot>;
    try {
      r = await deps.writer().load();
    } catch {
      r = { ok: false, error: { code: 'network' } };
    }
    if (disposed) return;
    if (r.ok) {
      set(reduceLoaded(s, r.data));
    } else {
      const out = reduceLoadFailed(s, r.error);
      set(out.state);
      run(out.effect);
    }
  };

  function resync(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (loadP) {
      again = true;
      return loadP;
    }
    clearRetry();
    set({ ...s, loading: true });
    loadP = (async () => {
      do {
        again = false;
        await loadOnce();
      } while (again && !disposed);
    })().finally(() => {
      loadP = null;
      if (disposed) return;
      set({ ...s, loading: false });
      kick();
    });
    return loadP;
  }

  const commit = (key?: FieldKey) => {
    const keys = key === undefined ? [...debounce.keys()] : [key];
    for (const k of keys) {
      const t = debounce.get(k);
      if (t !== undefined) timers.clear(t);
      debounce.delete(k);
    }
    set(reduceCommit(s, key));
    kick();
  };

  return {
    start() {
      if (disposed || channel) return;
      deps.onChange(s);
      channel = deps.writer().live({
        onField(f) {
          if (disposed) return;
          const out = reduceBroadcast(s, f);
          set(out.state);
          if (out.resync) void resync();
        },
        onSubmitted(info) {
          if (disposed || !s.snapshot) return;
          set({ ...s, snapshot: { ...s.snapshot, lastSubmit: info } });
        },
        onPresence(p) {
          if (disposed) return;
          set({ ...s, presence: p });
        },
        onStatus(st) {
          if (disposed) return;
          const out = reduceChannelStatus(s, st);
          if (st !== 'live') clearRetry();
          set(out.state);
          if (out.resync) void resync();
        },
      });
      // Offline start shows the cached snapshot + queue already; this load fills in what is newer.
      void resync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of debounce.values()) timers.clear(t);
      debounce.clear();
      clearRetry();
      channel?.close();
      channel = null;
    },
    edit(key, value) {
      if (disposed) return;
      const next = reduceEdit(s, key, value);
      if (next === s) return;
      set(next);
      const t = debounce.get(key);
      if (t !== undefined) timers.clear(t);
      debounce.set(key, timers.set(() => { debounce.delete(key); commit(key); }, WRITE_DEBOUNCE_MS));
    },
    flush(key) {
      if (disposed) return;
      commit(key);
    },
    focus(key) {
      if (disposed) return;
      channel?.setFocus(key);
    },
    resync,
    clearNotice() {
      if (disposed || s.notice === null) return;
      set({ ...s, notice: null });
    },
    getState: () => s,
  };
}
