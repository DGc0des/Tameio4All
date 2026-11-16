import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { parseKey, type FieldAck, type FieldKey, type ServerField, type Snapshot, type SubmitInfo } from '../../features/register/live/fields';

export type LiveStatus = 'connecting' | 'live' | 'offline';
export type LiveFieldEvent = ServerField & { revision: number; businessDate: string };
export interface LiveHandlers {
  onField(f: LiveFieldEvent): void;
  onSubmitted(s: SubmitInfo): void;
  onPresence(p: { name: string; focus: FieldKey | null }[]): void;
  onStatus(s: LiveStatus): void;
}
export interface LiveChannel {
  setFocus(key: FieldKey | null): void;
  close(): void;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);

function parseSubmitInfo(x: unknown): SubmitInfo | null {
  if (!isObj(x) || !isStr(x.closing_id) || !isStr(x.staff_name) || !isStr(x.at)) return null;
  const info: SubmitInfo = { closingId: x.closing_id, staffName: x.staff_name, at: x.at };
  if (isInt(x.revision)) info.revision = x.revision;
  return info;
}

/** One server field row; null when malformed (including a key the client's parseKey rejects, e.g. `d:0100`). */
export function parseServerField(x: unknown): ServerField | null {
  if (!isObj(x) || !isStr(x.key) || parseKey(x.key) === null) return null;
  if (!isInt(x.version) || !isStr(x.updated_by_name) || !isStr(x.updated_at)) return null;
  return { key: x.key, value: x.value, version: x.version, updatedByName: x.updated_by_name, updatedAt: x.updated_at };
}

/**
 * The `closing` object of get_open_closing / owner_get_open_closing. Malformed individual fields are
 * dropped; a malformed top-level part makes the whole snapshot null (an unexpected response).
 */
export function parseSnapshot(x: unknown): Snapshot | null {
  if (!isObj(x)) return null;
  if (!isStr(x.id) || x.id === '' || !isStr(x.business_date) || !isStr(x.config_id) || !isInt(x.revision)) return null;
  let lastSubmit: Snapshot['lastSubmit'] = null;
  if (x.last_submit !== null && x.last_submit !== undefined) {
    lastSubmit = parseSubmitInfo(x.last_submit);
    if (lastSubmit === null) return null;
  }
  if (x.fields !== null && x.fields !== undefined && !Array.isArray(x.fields)) return null;
  const fields: Snapshot['fields'] = {};
  for (const raw of (x.fields ?? []) as unknown[]) {
    const f = parseServerField(raw);
    if (f) fields[f.key] = f;
  }
  return { id: x.id, businessDate: x.business_date, configId: x.config_id, config: x.config, revision: x.revision, lastSubmit, fields };
}

/**
 * The ok answer of set_closing_field / owner_set_closing_field: {version, revision, value}. `value` (the
 * stored value) is passed on as is when present — the engine checks its shape before using it.
 */
export function parseFieldAck(x: unknown): FieldAck | null {
  if (!isObj(x) || !isInt(x.version) || !isInt(x.revision)) return null;
  return x.value === undefined ? { version: x.version, revision: x.revision } : { version: x.version, revision: x.revision, value: x.value };
}

/** The `current` object of a `stale` reply (it has no key/updated_at; the key comes from the request). */
export function parseStaleCurrent(key: FieldKey, x: unknown): ServerField | null {
  if (!isObj(x) || !isInt(x.version)) return null;
  return {
    key,
    value: x.value ?? null,
    version: x.version,
    updatedByName: isStr(x.updated_by_name) ? x.updated_by_name : '',
    updatedAt: '',
  };
}

function parseFieldBroadcast(x: unknown): LiveFieldEvent | null {
  if (!isObj(x) || !isInt(x.revision) || !isStr(x.business_date)) return null;
  const f = parseServerField(x);
  return f ? { ...f, revision: x.revision, businessDate: x.business_date } : null;
}

const newPresenceKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * Presence is cosmetic and Supabase closes the channel of a client that tracks too often
 * (`ClientPresenceRateLimitReached`; tabbing through boxes sends a blur + a focus per box). So at most one
 * track per this interval: the latest focus is sent at the end of the window, an unchanged one not at all.
 */
export const PRESENCE_MIN_INTERVAL_MS = 1000;

/**
 * realtime-js never rejoins a channel the server closed (it drops it from its registry): reopen a fresh
 * one after this cooldown. Errors and timeouts are rejoined by realtime-js itself.
 */
export const REOPEN_AFTER_CLOSE_MS = 10_000;

/** After this long waiting for an older channel of the same topic to finish leaving, the reopen reports offline (and keeps waiting). */
export const REMOVAL_TIMEOUT_MS = 3000;

/**
 * Removals in flight, per client and topic. realtime-js tears a channel down when its first leave
 * completes, which drops the bindings a second leave push needs to resolve, so a second removeChannel
 * of the same channel can hang forever. Everything that removes a channel records it here, and
 * everything that needs it gone waits on this instead of removing again.
 */
