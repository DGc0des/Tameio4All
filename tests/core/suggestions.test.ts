import { describe, expect, it } from 'vitest';
import { exactExpenseMatch, suggestExpenseDescriptions } from '../../src/core/suggestions';

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
