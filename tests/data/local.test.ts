import { describe, expect, it } from 'vitest';
import type { ClosingInputs } from '../../src/core/formula';
import { clearDraft, DRAFT_TTL_MS, loadDraft, saveDraft } from '../../src/data/local/drafts';
import { loadTheme, saveTheme } from '../../src/data/local/prefs';
import { loadStaff, normalizeStaff, saveStaff } from '../../src/data/local/staff';
import {
  memoryStore, readJson, removeKey, shopKey, writeJson, type KeyValueStore,
} from '../../src/data/local/storage';
import {
  loadSubmissions, MAX_SUBMISSIONS, pastExpenses, saveSubmission, type Submission,
} from '../../src/data/local/submissions';
import { newDraft } from '../../src/features/register/draft';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

const inputs = (expenses: ClosingInputs['expenses'] = []): ClosingInputs => ({
  schema: 1, counts: { '10000': 5 }, channelCents: {}, expenses,
});
const sub = (id: string, expenses: ClosingInputs['expenses'] = []): Submission => ({
  id, shopId: 'local', staffName: 'ΓΚΡΕΖΙΟΣ', businessDate: '2026-09-28',
  submittedAt: '2026-09-28T21:00:00.000Z', inputs: inputs(expenses),
});

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

  it('restores a draft saved within 10 hours', () => {
    const s = memoryStore();
    const d = newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ');
    expect(saveDraft(s, 'local', d, now)).toBe(true);
    expect(loadDraft(s, 'local', now + DRAFT_TTL_MS - 1)).toEqual(d);
  });

  it('drops an expired draft and deletes it', () => {
    const s = memoryStore();
    saveDraft(s, 'local', newDraft('d1', '2026-09-28'), now);
    expect(loadDraft(s, 'local', now + DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.getItem(shopKey('local', 'draft'))).toBeNull();
  });

  it('drops a malformed draft', () => {
    const s = memoryStore();
    s.setItem(shopKey('local', 'draft'), JSON.stringify({ savedAt: now, draft: { id: 5 } }));
    expect(loadDraft(s, 'local', now)).toBeNull();
    s.setItem(shopKey('local', 'draft'), 'not json');
    expect(loadDraft(s, 'local', now)).toBeNull();
  });

  it('clearDraft removes it; failures return null/false', () => {
    const s = memoryStore();
    saveDraft(s, 'local', newDraft('d1', '2026-09-28'), now);
    clearDraft(s, 'local');
    expect(loadDraft(s, 'local', now)).toBeNull();
    expect(saveDraft(throwing, 'local', newDraft('d1', '2026-09-28'), now)).toBe(false);
    expect(loadDraft(throwing, 'local', now)).toBeNull();
  });
});

describe('submissions', () => {
  it('saves once per id (double tap / retry safe)', () => {
    const s = memoryStore();
    expect(saveSubmission(s, sub('a'))).toBe('saved');
    expect(saveSubmission(s, sub('a'))).toBe('duplicate');
    expect(loadSubmissions(s, 'local')).toHaveLength(1);
  });

  it('reports failure when storage refuses the write', () => {
    expect(saveSubmission(throwing, sub('a'))).toBe('failed');
  });

  it('skips malformed records', () => {
    const s = memoryStore();
    s.setItem(shopKey('local', 'submissions'), JSON.stringify([sub('a'), { id: 1 }, null, { ...sub('b'), inputs: 3 }]));
    expect(loadSubmissions(s, 'local').map((x) => x.id)).toEqual(['a']);
  });

  it(`keeps only the newest ${MAX_SUBMISSIONS}`, () => {
    const s = memoryStore();
    for (let i = 0; i <= MAX_SUBMISSIONS; i++) saveSubmission(s, sub(`s${i}`));
    const ids = loadSubmissions(s, 'local').map((x) => x.id);
    expect(ids).toHaveLength(MAX_SUBMISSIONS);
    expect(ids[0]).toBe('s1');
    expect(ids.at(-1)).toBe(`s${MAX_SUBMISSIONS}`);
  });

  it('turns submissions into past expenses dated by business date', () => {
    expect(pastExpenses([sub('a', [{ description: 'Nice', cents: 1300 }])])).toEqual([
      { description: 'Nice', cents: 1300, date: '2026-09-28' },
    ]);
  });
});

describe('staff', () => {
  it('normalizes: trims, collapses spaces, drops empties and case-insensitive duplicates', () => {
    expect(normalizeStaff(['  ΜΑΡΙΑ ', 'Μαρία', 'μαρια', '', 'ΝΙΚΟΣ  Π', 5])).toEqual(['ΜΑΡΙΑ', 'Μαρία', 'ΝΙΚΟΣ Π']);
  });

  it('saves and loads per shop; junk loads as empty', () => {
    const s = memoryStore();
    expect(saveStaff(s, 'local', ['ΓΚΡΕΖΙΟΣ', ' ΓΚΡΕΖΙΟΣ'])).toEqual(['ΓΚΡΕΖΙΟΣ']);
    expect(loadStaff(s, 'local')).toEqual(['ΓΚΡΕΖΙΟΣ']);
    s.setItem(shopKey('local', 'staff'), '"x"');
    expect(loadStaff(s, 'local')).toEqual([]);
    expect(saveStaff(throwing, 'local', ['A'])).toBeNull();
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
