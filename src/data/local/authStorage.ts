import { removeKey, type KeyValueStore } from './storage';

/** supabase-js keeps the session (and the PKCE code verifier) under this key prefix. */
export const AUTH_STORAGE_KEY = 'tameio4all:v1:auth';

/** Failure-safe storage for supabase auth: a refused write means "signed out after reload", never a crash. */
export function authStorage(store: KeyValueStore): KeyValueStore {
  return {
    getItem: (key) => {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        store.setItem(key, value);
      } catch {
        // storage full or blocked: the session lives in memory until the tab closes
      }
    },
    removeItem: (key) => removeKey(store, key),
  };
}
