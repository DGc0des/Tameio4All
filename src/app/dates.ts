const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD (the shop's business day, not UTC). */
export function todayIso(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

const DAYS_EL = ['Κυρ', 'Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ'];

/** "2026-09-28" → "Δευ 28/09". Unknown input is returned unchanged. */
export function formatDayEl(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  return `${DAYS_EL[new Date(y, mo - 1, d).getDay()]} ${pad(d)}/${pad(mo)}`;
}

/** "2026-09-28" → "28/09/2026". Unknown input is returned unchanged. */
export function formatDateEl(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}
