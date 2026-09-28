import { describe, expect, it } from 'vitest';
import {
  buildSupplierHistory,
  exactExpenseMatch,
  HISTORY_AMOUNTS_PER_SUPPLIER,
  suggestExpenseDescriptions,
  supplierKey,
  type PastExpense,
} from '../../src/core/suggestions';

const past = (description: string, cents: number, date: string): PastExpense => ({ description, cents, date });

describe('supplierKey', () => {
  it('ignores case, accents, extra spaces and final sigma', () => {
    expect(supplierKey('  Μεβγάλ ')).toBe(supplierKey('ΜΕΒΓΑΛ'));
    expect(supplierKey('Τσακίρης')).toBe(supplierKey('ΤΣΑΚΙΡΗΣ'));
    expect(supplierKey('Super   Market')).toBe(supplierKey('super market'));
    expect(supplierKey('Nice')).not.toBe(supplierKey('Nicer'));
  });
});

describe('buildSupplierHistory', () => {
  it('gives a new shop no suggestions', () => {
    expect(buildSupplierHistory([])).toEqual({});
    expect(suggestExpenseDescriptions(buildSupplierHistory([]), 2400)).toEqual([]);
  });

  it('groups spellings of one supplier and shows the most recent spelling', () => {
    const h = buildSupplierHistory([
      past('Μεβγάλ', 1000, '2026-09-01'),
      past('ΜΕΒΓΑΛ ', 1200, '2026-09-02'),
      past('  Μεβγαλ', 1300, '2026-09-03'),
    ]);
    expect(h).toEqual({ 'Μεβγαλ': [1300, 1200, 1000] });
  });

  it('collapses inner whitespace in the shown name', () => {
    expect(buildSupplierHistory([past('Super   Market', 500, '2026-09-01')])).toEqual({ 'Super Market': [500] });
  });

  it('orders by date, not by input order (newest amount first)', () => {
    const h = buildSupplierHistory([
      past('Nice', 1300, '2026-09-03'),
      past('Nice', 520, '2026-09-01'),
      past('nice', 780, '2026-09-02'),
    ]);
    expect(h).toEqual({ 'Nice': [1300, 780, 520] });
  });

  it('treats later entries on the same date as newer', () => {
    const h = buildSupplierHistory([past('ΛΑ', 600, '2026-09-01'), past('Λα', 590, '2026-09-01')]);
    expect(h).toEqual({ 'Λα': [590, 600] });
  });

  it(`keeps only the ${HISTORY_AMOUNTS_PER_SUPPLIER} most recent amounts per supplier`, () => {
    // 35 closings on increasing dates: 2026-01-01 … 2026-01-28, then 2026-02-01 … 2026-02-07.
    const day = (i: number) =>
      `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    const entries = Array.from({ length: 35 }, (_, i) => past('Nice', 100 + i, day(i)));
    const amounts = buildSupplierHistory(entries)['Nice']!;
    expect(HISTORY_AMOUNTS_PER_SUPPLIER).toBe(30);
    expect(amounts).toHaveLength(30);
    expect(amounts[0]).toBe(134); // newest
    expect(amounts).not.toContain(100); // oldest five dropped
    expect(amounts).not.toContain(104);
  });

  it('skips blank descriptions and non-positive or non-integer amounts', () => {
    const h = buildSupplierHistory([
      past('   ', 500, '2026-09-01'),
      past('Nice', 0, '2026-09-01'),
      past('Nice', -300, '2026-09-01'),
      past('Nice', 12.5, '2026-09-01'),
      past('Nice', 1300, '2026-09-01'),
    ]);
    expect(h).toEqual({ 'Nice': [1300] });
  });

  it('skips malformed entries from storage instead of throwing', () => {
    const junk = [
      { description: null, cents: 500, date: '2026-09-01' },
      { description: 'Nice', cents: '500', date: '2026-09-01' },
      { description: 'Nice', cents: 500 },
      null,
      past('Nice', 1300, '2026-09-02'),
    ] as unknown as PastExpense[];
    expect(buildSupplierHistory(junk)).toEqual({ 'Nice': [1300] });
  });

  it('feeds the existing suggestion functions: every submission teaches', () => {
    const learned = buildSupplierHistory([past('Ντόντης', 2400, '2026-09-01')]);
    expect(suggestExpenseDescriptions(learned, 2400)).toEqual(['Ντόντης']);
    expect(exactExpenseMatch(learned, 2400)).toBe('Ντόντης');
  });
});

const history = {
  'Nice': [1300, 520, 780],
  'ΛΑ': [600, 590, 345],
  'Ντόντης': [1800, 2400],
  'Τσακίρης': [2340, 2300, 2120],
};

describe('exactExpenseMatch', () => {
  it('returns the single supplier with that exact amount', () => {
    expect(exactExpenseMatch(history, 2400)).toBe('Ντόντης');
    expect(exactExpenseMatch(history, 600)).toBe('ΛΑ');
  });

  it('returns null when ambiguous, unknown or non-positive', () => {
    expect(exactExpenseMatch({ ...history, 'Άλλος': [600] }, 600)).toBeNull();
    expect(exactExpenseMatch(history, 999)).toBeNull();
    expect(exactExpenseMatch(history, 0)).toBeNull();
    expect(exactExpenseMatch(history, -600)).toBeNull();
  });
});

describe('suggestExpenseDescriptions', () => {
  it('ranks exact recorded amounts first, then in-range suppliers', () => {
    expect(suggestExpenseDescriptions(history, 2400)).toEqual(['Ντόντης', 'Τσακίρης']);
  });

  it('includes suppliers within tolerance just outside their range', () => {
    // Nice max 1300 + 12% of 1400 (168) → accepts 1400; ΛΑ max 600 + 168 does not.
    expect(suggestExpenseDescriptions(history, 1400)).toContain('Nice');
    expect(suggestExpenseDescriptions(history, 1400)).not.toContain('ΛΑ');
  });

  it('uses a 50c minimum tolerance for small amounts', () => {
    expect(suggestExpenseDescriptions({ 'Xcopy': [100] }, 150)).toEqual(['Xcopy']);
    expect(suggestExpenseDescriptions({ 'Xcopy': [100] }, 151)).toEqual([]);
  });

  it('returns nothing for non-positive amounts', () => {
    expect(suggestExpenseDescriptions(history, 0)).toEqual([]);
  });

  it('respects maxResults and breaks full ties by name', () => {
    const tied = { 'Β': [500], 'Α': [500], 'Γ': [500] };
    expect(suggestExpenseDescriptions(tied, 500, 2)).toEqual(['Α', 'Β']);
  });

  it('skips suppliers with no recorded amounts', () => {
    expect(suggestExpenseDescriptions({ 'Κενός': [] }, 500)).toEqual([]);
  });
});
