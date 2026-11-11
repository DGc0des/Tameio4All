import { describe, expect, it, vi } from 'vitest';
import { loadJoinKey, saveJoinKey } from '../../../src/data/local/phone';
import { memoryStore, type KeyValueStore } from '../../../src/data/local/storage';
import { joinStore } from '../../../src/features/phone/model/join';
import { platformLabel } from '../../../src/features/phone/model/platform';
import { fail, fakeDeviceApi } from './fakeDeviceApi';

const K = 'ABCDEFGHJKLMNPQR';
const K2 = 'STUVWXYZ23456789';
const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

describe('joinStore', () => {
  it('saves the key after a successful join', async () => {
    const api = fakeDeviceApi();
    const store = memoryStore();
    expect((await joinStore(api, store, K, 'iPhone')).ok).toBe(true);
    expect(api.join).toHaveBeenCalledWith(K, 'iPhone', undefined);
    expect(loadJoinKey(store)).toBe(K);
  });

  it('passes the options through', async () => {
    const api = fakeDeviceApi();
    await joinStore(api, memoryStore(), K, 'iPhone', { switchShop: true });
    expect(api.join).toHaveBeenCalledWith(K, 'iPhone', { switchShop: true });
  });

  it('forgets a stored key the server no longer accepts', async () => {
    const store = memoryStore();
    saveJoinKey(store, K);
    const api = fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'invalid_code' })) });
    expect(await joinStore(api, store, K, 'iPhone')).toEqual({ ok: false, error: { code: 'invalid_code' } });
    expect(loadJoinKey(store)).toBeNull();
  });

  it('keeps the stored key when another key is refused, and on a network failure', async () => {
    const store = memoryStore();
    saveJoinKey(store, K);
    await joinStore(fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'invalid_code' })) }), store, K2, 'iPhone');
    expect(loadJoinKey(store)).toBe(K);
    await joinStore(fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'network' })) }), store, K, 'iPhone');
    expect(loadJoinKey(store)).toBe(K);
  });

  it('a successful join of another store replaces the stored key', async () => {
    const store = memoryStore();
    saveJoinKey(store, K);
    await joinStore(fakeDeviceApi(), store, K2, 'iPhone', { switchShop: true });
    expect(loadJoinKey(store)).toBe(K2);
  });

  it('joins even when storage is unavailable (Review Focus 4)', async () => {
    expect((await joinStore(fakeDeviceApi(), throwing, K, 'iPhone')).ok).toBe(true);
    const refused = fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'invalid_code' })) });
    expect((await joinStore(refused, throwing, K, 'iPhone')).ok).toBe(false);
  });
});

describe('platformLabel', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 'iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'iPad'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile', 'Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'Υπολογιστής'],
    ['', 'Υπολογιστής'],
  ])('%s → %s', (ua, label) => expect(platformLabel(ua)).toBe(label));
});
