import { describe, expect, it } from 'vitest';
import { newShopConfig } from '../../src/core/config';
import { AUTH_STORAGE_KEY, authStorage } from '../../src/data/local/authStorage';
import { clearOwnerDraft, loadOwnerDraft, saveOwnerDraft } from '../../src/data/local/ownerDrafts';
import { memoryStore, shopKey, type KeyValueStore } from '../../src/data/local/storage';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

describe('authStorage', () => {
  it('passes through to the store and never throws', () => {
    const s = memoryStore();
    const a = authStorage(s);
    a.setItem(AUTH_STORAGE_KEY, 'tok');
    expect(s.getItem(AUTH_STORAGE_KEY)).toBe('tok');
    a.removeItem(AUTH_STORAGE_KEY);
    expect(a.getItem(AUTH_STORAGE_KEY)).toBeNull();
    const t = authStorage(throwing);
    expect(() => t.setItem('k', 'v')).not.toThrow();
    expect(t.getItem('k')).toBeNull();
    expect(() => t.removeItem('k')).not.toThrow();
  });
});

describe('owner drafts', () => {
  it('round-trips per shop', () => {
    const s = memoryStore();
    const draft = { config: newShopConfig(), baseVersion: 3, savedAt: 1 };
    expect(saveOwnerDraft(s, 'shop-a', draft)).toBe(true);
    expect(loadOwnerDraft(s, 'shop-a')).toEqual(draft);
    expect(loadOwnerDraft(s, 'shop-b')).toBeNull();
    clearOwnerDraft(s, 'shop-a');
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
  });

  it('drops corrupt or structurally broken drafts', () => {
    const s = memoryStore();
    s.setItem(shopKey('shop-a', 'owner-draft'), '{{{');
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
    s.setItem(shopKey('shop-a', 'owner-draft'), JSON.stringify({ config: { schema: 1 }, baseVersion: 1, savedAt: 1 }));
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
    s.setItem(shopKey('shop-a', 'owner-draft'), JSON.stringify({ config: newShopConfig(), baseVersion: '1', savedAt: 1 }));
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
  });

  it('survives a store that throws', () => {
    expect(saveOwnerDraft(throwing, 'x', { config: newShopConfig(), baseVersion: 1, savedAt: 1 })).toBe(false);
    expect(loadOwnerDraft(throwing, 'x')).toBeNull();
    expect(() => clearOwnerDraft(throwing, 'x')).not.toThrow();
  });
});
