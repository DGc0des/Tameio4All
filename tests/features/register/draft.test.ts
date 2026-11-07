import { describe, expect, it } from 'vitest';
import { draftReducer, isDraft, newDraft, type Draft } from '../../../src/features/register/draft';

const base = (): Draft => newDraft('d1', '2026-09-28');

describe('draftReducer', () => {
  it('sanitizes typed amounts (comma → dot, junk stripped)', () => {
    let d = draftReducer(base(), { type: 'setEntry', denom: 10000, text: '12,5' });
    expect(d.entries['10000']).toBe('12.5');
    d = draftReducer(d, { type: 'setChannel', id: 'wolt', text: '5-3a' });
    expect(d.channels.wolt).toBe('53');
  });

  it('converts entries when the mode changes and keeps invalid text as typed', () => {
    let d = draftReducer(base(), { type: 'setEntry', denom: 10000, text: '500' });
    d = draftReducer(d, { type: 'setEntry', denom: 1000, text: '55' });
    d = draftReducer(d, { type: 'setMode', mode: 'count', denominations: [10000, 1000] });
    expect(d.mode).toBe('count');
    expect(d.entries).toEqual({ '10000': '5', '1000': '55' });
    d = draftReducer(d, { type: 'setMode', mode: 'amount', denominations: [10000, 1000] });
    expect(d.entries['10000']).toBe('500');
  });

  it('setMode to the current mode is a no-op', () => {
    const d = base();
    expect(draftReducer(d, { type: 'setMode', mode: 'amount', denominations: [10000] })).toBe(d);
  });

  it('adds expenses up to the maximum, edits and removes them', () => {
    let d = draftReducer(base(), { type: 'addExpense', id: 'e1', max: 2, addedBy: null });
    d = draftReducer(d, { type: 'addExpense', id: 'e2', max: 2, addedBy: null });
    d = draftReducer(d, { type: 'addExpense', id: 'e3', max: 2, addedBy: null });
    expect(d.expenses.map((e) => e.id)).toEqual(['e1', 'e2']);
    d = draftReducer(d, { type: 'setExpense', id: 'e1', description: ' Nice ', amountText: '7,80' });
    expect(d.expenses[0]).toEqual({ id: 'e1', description: ' Nice ', amountText: '7.80', addedBy: null });
    d = draftReducer(d, { type: 'setExpense', id: 'e1', amountText: '9' });
    expect(d.expenses[0]?.description).toBe(' Nice ');
    d = draftReducer(d, { type: 'removeExpense', id: 'e1' });
    expect(d.expenses.map((e) => e.id)).toEqual(['e2']);
  });

  it('addExpense stores the author', () => {
    const d = draftReducer(base(), { type: 'addExpense', id: 'e2', max: 5, addedBy: { kind: 'staff', id: 's1' } });
    expect(d.expenses[0]).toEqual({ id: 'e2', description: '', amountText: '', addedBy: { kind: 'staff', id: 's1' } });
  });

  it('replace swaps the whole draft', () => {
    const other = newDraft('x', '2026-01-01');
    expect(draftReducer(base(), { type: 'replace', draft: other })).toBe(other);
  });
});

describe('isDraft', () => {
  it('accepts a real draft and rejects junk', () => {
    expect(isDraft(base())).toBe(true);
    expect(isDraft(JSON.parse(JSON.stringify(base())))).toBe(true);
    expect(isDraft(null)).toBe(false);
    expect(isDraft({ id: 5 })).toBe(false);
    expect(isDraft({ ...base(), mode: 'pieces' })).toBe(false);
    expect(isDraft({ ...base(), entries: { '500': 5 } })).toBe(false);
    expect(isDraft({ ...base(), expenses: [{ id: 'e1' }] })).toBe(false);
    expect(isDraft({ ...base(), staffName: 'old' })).toBe(true);
  });

  it('accepts expenses with an author or null, rejects ones without an addedBy key (old drafts)', () => {
    const ex = { id: 'e1', description: '', amountText: '' };
    expect(isDraft({ ...base(), expenses: [{ ...ex, addedBy: null }] })).toBe(true);
    expect(isDraft({ ...base(), expenses: [{ ...ex, addedBy: { kind: 'owner' } }] })).toBe(true);
    expect(isDraft({ ...base(), expenses: [{ ...ex, addedBy: { kind: 'staff', id: 's1' } }] })).toBe(true);
    expect(isDraft({ ...base(), expenses: [ex] })).toBe(false);
    expect(isDraft({ ...base(), expenses: [{ ...ex, addedBy: { kind: 'x' } }] })).toBe(false);
  });
});
