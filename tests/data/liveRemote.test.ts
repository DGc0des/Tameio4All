import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceApi } from '../../src/data/remote/device';
import { fromServerResult } from '../../src/data/remote/deviceErrors';
import { mapError } from '../../src/data/remote/errors';
import { openShopChannel, REMOVAL_TIMEOUT_MS, type LiveHandlers } from '../../src/data/remote/live';
import { createOwnerApi } from '../../src/data/remote/owner';

const field = (key: string, over: Record<string, unknown> = {}) => ({
  key, value: { text: '5' }, version: 2, updated_by_name: 'ΜΑΡΙΑ', updated_at: '2026-11-07T10:00:00Z', ...over,
});
const closing = (over: Record<string, unknown> = {}) => ({
  id: 'oc1', business_date: '2026-11-07', config_id: 'cfg', config: { schema: 1 }, revision: 7,
  last_submit: { closing_id: 'cl1', staff_name: 'ΝΙΚΟΣ', at: '2026-11-07T09:00:00Z' },
  fields: [field('c:wolt'), field('d:100', { value: { text: '1', mode: 'count' } })], ...over,
});

function rpcClient(reply: unknown) {
  const rpc = vi.fn(() => Promise.resolve({ data: reply, error: null }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('getOpenClosing / todayClosing', () => {
  it('parses the snapshot into camelCase with fields keyed by key', async () => {
    const s = rpcClient({ ok: true, closing: closing() });
    const r = await createDeviceApi(s.client).getOpenClosing('tok');
    expect(s.rpc).toHaveBeenCalledWith('get_open_closing', { p_token: 'tok' });
    expect(r).toEqual({
      ok: true,
      data: {
        id: 'oc1', businessDate: '2026-11-07', configId: 'cfg', config: { schema: 1 }, revision: 7,
        lastSubmit: { closingId: 'cl1', staffName: 'ΝΙΚΟΣ', at: '2026-11-07T09:00:00Z' },
        fields: {
          'c:wolt': { key: 'c:wolt', value: { text: '5' }, version: 2, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T10:00:00Z' },
          'd:100': { key: 'd:100', value: { text: '1', mode: 'count' }, version: 2, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T10:00:00Z' },
        },
      },
    });
  });

  it('drops malformed fields (non-canonical d:0100, bad version) but keeps the rest; null last_submit is fine', async () => {
    const s = rpcClient({ ok: true, closing: closing({ last_submit: null, fields: [field('d:0100'), field('c:a', { version: 'x' }), field('c:ok'), 5] }) });
    const r = await createDeviceApi(s.client).getOpenClosing('tok');
    expect(r.ok && Object.keys(r.data.fields)).toEqual(['c:ok']);
    expect(r.ok && r.data.lastSubmit).toBeNull();
  });

  it('a malformed top-level part is an unexpected response', async () => {
    for (const bad of [{ revision: '7' }, { id: 5 }, { business_date: null }, { config_id: 1 }, { last_submit: { closing_id: 1 } }]) {
      const r = await createDeviceApi(rpcClient({ ok: true, closing: closing(bad) }).client).getOpenClosing('t');
      expect(r).toEqual({ ok: false, error: { code: 'unknown', detail: 'bad_response' } });
    }
  });

  it('maps server errors', async () => {
    const r = await createDeviceApi(rpcClient({ ok: false, error: 'session_invalid' }).client).getOpenClosing('t');
    expect(r).toEqual({ ok: false, error: { code: 'session_invalid' } });
  });

  it('owner: calls owner_get_open_closing; not_owner raised is mapped', async () => {
    const s = rpcClient({ ok: true, closing: closing() });
    const r = await createOwnerApi(s.client).todayClosing('shop1');
    expect(s.rpc).toHaveBeenCalledWith('owner_get_open_closing', { p_shop_id: 'shop1' });
    expect(r.ok && r.data.revision).toBe(7);
    const client = { rpc: () => Promise.resolve({ data: null, error: { message: 'not_owner', code: 'P0001' } }) } as unknown as SupabaseClient;
    expect(await createOwnerApi(client).todayClosing('s')).toEqual({ ok: false, error: { code: 'not_owner' } });
  });
});

describe('setField / setTodayField', () => {
  it('device: passes the server argument names and returns version + revision', async () => {
    const s = rpcClient({ ok: true, version: 3, revision: 9 });
    const r = await createDeviceApi(s.client).setField('tok', '2026-11-07', 'c:wolt', { text: '5' }, 2);
    expect(s.rpc).toHaveBeenCalledWith('set_closing_field', {
      p_token: 'tok', p_business_date: '2026-11-07', p_key: 'c:wolt', p_value: { text: '5' }, p_base_version: 2,
    });
    expect(r).toEqual({ ok: true, data: { version: 3, revision: 9 } });
  });

  it('device: stale becomes an error carrying the current field, filled with the request key', async () => {
    const s = rpcClient({ ok: false, error: 'stale', current: { value: { text: '9' }, version: 4, updated_by_name: 'ΝΙΚΟΣ' } });
    const r = await createDeviceApi(s.client).setField('t', 'd', 'c:wolt', { text: '5' }, 2);
    expect(r).toEqual({
      ok: false,
      error: { code: 'stale', current: { key: 'c:wolt', value: { text: '9' }, version: 4, updatedByName: 'ΝΙΚΟΣ', updatedAt: '' } },
    });
  });

  it('device: stale on a never-written field (null value/name, version 0) still maps', async () => {
    const s = rpcClient({ ok: false, error: 'stale', current: { value: null, version: 0, updated_by_name: null } });
    const r = await createDeviceApi(s.client).setField('t', 'd', 'c:x', { text: '5' }, 3);
    expect(r.ok === false && r.error).toMatchObject({ code: 'stale', current: { key: 'c:x', value: null, version: 0 } });
  });

  it('device: wrong_day / bad_field / too_many_expenses / session errors map', async () => {
    for (const code of ['wrong_day', 'bad_field', 'too_many_expenses', 'session_invalid', 'device_revoked']) {
      const r = await createDeviceApi(rpcClient({ ok: false, error: code }).client).setField('t', 'd', 'c:x', {}, null);
      expect(r).toEqual({ ok: false, error: { code } });
    }
  });

  it('owner: stale is data, success carries version + revision, bad_field is an error', async () => {
    const stale = rpcClient({ ok: false, error: 'stale', current: { value: { text: '9' }, version: 4, updated_by_name: 'ΝΙΚΟΣ' } });
    const r1 = await createOwnerApi(stale.client).setTodayField('shop1', 'c:wolt', { text: '5' }, 2);
    expect(stale.rpc).toHaveBeenCalledWith('owner_set_closing_field', { p_shop_id: 'shop1', p_key: 'c:wolt', p_value: { text: '5' }, p_base_version: 2 });
    expect(r1).toEqual({ ok: true, data: { stale: { key: 'c:wolt', value: { text: '9' }, version: 4, updatedByName: 'ΝΙΚΟΣ', updatedAt: '' } } });
    expect(await createOwnerApi(rpcClient({ ok: true, version: 1, revision: 2 }).client).setTodayField('s', 'c:a', {}, null)).toEqual({ ok: true, data: { version: 1, revision: 2 } });
    expect(await createOwnerApi(rpcClient({ ok: false, error: 'bad_field' }).client).setTodayField('s', 'c:a', {}, null)).toEqual({ ok: false, error: { code: 'bad_field' } });
    expect(await createOwnerApi(rpcClient({ ok: false, error: 'weird' }).client).setTodayField('s', 'c:a', {}, null)).toEqual({ ok: false, error: { code: 'unknown', detail: 'weird' } });
  });

  it('mapError knows the new owner codes', () => {
    expect(mapError({ message: 'too_many_expenses' })).toEqual({ code: 'too_many_expenses' });
  });
});

describe('submit with revision', () => {
  it('draft_changed carries the current revision', () => {
    expect(fromServerResult({ ok: false, error: 'draft_changed', revision: 12 })).toEqual({ code: 'draft_changed', revision: 12 });
    expect(fromServerResult({ ok: false, error: 'draft_changed' })).toEqual({ code: 'unknown', detail: 'bad_response' });
  });
});

type Cb = (arg: unknown) => void;
/** Mimics realtime-js: channel(topic) returns an existing channel for the topic; removal leaves the registry only after a tick. */
function channelClient(opts: { neverRemove?: boolean } = {}) {
  type Stub = ReturnType<typeof makeCh>;
  const registry: Stub[] = [];
  const created: Stub[] = [];
  const removing = new Set<Stub>();
  const makeCh = (topic: string) => {
    const handlers: Record<string, Cb> = {};
    let subscribeCb: ((s: string) => void) | null = null;
    let presence: Record<string, unknown[]> = {};
    const ch = {
      topic: `realtime:${topic}`,
      handlers,
      on: vi.fn((type: string, filter: { event: string }, cb: Cb) => { handlers[`${type}:${filter.event}`] = cb; return ch; }),
      subscribe: vi.fn((cb: (s: string) => void) => { subscribeCb = cb; return ch; }),
      track: vi.fn(() => Promise.resolve('ok')),
      presenceState: vi.fn(() => presence),
      status: (s: string) => subscribeCb?.(s),
      setPresence: (p: Record<string, unknown[]>) => { presence = p; },
      opts: undefined as unknown as { config: { private: boolean; presence: { key: string } } },
    };
    return ch;
  };
  const client = {
    channel: vi.fn((topic: string, opts: Stub['opts']) => {
      const existing = registry.find((c) => c.topic === `realtime:${topic}`);
      if (existing) return existing;
      const ch = makeCh(topic);
      ch.opts = opts;
      registry.push(ch);
      created.push(ch);
      return ch;
    }),
    getChannels: vi.fn(() => [...registry]),
    removeChannel: vi.fn(async (ch: Stub) => {
      // realtime-js: a second leave of a channel already leaving never settles (its bindings are torn down).
      if (opts.neverRemove || removing.has(ch)) return new Promise<never>(() => {});
      removing.add(ch);
      await new Promise((r) => setTimeout(r, 5));
      const i = registry.indexOf(ch);
      if (i >= 0) registry.splice(i, 1);
      return 'ok';
    }),
    realtime: { setAuth: vi.fn(() => Promise.resolve()) },
  };
  return { client: client as unknown as SupabaseClient, raw: client, created, registry, get ch() { return created[created.length - 1]!; } };
}
const flush = () => new Promise((r) => setTimeout(r, 20));
const mkHandlers = () => ({ onField: vi.fn(), onSubmitted: vi.fn(), onPresence: vi.fn(), onStatus: vi.fn() }) satisfies LiveHandlers;

describe('openShopChannel', () => {
  it('opens a private shop topic with a random presence key, authorizes, then subscribes', async () => {
    const c = channelClient();
    const h = mkHandlers();
    openShopChannel(c.client, 'shop1', { name: 'ΜΑΡΙΑ' }, h);
    expect(h.onStatus).toHaveBeenCalledWith('connecting');
    await flush();
    expect(c.raw.channel.mock.calls[0]![0]).toBe('shop:shop1');
    expect(c.ch.opts.config.private).toBe(true);
    expect(c.ch.opts.config.presence.key.length).toBeGreaterThan(8);
    expect(c.raw.realtime.setAuth).toHaveBeenCalled();
    expect(c.ch.subscribe).toHaveBeenCalledTimes(1);
    expect(c.raw.realtime.setAuth.mock.invocationCallOrder[0]).toBeLessThan(c.raw.channel.mock.invocationCallOrder[0]!);
  });

  it('maps statuses and tracks presence once live; setFocus re-tracks; going offline clears presence', async () => {
    const c = channelClient();
    const h = mkHandlers();
    const live = openShopChannel(c.client, 's', { name: 'ΜΑΡΙΑ' }, h);
    await flush();
    c.ch.status('SUBSCRIBED');
    expect(h.onStatus).toHaveBeenLastCalledWith('live');
    expect(c.ch.track).toHaveBeenCalledWith({ name: 'ΜΑΡΙΑ', focus: null });
    live.setFocus('c:wolt');
    expect(c.ch.track).toHaveBeenLastCalledWith({ name: 'ΜΑΡΙΑ', focus: 'c:wolt' });
    for (const st of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      c.ch.status('SUBSCRIBED');
      h.onPresence.mockClear();
      c.ch.status(st);
      expect(h.onStatus).toHaveBeenLastCalledWith('offline');
      expect(h.onPresence).toHaveBeenCalledWith([]);
    }
  });

  it('maps field and submitted broadcasts and ignores malformed ones', async () => {
    const c = channelClient();
    const h = mkHandlers();
    openShopChannel(c.client, 's', { name: 'x' }, h);
    await flush();
    const hs = c.ch.handlers;
    hs['broadcast:field']!({ payload: { ...field('c:wolt'), revision: 5, business_date: '2026-11-07' } });
    expect(h.onField).toHaveBeenCalledWith({
      key: 'c:wolt', value: { text: '5' }, version: 2, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T10:00:00Z', revision: 5, businessDate: '2026-11-07',
    });
    hs['broadcast:field']!({ payload: { ...field('d:0100'), revision: 5, business_date: 'd' } });
    hs['broadcast:field']!({ payload: { ...field('c:a'), business_date: 'd' } });
    hs['broadcast:field']!({});
    expect(h.onField).toHaveBeenCalledTimes(1);
    hs['broadcast:submitted']!({ payload: { closing_id: 'cl', staff_name: 'ΝΙΚΟΣ', at: 't' } });
    expect(h.onSubmitted).toHaveBeenCalledWith({ closingId: 'cl', staffName: 'ΝΙΚΟΣ', at: 't' });
    hs['broadcast:submitted']!({ payload: { closing_id: 1 } });
    expect(h.onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('presence sync flattens other participants and excludes self', async () => {
    const c = channelClient();
    const h = mkHandlers();
    openShopChannel(c.client, 's', { name: 'ΜΑΡΙΑ' }, h);
    await flush();
    const selfKey = c.ch.opts.config.presence.key;
    c.ch.setPresence({
      [selfKey]: [{ name: 'ΜΑΡΙΑ', focus: null }],
      other: [{ name: 'ΝΙΚΟΣ', focus: 'c:wolt' }, { name: 'ΝΙΚΟΣ', focus: 'bogus' }],
    });
    c.ch.handlers['presence:sync']!({});
    expect(h.onPresence).toHaveBeenCalledWith([{ name: 'ΝΙΚΟΣ', focus: 'c:wolt' }, { name: 'ΝΙΚΟΣ', focus: null }]);
  });

  it('close removes the channel and silences every handler', async () => {
    const c = channelClient();
    const h = mkHandlers();
    const live = openShopChannel(c.client, 's', { name: 'x' }, h);
    await flush();
    const ch = c.ch;
    ch.status('SUBSCRIBED');
    live.close();
    expect(c.raw.removeChannel).toHaveBeenCalledWith(ch);
    const calls = h.onStatus.mock.calls.length;
    ch.status('CLOSED');
    ch.handlers['broadcast:field']!({ payload: { ...field('c:a'), revision: 1, business_date: 'd' } });
    ch.handlers['presence:sync']!({});
    live.setFocus('c:a');
    expect(h.onStatus.mock.calls.length).toBe(calls);
    expect(h.onField).not.toHaveBeenCalled();
    expect(h.onPresence).not.toHaveBeenCalled();
    expect(ch.track).toHaveBeenCalledTimes(1);
  });

  it('closing before the auth refresh finishes never creates or subscribes a channel', async () => {
    const c = channelClient();
    openShopChannel(c.client, 's', { name: 'x' }, mkHandlers()).close();
    await flush();
    expect(c.created).toHaveLength(0);
  });

  it('a pre-existing channel for the topic is removed before the new one is created', async () => {
    const c = channelClient();
    const old = c.client.channel('shop:s') as never;
    c.raw.channel.mockClear();
    openShopChannel(c.client, 's', { name: 'x' }, mkHandlers());
    await flush();
    expect(c.raw.removeChannel).toHaveBeenCalledWith(old);
    expect(c.created).toHaveLength(2);
    expect(c.ch).not.toBe(old);
    expect(c.ch.subscribe).toHaveBeenCalledTimes(1);
  });

  it('StrictMode-like open -> close -> open ends live on a fresh channel with correct self-exclusion', async () => {
    const c = channelClient();
    const h1 = mkHandlers();
    const first = openShopChannel(c.client, 's', { name: 'ΜΑΡΙΑ' }, h1);
    await flush();
    const firstCh = c.ch;
    firstCh.status('SUBSCRIBED');
    first.close();
    const h2 = mkHandlers();
    openShopChannel(c.client, 's', { name: 'ΜΑΡΙΑ' }, h2);
    await flush();
    expect(c.created).toHaveLength(2);
    const second = c.ch;
    expect(second).not.toBe(firstCh);
    expect(c.registry).toEqual([second]);
    expect(c.raw.removeChannel).toHaveBeenCalledTimes(1);
    expect(c.raw.removeChannel).toHaveBeenCalledWith(firstCh);
    second.status('SUBSCRIBED');
    expect(h2.onStatus).toHaveBeenLastCalledWith('live');
    const selfKey = second.opts.config.presence.key;
    expect(selfKey).not.toBe(firstCh.opts.config.presence.key);
    second.setPresence({ [selfKey]: [{ name: 'ΜΑΡΙΑ', focus: null }], o: [{ name: 'ΝΙΚΟΣ', focus: null }] });
    second.handlers['presence:sync']!({});
    expect(h2.onPresence).toHaveBeenLastCalledWith([{ name: 'ΝΙΚΟΣ', focus: null }]);
    expect(h1.onPresence).not.toHaveBeenCalled();
  });
});

describe('openShopChannel slow removal', () => {
  it('reports offline at 3 s, keeps waiting, then ends live on a fresh channel with self excluded', async () => {
    vi.useFakeTimers();
    try {
      const c = channelClient();
      const first = openShopChannel(c.client, 's', { name: 'A' }, mkHandlers());
      await vi.advanceTimersByTimeAsync(1);
      const old = c.ch;
      // the old leave takes 8 s
      c.raw.removeChannel.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 8000));
        c.registry.splice(c.registry.indexOf(old), 1);
        return 'ok';
      });
      first.close();
      const h = mkHandlers();
      openShopChannel(c.client, 's', { name: 'ΜΑΡΙΑ' }, h);
      await vi.advanceTimersByTimeAsync(REMOVAL_TIMEOUT_MS + 100);
      expect(h.onStatus.mock.calls.map((x) => x[0])).toEqual(['connecting', 'offline']);
      expect(h.onPresence).toHaveBeenCalledWith([]);
      expect(c.created).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(6000);
      expect(c.created).toHaveLength(2);
      const fresh = c.ch;
      expect(fresh).not.toBe(old);
      fresh.status('SUBSCRIBED');
      expect(h.onStatus).toHaveBeenLastCalledWith('live');
      const key = fresh.opts.config.presence.key;
      fresh.setPresence({ [key]: [{ name: 'ΜΑΡΙΑ', focus: null }], o: [{ name: 'ΝΙΚΟΣ', focus: null }] });
      fresh.handlers['presence:sync']!({});
      expect(h.onPresence).toHaveBeenLastCalledWith([{ name: 'ΝΙΚΟΣ', focus: null }]);
      expect(c.raw.removeChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() during the wait creates no channel and calls no handler afterwards', async () => {
    vi.useFakeTimers();
    try {
      const c = channelClient();
      const first = openShopChannel(c.client, 's', { name: 'A' }, mkHandlers());
      await vi.advanceTimersByTimeAsync(1);
      const old = c.ch;
      c.raw.removeChannel.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 8000));
        c.registry.splice(c.registry.indexOf(old), 1);
        return 'ok';
      });
      first.close();
      const h = mkHandlers();
      const second = openShopChannel(c.client, 's', { name: 'B' }, h);
      await vi.advanceTimersByTimeAsync(1000);
      second.close();
      const calls = h.onStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(c.created).toHaveLength(1);
      expect(h.onStatus.mock.calls.length).toBe(calls);
      expect(h.onPresence).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('live delegation', () => {
  it('device and owner apis open the channel on the shared client', async () => {
    for (const make of [createDeviceApi, createOwnerApi]) {
      const c = channelClient();
      const live = make(c.client).live('shop9', { name: 'x' }, mkHandlers());
      await flush();
      expect(c.raw.channel).toHaveBeenCalledWith('shop:shop9', expect.anything());
      live.close();
    }
  });
});
