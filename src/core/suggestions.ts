import type { Cents } from './money';

/** Supplier/description name → amounts it was previously recorded with. */
export type SupplierHistory = Record<string, readonly Cents[]>;

const TOLERANCE_PCT = 0.12;
const TOLERANCE_MIN: Cents = 50;

/** The one supplier recorded with exactly this amount, or null if none or ambiguous. */
export function exactExpenseMatch(history: SupplierHistory, amountCents: Cents): string | null {
  if (!(amountCents > 0)) return null;
  let match: string | null = null;
  for (const [name, values] of Object.entries(history)) {
    if (!values.includes(amountCents)) continue;
    if (match !== null) return null;
    match = name;
  }
  return match;
}

/** Likely descriptions for an amount, best first. Suppliers match on their [min, max] range ± tolerance. */
export function suggestExpenseDescriptions(
  history: SupplierHistory,
  amountCents: Cents,
  maxResults = 6,
): string[] {
  if (!(amountCents > 0)) return [];
  const pad = Math.max(TOLERANCE_MIN, Math.round(amountCents * TOLERANCE_PCT));

  const candidates: { name: string; distToNearest: number; distToRange: number; freq: number }[] = [];
  for (const [name, values] of Object.entries(history)) {
    if (values.length === 0) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (amountCents < min - pad || amountCents > max + pad) continue;

    const distToRange = amountCents < min ? min - amountCents : amountCents > max ? amountCents - max : 0;
    const distToNearest = Math.min(...values.map((v) => Math.abs(v - amountCents)));
    candidates.push({ name, distToNearest, distToRange, freq: values.length });
  }

  candidates.sort(
    (a, b) =>
      a.distToNearest - b.distToNearest ||
      a.distToRange - b.distToRange ||
      b.freq - a.freq ||
      a.name.localeCompare(b.name, 'el'),
  );
  return candidates.slice(0, maxResults).map((c) => c.name);
}
