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

/** "2026-09-28" → "28/09". Unknown input is returned unchanged. */
export function formatDayMonth(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [, mo, d] = iso.split('-');
  return `${d}/${mo}`;
}

/** "2026-09-28" → "28/09/2026". Unknown input is returned unchanged. */
export function formatDateEl(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

const TIME_EL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** An ISO timestamp → "21:42", shop time (Europe/Athens, like the business day). Unknown input is returned unchanged. */
export function formatTimeEl(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const parts = TIME_EL.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

const STAMP_EL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Athens', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const WEEKDAY_EL: Record<string, string> = { Mon: 'Δευ', Tue: 'Τρι', Wed: 'Τετ', Thu: 'Πεμ', Fri: 'Παρ', Sat: 'Σαβ', Sun: 'Κυρ' };

/** An ISO timestamp → "Δευ 09/11 14:32", shop time (Europe/Athens). Unknown input is returned unchanged. */
export function formatStampEl(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const parts = STAMP_EL.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${WEEKDAY_EL[get('weekday')] ?? get('weekday')} ${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}
