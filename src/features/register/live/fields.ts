import type { EntryMode } from '../../../core/denominations';
import type { ExpenseAuthor } from '../../../core/formula';
import type { Cents } from '../../../core/money';

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

/** null for anything that does not match KEY_RE. */
export function parseKey(key: string): ParsedKey | null {
  if (!isFieldKey(key)) return null;
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
const isText = (x: unknown): x is string => typeof x === 'string' && x.length <= MAX_TEXT;

export const isTextValue = (v: unknown): v is { text: string } => isObj(v) && isText(v.text);
export const isDenomValue = (v: unknown): v is { text: string; mode: EntryMode } =>
  isTextValue(v) && ((v as Obj).mode === 'amount' || (v as Obj).mode === 'count');
// Stricter than SQL (which only needs an object): the server always writes a real author, and a
// line whose author is unreadable could not be submitted anyway.
const isAuthor = (x: unknown): x is ExpenseAuthor =>
  isObj(x) && (x.kind === 'owner' || (x.kind === 'staff' && typeof x.id === 'string' && x.id.length > 0));
export const isExpenseMeta = (v: unknown): v is ExpenseMeta =>
  isObj(v) && typeof v.removed === 'boolean' && typeof v.order === 'number' && Number.isFinite(v.order) && isAuthor(v.addedBy);

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

export interface PendingEdit {
  key: FieldKey;
  value: unknown;
  businessDate: string;
  baseVersion: number | null;
  queuedOffline: boolean;
  seq: number;
}
