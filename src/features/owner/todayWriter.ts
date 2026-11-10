import type { DResult, DeviceError } from '../../data/remote/deviceApi';
import type { OwnerError } from '../../data/remote/errors';
import type { OwnerApi, Result } from '../../data/remote/ownerApi';
import type { Writer } from '../register/live/syncEngine';
import { ownerErrorMessage } from './model/messages';

export const OWNER_PRESENCE_NAME = 'Ιδιοκτήτης';

/**
 * An owner error the engine handles keeps its code; every other one is fatal (`unknown`), and its
 * `detail` is already the Greek owner message (DeviceError cannot carry an OwnerError).
 */
function toDeviceError(e: OwnerError): DeviceError {
  if (e.code === 'network' || e.code === 'bad_field' || e.code === 'too_many_expenses') return { code: e.code };
  return { code: 'unknown', detail: ownerErrorMessage(e) };
}

const mapFail = <T,>(r: Extract<Result<unknown>, { ok: false }>): DResult<T> => ({ ok: false, error: toDeviceError(r.error) });

/** The owner's side of the shared closing (the shop's business date is decided server-side). */
export function createTodayWriter(api: OwnerApi, shopId: string): Writer {
  return {
    load: async () => {
      const r = await api.todayClosing(shopId);
      return r.ok ? r : mapFail(r);
    },
    write: async (e) => {
      const r = await api.setTodayField(shopId, e.key, e.value, e.baseVersion);
      if (!r.ok) return mapFail(r);
      if ('stale' in r.data) return { ok: false, error: { code: 'stale', current: r.data.stale } };
      return { ok: true, data: r.data };
    },
    live: (h) => api.live(shopId, { name: OWNER_PRESENCE_NAME }, h),
  };
}
