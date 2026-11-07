import type { DeviceContext, DeviceError, StaffSession } from '../../../data/remote/deviceApi';
import { deviceErrorMessage } from './messages';

/** What the phone shows. Derived only by gateReducer; PhoneApp renders it and never decides on its own. */
export type Gate =
  | { s: 'loading' }
  | { s: 'unconfigured' }
  | { s: 'offline_no_cache' }
  | { s: 'unpaired'; notice: string | null }
  | { s: 'signed_out'; ctx: DeviceContext; offline: boolean }
  | { s: 'ready'; ctx: DeviceContext; session: StaffSession; offline: boolean };

export type GateEvent =
  | { t: 'no_client' }
  | { t: 'loaded'; ctx: DeviceContext | null; stored: StaffSession | null }
  | { t: 'load_failed'; error: DeviceError; cached: DeviceContext | null; stored: StaffSession | null }
  | { t: 'paired' }
  | { t: 'signed_in'; session: StaffSession }
  | { t: 'signed_out' }
  | { t: 'server_error'; error: DeviceError };

/** A stored session counts only for the same shop and the same business date. */
function fromContext(ctx: DeviceContext, stored: StaffSession | null, offline: boolean): Gate {
  const valid = stored !== null && stored.shopId === ctx.shopId && stored.businessDate === ctx.businessDate;
  return valid ? { s: 'ready', ctx, session: stored, offline } : { s: 'signed_out', ctx, offline };
}

const unpairedBy = (error: DeviceError): Gate => ({ s: 'unpaired', notice: deviceErrorMessage(error) });

export function gateReducer(g: Gate, e: GateEvent): Gate {
  switch (e.t) {
    case 'no_client':
      return { s: 'unconfigured' };
    case 'loaded':
      return e.ctx === null ? { s: 'unpaired', notice: null } : fromContext(e.ctx, e.stored, false);
    case 'load_failed':
      if (e.error.code === 'device_revoked' || e.error.code === 'not_a_device') return unpairedBy(e.error);
      // Any other failure (network, or a server hiccup) falls back to the cache like a dropped connection.
      return e.cached === null ? { s: 'offline_no_cache' } : fromContext(e.cached, e.stored, true);
    case 'paired':
      return { s: 'loading' };
    case 'signed_in':
      return g.s === 'signed_out' ? { s: 'ready', ctx: g.ctx, session: e.session, offline: g.offline } : g;
    case 'signed_out':
      return g.s === 'ready' ? { s: 'signed_out', ctx: g.ctx, offline: g.offline } : g;
    case 'server_error':
      switch (e.error.code) {
        case 'device_revoked':
        case 'not_a_device':
          return unpairedBy(e.error);
        case 'session_invalid':
        case 'wrong_day':
          return g.s === 'ready' ? { s: 'signed_out', ctx: g.ctx, offline: g.offline } : g;
        default:
          return g;
      }
  }
}
