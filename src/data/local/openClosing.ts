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
    isObj(x) && isStr(x.author) && x.author !== '' && isFieldKey(x.key) && isFieldValue(x.key, x.value) && isStr(x.businessDate) &&
    (x.baseVersion === null || isNum(x.baseVersion)) && typeof x.queuedOffline === 'boolean' && isNum(x.seq)
  );
}

/**
 * The stored queue (one per shop, shared by everyone using this browser: cashiers and the owner).
 * With `author`, only that person's items. Not an array -> []. A malformed item is dropped on its own:
 * one bad entry must not lose the rest of the queue. An item without an author (stored before the
 * queue was author-tagged) is malformed: it cannot be attributed, so it is never sent.
 */
export function loadPending(store: KeyValueStore, shopId: string, author?: string): PendingEdit[] {
  const raw = readJson(store, pendingKey(shopId));
  const all = Array.isArray(raw) ? raw.filter(isPendingEdit) : [];
  return author === undefined ? all : all.filter((p) => p.author === author);
}

/**
 * Replaces `author`'s items with `mine`, keeping everyone else's as stored (read-modify-write, so an
 * engine never erases another person's hidden edits). Other authors' items of a business date before
 * `currentDate` can never be sent (the server accepts only its current date) and are dropped.
 */
export function savePending(store: KeyValueStore, shopId: string, author: string, mine: PendingEdit[], currentDate: string | null = null): boolean {
  const others = loadPending(store, shopId).filter(
    (p) => p.author !== author && (currentDate === null || p.businessDate >= currentDate),
  );
  return writeJson(store, pendingKey(shopId), [...others, ...mine]);
}

function isServerField(key: string, x: unknown): x is ServerField {
  return (
    isObj(x) && x.key === key && isFieldValue(key, x.value) && isNum(x.version) && isStr(x.updatedByName) && isStr(x.updatedAt)
  );
}

function isSnapshot(x: unknown): x is Snapshot {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.businessDate) || !isStr(x.configId) || !('config' in x) || !isNum(x.revision)) return false;
  const ls = x.lastSubmit;
  if (ls !== null && !(isObj(ls) && isStr(ls.closingId) && isStr(ls.staffName) && isStr(ls.at) && (ls.revision === undefined || isNum(ls.revision)))) return false;
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
