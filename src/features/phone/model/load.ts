import { loadCachedContext, loadJoinKey, loadStaffSession, saveCachedContext } from '../../../data/local/phone';
import type { KeyValueStore } from '../../../data/local/storage';
import type { DeviceApi, DeviceContext, DResult } from '../../../data/remote/deviceApi';
import type { GateEvent } from './gate';
import { joinStore } from './join';

/** A context() answer as a gate event; a successful one is cached for offline starts. */
function fromContext(store: KeyValueStore, r: DResult<DeviceContext | null>): GateEvent {
  if (r.ok) {
    if (r.data !== null) saveCachedContext(store, r.data);
    return { t: 'loaded', ctx: r.data, stored: loadStaffSession(store) };
  }
  return { t: 'load_failed', error: r.error, cached: loadCachedContext(store), stored: loadStaffSession(store) };
}

/**
 * The phone's one load path (PhoneApp dispatches what it returns). When the phone turns out not to be in a
 * store (definitely no session, no device row, or `not_a_device`) and a key from an earlier join is stored and
 * no owner is signed in here, it re-joins **once** with that key and reads the context again (the silent
 * return). Never a second join in one load: no loops.
 */
export async function loadGate(api: DeviceApi, store: KeyValueStore, label: string): Promise<GateEvent> {
  // A failed lookup only means "couldn't tell" (offline with an expired access token): context() decides,
  // falling back to the cached register when offline.
  const auth = await api.session();
  const owner = auth.ok && auth.data?.anonymous === false;
  let notInStore: GateEvent;
  if (auth.ok && auth.data === null) {
    // Definitely no auth session (e.g. an owner signed in here and out again): not a store phone, whatever the
    // cache says. The gate goes to the entry screen and the cached session/context are cleared.
    notInStore = { t: 'loaded', ctx: null, stored: null };
  } else {
    const r = await api.context();
    if (r.ok ? r.data !== null : r.error.code !== 'not_a_device') return fromContext(store, r);
    notInStore = fromContext(store, r);
  }

  const key = loadJoinKey(store);
  if (key === null || owner) return notInStore;
  const j = await joinStore(api, store, key, label);
  if (j.ok) return fromContext(store, await api.context());
  switch (j.error.code) {
    case 'invalid_code':
      // The link was replaced (joinStore has forgotten the key): the entry screen says to ask for the new one.
      return { t: 'load_failed', error: { code: 'invalid_code' }, cached: null, stored: null };
    case 'owner_signed_in':
      return { t: 'loaded', ctx: null, stored: null };
    default:
      // Network and anything else: the key is kept and the existing offline / error rules apply.
      return { t: 'load_failed', error: j.error, cached: loadCachedContext(store), stored: loadStaffSession(store) };
  }
}
