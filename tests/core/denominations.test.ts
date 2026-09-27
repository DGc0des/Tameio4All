import { describe, expect, it } from 'vitest';
import {
  convertEntry,
  denomLabel,
  entryToCount,
  EUR_DENOMINATIONS,
  isBill,
} from '../../src/core/denominations';

describe('EUR_DENOMINATIONS', () => {
  it('is sorted descending and has no 1c/2c', () => {
    expect([...EUR_DENOMINATIONS].sort((a, b) => b - a)).toEqual([...EUR_DENOMINATIONS]);
    expect(EUR_DENOMINATIONS).not.toContain(1);
    expect(EUR_DENOMINATIONS).not.toContain(2);
    expect(EUR_DENOMINATIONS.at(-1)).toBe(5);
  });
});

describe('labels', () => {
  it.each([
    [10000, '100€'],
    [200, '2€'],
    [50, '50c'],
    [5, '5c'],
  ])('%i → %s', (d, label) => expect(denomLabel(d)).toBe(label));

  it('classifies bills from 5€ up', () => {
    expect(isBill(500)).toBe(true);
    expect(isBill(200)).toBe(false);
  });
});

describe('entryToCount — amount mode', () => {
  it.each([
    ['50', 1000, 5],
    ['0.3', 10, 3], // V2 relied on float % with an epsilon here
    ['6,5', 50, 13],
    ['', 500, 0],
  ])('%s of %i → %i pieces', (raw, denom, count) => {
    expect(entryToCount(raw, denom, 'amount')).toEqual({ ok: true, count });
  });

  it.each([
    ['55', 1000, 'not_multiple'],
    ['0.15', 10, 'not_multiple'],
    ['-20', 1000, 'negative'],
    ['5-3', 100, 'invalid'],
  ])('%s of %i → %s', (raw, denom, reason) => {
    expect(entryToCount(raw, denom, 'amount')).toEqual({ ok: false, reason });
  });
});

describe('entryToCount — count mode', () => {
  it('reads piece counts', () => {
    expect(entryToCount('3', 500, 'count')).toEqual({ ok: true, count: 3 });
    expect(entryToCount('', 500, 'count')).toEqual({ ok: true, count: 0 });
  });
  it('rejects fractional and negative counts', () => {
    expect(entryToCount('2.5', 500, 'count')).toEqual({ ok: false, reason: 'invalid' });
    expect(entryToCount('-2', 500, 'count')).toEqual({ ok: false, reason: 'negative' });
  });
});

describe('convertEntry', () => {
  it.each([
    ['50', 1000, 'amount', 'count', '5'],
    ['5', 1000, 'count', 'amount', '50'],
    ['13', 50, 'count', 'amount', '6.5'],
    ['55', 1000, 'amount', 'count', '55'], // invalid entries are left as typed
    ['', 1000, 'amount', 'count', ''],
    ['7', 1000, 'count', 'count', '7'],
  ] as const)('%s (%i) %s→%s = %s', (raw, denom, from, to, out) => {
    expect(convertEntry(raw, denom, from, to)).toBe(out);
  });
});
