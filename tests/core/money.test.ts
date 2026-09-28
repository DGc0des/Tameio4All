import { describe, expect, it } from 'vitest';
import {
  centsToPlain,
  formatCents,
  formatEuro,
  parseAmount,
  parseCount,
  parseDecimal,
  sanitizeAmountInput,
} from '../../src/core/money';

describe('parseAmount', () => {
  it.each([
    ['12,5', 1250],
    ['12.50', 1250],
    ['7.', 700],
    ['.5', 50],
    ['0.05', 5],
    [' 3 ', 300],
    ['0', 0],
  ])('%s → %i cents', (raw, cents) => {
    expect(parseAmount(raw)).toEqual({ ok: true, value: cents });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['-3', 'negative'],
    ['5-3', 'invalid'],
    ['abc', 'invalid'],
    ['.', 'invalid'],
    [',', 'invalid'],
    ['1e3', 'invalid'],
    ['1.2.3', 'invalid'],
    ['1.234', 'too_many_decimals'],
  ])('%s → %s', (raw, reason) => {
    expect(parseAmount(raw)).toEqual({ ok: false, reason });
  });

  it('rejects numbers beyond safe integer range', () => {
    expect(parseAmount('99999999999999999999')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('parseDecimal', () => {
  it('scales by the requested places', () => {
    expect(parseDecimal('1,25', 3)).toEqual({ ok: true, value: 1250 });
    expect(parseDecimal('1.2345', 3)).toEqual({ ok: false, reason: 'too_many_decimals' });
  });
});

describe('parseCount', () => {
  it('accepts non-negative integers', () => {
    expect(parseCount('12')).toEqual({ ok: true, value: 12 });
    expect(parseCount(' 0 ')).toEqual({ ok: true, value: 0 });
  });
  it.each([
    ['', 'empty'],
    ['2.5', 'invalid'],
    ['2,5', 'invalid'],
    ['-1', 'negative'],
    ['x', 'invalid'],
  ])('%s → %s', (raw, reason) => {
    expect(parseCount(raw)).toEqual({ ok: false, reason });
  });
});

describe('sanitizeAmountInput', () => {
  it.each([
    ['12,5', '12.5'],
    ['1.2.3', '1.23'],
    ['-5a', '5'],
    ['5-3', '53'],
    ['', ''],
  ])('%s → %s', (raw, out) => {
    expect(sanitizeAmountInput(raw)).toBe(out);
  });
});

describe('formatCents', () => {
  it.each([
    [123456, '1234.56€'],
    [-100000, '-1000.00€'],
    [5, '0.05€'],
    [0, '0.00€'],
    [-5, '-0.05€'],
  ])('%i → %s', (c, out) => {
    expect(formatCents(c)).toBe(out);
  });
});

describe('centsToPlain', () => {
  it.each([
    [1250, '12.5'],
    [5, '0.05'],
    [1200, '12'],
    [1205, '12.05'],
    [0, '0'],
    [-1250, '-12.5'],
    [-5, '-0.05'],
    [-1200, '-12'],
  ])('%i → %s', (c, out) => {
    expect(centsToPlain(c)).toBe(out);
  });
});

describe('formatEuro', () => {
  it.each([
    [185520, '1.855,20€'],
    [5, '0,05€'],
    [0, '0,00€'],
    [-100000, '-1.000,00€'],
    [123456789, '1.234.567,89€'],
    [99999, '999,99€'],
    [-5, '-0,05€'],
  ])('%i → %s', (c, out) => {
    expect(formatEuro(c)).toBe(out);
  });
});
