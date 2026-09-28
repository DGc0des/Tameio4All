import { describe, expect, it } from 'vitest';
import { formatKg, netWeightGrams } from '../../src/core/tare';

describe('netWeightGrams', () => {
  it.each([
    ['1.2', 360, 840], // V2 float trap: 1.2 − 0.36
    ['1,250', 88, 1162],
    ['0.36', 360, 0],
  ])('%s kg − %i g → %i g', (raw, tare, net) => {
    expect(netWeightGrams(raw, tare)).toBe(net);
  });

  it.each([
    ['0.1', 360], // lighter than the container
    ['', 360],
    ['abc', 360],
    ['0', 0],
    ['-1', 0],
    ['1.2345', 0], // scale shows grams at most
  ])('%s kg (tare %i) → null', (raw, tare) => {
    expect(netWeightGrams(raw, tare)).toBeNull();
  });
});

describe('formatKg', () => {
  it.each([
    [840, '0.840'],
    [1162, '1.162'],
    [0, '0.000'],
  ])('%i → %s', (g, out) => expect(formatKg(g)).toBe(out));
});
