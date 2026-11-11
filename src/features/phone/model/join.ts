import { clearJoinKey, loadJoinKey, saveJoinKey } from '../../../data/local/phone';
import type { KeyValueStore } from '../../../data/local/storage';
import type { DeviceApi, DResult } from '../../../data/remote/deviceApi';

/**
 * The only client code that calls `api.join`. Keeps the stored key right: saved after a successful join (so the
 * phone can return by itself), forgotten when the server refuses that same key (the link was replaced).
 * Never throws: the local store helpers are failure-safe.
 */
export async function joinStore(
  api: DeviceApi,
  store: KeyValueStore,
  key: string,
  label: string,
  opts?: { force?: boolean; switchShop?: boolean },
): Promise<DResult<void>> {
  const r = await api.join(key, label, opts);
  if (r.ok) saveJoinKey(store, key);
  else if (r.error.code === 'invalid_code' && loadJoinKey(store) === key) clearJoinKey(store);
  return r;
}
