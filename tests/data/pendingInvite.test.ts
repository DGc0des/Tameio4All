import { describe, expect, it } from 'vitest';
import { memoryStore, type KeyValueStore } from '../../src/data/local/storage';
import { clearPendingInvite, loadPendingInvite, savePendingInvite } from '../../src/data/local/pendingInvite';

const T = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('pending invite', () => {
  it('saves, loads and clears', () => {
    const s = memoryStore();
    expect(loadPendingInvite(s)).toBeNull();
    expect(savePendingInvite(s, T)).toBe(true);
    expect(loadPendingInvite(s)).toBe(T);
    clearPendingInvite(s);
    expect(loadPendingInvite(s)).toBeNull();
  });
  it('ignores junk', () => {
    const s = memoryStore();
    s.setItem('tameio4all:v1:pending-invite', JSON.stringify('nope'));
    expect(loadPendingInvite(s)).toBeNull();
  });
  it('is failure-safe', () => {
    const boom = () => {
      throw new Error('x');
    };
    const s: KeyValueStore = { getItem: boom, setItem: boom, removeItem: boom };
    expect(loadPendingInvite(s)).toBeNull();
    expect(savePendingInvite(s, T)).toBe(false);
    expect(() => clearPendingInvite(s)).not.toThrow();
  });
});
