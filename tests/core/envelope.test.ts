import { describe, expect, it } from 'vitest';
import { planEnvelope } from '../../src/core/envelope';
import { joinJuicePreset } from '../../src/core/presets';

const JJ = joinJuicePreset.denominations;

describe('planEnvelope', () => {
  it('finds the exact combination greedy misses (H1: 60€ from 1×50 + 3×20)', () => {
    const p = planEnvelope(6000, { '5000': 1, '2000': 3 }, [5000, 2000]);
    expect(p.put).toEqual({ '2000': 3 });
    expect(p.putCents).toBe(6000);
    expect(p.shortCents).toBe(0);
    expect(p.remaining).toEqual({ '5000': 1, '2000': 0 });
  });

  it('returns the same answer as V2 greedy when greedy is exact', () => {
    const counts = {
      '10000': 5, '5000': 6, '2000': 12, '1000': 9, '500': 7,
      '200': 12, '100': 17, '50': 13, '20': 17, '10': 12, '5': 9,
    };
    const p = planEnvelope(36755, counts, JJ);
    expect(p.put).toEqual({ '10000': 3, '5000': 1, '1000': 1, '500': 1, '200': 1, '50': 1, '5': 1 });
    expect(p.shortCents).toBe(0);
  });

  it('reports the full shortfall when nothing fits', () => {
    const p = planEnvelope(1000, { '2000': 1 }, [2000]);
    expect(p.put).toEqual({});
    expect(p.putCents).toBe(0);
    expect(p.shortCents).toBe(1000);
  });

  it('puts the closest amount under target when exact is impossible', () => {
    const p = planEnvelope(60, { '50': 1, '20': 1 }, [50, 20]);
    expect(p.put).toEqual({ '50': 1 });
    expect(p.shortCents).toBe(10);
  });

  it('handles targets that are not a multiple of 5c', () => {
    const p = planEnvelope(1003, { '1000': 1, '5': 1 }, [1000, 5]);
    expect(p.put).toEqual({ '1000': 1 });
    expect(p.shortCents).toBe(3);
  });

  it('puts nothing and reports no shortfall for zero or negative cash', () => {
    for (const target of [0, -500]) {
      const p = planEnvelope(target, { '1000': 2 }, [1000]);
      expect(p.put).toEqual({});
      expect(p.shortCents).toBe(0);
      expect(p.remaining).toEqual({ '1000': 2 });
    }
  });

  it('puts everything and reports the rest when target exceeds the till', () => {
    const p = planEnvelope(50000, { '10000': 2 }, JJ);
    expect(p.put).toEqual({ '10000': 2 });
    expect(p.shortCents).toBe(30000);
  });

  it('stays fast on an absurd target (20 000€)', () => {
    const start = performance.now();
    const p = planEnvelope(2_000_000, { '10000': 200, '5': 400 }, JJ);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(p.put).toEqual({ '10000': 200 });
    expect(p.shortCents).toBe(0);
  });

  it('ignores counts for denominations not passed in', () => {
    const p = planEnvelope(1000, { '1000': 1, '50000': 3 }, [1000]);
    expect(p.remaining).toEqual({ '1000': 0 });
  });

  it('treats a non-safe-integer count (NaN) as 0, never producing NaN', () => {
    const p = planEnvelope(1000, { '1000': NaN, '500': 2 }, [1000, 500]);
    expect(p.put).toEqual({ '500': 2 });
    expect(p.shortCents).toBe(0);
    for (const v of [p.putCents, p.shortCents, ...Object.values(p.put), ...Object.values(p.remaining)]) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('treats negative and fractional counts as 0 as well', () => {
    const p = planEnvelope(500, { '1000': -1, '500': 1.5 }, [1000, 500]);
    expect(p.put).toEqual({});
    expect(p.shortCents).toBe(500);
  });

  describe('bounded search above MAX_UNITS (≈20 000€ at 5c units)', () => {
    it('stays fast and exact for a 10 000×100€ till against an odd-cent near-full target', () => {
      const denoms = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];
      const start = performance.now();
      const p = planEnvelope(99_999_995, { '10000': 10000 }, denoms);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(p.putCents).toBeLessThanOrEqual(99_999_995);
      expect(p.shortCents).toBe(99_999_995 - p.putCents);
      expect(Number.isNaN(p.putCents)).toBe(false);
      expect(Number.isNaN(p.shortCents)).toBe(false);
    });

    it('stays fast and bounded for a 50 000×100€ till + coins against a 5 000 000€ target', () => {
      const denoms = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];
      const counts = { '10000': 50000, '500': 2000, '50': 500, '5': 100 };
      const start = performance.now();
      const p = planEnvelope(500_000_000, counts, denoms);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(p.putCents).toBeLessThanOrEqual(500_000_000);
      expect(p.shortCents).toBe(500_000_000 - p.putCents);
      expect(Number.isNaN(p.putCents)).toBe(false);
      expect(Number.isNaN(p.shortCents)).toBe(false);
      for (const v of Object.values(p.remaining)) expect(Number.isNaN(v)).toBe(false);
    });
  });
});
