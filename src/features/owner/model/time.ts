import { formatTimeEl } from '../../../app/dates';

export function isLocked(lockedUntil: string | null, nowMs: number): boolean {
  if (lockedUntil === null) return false;
  const t = Date.parse(lockedUntil);
  return Number.isFinite(t) && t > nowMs;
}

const DATE_EL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Shop-time clock HH:MM (Europe/Athens). Unparseable input is returned unchanged. */
export function formatClock(iso: string): string {
  return formatTimeEl(iso);
}

/** Shop-time date DD/MM/YYYY (Europe/Athens). Unparseable input is returned unchanged. */
export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const parts = DATE_EL.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}
