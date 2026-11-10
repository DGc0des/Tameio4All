import type { EntryMode } from '../../core/denominations';
import {
  isFieldKey, isFieldValue, type PendingEdit, type ServerField, type Snapshot,
} from '../../features/register/live/fields';
import { readJson, shopKey, writeJson, type KeyValueStore } from './storage';

/**
 * Local side of the live shared closing: the queue of edits not yet acknowledged by the server, the
 * last server snapshot (for offline start) and the per-shop entry-mode preference.
 * Failure-safe: nothing here throws; corrupt data reads back as empty / null / the default.
 */

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const pendingKey = (shop: string) => shopKey(shop, 'pending');
const snapshotKey = (shop: string) => shopKey(shop, 'snapshot');
const entryModeKey = (shop: string) => shopKey(shop, 'entryMode');

function isPendingEdit(x: unknown): x is PendingEdit {
  return (
    isObj(x) && isFieldKey(x.key) && isFieldValue(x.key, x.value) && isStr(x.businessDate) &&
    (x.baseVersion === null || isNum(x.baseVersion)) && typeof x.queuedOffline === 'boolean' && isNum(x.seq)
  );
}

/** Not an array -> []. A malformed item is dropped on its own: one bad entry must not lose the rest of the queue. */
export function loadPending(store: KeyValueStore, shopId: string): PendingEdit[] {
  const raw = readJson(store, pendingKey(shopId));
  return Array.isArray(raw) ? raw.filter(isPendingEdit) : [];
}

export function savePending(store: KeyValueStore, shopId: string, list: PendingEdit[]): boolean {
  return writeJson(store, pendingKey(shopId), list);
}

function isServerField(key: string, x: unknown): x is ServerField {
  return (
    isObj(x) && x.key === key && isFieldValue(key, x.value) && isNum(x.version) && isStr(x.updatedByName) && isStr(x.updatedAt)
  );
}

function isSnapshot(x: unknown): x is Snapshot {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.businessDate) || !isStr(x.configId) || !('config' in x) || !isNum(x.revision)) return false;
  const ls = x.lastSubmit;
  if (ls !== null && !(isObj(ls) && isStr(ls.closingId) && isStr(ls.staffName) && isStr(ls.at))) return false;
  if (!isObj(x.fields)) return false;
  return Object.entries(x.fields).every(([k, f]) => isFieldKey(k) && isServerField(k, f));
}

/** A snapshot with any malformed part is unusable as a whole -> null (the register then starts from the server). */
export function loadSnapshot(store: KeyValueStore, shopId: string): Snapshot | null {
  const raw = readJson(store, snapshotKey(shopId));
  return isSnapshot(raw) ? raw : null;
}

export function saveSnapshot(store: KeyValueStore, shopId: string, s: Snapshot): boolean {
  return writeJson(store, snapshotKey(shopId), s);
}

export function loadEntryMode(store: KeyValueStore, shopId: string): EntryMode {
  const v = readJson(store, entryModeKey(shopId));
  return v === 'count' ? 'count' : 'amount';
}

export function saveEntryMode(store: KeyValueStore, shopId: string, m: EntryMode): boolean {
  return writeJson(store, entryModeKey(shopId), m);
}
