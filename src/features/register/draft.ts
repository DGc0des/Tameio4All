import { isIsoDate } from '../../app/dates';
import { convertEntry, type EntryMode } from '../../core/denominations';
import { sanitizeAmountInput } from '../../core/money';

export interface ExpenseDraft {
  id: string;
  description: string;
  amountText: string;
}

/** Everything the person typed, as text. Money is only derived from it by deriveClosing. */
export interface Draft {
  id: string;
  staffName: string;
  businessDate: string;
  mode: EntryMode;
  /** Keyed by String(denominationCents). */
  entries: Record<string, string>;
  /** Keyed by channel id. */
  channels: Record<string, string>;
  expenses: ExpenseDraft[];
}

export function newDraft(id: string, businessDate: string, staffName = '', mode: EntryMode = 'amount'): Draft {
  return { id, staffName, businessDate, mode, entries: {}, channels: {}, expenses: [] };
}

export type DraftAction =
  | { type: 'setEntry'; denom: number; text: string }
  | { type: 'setChannel'; id: string; text: string }
  | { type: 'setMode'; mode: EntryMode; denominations: readonly number[] }
  | { type: 'addExpense'; id: string; max: number }
  | { type: 'setExpense'; id: string; description?: string; amountText?: string }
  | { type: 'removeExpense'; id: string }
  | { type: 'setStaff'; name: string }
  | { type: 'setDate'; date: string }
  | { type: 'resetInputs'; id: string }
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
      return { ...draft, expenses: [...draft.expenses, { id: action.id, description: '', amountText: '' }] };
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
    case 'setStaff':
      return { ...draft, staffName: action.name.trim() };
    case 'setDate':
      return isIsoDate(action.date) ? { ...draft, businessDate: action.date } : draft;
    case 'resetInputs':
      return newDraft(action.id, draft.businessDate, draft.staffName, draft.mode);
    case 'replace':
      return action.draft;
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStringRecord = (x: unknown): boolean => isObj(x) && Object.values(x).every((v) => typeof v === 'string');
const isExpenseDraft = (x: unknown): boolean =>
  isObj(x) && typeof x.id === 'string' && typeof x.description === 'string' && typeof x.amountText === 'string';

/** Guards drafts read back from storage (they may be from an older app version or corrupted). */
export function isDraft(x: unknown): x is Draft {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.staffName === 'string' &&
    typeof x.businessDate === 'string' &&
    (x.mode === 'amount' || x.mode === 'count') &&
    isStringRecord(x.entries) &&
    isStringRecord(x.channels) &&
    Array.isArray(x.expenses) &&
    x.expenses.every(isExpenseDraft)
  );
}
