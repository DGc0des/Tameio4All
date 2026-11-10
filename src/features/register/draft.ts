import type { EntryMode } from '../../core/denominations';
import type { ExpenseAuthor } from '../../core/formula';
import { sanitizeAmountInput } from '../../core/money';

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

/** Everything the person typed, as text. Money is only derived from it by deriveClosing. */
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

export type DraftAction =
  | { type: 'setEntry'; denom: number; text: string; mode: EntryMode }
  | { type: 'setChannel'; id: string; text: string }
  | { type: 'addExpense'; id: string; max: number; addedBy: ExpenseAuthor | null; order: number }
  | { type: 'setExpense'; id: string; description?: string; amountText?: string }
  | { type: 'removeExpense'; id: string }
  | { type: 'replace'; draft: Draft };

export type DraftDispatch = (action: DraftAction) => void;

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'setEntry':
      return { ...draft, entries: { ...draft.entries, [String(action.denom)]: { text: sanitizeAmountInput(action.text), mode: action.mode } } };
    case 'setChannel':
      return { ...draft, channels: { ...draft.channels, [action.id]: sanitizeAmountInput(action.text) } };
    case 'addExpense':
      if (draft.expenses.length >= action.max) return draft;
      return { ...draft, expenses: [...draft.expenses, { id: action.id, description: '', amountText: '', addedBy: action.addedBy, order: action.order }] };
    case 'setExpense':
      return {
        ...draft,
        expenses: draft.expenses.map((e) =>
          e.id !== action.id
            ? e
            : {
                ...e,
                ...(action.description !== undefined ? { description: action.description } : {}),
                ...(action.amountText !== undefined ? { amountText: sanitizeAmountInput(action.amountText) } : {}),
              },
        ),
      };
    case 'removeExpense':
      return { ...draft, expenses: draft.expenses.filter((e) => e.id !== action.id) };
    case 'replace':
      return action.draft;
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStringRecord = (x: unknown): boolean => isObj(x) && Object.values(x).every((v) => typeof v === 'string');
const isBoxRecord = (x: unknown): boolean =>
  isObj(x) && Object.values(x).every((v) => isObj(v) && typeof v.text === 'string' && (v.mode === 'amount' || v.mode === 'count'));
const isAuthor = (x: unknown): boolean =>
  isObj(x) && (x.kind === 'owner' || (x.kind === 'staff' && typeof x.id === 'string' && x.id.length > 0));
// Same author rule as validateClosingInputs, so a stored draft can never make evaluateTotals throw.
// `addedBy` must be present (null or an author): drafts saved before it existed are discarded on load.
const isExpenseDraft = (x: unknown): boolean =>
  isObj(x) &&
  typeof x.id === 'string' &&
  typeof x.description === 'string' &&
  typeof x.amountText === 'string' &&
  typeof x.order === 'number' &&
  Number.isFinite(x.order) &&
  Object.hasOwn(x, 'addedBy') &&
  (x.addedBy === null || isAuthor(x.addedBy));

/** Guards drafts read back from storage. Accepts only the current shape: older drafts (with `id`/`mode`) are discarded. */
export function isDraft(x: unknown): x is Draft {
  return (
    isObj(x) &&
    typeof x.businessDate === 'string' &&
    isBoxRecord(x.entries) &&
    isStringRecord(x.channels) &&
    Array.isArray(x.expenses) &&
    x.expenses.every(isExpenseDraft)
  );
}
