import { describe, expect, it } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import {
  deriveClosing, envelopeBlockReason, fieldError, fieldId, submitBlockReason,
} from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';

const draft = (changes: Partial<Draft>): Draft => ({ ...newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ'), ...changes });

const V2_TOTALS = { tameio: 185520, expenses_total: 2030, cash: 36755, cash_lim: 38785, income_lim: 78650 };
const V2_CHANNELS = { kermata: '150', wolt: '45.60', efood: '23,10', mypos: '310.25', eurobank: '88.40' };
const V2_EXPENSES = [
  { id: 'e1', description: 'Nice', amountText: '12.50' },
  { id: 'e2', description: ' Nice ', amountText: '7,80' },
];

describe('deriveClosing', () => {
  it('reproduces tameioV2 from € amounts typed as text', () => {
    const d = derive(draft({
      mode: 'amount',
      entries: {
        '10000': '500', '5000': '300', '2000': '240', '1000': '90', '500': '35',
        '200': '24', '100': '17', '50': '6.5', '20': '3.4', '10': '1.2', '5': '0.45',
      },
      channels: V2_CHANNELS,
      expenses: V2_EXPENSES,
    }));
    expect(d.errors).toEqual([]);
    expect(d.totals).toEqual(V2_TOTALS);
    expect(d.billsCents).toBe(116500);
    expect(d.coinsCents).toBe(5255);
    expect(d.expensesCents).toBe(2030);
    expect(d.inputs.expenses).toEqual([
      { description: 'Nice', cents: 1250 },
      { description: 'Nice', cents: 780 },
    ]);
    expect(d.rowCents['10000']).toBe(50000);
    expect(d.expenseRowCents).toEqual({ e1: 1250, e2: 780 });
  });

  it('gives the same totals from piece counts', () => {
    const d = derive(draft({
      mode: 'count',
      entries: {
        '10000': '5', '5000': '6', '2000': '12', '1000': '9', '500': '7',
        '200': '12', '100': '17', '50': '13', '20': '17', '10': '12', '5': '9',
      },
      channels: V2_CHANNELS,
      expenses: V2_EXPENSES,
    }));
    expect(d.totals).toEqual(V2_TOTALS);
  });

  it('reports invalid fields with Greek messages and leaves them out of the money', () => {
    const d = derive(draft({ entries: { '10000': '500', '1000': '95' }, channels: { wolt: '1.234' } }));
    expect(d.errors).toEqual([
      { field: 'denom:1000', label: '10€', message: 'όχι πολλαπλάσιο' },
      { field: 'channel:wolt', label: 'WOLT', message: 'πολλά δεκαδικά' },
    ]);
    expect(d.inputs.counts).toEqual({ '10000': 5 });
    expect(fieldError(d, fieldId.denom(1000))).toBe('όχι πολλαπλάσιο');
    expect(fieldError(d, fieldId.denom(10000))).toBeUndefined();
  });

  it('skips blank expense rows and names invalid ones by description or position', () => {
    const d = derive(draft({
      expenses: [
        { id: 'a', description: '', amountText: '' },
        { id: 'b', description: 'Μόνο περιγραφή', amountText: '' },
        { id: 'c', description: '', amountText: '1.234' },
        { id: 'd', description: 'Γάλα', amountText: '0' },
      ],
    }));
    expect(d.inputs.expenses).toEqual([]);
    expect(d.errors).toEqual([{ field: 'expense:c', label: 'Έξοδο 3', message: 'πολλά δεκαδικά' }]);
  });

  it('ignores entries for denominations the shop has not enabled', () => {
    const d = derive(draft({ entries: { '50000': '1000' } }));
    expect(d.inputs.counts).toEqual({});
    expect(d.errors).toEqual([]);
  });

  it('plans the exact envelope greedy missed (60€ from 1×50 + 3×20)', () => {
    // counted 110€ + ΚΕΡΜΑΤΑ 950€ − float 1000€ = 60€
    const d = derive(draft({ entries: { '5000': '50', '2000': '60' }, channels: { kermata: '950' } }));
    expect(d.totals.cash).toBe(6000);
    expect(d.envelope.put).toEqual({ '2000': 3 });
    expect(d.envelope.shortCents).toBe(0);
  });
});

describe('block reasons', () => {
  it('lists invalid fields, then requires a staff member for submit', () => {
    const bad = draft({ entries: { '1000': '95' }, channels: { wolt: '1.234' } });
    const dBad = derive(bad);
    expect(envelopeBlockReason(dBad)).toBe('Λάθος τιμή: 10€, WOLT');
    expect(submitBlockReason(dBad, bad)).toBe('Λάθος τιμή: 10€, WOLT');

    const noStaff = draft({ staffName: '' });
    const dOk = derive(noStaff);
    expect(envelopeBlockReason(dOk)).toBeNull();
    expect(submitBlockReason(dOk, noStaff)).toBe('Διάλεξε όνομα για υποβολή');
    expect(submitBlockReason(dOk, draft({}))).toBeNull();
  });
});

function derive(d: Draft) {
  return deriveClosing(cfg, d);
}
