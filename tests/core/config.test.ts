import { describe, expect, it } from 'vitest';
import {
  defaultTotals,
  minus,
  newShopConfig,
  plus,
  totalOrder,
  validateConfig,
  type ShopConfig,
  type TotalDef,
} from '../../src/core/config';

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
