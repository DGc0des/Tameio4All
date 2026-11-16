/** Limits mirror the database CHECKs (shops.name 1–80, staff.name 1–40, devices.label ≤ 60). */
export const SHOP_NAME_MAX = 80;
export const STAFF_NAME_MAX = 40;
export const DEVICE_LABEL_MAX = 60;
export const PASSWORD_MIN = 8;
/** Closings per business day, 1..6. Cross-file: the CHECK on shops.closings_per_day and the check in set_closing_plan. */
export const MAX_CLOSINGS_PER_DAY = 6;

export type NameProblem = 'empty' | 'too_long';

/** Postgres char_length counts code points, so count them the same way (not UTF-16 units). */
const length = (s: string): number => [...s].length;

export function checkName(raw: string, max: number): { ok: true; value: string } | { ok: false; problem: NameProblem } {
  const value = raw.trim();
  if (value === '') return { ok: false, problem: 'empty' };
  if (length(value) > max) return { ok: false, problem: 'too_long' };
  return { ok: true, value };
}

export function checkLabel(raw: string, max: number): { ok: true; value: string } | { ok: false; problem: 'too_long' } {
  const value = raw.trim();
  return length(value) > max ? { ok: false, problem: 'too_long' } : { ok: true, value };
}

/** Staff PINs are exactly 6 ASCII digits. Cross-file: private.check_pin, the regex in private.check_staff_pin, the PIN inputs. */
export const PIN_LENGTH = 6;
export const isPin = (s: string): boolean => /^[0-9]{6}$/.test(s);
export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
