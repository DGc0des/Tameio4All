import { isDraft, type Draft } from '../../features/register/draft';
import { readJson, removeKey, shopKey, writeJson, type KeyValueStore } from './storage';

/** A draft older than one shift (10 h, as in tameioV2) is discarded on load. */
export const DRAFT_TTL_MS = 10 * 60 * 60 * 1000;

export function loadDraft(store: KeyValueStore, shopId: string, nowMs: number): Draft | null {
  const key = shopKey(shopId, 'draft');
  const saved = readJson(store, key);
  if (saved === null) return null;
  const s = typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  if (typeof s.savedAt !== 'number' || !isDraft(s.draft) || nowMs - s.savedAt > DRAFT_TTL_MS) {
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
