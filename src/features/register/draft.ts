import type { EntryMode } from '../../core/denominations';
import type { ExpenseAuthor } from '../../core/formula';

export interface ExpenseDraft {
  id: string;
  description: string;
  amountText: string;
  /** null only for drafts that predate sign-in; such a draft cannot be submitted. */
  addedBy: ExpenseAuthor | null;
  /** Client ms at creation: the shared, deterministic line order. */
  order: number;
}

/** One denomination box: the typed text and the mode it was typed in (each box has its own). */
export interface BoxText {
  text: string;
  mode: EntryMode;
}

/**
 * The closing as text (the live merged view: server fields + this client's unsent edits, built by
 * `draftFromFields`). Money is only derived from it by deriveClosing.
 */
export interface Draft {
  businessDate: string;
  /** Keyed by String(denominationCents). */
  entries: Record<string, BoxText>;
  /** Keyed by channel id. */
  channels: Record<string, string>;
  expenses: ExpenseDraft[];
}

export function newDraft(businessDate: string): Draft {
  return { businessDate, entries: {}, channels: {}, expenses: [] };
}
