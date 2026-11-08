import type { DeviceContext, DeviceError, StaffSession } from '../../../data/remote/deviceApi';
import { deviceErrorMessage } from './messages';

/** What the phone shows. Derived only by gateReducer; PhoneApp renders it and never decides on its own. */
export type Gate =
  | { s: 'loading' }
  | { s: 'unconfigured' }
  | { s: 'offline_no_cache' }
  /** The context load failed for a reason other than the network: no cached register, only a retry. */
  | { s: 'load_error'; error: DeviceError }
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
  | { t: 'server_error'; error: DeviceError }
  /** Re-check the server: the browser came back online or visible, or the person tapped «Δοκίμασε ξανά». */
  | { t: 'retry' };

/** A session counts only for the same shop and the same business date as the context. */
const matches = (ctx: DeviceContext, session: StaffSession): boolean =>
  session.shopId === ctx.shopId && session.businessDate === ctx.businessDate;

function fromContext(ctx: DeviceContext, stored: StaffSession | null, offline: boolean): Gate {
  return stored !== null && matches(ctx, stored) ? { s: 'ready', ctx, session: stored, offline } : { s: 'signed_out', ctx, offline };
}

/** `loading` means "fetch the context again": PhoneApp re-runs its one load path whenever the gate enters it. */
const RELOAD: Gate = { s: 'loading' };

const unpairedBy = (error: DeviceError): Gate => ({ s: 'unpaired', notice: deviceErrorMessage(error) });

export function gateReducer(g: Gate, e: GateEvent): Gate {
  switch (e.t) {
    case 'no_client':
      return { s: 'unconfigured' };
    case 'loaded':
      return e.ctx === null ? { s: 'unpaired', notice: null } : fromContext(e.ctx, e.stored, false);
    case 'load_failed':
      if (e.error.code === 'device_revoked' || e.error.code === 'not_a_device') return unpairedBy(e.error);
      // Only a dropped connection falls back to the cache; any other failure must not show a stale register.
      if (e.error.code !== 'network') return { s: 'load_error', error: e.error };
      return e.cached === null ? { s: 'offline_no_cache' } : fromContext(e.cached, e.stored, true);
    case 'paired':
      return RELOAD;
    case 'signed_in':
      if (g.s !== 'signed_out') return g;
      // A cached (offline) or mismatched context may be another day's: reload before opening the register.
      return g.offline || !matches(g.ctx, e.session) ? RELOAD : { s: 'ready', ctx: g.ctx, session: e.session, offline: false };
    case 'signed_out':
      return g.s === 'ready' ? { s: 'signed_out', ctx: g.ctx, offline: g.offline } : g;
    case 'retry':
      if (g.s === 'offline_no_cache' || g.s === 'load_error') return RELOAD;
      return (g.s === 'ready' || g.s === 'signed_out') && g.offline ? RELOAD : g;
    case 'server_error':
      switch (e.error.code) {
        case 'device_revoked':
        case 'not_a_device':
          return unpairedBy(e.error);
        case 'session_invalid':
        case 'wrong_day':
          // The day may have changed: the context is stale too.
          return g.s === 'ready' || g.s === 'signed_out' ? RELOAD : g;
        default:
          return g;
      }
  }
}
