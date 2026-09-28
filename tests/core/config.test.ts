import { describe, expect, it } from 'vitest';
import {
  defaultTotals,
  isShopConfig,
  minus,
  newShopConfig,
  plus,
  totalOrder,
  validateConfig,
  type ShopConfig,
  type TotalDef,
} from '../../src/core/config';
import { evaluateTotals, ConfigInvalidError, type ClosingInputs } from '../../src/core/formula';

const total = (id: string, terms: TotalDef['terms'] = []): TotalDef => ({
  id,
  label: id,
  terms,
  showInSummary: true,
  showInShare: true,
});

const withChanges = (changes: Partial<ShopConfig>): ShopConfig => ({ ...newShopConfig(), ...changes });
const codes = (c: ShopConfig) => validateConfig(c).map((e) => e.code);

describe('defaults', () => {
  it('new shop config is valid', () => {
    expect(validateConfig(newShopConfig())).toEqual([]);
  });

  it('default totals are ΤΑΜΕΙΟ, ΣΥΝΟΛΟ ΕΞΟΔΩΝ, ΜΕΤΡΗΤΑ', () => {
    const t = defaultTotals();
    expect(t.map((x) => x.id)).toEqual(['tameio', 'expenses_total', 'cash']);
    expect(t.map((x) => x.label)).toEqual(['ΤΑΜΕΙΟ', 'ΣΥΝΟΛΟ ΕΞΟΔΩΝ', 'ΜΕΤΡΗΤΑ']);
  });

  it('new shop envelope fills ΜΕΤΡΗΤΑ and allows 10 expenses', () => {
    const c = newShopConfig();
    expect(c.envelopeTotalId).toBe('cash');
    expect(c.maxExpenses).toBe(10);
    expect(c.denominations).not.toContain(50000);
    expect(c.denominations).not.toContain(20000);
  });
});

describe('validateConfig', () => {
  it('rejects negative or fractional float', () => {
    expect(codes(withChanges({ floatCents: -1 }))).toContain('bad_float');
    expect(codes(withChanges({ floatCents: 1.5 }))).toContain('bad_float');
  });

  it('rejects unknown and duplicate denominations', () => {
    expect(codes(withChanges({ denominations: [300] }))).toContain('bad_denomination');
    expect(codes(withChanges({ denominations: [500, 500] }))).toContain('bad_denomination');
  });

  it('rejects maxExpenses outside 0..30', () => {
    expect(codes(withChanges({ maxExpenses: 31 }))).toContain('bad_max_expenses');
    expect(codes(withChanges({ maxExpenses: -1 }))).toContain('bad_max_expenses');
  });

  it('rejects duplicate and empty channel ids', () => {
    const dup = withChanges({
      channels: [
        { id: 'pos', label: 'POS', type: 'card' },
        { id: 'pos', label: 'POS 2', type: 'card' },
      ],
    });
    expect(codes(dup)).toContain('duplicate_id');
    expect(codes(withChanges({ channels: [{ id: '', label: 'x', type: 'card' }] }))).toContain('bad_id');
  });

  it('rejects duplicate total ids', () => {
    expect(codes(withChanges({ totals: [...defaultTotals(), total('cash')] }))).toContain('duplicate_id');
  });

  it('rejects references to unknown channels and totals', () => {
    const c = withChanges({
      totals: [...defaultTotals(), total('x', [plus({ kind: 'channel', id: 'ghost' }), minus({ kind: 'total', id: 'nope' })])],
    });
    expect(codes(c)).toEqual(expect.arrayContaining(['unknown_channel', 'unknown_total']));
  });

  it('rejects cycles, including self-reference', () => {
    const loop = withChanges({
      totals: [
        ...defaultTotals(),
        total('a', [plus({ kind: 'total', id: 'b' })]),
        total('b', [plus({ kind: 'total', id: 'a' })]),
      ],
    });
    const err = validateConfig(loop).find((e) => e.code === 'cycle');
    expect(err?.detail).toMatch(/a → b → a|b → a → b/);

    const self = withChanges({ totals: [...defaultTotals(), total('s', [plus({ kind: 'total', id: 's' })])] });
    expect(codes(self)).toContain('cycle');
  });

  it('requires the envelope total to exist', () => {
    expect(codes(withChanges({ envelopeTotalId: 'nope' }))).toContain('missing_envelope_total');
  });

  it('rejects bad tare items', () => {
    expect(codes(withChanges({ tareItems: [{ name: '', tareGrams: 100 }] }))).toContain('bad_tare');
    expect(codes(withChanges({ tareItems: [{ name: 'x', tareGrams: -5 }] }))).toContain('bad_tare');
  });
});

