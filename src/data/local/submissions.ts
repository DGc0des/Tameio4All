import type { ClosingInputs } from '../../core/formula';
import type { PastExpense } from '../../core/suggestions';
import { readJson, shopKey, writeJson, type KeyValueStore } from './storage';

/** A submitted closing kept on the device. Raw inputs only — totals are always recomputed. */
export interface Submission {
  id: string;
  shopId: string;
  staffName: string;
  businessDate: string;
  submittedAt: string;
  inputs: ClosingInputs;
}

export type SaveResult = 'saved' | 'duplicate' | 'conflict' | 'failed';

/** localStorage is ~5 MB; ~1 KB per closing, so the newest 500 are plenty for suggestions. */
export const MAX_SUBMISSIONS = 500;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function isSubmission(x: unknown): x is Submission {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.shopId === 'string' &&
    typeof x.staffName === 'string' &&
    typeof x.businessDate === 'string' &&
    typeof x.submittedAt === 'string' &&
    isObj(x.inputs) &&
    Array.isArray(x.inputs.expenses)
  );
}

export function loadSubmissions(store: KeyValueStore, shopId: string): Submission[] {
  const raw = readJson(store, shopKey(shopId, 'submissions'));
  return Array.isArray(raw) ? raw.filter(isSubmission) : [];
}

/**
 * Idempotent by id: a double tap or retry stores the closing once. If the id is already taken
 * by a *different* closing (e.g. a stale draft id reused after storage was cleared elsewhere),
 * that would silently discard the new data — so it is reported as 'conflict' and nothing is
 * written, instead of being reported as 'duplicate'.
 */
export function saveSubmission(store: KeyValueStore, submission: Submission): SaveResult {
  const list = loadSubmissions(store, submission.shopId);
  const existing = list.find((s) => s.id === submission.id);
  if (existing !== undefined) {
    return JSON.stringify(existing.inputs) === JSON.stringify(submission.inputs) ? 'duplicate' : 'conflict';
  }
  const next = [...list, submission].slice(-MAX_SUBMISSIONS);
  return writeJson(store, shopKey(submission.shopId, 'submissions'), next) ? 'saved' : 'failed';
}

/** Expense lines of past closings, for buildSupplierHistory. Malformed lines are left for it to skip. */
export function pastExpenses(subs: readonly Submission[]): PastExpense[] {
  return subs.flatMap((s) =>
    s.inputs.expenses
      .filter((e) => isObj(e))
      .map((e) => ({ description: e.description, cents: e.cents, date: s.businessDate })),
  );
}
