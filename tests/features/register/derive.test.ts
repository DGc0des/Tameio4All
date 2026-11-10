import { describe, expect, it } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import {
  deriveClosing, envelopeBlockReason, fieldError, fieldId, submitBlockReason,
} from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';
import { boxes } from './boxes';

const draft = (changes: Partial<Draft>): Draft => ({ ...newDraft('2026-09-28'), ...changes });

const V2_TOTALS = { tameio: 185520, expenses_total: 2030, cash: 36755, cash_lim: 38785, income_lim: 78650 };
const V2_CHANNELS = { kermata: '150', wolt: '45.60', efood: '23,10', mypos: '310.25', eurobank: '88.40' };
const V2_EXPENSES: Draft['expenses'] = [
  { id: 'e1', description: 'Nice', amountText: '12.50', addedBy: { kind: 'owner' }, order: 1 },
  { id: 'e2', description: ' Nice ', amountText: '7,80', addedBy: { kind: 'owner' }, order: 1 },
];

describe('deriveClosing', () => {
  it('reproduces tameioV2 from € amounts typed as text', () => {
    const d = derive(draft({
      entries: boxes({
        '10000': '500', '5000': '300', '2000': '240', '1000': '90', '500': '35',
        '200': '24', '100': '17', '50': '6.5', '20': '3.4', '10': '1.2', '5': '0.45',
      }),
      channels: V2_CHANNELS,
      expenses: V2_EXPENSES,
    }));
    expect(d.errors).toEqual([]);
    expect(d.totals).toEqual(V2_TOTALS);
    expect(d.billsCents).toBe(116500);
    expect(d.coinsCents).toBe(5255);
    expect(d.expensesCents).toBe(2030);
    expect(d.inputs.expenses).toEqual([
      { id: 'e1', description: 'Nice', cents: 1250, addedBy: { kind: 'owner' } },
      { id: 'e2', description: 'Nice', cents: 780, addedBy: { kind: 'owner' } },
    ]);
    expect(d.rowCents['10000']).toBe(50000);
    expect(d.expenseRowCents).toEqual({ e1: 1250, e2: 780 });
  });

  it('gives the same totals from piece counts', () => {
    const d = derive(draft({
      entries: boxes({
        '10000': '5', '5000': '6', '2000': '12', '1000': '9', '500': '7',
        '200': '12', '100': '17', '50': '13', '20': '17', '10': '12', '5': '9',
      }, 'count'),
      channels: V2_CHANNELS,
      expenses: V2_EXPENSES,
    }));
    expect(d.totals).toEqual(V2_TOTALS);
  });

  it('reports invalid fields with Greek messages and leaves them out of the money', () => {
    const d = derive(draft({ entries: boxes({ '10000': '500', '1000': '95' }), channels: { wolt: '1.234' } }));
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
        { id: 'a', description: '', amountText: '', addedBy: null, order: 1 },
        { id: 'b', description: 'Μόνο περιγραφή', amountText: '', addedBy: null, order: 1 },
        { id: 'c', description: '', amountText: '1.234', addedBy: null, order: 1 },
        { id: 'd', description: 'Γάλα', amountText: '0', addedBy: null, order: 1 },
      ],
    }));
    expect(d.inputs.expenses).toEqual([]);
    expect(d.errors).toEqual([{ field: 'expense:c', label: 'Έξοδο 3', message: 'πολλά δεκαδικά' }]);
  });

  it('rejects a count whose euro value overflows safe-integer math instead of miscalculating silently', () => {
    const d = derive(draft({ entries: boxes({ '10000': '99999999999999' }, 'count') }));
    expect(d.errors).toEqual([{ field: 'denom:10000', label: '100€', message: 'μη έγκυρη τιμή' }]);
    expect(d.inputs.counts).toEqual({});
    expect(d.rowCents['10000']).toBeUndefined();
  });

  it('ignores entries for denominations the shop has not enabled', () => {
    const d = derive(draft({ entries: boxes({ '50000': '1000' }) }));
    expect(d.inputs.counts).toEqual({});
    expect(d.errors).toEqual([]);
  });

  it('plans the exact envelope greedy missed (60€ from 1×50 + 3×20)', () => {
    // counted 110€ + ΚΕΡΜΑΤΑ 950€ − float 1000€ = 60€
    const d = derive(draft({ entries: boxes({ '5000': '50', '2000': '60' }), channels: { kermata: '950' } }));
    expect(d.totals.cash).toBe(6000);
    expect(d.envelope.put).toEqual({ '2000': 3 });
    expect(d.envelope.shortCents).toBe(0);
  });
});

describe('block reasons', () => {
  it('lists invalid fields, then requires every expense to have an author', () => {
    const bad = draft({ entries: boxes({ '1000': '95' }), channels: { wolt: '1.234' } });
    const dBad = derive(bad);
    expect(envelopeBlockReason(dBad)).toBe('Λάθος τιμή: 10€, WOLT');
    expect(submitBlockReason(dBad, bad)).toBe('Λάθος τιμή: 10€, WOLT');

    const ok = draft({});
    expect(envelopeBlockReason(derive(ok))).toBeNull();
    expect(submitBlockReason(derive(ok), ok)).toBeNull();

    const noAuthor = draft({ expenses: [{ id: 'e1', description: 'Nice', amountText: '13', addedBy: null, order: 1 }] });
    expect(submitBlockReason(derive(noAuthor), noAuthor)).toBe('Συνδέσου ξανά για υποβολή');
    expect(envelopeBlockReason(derive(noAuthor))).toBeNull();
  });

  it('emits schema 2 with expense ids and authors; omits addedBy for null authors', () => {
    const d = draft({
      expenses: [
        { id: 'e1', description: ' Nice ', amountText: '13', addedBy: { kind: 'staff', id: 's1' }, order: 1 },
        { id: 'e2', description: 'x', amountText: '2', addedBy: null, order: 1 },
      ],
    });
    const { inputs } = derive(d);
    expect(inputs.schema).toBe(2);
    expect(inputs.expenses[0]).toEqual({ id: 'e1', description: 'Nice', cents: 1300, addedBy: { kind: 'staff', id: 's1' } });
    expect(inputs.expenses[1]).toEqual({ id: 'e2', description: 'x', cents: 200 });
    expect('addedBy' in (inputs.expenses[1] ?? {})).toBe(false);
  });
});

function derive(d: Draft) {
  return deriveClosing(cfg, d);
}
