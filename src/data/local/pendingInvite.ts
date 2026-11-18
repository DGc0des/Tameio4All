import { parseInviteToken } from '../../app/inviteToken';
import { readJson, removeKey, writeJson, type KeyValueStore } from './storage';

const KEY = 'tameio4all:v1:pending-invite';

/** An invite link opened before signing in, kept to resume after login. null when absent or not a token. */
export function loadPendingInvite(store: KeyValueStore): string | null {
  const v = readJson(store, KEY);
  return typeof v === 'string' ? parseInviteToken(v) : null;
}

export function savePendingInvite(store: KeyValueStore, token: string): boolean {
  return writeJson(store, KEY, token);
}

export function clearPendingInvite(store: KeyValueStore): void {
  removeKey(store, KEY);
}
