/** Limits mirror the database CHECKs (shops.name 1–80, staff.name 1–40, devices.label ≤ 60). */
export const SHOP_NAME_MAX = 80;
export const STAFF_NAME_MAX = 40;
export const DEVICE_LABEL_MAX = 60;
export const PASSWORD_MIN = 8;

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

export const isPin = (s: string): boolean => /^[0-9]{4}$/.test(s);
export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
