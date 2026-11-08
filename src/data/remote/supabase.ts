import type { SupabaseClient } from '@supabase/supabase-js';
import type { KeyValueStore } from '../local/storage';
import { createSupabase } from './client';

let instance: { client: SupabaseClient | null } | null = null;

/** One GoTrue client per page: the owner area and the phone flow share it (two clients fight over one stored session). */
export function getSupabase(store: KeyValueStore): SupabaseClient | null {
  if (!instance) instance = { client: createSupabase(store) };
  return instance.client;
}
