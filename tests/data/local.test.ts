import { describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, loadUnsentDraft, markDraftSubmitted, saveDraft, takeUnsentNotice } from '../../src/data/local/drafts';
import { loadTheme, saveTheme } from '../../src/data/local/prefs';
import {
  memoryStore, readJson, removeKey, shopKey, writeJson, type KeyValueStore,
} from '../../src/data/local/storage';
import { newDraft } from '../../src/features/register/draft';
import { boxes } from '../features/register/boxes';

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
    const d = newDraft('2026-09-28');
    expect(saveDraft(s, 'local', d, now)).toBe(true);
    expect(loadDraft(s, 'local', '2026-09-28')).toEqual(d);
  });

  it('moves an unsubmitted draft of another business date to the unsent key, announced once', () => {
    const s = memoryStore();
    const d = { ...newDraft('2026-09-28'), entries: boxes({ '10000': '3' }) };
    saveDraft(s, 'local', d, now);
    expect(loadDraft(s, 'local', '2026-09-29')).toBeNull();
    expect(s.getItem(shopKey('local', 'draft'))).toBeNull();
    expect(loadUnsentDraft(s, 'local')).toEqual(d);
    expect(takeUnsentNotice(s, 'local')).toBe('2026-09-28');
    expect(takeUnsentNotice(s, 'local')).toBeNull();
    // The draft itself stays kept after the notice.
    expect(loadUnsentDraft(s, 'local')).toEqual(d);
  });

  it('drops silently a never-typed draft of another business date (blank fields count as empty)', () => {
    const s = memoryStore();
    const blank = {
      ...newDraft('2026-09-28'),
      entries: boxes({ '10000': '', '5000': ' ' }),
      channels: { card: '' },
      expenses: [{ id: 'e1', description: ' ', amountText: '', addedBy: null, order: 1 }],
    };
    saveDraft(s, 'local', blank, now);
    expect(loadDraft(s, 'local', '2026-09-29')).toBeNull();
    expect(s.getItem(shopKey('local', 'draft'))).toBeNull();
    expect(loadUnsentDraft(s, 'local')).toBeNull();
    expect(takeUnsentNotice(s, 'local')).toBeNull();
    // An empty draft does not replace one already kept aside.
    const typed = { ...newDraft('2026-09-27'), channels: { card: '5' } };
    saveDraft(s, 'local', typed, now);
    loadDraft(s, 'local', '2026-09-28');
    saveDraft(s, 'local', newDraft('2026-09-28'), now);
    loadDraft(s, 'local', '2026-09-29');
    expect(loadUnsentDraft(s, 'local')).toEqual(typed);
  });

  it('a draft with only an expense description is not empty', () => {
    const s = memoryStore();
    const d = { ...newDraft('2026-09-28'), expenses: [{ id: 'e1', description: 'ΓΑΛΑ', amountText: '', addedBy: null, order: 1 }] };
    saveDraft(s, 'local', d, now);
    loadDraft(s, 'local', '2026-09-29');
    expect(loadUnsentDraft(s, 'local')).toEqual(d);
  });

  it('keeps only the latest unsent draft', () => {
    const s = memoryStore();
    saveDraft(s, 'local', { ...newDraft('2026-09-27'), entries: boxes({ '10000': '1' }) }, now);
    loadDraft(s, 'local', '2026-09-28');
    const later = { ...newDraft('2026-09-28'), entries: boxes({ '10000': '2' }) };
    saveDraft(s, 'local', later, now);
    loadDraft(s, 'local', '2026-09-29');
    expect(loadUnsentDraft(s, 'local')).toEqual(later);
    expect(takeUnsentNotice(s, 'local')).toBe('2026-09-28');
  });

  it('discards silently a draft that was submitted and not edited since', () => {
    const s = memoryStore();
    const d = { ...newDraft('2026-09-28'), entries: boxes({ '10000': '3' }) };
    saveDraft(s, 'local', d, now);
    markDraftSubmitted(s, 'local', d);
    expect(loadDraft(s, 'local', '2026-09-29')).toBeNull();
    expect(loadUnsentDraft(s, 'local')).toBeNull();
    expect(takeUnsentNotice(s, 'local')).toBeNull();
  });

  it('moves a draft edited after its last submit', () => {
    const s = memoryStore();
    const d = { ...newDraft('2026-09-28'), entries: boxes({ '10000': '3' }) };
    markDraftSubmitted(s, 'local', d);
    const edited = { ...d, entries: boxes({ '10000': '4' }) };
    saveDraft(s, 'local', edited, now);
    expect(loadDraft(s, 'local', '2026-09-29')).toBeNull();
    expect(loadUnsentDraft(s, 'local')).toEqual(edited);
    expect(takeUnsentNotice(s, 'local')).toBe('2026-09-28');
  });

  it('unsent storage is failure-safe', () => {
    expect(() => markDraftSubmitted(throwing, 'local', newDraft('2026-09-28'))).not.toThrow();
    expect(loadUnsentDraft(throwing, 'local')).toBeNull();
    expect(takeUnsentNotice(throwing, 'local')).toBeNull();
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
    saveDraft(s, 'local', newDraft('2026-09-28'), now);
    clearDraft(s, 'local');
    expect(loadDraft(s, 'local', '2026-09-28')).toBeNull();
    expect(saveDraft(throwing, 'local', newDraft('2026-09-28'), now)).toBe(false);
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
