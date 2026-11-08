import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceApi } from '../../src/data/remote/device';

type Reply = { data: unknown; error: unknown };

function stub(
  opts: { user?: { is_anonymous: boolean } | null; rpc?: Record<string, Reply>; getSession?: () => Promise<unknown> } = {},
) {
  const user = opts.user === undefined ? { is_anonymous: true } : opts.user;
  const rpc = vi.fn((name: string) => Promise.resolve(opts.rpc?.[name] ?? { data: null, error: null }));
  const auth = {
    getSession: vi.fn(opts.getSession ?? (() => Promise.resolve({ data: { session: user ? { user } : null }, error: null }))),
    signInAnonymously: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
  return { client: { rpc, auth } as unknown as SupabaseClient, rpc, auth };
}

// auth-js returns this when the stored access token expired and refreshing it failed (e.g. offline);
// the refresh token stays stored, so the phone is still paired.
const refreshFailed = () =>
  Promise.resolve({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });

describe('createDeviceApi', () => {
  it('session: no session and no error is "definitely none"; a session reports anonymity', async () => {
    expect(await createDeviceApi(stub({ user: null }).client).session()).toEqual({ ok: true, data: null });
    expect(await createDeviceApi(stub().client).session()).toEqual({ ok: true, data: { anonymous: true } });
    expect(await createDeviceApi(stub({ user: { is_anonymous: false } }).client).session()).toEqual({
      ok: true,
      data: { anonymous: false },
    });
  });

  it('session: a failed refresh ({session:null, error}) is not "no session"', async () => {
    const r = await createDeviceApi(stub({ getSession: refreshFailed }).client).session();
    expect(r).toEqual({ ok: false, error: { code: 'network' } });
  });

  it('session: a throwing getSession is not "no session"', async () => {
    const r = await createDeviceApi(stub({ getSession: () => Promise.reject(new TypeError('Failed to fetch')) }).client).session();
    expect(r).toEqual({ ok: false, error: { code: 'network' } });
  });

  it('pair does not sign in anonymously when the session lookup fails', async () => {
    const s = stub({ getSession: refreshFailed });
    expect(await createDeviceApi(s.client).pair('A', 'L')).toEqual({ ok: false, error: { code: 'network' } });
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(s.auth.signOut).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it('pair refuses an owner session without force, calling nothing', async () => {
    const s = stub({ user: { is_anonymous: false } });
    const r = await createDeviceApi(s.client).pair('ABCD', 'Phone');
    expect(r).toEqual({ ok: false, error: { code: 'owner_signed_in' } });
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.auth.signOut).not.toHaveBeenCalled();
  });

  it('pair with force signs the owner out, signs in anonymously, then redeems', async () => {
    const s = stub({ user: { is_anonymous: false } });
    const r = await createDeviceApi(s.client).pair('ABCD', 'Phone', { force: true });
    expect(r.ok).toBe(true);
    expect(s.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(s.auth.signInAnonymously).toHaveBeenCalled();
    expect(s.rpc).toHaveBeenCalledWith('redeem_pairing_code', { p_code: 'ABCD', p_label: 'Phone' });
  });

  it('pair signs in anonymously when there is no session; reuses an existing anonymous one', async () => {
    const none = stub({ user: null });
    await createDeviceApi(none.client).pair('A', 'L');
    expect(none.auth.signInAnonymously).toHaveBeenCalled();
    const anon = stub();
    await createDeviceApi(anon.client).pair('A', 'L');
    expect(anon.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('pair maps a raised invalid_code', async () => {
    const s = stub({ rpc: { redeem_pairing_code: { data: null, error: { message: 'invalid_code', code: '22023' } } } });
    expect(await createDeviceApi(s.client).pair('X', 'L')).toEqual({ ok: false, error: { code: 'invalid_code' } });
  });

  it('context: no rows is not paired; rows map to DeviceContext', async () => {
    const empty = stub({ rpc: { device_context: { data: [], error: null } } });
    expect(await createDeviceApi(empty.client).context()).toEqual({ ok: true, data: null });
    const row = { shop_id: 's1', shop_name: 'Shop', config_id: 'c1', version: 3, config: { a: 1 }, business_date: '2026-11-07' };
    const full = stub({ rpc: { device_context: { data: [row], error: null } } });
    expect(await createDeviceApi(full.client).context()).toEqual({
      ok: true,
      data: { shopId: 's1', shopName: 'Shop', configId: 'c1', config: { a: 1 }, businessDate: '2026-11-07' },
    });
  });

  it('signIn carries the shop id from the last context() and maps failures', async () => {
    const row = { shop_id: 's1', shop_name: 'Shop', config_id: 'c1', config: {}, business_date: '2026-11-07' };
    const good = stub({
      rpc: {
        device_context: { data: [row], error: null },
        staff_sign_in: { data: { ok: true, token: 't', staff_id: 'p1', name: 'ΜΑΡΙΑ', business_date: '2026-11-07' }, error: null },
      },
    });
    const api = createDeviceApi(good.client);
    const before = await api.signIn('p1', '1234');
    expect(before).toMatchObject({ ok: true, data: { shopId: '' } });
    await api.context();
    expect(await api.signIn('p1', '1234')).toEqual({
      ok: true,
      data: { token: 't', staffId: 'p1', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: 's1' },
    });
    expect(good.rpc).toHaveBeenCalledWith('staff_sign_in', { p_staff_id: 'p1', p_pin: '1234' });

    const locked = stub({ rpc: { staff_sign_in: { data: { ok: false, error: 'staff_locked', locked_until: 'T' }, error: null } } });
    expect(await createDeviceApi(locked.client).signIn('p1', '0')).toEqual({
      ok: false,
      error: { code: 'staff_locked', lockedUntil: 'T' },
    });
  });

  it('submit passes the server argument names and maps the result', async () => {
    const s = stub({ rpc: { submit_closing: { data: { ok: true, closing_id: 'cl1', repeat: true }, error: null } } });
    const inputs = { schema: 2 } as never;
    const r = await createDeviceApi(s.client).submit('tok', 'cfg', '2026-11-07', inputs, 'key');
    expect(r).toEqual({ ok: true, data: { closingId: 'cl1', repeat: true } });
    expect(s.rpc).toHaveBeenCalledWith('submit_closing', {
      p_token: 'tok',
      p_config_id: 'cfg',
      p_business_date: '2026-11-07',
      p_inputs: inputs,
      p_idempotency_key: 'key',
    });
    const refused = stub({ rpc: { submit_closing: { data: { ok: false, error: 'wrong_day' }, error: null } } });
    expect(await createDeviceApi(refused.client).submit('t', 'c', 'd', inputs, 'k')).toEqual({
      ok: false,
      error: { code: 'wrong_day' },
    });
  });

  it('suggestionData maps rows to {description, cents, date}', async () => {
    const s = stub({
      rpc: { expense_suggestion_data: { data: [{ description: 'Φρούτα', cents: 1250, business_date: '2026-11-06' }], error: null } },
    });
    expect(await createDeviceApi(s.client).suggestionData()).toEqual({
      ok: true,
      data: [{ description: 'Φρούτα', cents: 1250, date: '2026-11-06' }],
    });
  });

  it('suggestionData skips rows whose cents is not a safe non-negative integer', async () => {
    const rows = [
      { description: 'A', cents: 'abc', business_date: '2026-11-06' },
      { description: 'B', cents: null, business_date: '2026-11-06' },
      { description: 'C', cents: -5, business_date: '2026-11-06' },
      { description: 'D', cents: 1.5, business_date: '2026-11-06' },
      { description: 'E', cents: 1e20, business_date: '2026-11-06' },
      { description: 'F', cents: '700', business_date: '2026-11-06' },
      { description: 'G', cents: 0, business_date: '2026-11-06' },
    ];
    const s = stub({ rpc: { expense_suggestion_data: { data: rows, error: null } } });
    expect(await createDeviceApi(s.client).suggestionData()).toEqual({
      ok: true,
      data: [
        { description: 'F', cents: 700, date: '2026-11-06' },
        { description: 'G', cents: 0, date: '2026-11-06' },
      ],
    });
  });

  it('never throws: a rejected call becomes a network error; signOut swallows failures', async () => {
    const s = stub();
    s.rpc.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const api = createDeviceApi(s.client);
    expect(await api.listStaff()).toEqual({ ok: false, error: { code: 'network' } });
    await expect(api.signOut('t')).resolves.toBeUndefined();
  });
});
