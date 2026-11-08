import { describe, expect, it } from 'vitest';
import {
  clearStaffSession, loadCachedContext, loadStaffSession, saveCachedContext, saveStaffSession,
} from '../../src/data/local/phone';
import { memoryStore, type KeyValueStore } from '../../src/data/local/storage';
import type { DeviceContext, StaffSession } from '../../src/data/remote/deviceApi';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};
const session: StaffSession = { token: 't1', staffId: 's1', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: 'shop-1' };
const ctx: DeviceContext = { shopId: 'shop-1', shopName: 'Join Juice', configId: 'c1', config: { schema: 1 }, businessDate: '2026-11-07' };
const SESSION_KEY = 'tameio4all:v1:phone:session';
const CONTEXT_KEY = 'tameio4all:v1:phone:context';

describe('phone local storage', () => {
  it('round-trips the staff session under its key, and clears it', () => {
    const s = memoryStore();
    expect(loadStaffSession(s)).toBeNull();
    expect(saveStaffSession(s, session)).toBe(true);
    expect(s.getItem(SESSION_KEY)).not.toBeNull();
    expect(loadStaffSession(s)).toEqual(session);
    clearStaffSession(s);
    expect(loadStaffSession(s)).toBeNull();
  });

  it('round-trips the cached context under its key', () => {
    const s = memoryStore();
    expect(loadCachedContext(s)).toBeNull();
    expect(saveCachedContext(s, ctx)).toBe(true);
    expect(s.getItem(CONTEXT_KEY)).not.toBeNull();
    expect(loadCachedContext(s)).toEqual(ctx);
  });

  it('corrupt or wrongly shaped JSON loads as null', () => {
    const s = memoryStore();
    s.setItem(SESSION_KEY, 'not json');
    s.setItem(CONTEXT_KEY, '{');
    expect(loadStaffSession(s)).toBeNull();
    expect(loadCachedContext(s)).toBeNull();
    s.setItem(SESSION_KEY, JSON.stringify({ ...session, token: 5 }));
    s.setItem(CONTEXT_KEY, JSON.stringify({ shopId: 'x' }));
    expect(loadStaffSession(s)).toBeNull();
    expect(loadCachedContext(s)).toBeNull();
  });

  it('never throws when storage refuses', () => {
    expect(saveStaffSession(throwing, session)).toBe(false);
    expect(saveCachedContext(throwing, ctx)).toBe(false);
    expect(loadStaffSession(throwing)).toBeNull();
    expect(loadCachedContext(throwing)).toBeNull();
    expect(() => clearStaffSession(throwing)).not.toThrow();
  });
});