const removals = new WeakMap<object, Map<string, Promise<unknown>>>();
const removalsOf = (client: object): Map<string, Promise<unknown>> => {
  let m = removals.get(client);
  if (!m) removals.set(client, (m = new Map()));
  return m;
};
/**
 * Listens to the shop's private realtime topic and tracks presence. Clients never broadcast (the
 * server does, from the write functions). After close() no handler is called again.
 *
 * Status: 'connecting' first; after an error the status goes offline -> live again (supabase-js
 * rejoins by itself) with no 'connecting' in between. A channel the server closed (e.g. presence rate
 * limit) is not rejoined by supabase-js: after REOPEN_AFTER_CLOSE_MS a fresh one is opened (offline -> live).
 * Presence tracks are throttled (PRESENCE_MIN_INTERVAL_MS). Going offline also reports empty presence.
 *
 * supabase-js hands back an existing channel for the same topic, and a closed channel only leaves
 * its registry after an async unsubscribe. So the channel is created only after any older one for
 * this topic has been removed; otherwise reopening (StrictMode, gate reload) could reuse the dying one.
 * A leave can take up to realtime-js's 10 s timeout (dead socket after a phone resume): after
 * REMOVAL_TIMEOUT_MS the status goes 'offline' and the open keeps waiting, then continues offline -> live.
 * Contract: one live channel per shop at a time on the shared client; close() before reopening.
 */
export function openShopChannel(client: SupabaseClient, shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel {
  const selfKey = newPresenceKey();
  const topic = `shop:${shopId}`;
  let closed = false;
  let subscribed = false;
  let focus: FieldKey | null = null;
  let ch: RealtimeChannel | null = null;
  // Throttle state of the current channel: what it last tracked, when, and a pending trailing send.
  let sentFocus: FieldKey | null | undefined;
  let lastTrackAt = -Infinity;
  let trackTimer: ReturnType<typeof setTimeout> | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTrackTimer = () => {
    if (trackTimer !== null) clearTimeout(trackTimer);
    trackTimer = null;
  };

  const track = () => {
    if (closed || !subscribed || !ch || trackTimer !== null) return;
    if (focus === sentFocus) return;
    const wait = lastTrackAt + PRESENCE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      trackTimer = setTimeout(() => {
        trackTimer = null;
        track();
      }, wait);
      return;
    }
    sentFocus = focus;
    lastTrackAt = Date.now();
    void Promise.resolve(ch.track({ name: me.name, focus })).catch(() => {});
  };

  const start = async () => {
    // A private channel authorizes with the current access token, so refresh it before joining.
    try {
      await client.realtime.setAuth();
    } catch {
      /* join anyway; the server decides */
    }
    if (closed) return;
    const inflight = removalsOf(client);
    const registered = () => client.getChannels().filter((c) => c.topic === `realtime:${topic}`);
    // Reports offline once if the wait is slow, but never gives up: a removal always settles.
    let announced = false;
    const wait = async (p: Promise<unknown>) => {
      const t = setTimeout(() => {
        if (closed || announced) return;
        announced = true;
        h.onStatus('offline');
        h.onPresence([]);
      }, REMOVAL_TIMEOUT_MS);
      try {
        await p;
      } finally {
        clearTimeout(t);
      }
    };
    try {
      for (let own = 0; own < 3; ) {
        const pending = inflight.get(topic);
        if (pending) {
          await wait(pending);
        } else {
          const old = registered()[0];
          if (!old) break;
          own++;
          const p: Promise<unknown> = Promise.resolve(client.removeChannel(old)).catch(() => {});
          inflight.set(topic, p);
          void p.then(() => { if (inflight.get(topic) === p) inflight.delete(topic); });
          await wait(p);
        }
        if (closed) return;
      }
    } catch {
      /* best effort */
    }
    if (closed) return;
    const mine = client.channel(topic, { config: { private: true, presence: { key: selfKey } } });
    ch = mine;
    // Callbacks of a channel this wrapper has replaced (after a server close) are ignored.
    const dead = () => closed || ch !== mine;
    mine.on('broadcast', { event: 'field' }, (msg: { payload?: unknown }) => {
      if (dead()) return;
      const f = parseFieldBroadcast(msg.payload);
      if (f) h.onField(f);
    });
    mine.on('broadcast', { event: 'submitted' }, (msg: { payload?: unknown }) => {
      if (dead()) return;
      const s = parseSubmitInfo(msg.payload);
      if (s) h.onSubmitted(s);
    });
    mine.on('presence', { event: 'sync' }, () => {
      if (dead()) return;
      const out: { name: string; focus: FieldKey | null }[] = [];
      for (const [key, metas] of Object.entries(mine.presenceState() as Record<string, unknown[]>)) {
        if (key === selfKey) continue;
        for (const m of metas) {
          if (!isObj(m) || !isStr(m.name)) continue;
          out.push({ name: m.name, focus: isStr(m.focus) && parseKey(m.focus) !== null ? m.focus : null });
        }
      }
      h.onPresence(out);
    });
    mine.subscribe((status: string) => {
      if (dead()) return;
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        sentFocus = undefined; // a (re)joined channel has no presence of ours yet
        h.onStatus('live');
        track();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false;
        clearTrackTimer();
        h.onStatus('offline');
        h.onPresence([]);
        if (status === 'CLOSED' && reopenTimer === null) {
          // Closed by the server (we never get here after close()): realtime-js will not rejoin it.
          reopenTimer = setTimeout(() => {
            reopenTimer = null;
            if (dead()) return;
            ch = null;
            void start();
          }, REOPEN_AFTER_CLOSE_MS);
        }
      }
    });
  };

  h.onStatus('connecting');
  void start();

  return {
    setFocus(key) {
      focus = key;
      track();
    },
    close() {
      if (closed) return;
      closed = true;
      clearTrackTimer();
      if (reopenTimer !== null) clearTimeout(reopenTimer);
      reopenTimer = null;
      if (ch) {
        const inflight = removalsOf(client);
        const p: Promise<unknown> = Promise.resolve(client.removeChannel(ch)).catch(() => {});
        inflight.set(topic, p);
        void p.then(() => { if (inflight.get(topic) === p) inflight.delete(topic); });
      }
    },
  };
}
