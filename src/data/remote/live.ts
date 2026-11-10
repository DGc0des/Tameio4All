import type { SupabaseClient } from '@supabase/supabase-js';
import { parseKey, type FieldKey, type ServerField, type Snapshot } from '../../features/register/live/fields';

export type LiveStatus = 'connecting' | 'live' | 'offline';
export type LiveFieldEvent = ServerField & { revision: number; businessDate: string };
export interface LiveHandlers {
  onField(f: LiveFieldEvent): void;
  onSubmitted(s: { closingId: string; staffName: string; at: string }): void;
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

function parseSubmitInfo(x: unknown): { closingId: string; staffName: string; at: string } | null {
  if (!isObj(x) || !isStr(x.closing_id) || !isStr(x.staff_name) || !isStr(x.at)) return null;
  return { closingId: x.closing_id, staffName: x.staff_name, at: x.at };
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
 * Listens to the shop's private realtime topic and tracks presence. Clients never broadcast (the
 * server does, from the write functions). After close() no handler is called again.
 */
export function openShopChannel(client: SupabaseClient, shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel {
  const selfKey = newPresenceKey();
  let closed = false;
  let subscribed = false;
  let focus: FieldKey | null = null;
  const ch = client.channel(`shop:${shopId}`, { config: { private: true, presence: { key: selfKey } } });

  const track = () => {
    if (closed || !subscribed) return;
    void Promise.resolve(ch.track({ name: me.name, focus })).catch(() => {});
  };

  ch.on('broadcast', { event: 'field' }, (msg: { payload?: unknown }) => {
    if (closed) return;
    const f = parseFieldBroadcast(msg.payload);
    if (f) h.onField(f);
  });
  ch.on('broadcast', { event: 'submitted' }, (msg: { payload?: unknown }) => {
    if (closed) return;
    const s = parseSubmitInfo(msg.payload);
    if (s) h.onSubmitted(s);
  });
  ch.on('presence', { event: 'sync' }, () => {
    if (closed) return;
    const out: { name: string; focus: FieldKey | null }[] = [];
    for (const [key, metas] of Object.entries(ch.presenceState() as Record<string, unknown[]>)) {
      if (key === selfKey) continue;
      for (const m of metas) {
        if (!isObj(m) || !isStr(m.name)) continue;
        out.push({ name: m.name, focus: isStr(m.focus) && parseKey(m.focus) !== null ? m.focus : null });
      }
    }
    h.onPresence(out);
  });

  h.onStatus('connecting');
  // A private channel authorizes with the current access token, so refresh it before joining.
  void Promise.resolve()
    .then(() => client.realtime.setAuth())
    .catch(() => {})
    .then(() => {
      if (closed) return;
      ch.subscribe((status: string) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          h.onStatus('live');
          track();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          subscribed = false;
          h.onStatus('offline');
        }
      });
    });

  return {
    setFocus(key) {
      focus = key;
      track();
    },
    close() {
      if (closed) return;
      closed = true;
      void Promise.resolve(client.removeChannel(ch)).catch(() => {});
    },
  };
}
