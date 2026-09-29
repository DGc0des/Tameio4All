import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, authStorage } from '../local/authStorage';
import type { KeyValueStore } from '../local/storage';

/**
 * null when the env vars are missing (e.g. not registered in Vercel) — the owner area then says so
 * instead of crashing at import time. PKCE keeps auth codes in the query string (the hash is the
 * router's); detectSessionInUrl is off because OwnerApp exchanges the code itself, exactly once.
 */
export function createSupabase(store: KeyValueStore): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage: authStorage(store),
      storageKey: AUTH_STORAGE_KEY,
    },
  });
}
