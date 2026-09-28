import { parseDecimal } from './money';

/** Scale reading in kg (as typed) minus the container's tare, in whole grams. */
export function netWeightGrams(grossKgRaw: string, tareGrams: number): number | null {
  const gross = parseDecimal(grossKgRaw, 3);
  if (!gross.ok || gross.value <= 0) return null;
  const net = gross.value - tareGrams;
  return net < 0 ? null : net;
}

export function formatKg(grams: number): string {
  return `${Math.floor(grams / 1000)}.${String(grams % 1000).padStart(3, '0')}`;
}
