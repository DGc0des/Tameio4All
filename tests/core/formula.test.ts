import { describe, expect, it } from 'vitest';
import { newShopConfig, plus, type ShopConfig } from '../../src/core/config';
import {
  ClosingInputsInvalidError,
  ConfigInvalidError,
  countedCents,
  evaluateTotals,
  expensesCents,
  validateClosingInputs,
  type ClosingInputs,
} from '../../src/core/formula';

const shop: ShopConfig = {
  ...newShopConfig(),
  floatCents: 20000,
  channels: [
    { id: 'pos', label: 'POS', type: 'card' },
    { id: 'wolt', label: 'WOLT', type: 'delivery' },
    { id: 'box', label: 'ΚΕΡΜΑΤΑ', type: 'cash_extra' },
  ],
};

const inputs: ClosingInputs = {
  schema: 1,
  counts: { '10000': 3, '50': 2 },
  channelCents: { pos: 5000, wolt: 2000, box: 1000 },
  expenses: [{ description: 'Γάλα', cents: 500 }],
};

describe('evaluateTotals', () => {
  it('computes default totals from channel types', () => {
    expect(countedCents(shop, inputs)).toBe(30100);
    expect(expensesCents(inputs)).toBe(500);
    expect(evaluateTotals(shop, inputs)).toEqual({
      tameio: 38600, // 30100 counted + 1000 box + 5000 pos + 2000 wolt + 500 expenses
      expenses_total: 500,
      cash: 11100, // tameio − 20000 float − 500 − 5000 − 2000 = counted + box − float
    });
  });

  it('evaluates totals that reference totals defined later in the list', () => {
    const c: ShopConfig = {
      ...shop,
      totals: [
        { id: 'double', label: 'x2', terms: [plus({ kind: 'total', id: 'cash' }), plus({ kind: 'total', id: 'cash' })], showInSummary: true, showInShare: false },
        ...shop.totals,
      ],
    };
    expect(evaluateTotals(c, inputs).double).toBe(22200);
  });

  it('ignores counts for denominations the shop has not enabled', () => {
    expect(countedCents(shop, { ...inputs, counts: { '50000': 1 } })).toBe(0);
  });

  it('ignores channel amounts for channels no longer in the config', () => {
    const stale = { ...inputs, channelCents: { ...inputs.channelCents, deleted: 99999 } };
    expect(evaluateTotals(shop, stale)).toEqual(evaluateTotals(shop, inputs));
  });

  it('gives −float when nothing is entered', () => {
    const empty: ClosingInputs = { schema: 1, counts: {}, channelCents: {}, expenses: [] };
    expect(evaluateTotals(shop, empty)).toEqual({ tameio: 0, expenses_total: 0, cash: -20000 });
  });

  it('throws ConfigInvalidError with the validation errors for a broken config', () => {
    const broken: ShopConfig = {
      ...shop,
      totals: [...shop.totals, { id: 'x', label: 'x', terms: [plus({ kind: 'channel', id: 'ghost' })], showInSummary: true, showInShare: true }],
    };
    expect(() => evaluateTotals(broken, inputs)).toThrow(ConfigInvalidError);
    try {
      evaluateTotals(broken, inputs);
    } catch (e) {
      expect((e as ConfigInvalidError).errors.map((x) => x.code)).toEqual(['unknown_channel']);
    }
  });
});

describe('validateClosingInputs', () => {
  const codesOf = (i: unknown): string[] => {
    let result: string[] = [];
    expect(() => {
      result = validateClosingInputs(shop, i).map((e) => e.code);
    }).not.toThrow();
    return result;
  };

  it('accepts stale keys not present in the config (denominations/channels)', () => {
    expect(
      codesOf({ schema: 1, counts: { '50000': 1 }, channelCents: { deleted: 99999 }, expenses: [] }),
    ).toEqual([]);
  });

  it('rejects a negative count (bad_count)', () => {
    expect(codesOf({ schema: 1, counts: { '10000': -3 }, channelCents: {}, expenses: [] })).toContain(
      'bad_count',
    );
  });

  it('rejects a fractional count (bad_count)', () => {
    expect(codesOf({ schema: 1, counts: { '10000': 0.5 }, channelCents: {}, expenses: [] })).toContain(
      'bad_count',
    );
  });

  it('rejects a NaN count (bad_count)', () => {
    expect(codesOf({ schema: 1, counts: { '10000': NaN }, channelCents: {}, expenses: [] })).toContain(
      'bad_count',
    );
  });

  it('rejects a string expense amount (bad_amount)', () => {
    expect(
      codesOf({ schema: 1, counts: {}, channelCents: {}, expenses: [{ description: 'x', cents: '500' }] }),
    ).toContain('bad_amount');
  });

  it('rejects more expenses than maxExpenses (too_many_expenses)', () => {
    const many = Array.from({ length: shop.maxExpenses + 1 }, () => ({ description: 'x', cents: 100 }));
    expect(codesOf({ schema: 1, counts: {}, channelCents: {}, expenses: many })).toContain(
      'too_many_expenses',
    );
  });

  it('rejects a missing expenses array (bad_shape)', () => {
    expect(codesOf({ schema: 1, counts: {}, channelCents: {} })).toContain('bad_shape');
  });

  it('never throws on completely foreign input', () => {
    expect(codesOf(null)).toContain('bad_shape');
    expect(codesOf('nope')).toContain('bad_shape');
  });
});

describe('evaluateTotals throws ClosingInputsInvalidError for bad closing inputs', () => {
  it('throws with bad_count for a negative count', () => {
    const bad = { schema: 1, counts: { '10000': -3 }, channelCents: {}, expenses: [] } as unknown as ClosingInputs;
    expect(() => evaluateTotals(shop, bad)).toThrow(ClosingInputsInvalidError);
    try {
      evaluateTotals(shop, bad);
    } catch (e) {
      expect((e as ClosingInputsInvalidError).errors.map((x) => x.code)).toContain('bad_count');
    }
  });
});
