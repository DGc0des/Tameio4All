import type { Cents } from './money';

/** Supplier/description name → amounts it was previously recorded with, newest first. */
export type SupplierHistory = Record<string, readonly Cents[]>;

/** One expense line from a submitted closing. `date` is the business date, `YYYY-MM-DD`. */
export interface PastExpense {
  description: string;
  cents: Cents;
  date: string;
}

/** Only the most recent amounts count, so a supplier whose prices changed stops matching old prices. */
export const HISTORY_AMOUNTS_PER_SUPPLIER = 30;

const TOLERANCE_PCT = 0.12;
const TOLERANCE_MIN: Cents = 50;

const collapseSpaces = (s: string): string => s.trim().replace(/\s+/g, ' ');

/** Grouping key for a description: case, accents, extra spaces and final sigma are ignored. */
export function supplierKey(description: string): string {
  return collapseSpaces(description)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('el')
    .replace(/ς/g, 'σ');
}

const isPastExpense = (e: unknown): e is PastExpense => {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.description === 'string' &&
    typeof x.date === 'string' &&
    typeof x.cents === 'number' &&
    Number.isSafeInteger(x.cents) &&
    x.cents > 0
  );
};

/**
 * Learns a shop's suppliers from the expense lines of its submitted closings. Each shop builds its
 * own history — no supplier names ship with the app. Entries may come straight from storage, so
 * malformed ones are skipped rather than trusted. Recency is by `date`; for equal dates, later
 * entries in the array count as newer. The shown name is the most recent spelling.
 */
export function buildSupplierHistory(entries: readonly PastExpense[]): SupplierHistory {
  const newestFirst = entries
    .map((entry, index) => ({ entry: entry as unknown, index }))
    .filter((x): x is { entry: PastExpense; index: number } => isPastExpense(x.entry))
    .sort((a, b) => (a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : b.index - a.index));

  const byKey = new Map<string, { name: string; amounts: Cents[] }>();
  for (const { entry } of newestFirst) {
    const key = supplierKey(entry.description);
    if (key === '') continue;
    const group = byKey.get(key) ?? { name: collapseSpaces(entry.description), amounts: [] };
    if (group.amounts.length < HISTORY_AMOUNTS_PER_SUPPLIER) group.amounts.push(entry.cents);
    byKey.set(key, group);
  }

  const history: Record<string, Cents[]> = {};
  for (const { name, amounts } of byKey.values()) history[name] = amounts;
  return history;
}

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
