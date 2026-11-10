import type { EntryMode } from '../../../core/denominations';
import type { ExpenseAuthor } from '../../../core/formula';
import { sanitizeAmountInput, type Cents } from '../../../core/money';

/**
 * The shared field model (SQL `private.closing_field_ok` is the server twin; keep them in step):
 *   d:<denomCents>      {text, mode: 'amount'|'count'}
 *   c:<channelId>       {text}
 *   e:<expenseId>       {addedBy, removed, order}   (line meta; `order` = client ms at creation)
 *   e:<expenseId>:d     {text}                      (description)
 *   e:<expenseId>:a     {text}                      (amount)
 */
export type FieldKey = string;

export const KEY_RE = /^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$/;
export const MAX_TEXT = 200;

export const isFieldKey = (k: unknown): k is FieldKey => typeof k === 'string' && KEY_RE.test(k);

export const denomKey = (d: Cents): FieldKey => `d:${d}`;
export const channelKey = (id: string): FieldKey => `c:${id}`;
export const expenseKey = (id: string): FieldKey => `e:${id}`;
export const expenseDescKey = (id: string): FieldKey => `e:${id}:d`;
export const expenseAmountKey = (id: string): FieldKey => `e:${id}:a`;

export type ParsedKey =
  | { kind: 'denom'; denom: Cents }
  | { kind: 'channel'; id: string }
  | { kind: 'expense'; id: string }
  | { kind: 'expenseDesc'; id: string }
  | { kind: 'expenseAmount'; id: string };

/** null for anything that does not match KEY_RE, and for non-canonical denomination keys (leading zero / zero). */
export function parseKey(key: string): ParsedKey | null {
  if (!isFieldKey(key)) return null;
  // KEY_RE is the SQL twin (it accepts d:0100); here a denomination must be a canonical positive
  // integer so two keys can never name one entry.
  if (key.startsWith('d:') && !/^d:[1-9][0-9]{0,5}$/.test(key)) return null;
  if (key.startsWith('d:')) return { kind: 'denom', denom: Number(key.slice(2)) };
  if (key.startsWith('c:')) return { kind: 'channel', id: key.slice(2) };
  const rest = key.slice(2);
  if (rest.endsWith(':d')) return { kind: 'expenseDesc', id: rest.slice(0, -2) };
  if (rest.endsWith(':a')) return { kind: 'expenseAmount', id: rest.slice(0, -2) };
  return { kind: 'expense', id: rest };
}

export interface ExpenseMeta {
  addedBy: ExpenseAuthor;
  removed: boolean;
  order: number;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string' && [...x].length <= MAX_TEXT; // code points, like SQL char_length

// Exact key sets, like SQL (`v_keys = array[...]`): no extra properties.
const hasKeys = (v: Obj, keys: string[]): boolean => {
  const k = Object.keys(v);
  return k.length === keys.length && keys.every((x) => k.includes(x));
};
export const isTextValue = (v: unknown): v is { text: string } => isObj(v) && hasKeys(v, ['text']) && isText(v.text);
export const isDenomValue = (v: unknown): v is { text: string; mode: EntryMode } =>
  isObj(v) && hasKeys(v, ['mode', 'text']) && isText(v.text) && (v.mode === 'amount' || v.mode === 'count');
// Stricter than SQL (which only needs an object): the server always writes a real author, and a
// line whose author is unreadable could not be submitted anyway.
const isAuthor = (x: unknown): x is ExpenseAuthor =>
  isObj(x) && (x.kind === 'owner' || (x.kind === 'staff' && typeof x.id === 'string' && x.id.length > 0));
export const isExpenseMeta = (v: unknown): v is ExpenseMeta =>
  isObj(v) && hasKeys(v, ['addedBy', 'order', 'removed']) && typeof v.removed === 'boolean' && typeof v.order === 'number' && Number.isFinite(v.order) && isAuthor(v.addedBy);

// Value builders for what a box writes (exact key sets, text cut to MAX_TEXT code points).
const cut = (text: string): string => [...text].slice(0, MAX_TEXT).join('');
/** A denomination box: amount text sanitized, stored with the mode it was typed in. */
export const denomValue = (text: string, mode: EntryMode): { text: string; mode: EntryMode } => ({ text: cut(sanitizeAmountInput(text)), mode });
/** A channel or expense-amount box. */
export const amountValue = (text: string): { text: string } => ({ text: cut(sanitizeAmountInput(text)) });
/** An expense description (free text). */
export const textValue = (text: string): { text: string } => ({ text: cut(text) });
export const expenseMetaValue = (addedBy: ExpenseAuthor, order: number, removed: boolean): ExpenseMeta => ({ addedBy, order, removed });

/** True when `value` has the shape the server accepts for `key`. */
export function isFieldValue(key: FieldKey, value: unknown): boolean {
  const p = parseKey(key);
  if (p === null) return false;
  switch (p.kind) {
    case 'denom': return isDenomValue(value);
    case 'expense': return isExpenseMeta(value);
    default: return isTextValue(value);
  }
}

export type ServerField = { key: FieldKey; value: unknown; version: number; updatedByName: string; updatedAt: string };

export interface Snapshot {
  id: string;
  businessDate: string;
  configId: string;
  config: unknown;
  revision: number;
  lastSubmit: { closingId: string; staffName: string; at: string } | null;
  fields: Record<FieldKey, ServerField>;
}

/**
 * The server's answer to a successful write. `value` is what the server STORED (since 20261108000003):
 * for an `e:<id>` line the author is decided server-side, so it may differ from what was sent. Absent
 * from an older server: the sent value is used.
 */
export type FieldAck = { version: number; revision: number; value?: unknown };

/** Queue owner of the owner's «Σήμερα» edits (staff edits carry the cashier's staff id, a uuid). */
export const OWNER_QUEUE_AUTHOR = 'owner';

export interface PendingEdit {
  /**
   * Who typed it: the cashier's staff id, or OWNER_QUEUE_AUTHOR. An engine shows and sends only its own
   * author's items (they are sent with that person's credentials); others stay stored, hidden.
   */
  author: string;
  key: FieldKey;
  value: unknown;
  businessDate: string;
  baseVersion: number | null;
  queuedOffline: boolean;
  seq: number;
}
