/** Server-side lifetime of a pairing code (create_pairing_code: now() + 10 minutes). */
export const PAIRING_TTL_SECONDS = 600;

/** 'ABCDEFGH' → 'ABCD-EFGH' for reading aloud; other lengths are shown as they are. */
export function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function secondsLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
