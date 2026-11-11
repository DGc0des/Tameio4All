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

/** [year, month 1–12, day] of a valid ISO date, else null. */
function parts(iso: string): [number, number, number] | null {
  if (!isIsoDate(iso)) return null;
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  return [y, mo, d];
}

/** Calendar math on the date itself in UTC, so a daylight-saving change can never shift the result. */
function utcDate(y: number, mo: number, d: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  return date;
}

const isoOf = (date: Date): string => `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** "2026-11-30" + 1 → "2026-12-01". Unknown input is returned unchanged. */
export function addDaysIso(iso: string, n: number): string {
  const p = parts(iso);
  if (p === null) return iso;
  return isoOf(utcDate(p[0], p[1], p[2] + n));
}

/** The Monday of the Monday–Sunday week containing the date. Unknown input is returned unchanged. */
export function weekStartIso(iso: string): string {
  const p = parts(iso);
  if (p === null) return iso;
  const sinceMonday = (utcDate(...p).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -sinceMonday);
}

const WEEKDAYS_LONG_EL = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS_GEN_EL = [
  'Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
  'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου',
];

/** "2026-11-09" → "Δευτέρα". Unknown input is returned unchanged. */
export function formatWeekdayEl(iso: string): string {
  const p = parts(iso);
  return p === null ? iso : (WEEKDAYS_LONG_EL[utcDate(...p).getUTCDay()] ?? iso);
}

/** "2026-11-09" → "9 Νοεμβρίου" (genitive month). Unknown input is returned unchanged. */
export function formatDayMonthLongEl(iso: string): string {
  const p = parts(iso);
  return p === null ? iso : `${p[2]} ${MONTHS_GEN_EL[p[1] - 1] ?? ''}`;
}

/** A week's Monday → "9 – 15 Νοεμβρίου 2026", "30 Νοεμβρίου – 6 Δεκεμβρίου 2026" or "29 Δεκεμβρίου 2025 – 4 Ιανουαρίου 2026". */
export function formatWeekRangeEl(monday: string): string {
  const a = parts(monday);
  const sunday = addDaysIso(monday, 6);
  const b = parts(sunday);
  if (a === null || b === null) return monday;
  if (a[0] !== b[0]) return `${formatDayMonthLongEl(monday)} ${a[0]} – ${formatDayMonthLongEl(sunday)} ${b[0]}`;
  if (a[1] !== b[1]) return `${formatDayMonthLongEl(monday)} – ${formatDayMonthLongEl(sunday)} ${b[0]}`;
  return `${a[2]} – ${formatDayMonthLongEl(sunday)} ${b[0]}`;
}
