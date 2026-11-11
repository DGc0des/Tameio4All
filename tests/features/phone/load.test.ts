import { beforeEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
import { loadCachedContext, loadJoinKey, saveCachedContext, saveJoinKey, saveStaffSession } from '../../../src/data/local/phone';
import { memoryStore, type KeyValueStore } from '../../../src/data/local/storage';
import type { DeviceApi, DeviceContext, StaffSession } from '../../../src/data/remote/deviceApi';
import { loadGate } from '../../../src/features/phone/model/load';
import { fail, FAKE_CONFIG_ID, FAKE_SHOP_ID, fakeDeviceApi, ok } from './fakeDeviceApi';

const K = 'ABCDEFGHJKLMNPQR';
const CTX: DeviceContext = {
  shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: joinJuicePreset, businessDate: '2026-11-07',
};
const SESSION: StaffSession = { token: 'token-1', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: FAKE_SHOP_ID };

let store: KeyValueStore;
beforeEach(() => {
  store = memoryStore();
  saveJoinKey(store, K);
});

describe('loadGate', () => {
  it('paired phone: loaded, join never called', async () => {
    const api = fakeDeviceApi();
    expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'loaded', ctx: { shopId: FAKE_SHOP_ID } });
    expect(api.join).not.toHaveBeenCalled();
    expect(loadCachedContext(store)).toEqual(CTX);
  });

  it('no session + stored key: joins once, then loads the context', async () => {
    const session = vi.fn<DeviceApi['session']>().mockReturnValueOnce(ok(null));
    const api = fakeDeviceApi({ session });
    const e = await loadGate(api, store, 'iPhone');
    expect(api.join).toHaveBeenCalledTimes(1);
    expect(api.join).toHaveBeenCalledWith(K, 'iPhone', undefined);
    expect(e).toMatchObject({ t: 'loaded', ctx: { shopId: FAKE_SHOP_ID } });
  });

  it('context says not_a_device + stored key: joins once', async () => {
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(fail({ code: 'not_a_device' })).mockReturnValue(ok(CTX));
    const api = fakeDeviceApi({ context });
    expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'loaded', ctx: { shopId: FAKE_SHOP_ID } });
    expect(api.join).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledTimes(2);
  });

  it('no stored key: loaded with ctx null, join never called', async () => {
    const empty = memoryStore();
    const api = fakeDeviceApi({ context: vi.fn(() => ok<DeviceContext | null>(null)) });
    expect(await loadGate(api, empty, 'iPhone')).toMatchObject({ t: 'loaded', ctx: null });
    expect(api.join).not.toHaveBeenCalled();
    const none = fakeDeviceApi({ session: vi.fn(() => ok(null)) });
    expect(await loadGate(none, empty, 'iPhone')).toEqual({ t: 'loaded', ctx: null, stored: null });
    expect(none.join).not.toHaveBeenCalled();
    expect(none.context).not.toHaveBeenCalled();
  });

  it('owner session: never joins, even with a stored key', async () => {
    const api = fakeDeviceApi({
      session: vi.fn(() => ok({ anonymous: false })),
      context: vi.fn(() => ok<DeviceContext | null>(null)),
    });
    expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'loaded', ctx: null });
    expect(api.join).not.toHaveBeenCalled();
    expect(loadJoinKey(store)).toBe(K);
  });

  it('replaced link: invalid_code clears the key and reports it', async () => {
    const api = fakeDeviceApi({
      context: vi.fn(() => fail<DeviceContext | null>({ code: 'not_a_device' })),
      join: vi.fn(() => fail<void>({ code: 'invalid_code' })),
    });
    expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'load_failed', error: { code: 'invalid_code' } });
    expect(loadJoinKey(store)).toBeNull();
  });

  it('network failure on the re-join keeps the key and falls back like any offline load', async () => {
    saveCachedContext(store, CTX);
    saveStaffSession(store, SESSION);
    const api = fakeDeviceApi({
      context: vi.fn(() => fail<DeviceContext | null>({ code: 'not_a_device' })),
      join: vi.fn(() => fail<void>({ code: 'network' })),
    });
    expect(await loadGate(api, store, 'iPhone')).toEqual({ t: 'load_failed', error: { code: 'network' }, cached: CTX, stored: SESSION });
    expect(api.join).toHaveBeenCalledTimes(1);
    expect(loadJoinKey(store)).toBe(K);
  });

  it('owner_signed_in on the re-join: not in a store, no notice', async () => {
    const api = fakeDeviceApi({
      context: vi.fn(() => fail<DeviceContext | null>({ code: 'not_a_device' })),
      join: vi.fn(() => fail<void>({ code: 'owner_signed_in' })),
    });
    expect(await loadGate(api, store, 'iPhone')).toEqual({ t: 'loaded', ctx: null, stored: null });
  });

  it('join ok but context still fails: one join only, the failure is returned', async () => {
    const api = fakeDeviceApi({ context: vi.fn(() => fail<DeviceContext | null>({ code: 'not_a_device' })) });
    expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'load_failed', error: { code: 'not_a_device' } });
    expect(api.join).toHaveBeenCalledTimes(1);
    expect(api.context).toHaveBeenCalledTimes(2);
  });

  it('a non-network context failure is returned as is, no join', async () => {
    const api = fakeDeviceApi({ context: vi.fn(() => fail<DeviceContext | null>({ code: 'device_revoked' })) });
    expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'load_failed', error: { code: 'device_revoked' } });
    expect(api.join).not.toHaveBeenCalled();
  });
});
