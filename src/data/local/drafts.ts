import { isDraft, type Draft } from '../../features/register/draft';
import { readJson, removeKey, shopKey, writeJson, type KeyValueStore } from './storage';

/** A draft belongs to one business date: one for another date (or unreadable) is discarded on load. */
export function loadDraft(store: KeyValueStore, shopId: string, businessDate: string): Draft | null {
  const key = shopKey(shopId, 'draft');
  const saved = readJson(store, key);
  if (saved === null) return null;
  const s = typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  if (!isDraft(s.draft) || s.draft.businessDate !== businessDate) {
    removeKey(store, key);
    return null;
  }
  return s.draft;
}

export function saveDraft(store: KeyValueStore, shopId: string, draft: Draft, nowMs: number): boolean {
  return writeJson(store, shopKey(shopId, 'draft'), { savedAt: nowMs, draft });
}

export function clearDraft(store: KeyValueStore, shopId: string): void {
  removeKey(store, shopKey(shopId, 'draft'));
}
