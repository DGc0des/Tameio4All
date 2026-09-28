import type { ShopConfig } from '../../core/config';
import { denomLabel, entryToCount, isBill } from '../../core/denominations';
import { planEnvelope, type EnvelopePlan } from '../../core/envelope';
import { evaluateTotals, type ClosingInputs, type ExpenseEntry } from '../../core/formula';
import { parseAmount, type Cents } from '../../core/money';
import type { Draft } from './draft';

export interface FieldError {
  field: string;
  label: string;
  message: string;
}

export interface Derived {
  inputs: ClosingInputs;
  errors: FieldError[];
  totals: Record<string, Cents>;
  envelope: EnvelopePlan;
  /** Value of each valid, non-zero denomination row, keyed by String(denominationCents). */
  rowCents: Record<string, Cents>;
  /** Amount of each valid, non-zero expense row, keyed by expense id. */
  expenseRowCents: Record<string, Cents>;
  billsCents: Cents;
  coinsCents: Cents;
  expensesCents: Cents;
}

export const fieldId = {
  denom: (d: Cents): string => `denom:${d}`,
  channel: (id: string): string => `channel:${id}`,
  expense: (id: string): string => `expense:${id}`,
};

const MESSAGES: Record<string, string> = {
  not_multiple: 'όχι πολλαπλάσιο',
  negative: 'αρνητικό ποσό',
  invalid: 'μη έγκυρη τιμή',
  too_many_decimals: 'πολλά δεκαδικά',
};
const message = (reason: string): string => MESSAGES[reason] ?? reason;

/** The only bridge from typed text to money. Invalid fields are reported and left out. */
export function deriveClosing(config: ShopConfig, draft: Draft): Derived {
  const errors: FieldError[] = [];

  const counts: Record<string, number> = {};
  const rowCents: Record<string, Cents> = {};
  let billsCents = 0;
  let coinsCents = 0;
  for (const d of config.denominations) {
    const key = String(d);
    const r = entryToCount(draft.entries[key] ?? '', d, draft.mode);
    if (!r.ok) {
      errors.push({ field: fieldId.denom(d), label: denomLabel(d), message: message(r.reason) });
      continue;
    }
    if (r.count === 0) continue;
    const cents = r.count * d;
    // A huge but individually "valid" count (e.g. typed as digits, safe on its own) can still
    // overflow Number's safe-integer range once multiplied by the denomination — silently
    // corrupting the total instead of erroring, since IEEE-754 doubles round past 2^53.
    if (!Number.isSafeInteger(cents)) {
      errors.push({ field: fieldId.denom(d), label: denomLabel(d), message: message('invalid') });
      continue;
    }
    counts[key] = r.count;
    rowCents[key] = cents;
    if (isBill(d)) billsCents += cents;
    else coinsCents += cents;
  }

  const channelCents: Record<string, Cents> = {};
  for (const ch of config.channels) {
    const r = parseAmount(draft.channels[ch.id] ?? '');
    if (r.ok) {
      if (r.value > 0) channelCents[ch.id] = r.value;
    } else if (r.reason !== 'empty') {
      errors.push({ field: fieldId.channel(ch.id), label: ch.label, message: message(r.reason) });
    }
  }

  const expenses: ExpenseEntry[] = [];
  const expenseRowCents: Record<string, Cents> = {};
  draft.expenses.slice(0, config.maxExpenses).forEach((e, i) => {
    const r = parseAmount(e.amountText);
    if (r.ok) {
      if (r.value > 0) {
        expenses.push({ description: e.description.trim(), cents: r.value });
        expenseRowCents[e.id] = r.value;
      }
    } else if (r.reason !== 'empty') {
      errors.push({ field: fieldId.expense(e.id), label: e.description.trim() || `Έξοδο ${i + 1}`, message: message(r.reason) });
    }
  });

  const inputs: ClosingInputs = { schema: 1, counts, channelCents, expenses };
  const totals = evaluateTotals(config, inputs);
  const envelope = planEnvelope(totals[config.envelopeTotalId] ?? 0, counts, config.denominations);
  const expensesCents = expenses.reduce((sum, e) => sum + e.cents, 0);

  return { inputs, errors, totals, envelope, rowCents, expenseRowCents, billsCents, coinsCents, expensesCents };
}

export function fieldError(derived: Derived, field: string): string | undefined {
  return derived.errors.find((e) => e.field === field)?.message;
}

export function envelopeBlockReason(derived: Derived): string | null {
  return derived.errors.length > 0 ? `Λάθος τιμή: ${derived.errors.map((e) => e.label).join(', ')}` : null;
}

export function submitBlockReason(derived: Derived, draft: Draft): string | null {
  return envelopeBlockReason(derived) ?? (draft.staffName === '' ? 'Διάλεξε όνομα για υποβολή' : null);
}