describe('validateConfig on JSON-shaped unknown input', () => {
  const emptyInputs: ClosingInputs = { schema: 1, counts: {}, channelCents: {}, expenses: [] };

  /** A valid config, round-tripped through JSON like a config read back from storage would be. */
  function validConfigJson(): unknown {
    const cfg: ShopConfig = {
      ...newShopConfig(),
      channels: [{ id: 'pos', label: 'POS', type: 'card' }],
      totals: [...defaultTotals(), total('extra', [plus({ kind: 'channel', id: 'pos' })])],
    };
    return JSON.parse(JSON.stringify(cfg));
  }

  const codesOf = (c: unknown): string[] => {
    let result: string[] = [];
    expect(() => {
      result = validateConfig(c).map((e) => e.code);
    }).not.toThrow();
    return result;
  };

  it.each([null, undefined, 'a string', 42, [], true])('rejects %p as bad_shape, never throws', (bad) => {
    expect(codesOf(bad)).toContain('bad_shape');
  });

  it('rejects a channel with a bad type (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    (c.channels as Record<string, unknown>[])[0]!.type = 'Card';
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects an unknown term ref kind (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    const totals = c.totals as Record<string, unknown>[];
    const extra = totals[totals.length - 1]!.terms as Record<string, unknown>[];
    (extra[0]!.ref as Record<string, unknown>).kind = 'countd';
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects a term with a bad sign (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    const totals = c.totals as Record<string, unknown>[];
    const extra = totals[totals.length - 1]!.terms as Record<string, unknown>[];
    extra[0]!.sign = 100;
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects a type-ref with a channel type that does not exist (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    const totals = c.totals as Record<string, unknown>[];
    const extra = totals[totals.length - 1]!.terms as Record<string, unknown>[];
    extra[0]!.ref = { kind: 'type', type: 'cash' };
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects a channel id that is an Object.prototype property name (bad_id)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    (c.channels as Record<string, unknown>[])[0]!.id = 'constructor';
    expect(codesOf(c)).toContain('bad_id');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects a config missing channels entirely (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    delete c.channels;
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects a total without a terms array (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    const totals = c.totals as Record<string, unknown>[];
    delete totals[0]!.terms;
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects an empty label after trim (bad_label)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    (c.channels as Record<string, unknown>[])[0]!.label = '   ';
    expect(codesOf(c)).toContain('bad_label');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('rejects seedSuppliers values that are not non-negative safe integers (bad_shape)', () => {
    const negative = validConfigJson() as Record<string, unknown>;
    negative.seedSuppliers = { X: [-5] };
    expect(codesOf(negative)).toContain('bad_shape');
    expect(() => evaluateTotals(negative as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);

    const stringValue = validConfigJson() as Record<string, unknown>;
    stringValue.seedSuppliers = { X: ['5'] };
    expect(codesOf(stringValue)).toContain('bad_shape');
  });

  it('rejects a config with a missing schema (bad_shape)', () => {
    const c = validConfigJson() as Record<string, unknown>;
    delete c.schema;
    expect(codesOf(c)).toContain('bad_shape');
    expect(() => evaluateTotals(c as unknown as ShopConfig, emptyInputs)).toThrow(ConfigInvalidError);
  });

  it('accepts a valid config round-tripped through JSON', () => {
    expect(codesOf(validConfigJson())).toEqual([]);
  });
});

describe('isShopConfig', () => {
  it('is true only for a config with no validation errors', () => {
    expect(isShopConfig(newShopConfig())).toBe(true);
    expect(isShopConfig(null)).toBe(false);
    expect(isShopConfig({})).toBe(false);
    expect(isShopConfig({ ...newShopConfig(), floatCents: -1 })).toBe(false);
  });
});

describe('totalOrder', () => {
  it('orders dependencies first regardless of list order', () => {
    const r = totalOrder([total('b', [plus({ kind: 'total', id: 'a' })]), total('a')]);
    expect(r).toEqual({ ok: true, order: ['a', 'b'] });
  });

  it('reports the cycle path', () => {
    const r = totalOrder([total('a', [plus({ kind: 'total', id: 'a' })])]);
    expect(r).toEqual({ ok: false, cycle: ['a', 'a'] });
  });
});
