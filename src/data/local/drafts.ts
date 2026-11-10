import { isDraft, type Draft } from '../../features/register/draft';
import { readJson, removeKey, shopKey, writeJson, type KeyValueStore } from './storage';

const draftKey = (shopId: string) => shopKey(shopId, 'draft');
/** The draft exactly as it was when the server last acknowledged a submit of it. */
const submittedKey = (shopId: string) => shopKey(shopId, 'draft-submitted');
/** The latest draft whose business day ended before it was submitted: `{ draft, noticed }`. */
const unsentKey = (shopId: string) => shopKey(shopId, 'unsent');

function readStored(store: KeyValueStore, key: string): { draft: Draft; noticed: unknown } | null {
  const saved = readJson(store, key);
  if (typeof saved !== 'object' || saved === null) return null;
  const s = saved as Record<string, unknown>;
  return isDraft(s.draft) ? { draft: s.draft, noticed: s.noticed } : null;
}

const blank = (text: string): boolean => text.trim() === '';

/** Nothing was ever typed: every entry, channel and expense field is empty or whitespace. */
function isEmptyDraft(d: Draft): boolean {
  return (
    Object.values(d.entries).every((b) => blank(b.text)) &&
    Object.values(d.channels).every(blank) &&
    d.expenses.every((e) => blank(e.description) && blank(e.amountText))
  );
}

/**
 * A draft belongs to one business date. One for another date is never silently lost: unless it was
 * submitted and not edited since, or nothing was ever typed in it, it moves to the shop's "unsent" key
 * (only the latest is kept) and `takeUnsentNotice` reports it once. An unreadable draft is discarded.
 */
export function loadDraft(store: KeyValueStore, shopId: string, businessDate: string): Draft | null {
  const key = draftKey(shopId);
  if (readJson(store, key) === null) return null;
  const stored = readStored(store, key);
  if (stored !== null && stored.draft.businessDate === businessDate) return stored.draft;
  if (stored !== null && !isEmptyDraft(stored.draft) && JSON.stringify(readJson(store, submittedKey(shopId))) !== JSON.stringify(stored.draft)) {
    writeJson(store, unsentKey(shopId), { draft: stored.draft, noticed: false });
  }
  removeKey(store, key);
  removeKey(store, submittedKey(shopId));
  return null;
}

export function saveDraft(store: KeyValueStore, shopId: string, draft: Draft, nowMs: number): boolean {
  return writeJson(store, draftKey(shopId), { savedAt: nowMs, draft });
}

/**
 * Records that the server acknowledged a submit of exactly this draft. If the write fails, the draft is
 * only kept aside (and announced) after a day change: the safe side.
 */
export function markDraftSubmitted(store: KeyValueStore, shopId: string, draft: Draft): void {
  writeJson(store, submittedKey(shopId), draft);
}

export function clearDraft(store: KeyValueStore, shopId: string): void {
  removeKey(store, draftKey(shopId));
  removeKey(store, submittedKey(shopId));
}

/** The latest draft kept aside by a day change, or null. */
export function loadUnsentDraft(store: KeyValueStore, shopId: string): Draft | null {
  return readStored(store, unsentKey(shopId))?.draft ?? null;
}

/** The business date of a kept-aside draft not announced yet (marking it announced); otherwise null. */
export function takeUnsentNotice(store: KeyValueStore, shopId: string): string | null {
  const stored = readStored(store, unsentKey(shopId));
  if (stored === null || stored.noticed !== false) return null;
  writeJson(store, unsentKey(shopId), { draft: stored.draft, noticed: true });
  return stored.draft.businessDate;
}
