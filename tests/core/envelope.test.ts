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
});
