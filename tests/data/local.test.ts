import { describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '../../src/data/local/drafts';
import { loadTheme, saveTheme } from '../../src/data/local/prefs';
import {
  memoryStore, readJson, removeKey, shopKey, writeJson, type KeyValueStore,
} from '../../src/data/local/storage';
import { newDraft } from '../../src/features/register/draft';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

describe('storage', () => {
  it('namespaces keys per shop', () => {
    expect(shopKey('local', 'draft')).toBe('tameio4all:v1:local:draft');
  });

  it('round-trips JSON and treats garbage as missing', () => {
    const s = memoryStore();
    expect(writeJson(s, 'k', { a: 1 })).toBe(true);
    expect(readJson(s, 'k')).toEqual({ a: 1 });
    s.setItem('bad', '{{{');
    expect(readJson(s, 'bad')).toBeNull();
    expect(readJson(s, 'missing')).toBeNull();
  });

  it('never throws when the browser store fails', () => {
    expect(readJson(throwing, 'k')).toBeNull();
    expect(writeJson(throwing, 'k', 1)).toBe(false);
    expect(() => removeKey(throwing, 'k')).not.toThrow();
  });
});

describe('drafts', () => {
  const now = 1_790_000_000_000;

  it('restores a draft of the same business date, whatever its age', () => {
    const s = memoryStore();
    const d = newDraft('d1', '2026-09-28');
    expect(saveDraft(s, 'local', d, now)).toBe(true);
    expect(loadDraft(s, 'local', '2026-09-28')).toEqual(d);
  });

  it('drops a draft of another business date and deletes it', () => {
    const s = memoryStore();
    saveDraft(s, 'local', newDraft('d1', '2026-09-28'), now);
    expect(loadDraft(s, 'local', '2026-09-29')).toBeNull();
    expect(s.getItem(shopKey('local', 'draft'))).toBeNull();
  });

  it('drops a malformed draft', () => {
    const s = memoryStore();
    s.setItem(shopKey('local', 'draft'), JSON.stringify({ savedAt: now, draft: { id: 5 } }));
    expect(loadDraft(s, 'local', '2026-09-28')).toBeNull();
    s.setItem(shopKey('local', 'draft'), 'not json');
    expect(loadDraft(s, 'local', '2026-09-28')).toBeNull();
  });

  it('clearDraft removes it; failures return null/false', () => {
    const s = memoryStore();
    saveDraft(s, 'local', newDraft('d1', '2026-09-28'), now);
    clearDraft(s, 'local');
    expect(loadDraft(s, 'local', '2026-09-28')).toBeNull();
    expect(saveDraft(throwing, 'local', newDraft('d1', '2026-09-28'), now)).toBe(false);
    expect(loadDraft(throwing, 'local', '2026-09-28')).toBeNull();
  });
});

describe('prefs', () => {
  it('defaults to system and persists light/dark', () => {
    const s = memoryStore();
    expect(loadTheme(s)).toBe('system');
    expect(saveTheme(s, 'dark')).toBe(true);
    expect(loadTheme(s)).toBe('dark');
    s.setItem('tameio4all:v1:prefs:theme', '"purple"');
    expect(loadTheme(s)).toBe('system');
  });
});
