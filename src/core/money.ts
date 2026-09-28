/** Integer euro cents. All money in src/core is integer cents — never float euros. */
export type Cents = number;

export type ParseFailure = 'empty' | 'negative' | 'too_many_decimals' | 'invalid';
export type ParseResult = { ok: true; value: number } | { ok: false; reason: ParseFailure };

const DECIMAL = /^(\d*)(?:\.(\d*))?$/;
const INTEGER = /^\d+$/;

/**
 * Parses a non-negative decimal typed by a person ("12,5", "12.50", "7.", ".5") into an
 * integer scaled by 10^places. Uses string arithmetic, so no float rounding can occur.
 */
export function parseDecimal(raw: string, places: number): ParseResult {
  const s = raw.trim().replace(/,/g, '.');
  if (s === '') return { ok: false, reason: 'empty' };
  if (s.startsWith('-')) return { ok: false, reason: 'negative' };
  const m = DECIMAL.exec(s);
  if (!m || !/\d/.test(s)) return { ok: false, reason: 'invalid' };
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  if (frac.length > places) return { ok: false, reason: 'too_many_decimals' };
  const value = Number(whole || '0') * 10 ** places + Number(frac.padEnd(places, '0') || '0');
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'invalid' };
  return { ok: true, value };
}

/** Euro amount → cents. */
export function parseAmount(raw: string): ParseResult {
  return parseDecimal(raw, 2);
}

/** Piece count → non-negative integer. */
export function parseCount(raw: string): ParseResult {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  if (s.startsWith('-')) return { ok: false, reason: 'negative' };
  if (!INTEGER.test(s)) return { ok: false, reason: 'invalid' };
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'invalid' };
  return { ok: true, value };
}

/** Keystroke filter for amount fields: comma → dot, digits and one dot only. */
export function sanitizeAmountInput(raw: string): string {
  const s = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  return dot === -1 ? s : s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
}

/** 123456 → "1234.56€" (same shape tameioV2 displayed). */
export function formatCents(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}€`;
}

/** Cents → shortest plain decimal for refilling an input: 1250 → "12.5", -1250 → "-12.5". */
export function centsToPlain(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  const whole = Math.floor(a / 100);
  const frac = a % 100;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Greek display format: 185520 → "1.855,20€" (dot thousands, comma decimals). */
export function formatEuro(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${whole},${String(a % 100).padStart(2, '0')}€`;
}
