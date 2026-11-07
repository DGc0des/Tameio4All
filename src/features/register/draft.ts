import { convertEntry, type EntryMode } from '../../core/denominations';
import type { ExpenseAuthor } from '../../core/formula';
import { sanitizeAmountInput } from '../../core/money';

export interface ExpenseDraft {
  id: string;
  description: string;
  amountText: string;
  /** null only for drafts that predate sign-in; such a draft cannot be submitted. */
  addedBy: ExpenseAuthor | null;
}

/** Everything the person typed, as text. Money is only derived from it by deriveClosing. */
export interface Draft {
  id: string;
  businessDate: string;
  mode: EntryMode;
  /** Keyed by String(denominationCents). */
  entries: Record<string, string>;
  /** Keyed by channel id. */
  channels: Record<string, string>;
  expenses: ExpenseDraft[];
}

export function newDraft(id: string, businessDate: string, mode: EntryMode = 'amount'): Draft {
  return { id, businessDate, mode, entries: {}, channels: {}, expenses: [] };
}

export type DraftAction =
  | { type: 'setEntry'; denom: number; text: string }
  | { type: 'setChannel'; id: string; text: string }
  | { type: 'setMode'; mode: EntryMode; denominations: readonly number[] }
  | { type: 'addExpense'; id: string; max: number; addedBy: ExpenseAuthor | null }
  | { type: 'setExpense'; id: string; description?: string; amountText?: string }
  | { type: 'removeExpense'; id: string }
  | { type: 'replace'; draft: Draft };

export type DraftDispatch = (action: DraftAction) => void;

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'setEntry':
      return { ...draft, entries: { ...draft.entries, [String(action.denom)]: sanitizeAmountInput(action.text) } };
    case 'setChannel':
      return { ...draft, channels: { ...draft.channels, [action.id]: sanitizeAmountInput(action.text) } };
    case 'setMode': {
      if (action.mode === draft.mode) return draft;
      const entries: Record<string, string> = {};
      for (const d of action.denominations) {
        const text = draft.entries[String(d)];
        if (text !== undefined && text !== '') entries[String(d)] = convertEntry(text, d, draft.mode, action.mode);
      }
      return { ...draft, mode: action.mode, entries };
    }
    case 'addExpense':
      if (draft.expenses.length >= action.max) return draft;
      return { ...draft, expenses: [...draft.expenses, { id: action.id, description: '', amountText: '', addedBy: action.addedBy }] };
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
const isAuthor = (x: unknown): boolean =>
  isObj(x) && (x.kind === 'owner' || (x.kind === 'staff' && typeof x.id === 'string'));
// `addedBy` must be present (null or an author): drafts saved before it existed are discarded on load.
const isExpenseDraft = (x: unknown): boolean =>
  isObj(x) &&
  typeof x.id === 'string' &&
  typeof x.description === 'string' &&
  typeof x.amountText === 'string' &&
  Object.hasOwn(x, 'addedBy') &&
  (x.addedBy === null || isAuthor(x.addedBy));

/** Guards drafts read back from storage (they may be from an older app version or corrupted). */
export function isDraft(x: unknown): x is Draft {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.businessDate === 'string' &&
    (x.mode === 'amount' || x.mode === 'count') &&
    isStringRecord(x.entries) &&
    isStringRecord(x.channels) &&
    Array.isArray(x.expenses) &&
    x.expenses.every(isExpenseDraft)
  );
}
