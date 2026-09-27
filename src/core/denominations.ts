import { centsToPlain, parseAmount, parseCount, type Cents, type ParseFailure } from './money';

/** Every euro note and coin a till can hold, largest first. 1c/2c are not handled. */
export const EUR_DENOMINATIONS: readonly Cents[] = [
  50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5,
];

/** 'amount': the person types a euro total per denomination. 'count': number of pieces. */
export type EntryMode = 'amount' | 'count';

export type EntryResult =
  | { ok: true; count: number }
  | { ok: false; reason: Exclude<ParseFailure, 'empty'> | 'not_multiple' };

export function isBill(d: Cents): boolean {
  return d >= 500;
}

export function denomLabel(d: Cents): string {
  return d >= 100 ? `${d / 100}€` : `${d}c`;
}

/** Converts what was typed in a denomination field into a piece count. Empty means 0. */
export function entryToCount(raw: string, denom: Cents, mode: EntryMode): EntryResult {
  const parsed = mode === 'count' ? parseCount(raw) : parseAmount(raw);
  if (!parsed.ok) {
    return parsed.reason === 'empty' ? { ok: true, count: 0 } : { ok: false, reason: parsed.reason };
  }
  if (mode === 'count') return { ok: true, count: parsed.value };
  if (parsed.value % denom !== 0) return { ok: false, reason: 'not_multiple' };
  return { ok: true, count: parsed.value / denom };
}

/** Rewrites a field's text when the person switches entry mode. Invalid or empty text is kept. */
export function convertEntry(raw: string, denom: Cents, from: EntryMode, to: EntryMode): string {
  if (from === to) return raw;
  const r = entryToCount(raw, denom, from);
  if (!r.ok || r.count === 0) return raw;
  return to === 'count' ? String(r.count) : centsToPlain(r.count * denom);
}
