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
    await api.joinKey('s1');
    await api.rotateJoinKey('s1');
    await api.listDevices('s1');
    await api.removeDevice('u1');
    expect(calls.map((c) => [c[1], Object.keys(c[2] as object)])).toEqual([
      ['create_shop', ['p_name', 'p_config']],
      ['create_staff', ['p_shop_id', 'p_name', 'p_pin']],
      ['set_staff_pin', ['p_staff_id', 'p_pin']],
      ['unlock_staff', ['p_staff_id']],
      ['owner_get_join_key', ['p_shop_id']],
      ['owner_rotate_join_key', ['p_shop_id']],
      ['owner_list_devices', ['p_shop_id']],
      ['owner_remove_device', ['p_device_user_id']],
    ]);
  });

  it('reports a direct update that changed no row as not_owner', async () => {
    const { api } = fake({ data: [], error: null });
    expect(await api.renameShop('s1', 'X')).toEqual({ ok: false, error: { code: 'not_owner' } });
    expect(await api.renameDevice('u1', 'Ταμείο')).toEqual({ ok: false, error: { code: 'not_owner' } });
  });

  it('renames a device with a label-only update of its row', async () => {
    const { api, calls } = fake({ data: [{ user_id: 'u1' }], error: null });
    expect(await api.renameDevice('u1', 'Ταμείο μπαρ')).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([
      ['from', 'devices'],
      ['update', { label: 'Ταμείο μπαρ' }],
      ['eq', 'user_id', 'u1'],
      ['select', 'user_id'],
    ]);
  });

  it('reads the store key and its replacement, refusing a payload that is not a key', async () => {
    const good = fake({ data: 'ABCDEFGHJKLMNPQR', error: null });
    expect(await good.api.joinKey('s1')).toEqual({ ok: true, data: 'ABCDEFGHJKLMNPQR' });
    expect(good.calls).toEqual([['rpc', 'owner_get_join_key', { p_shop_id: 's1' }]]);
    const rotated = fake({ data: 'STUVWXYZ23456789', error: null });
    expect(await rotated.api.rotateJoinKey('s1')).toEqual({ ok: true, data: 'STUVWXYZ23456789' });
    expect(rotated.calls).toEqual([['rpc', 'owner_rotate_join_key', { p_shop_id: 's1' }]]);
    const bad = { ok: false, error: { code: 'unknown', detail: 'bad_response' } };
    expect(await fake({ data: 'nope', error: null }).api.joinKey('s1')).toEqual(bad);
    expect(await fake({ data: null, error: null }).api.joinKey('s1')).toEqual(bad);
    expect(await fake({ data: 42, error: null }).api.rotateJoinKey('s1')).toEqual(bad);
  });

  it('maps a not_owner raise from the key and device functions', async () => {
    const notOwner = { data: null, error: { message: 'not_owner', code: '42501' } };
    expect(await fake(notOwner).api.joinKey('s1')).toEqual({ ok: false, error: { code: 'not_owner' } });
    expect(await fake(notOwner).api.rotateJoinKey('s1')).toEqual({ ok: false, error: { code: 'not_owner' } });
    expect(await fake(notOwner).api.listDevices('s1')).toEqual({ ok: false, error: { code: 'not_owner' } });
    expect(await fake(notOwner).api.removeDevice('u1')).toEqual({ ok: false, error: { code: 'not_owner' } });
  });

  it('removes a device through owner_remove_device', async () => {
    const { api, calls } = fake({ data: null, error: null });
    expect(await api.removeDevice('u1')).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([['rpc', 'owner_remove_device', { p_device_user_id: 'u1' }]]);
  });

  it('maps owner_list_devices rows and reads a null payload as no devices', async () => {
    const row = { user_id: 'u1', label: 'Ταμείο 1', created_at: '2026-09-20T08:00:00Z', last_seen_at: '2026-11-10T18:00:00Z', last_staff_name: 'ΜΑΡΙΑ' };
    const { api, calls } = fake({ data: [row, { ...row, user_id: 'u2', label: '', last_seen_at: null, last_staff_name: null }], error: null });
    expect(await api.listDevices('s1')).toEqual({
      ok: true,
      data: [
        { userId: 'u1', label: 'Ταμείο 1', createdAt: '2026-09-20T08:00:00Z', lastSeenAt: '2026-11-10T18:00:00Z', lastStaffName: 'ΜΑΡΙΑ' },
        { userId: 'u2', label: '', createdAt: '2026-09-20T08:00:00Z', lastSeenAt: null, lastStaffName: null },
      ],
    });
    expect(calls).toEqual([['rpc', 'owner_list_devices', { p_shop_id: 's1' }]]);
    expect(await fake({ data: null, error: null }).api.listDevices('s1')).toEqual({ ok: true, data: [] });
    expect(await fake({ data: 'x', error: null }).api.listDevices('s1')).toEqual({ ok: false, error: { code: 'unknown', detail: 'bad_response' } });
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

  it('reads the day-change time as HH:MM and hides a switch already in the past', async () => {
    const past = fake({ data: [{ day_change_time: '06:00:00', day_change_switch_at: '2020-01-01T00:00:00Z' }], error: null });
    expect(await past.api.dayChange('s1')).toEqual({ ok: true, data: { time: '06:00', fromDate: null } });
    expect(past.calls[0]).toEqual(['from', 'shops']);
  });

  it('gives the Athens date of a pending day-change switch', async () => {
    const { api } = fake({ data: [{ day_change_time: '04:00:00', day_change_switch_at: '2999-03-04T22:30:00Z' }], error: null });
    expect(await api.dayChange('s1')).toEqual({ ok: true, data: { time: '04:00', fromDate: '2999-03-05' } });
  });

  it('reports not_owner when no shop row is visible', async () => {
    const { api } = fake({ data: [], error: null });
    expect(await api.dayChange('s1')).toEqual({ ok: false, error: { code: 'not_owner' } });
  });

  it('calls set_day_change_time and returns the from-date', async () => {
    const { api, calls } = fake({ data: '2026-11-08', error: null });
    expect(await api.setDayChange('s1', '06:00')).toEqual({ ok: true, data: '2026-11-08' });
    expect(calls).toEqual([['rpc', 'set_day_change_time', { p_shop_id: 's1', p_time: '06:00' }]]);
  });

  describe('history', () => {
    const version = { id: 'v1', kind: 'staff', author_name: 'Μ', created_at: 't', config_id: 'c1', inputs: {}, corrects_closing_id: null };

    it('listClosings calls owner_list_closings and parses the payload', async () => {
      const payload = {
        ok: true, today: '2026-11-11', from: '2026-10-13', to: '2026-11-11', configs: {},
        days: [{ business_date: '2026-11-10', status: 'submitted', version_count: 1, current: version }],
      };
      const { api, calls } = fake({ data: payload, error: null });
      const r = await api.listClosings('s1', null, '2026-11-11');
      expect(calls).toEqual([['rpc', 'owner_list_closings', { p_shop_id: 's1', p_from: null, p_to: '2026-11-11' }]]);
      expect(r.ok && r.data.days).toHaveLength(1);
    });

    it('listClosings maps bad_range and a rejected payload', async () => {
      expect(await fake({ data: { ok: false, error: 'bad_range' }, error: null }).api.listClosings('s1', null, null))
        .toEqual({ ok: false, error: { code: 'bad_range' } });
      expect(await fake({ data: { ok: true }, error: null }).api.listClosings('s1', null, null))
        .toEqual({ ok: false, error: { code: 'unknown', detail: 'bad_response' } });
    });

    it('closingDay calls owner_get_closing_day and parses the payload', async () => {
      const payload = { ok: true, today: '2026-11-11', business_date: '2026-11-10', versions: [version], configs: {}, staff_names: {}, open: null };
      const { api, calls } = fake({ data: payload, error: null });
      const r = await api.closingDay('s1', '2026-11-10');
      expect(calls).toEqual([['rpc', 'owner_get_closing_day', { p_shop_id: 's1', p_business_date: '2026-11-10' }]]);
      expect(r.ok && r.data.versions[0]?.id).toBe('v1');
      expect(await fake({ data: { ok: true, versions: 1 }, error: null }).api.closingDay('s1', '2026-11-10'))
        .toEqual({ ok: false, error: { code: 'unknown', detail: 'bad_response' } });
    });

    const args = {
      businessDate: '2026-11-10', configId: 'c1', inputs: { schema: 2 } as never, expectedCurrentId: 'v1', key: 'k1',
    };

    it('saveClosing calls owner_save_closing with the server parameter names', async () => {
      const { api, calls } = fake({ data: { ok: true, closing_id: 'c', repeat: true }, error: null });
      expect(await api.saveClosing('s1', args)).toEqual({ ok: true, data: { closingId: 'c', repeat: true } });
      expect(calls).toEqual([[
        'rpc', 'owner_save_closing',
        { p_shop_id: 's1', p_business_date: '2026-11-10', p_config_id: 'c1', p_inputs: { schema: 2 }, p_expected_current_id: 'v1', p_idempotency_key: 'k1', p_revision: null },
      ]]);
    });

    it('saveClosing sends the live revision for today and maps draft_changed', async () => {
      const { api, calls } = fake({ data: { ok: false, error: 'draft_changed', revision: 8 }, error: null });
      expect(await api.saveClosing('s1', { ...args, revision: 7 })).toEqual({ ok: false, error: { code: 'draft_changed' } });
      expect((calls[0]![2] as Record<string, unknown>).p_revision).toBe(7);
    });

    it('saveClosing maps closing_changed with the current id, and other payload errors', async () => {
      expect(await fake({ data: { ok: false, error: 'closing_changed', current_id: 'x' }, error: null }).api.saveClosing('s1', args))
        .toEqual({ ok: false, error: { code: 'closing_changed', currentId: 'x' } });
      expect(await fake({ data: { ok: false, error: 'closing_changed', current_id: null }, error: null }).api.saveClosing('s1', args))
        .toEqual({ ok: false, error: { code: 'closing_changed', currentId: null } });
      expect(await fake({ data: { ok: false, error: 'config_mismatch' }, error: null }).api.saveClosing('s1', args))
        .toEqual({ ok: false, error: { code: 'config_mismatch' } });
      expect(await fake({ data: { ok: true, closing_id: '', repeat: false }, error: null }).api.saveClosing('s1', args))
        .toEqual({ ok: false, error: { code: 'unknown', detail: 'bad_response' } });
    });
  });
});
