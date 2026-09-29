import type { ShopConfig } from '../../core/config';
import { isEditableConfig } from '../../features/owner/model/settingsDraft';
import { readJson, removeKey, shopKey, writeJson, type KeyValueStore } from './storage';

/** Unpublished settings edits of one shop, with the server version they started from. */
export interface OwnerDraft {
  config: ShopConfig;
  baseVersion: number;
  savedAt: number;
}

const key = (shopId: string): string => shopKey(shopId, 'owner-draft');

export function loadOwnerDraft(store: KeyValueStore, shopId: string): OwnerDraft | null {
  const saved = readJson(store, key(shopId));
  if (typeof saved !== 'object' || saved === null) return null;
  const s = saved as Record<string, unknown>;
  if (!isEditableConfig(s.config) || !Number.isInteger(s.baseVersion) || typeof s.savedAt !== 'number') {
    removeKey(store, key(shopId));
    return null;
  }
  return { config: s.config, baseVersion: s.baseVersion as number, savedAt: s.savedAt };
}

export function saveOwnerDraft(store: KeyValueStore, shopId: string, draft: OwnerDraft): boolean {
  return writeJson(store, key(shopId), draft);
}

export function clearOwnerDraft(store: KeyValueStore, shopId: string): void {
  removeKey(store, key(shopId));
}
