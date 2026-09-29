export function isLocked(lockedUntil: string | null, nowMs: number): boolean {
  if (lockedUntil === null) return false;
  const t = Date.parse(lockedUntil);
  return Number.isFinite(t) && t > nowMs;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local time HH:MM. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date DD/MM/YYYY. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
