import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { newShopConfig } from '../../src/core/config';
import { createOwnerApi } from '../../src/data/remote/owner';

type Reply = { data: unknown; error: unknown };

/** Records every call; `from(...)` returns a chainable builder that resolves to `reply`. */
function fake(reply: Reply, authReply: Reply = { data: {}, error: null }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'eq', 'order', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: Reply) => unknown) => resolve(reply);
  const client = {
    rpc: (...args: unknown[]) => {
      calls.push(['rpc', ...args]);
      return Promise.resolve(reply);
    },
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
    auth: {
      exchangeCodeForSession: () => Promise.resolve(authReply),
      signInWithPassword: () => Promise.resolve(authReply),
    },
  };
  return { api: createOwnerApi(client as unknown as SupabaseClient), calls };
}

describe('createOwnerApi', () => {
  it('calls publish_config with the server parameter names', async () => {
    const { api, calls } = fake({ data: 4, error: null });
    const config = newShopConfig();
    expect(await api.publishConfig('s1', 3, config)).toEqual({ ok: true, data: 4 });
    expect(calls).toEqual([['rpc', 'publish_config', { p_shop_id: 's1', p_expected_version: 3, p_config: config }]]);
  });

  it('maps a version conflict', async () => {
    const { api } = fake({ data: null, error: { message: 'version_conflict', details: 'current version is 5', code: 'P0001' } });
    expect(await api.publishConfig('s1', 3, newShopConfig())).toEqual({ ok: false, error: { code: 'version_conflict', currentVersion: 5 } });
  });

  it('uses the right parameter names for every owner function', async () => {
    const { api, calls } = fake({ data: 'x', error: null });
    await api.createShop('Shop', newShopConfig());
    await api.createStaff('s1', 'ΜΑΡΙΑ', '1234');
    await api.setStaffPin('st1', '9876');
    await api.unlockStaff('st1');
    await api.createPairingCode('s1');
    expect(calls.map((c) => [c[1], Object.keys(c[2] as object)])).toEqual([
      ['create_shop', ['p_name', 'p_config']],
      ['create_staff', ['p_shop_id', 'p_name', 'p_pin']],
      ['set_staff_pin', ['p_staff_id', 'p_pin']],
      ['unlock_staff', ['p_staff_id']],
      ['create_pairing_code', ['p_shop_id']],
    ]);
  });

  it('reports a direct update that changed no row as not_owner', async () => {
    const { api } = fake({ data: [], error: null });
    expect(await api.renameShop('s1', 'X')).toEqual({ ok: false, error: { code: 'not_owner' } });
    expect(await api.updateDevice('u1', { revoke: true })).toEqual({ ok: false, error: { code: 'not_owner' } });
  });

  it('lists staff without ever selecting pin_hash', async () => {
    const { api, calls } = fake({ data: [{ id: 'a', name: 'ΜΑΡΙΑ', active: true, locked_until: null }], error: null });
    expect(await api.listStaff('s1')).toEqual({ ok: true, data: [{ id: 'a', name: 'ΜΑΡΙΑ', active: true, lockedUntil: null }] });
    const select = calls.find((c) => c[0] === 'select');
    expect(String(select?.[1])).not.toContain('pin_hash');
  });

  it('returns the latest config row or null', async () => {
    expect(await fake({ data: [{ id: 'c', version: 2, config: {} }], error: null }).api.latestConfig('s1'))
      .toEqual({ ok: true, data: { id: 'c', version: 2, config: {} } });
    expect(await fake({ data: [], error: null }).api.latestConfig('s1')).toEqual({ ok: true, data: null });
  });

  it('turns a failed code exchange into link_invalid, but keeps network errors', async () => {
    const bad = fake({ data: null, error: null }, { data: {}, error: { name: 'AuthApiError', code: 'bad_code_verifier', message: 'x' } });
    expect(await bad.api.exchangeCode('c')).toEqual({ ok: false, error: { code: 'link_invalid' } });
    const offline = fake({ data: null, error: null }, { data: {}, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
    expect(await offline.api.exchangeCode('c')).toEqual({ ok: false, error: { code: 'network' } });
  });

  it('maps a thrown fetch to network', async () => {
    const { api } = fake({ data: null, error: null });
    const throwing = createOwnerApi({ rpc: () => Promise.reject(new TypeError('Failed to fetch')) } as unknown as SupabaseClient);
    expect(await throwing.unlockStaff('x')).toEqual({ ok: false, error: { code: 'network' } });
    expect(api).toBeTruthy();
  });
});
