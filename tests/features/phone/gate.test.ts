import { describe, expect, it } from 'vitest';
import type { DeviceContext, StaffSession } from '../../../src/data/remote/deviceApi';
import { gateReducer, type Gate } from '../../../src/features/phone/model/gate';

const ctx: DeviceContext = { shopId: 'shop-1', shopName: 'Join Juice', configId: 'c1', config: {}, businessDate: '2026-11-07' };
const session: StaffSession = { token: 't', staffId: 's1', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: 'shop-1' };
const loading: Gate = { s: 'loading' };
const ready: Gate = { s: 'ready', ctx, session, offline: false };
const signedOut: Gate = { s: 'signed_out', ctx, offline: false };

describe('gateReducer — loading', () => {
  it('no client → unconfigured', () => {
    expect(gateReducer(loading, { t: 'no_client' })).toEqual({ s: 'unconfigured' });
  });

  it('loaded without a context → unpaired, no notice', () => {
    expect(gateReducer(loading, { t: 'loaded', ctx: null, stored: session })).toEqual({ s: 'unpaired', notice: null });
  });

  it('loaded with a matching stored session → ready', () => {
    expect(gateReducer(loading, { t: 'loaded', ctx, stored: session })).toEqual(ready);
  });

  it('loaded with no stored session → signed_out', () => {
    expect(gateReducer(loading, { t: 'loaded', ctx, stored: null })).toEqual(signedOut);
  });

  it('a stored session for another business date or shop is not used', () => {
    expect(gateReducer(loading, { t: 'loaded', ctx, stored: { ...session, businessDate: '2026-11-06' } })).toEqual(signedOut);
    expect(gateReducer(loading, { t: 'loaded', ctx, stored: { ...session, shopId: 'shop-2' } })).toEqual(signedOut);
  });

  it('network failure with a cache and a valid stored session → ready offline (Review Focus 5)', () => {
    expect(gateReducer(loading, { t: 'load_failed', error: { code: 'network' }, cached: ctx, stored: session })).toEqual({
      ...ready,
      offline: true,
    });
  });

  it('network failure with a cache but no valid session → signed_out offline', () => {
    expect(gateReducer(loading, { t: 'load_failed', error: { code: 'network' }, cached: ctx, stored: null })).toEqual({
      ...signedOut,
      offline: true,
    });
  });

  it('network failure without a cache → offline_no_cache (Review Focus 5)', () => {
    expect(gateReducer(loading, { t: 'load_failed', error: { code: 'network' }, cached: null, stored: session })).toEqual({
      s: 'offline_no_cache',
    });
  });

  it('revoked / not a device on load → unpaired with a notice', () => {
    const revoked = gateReducer(loading, { t: 'load_failed', error: { code: 'device_revoked' }, cached: ctx, stored: session });
    expect(revoked).toEqual({ s: 'unpaired', notice: 'Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.' });
    const notDevice = gateReducer(loading, { t: 'load_failed', error: { code: 'not_a_device' }, cached: ctx, stored: session });
    expect(notDevice.s).toBe('unpaired');
    expect(notDevice.s === 'unpaired' && notDevice.notice).toBeTruthy();
  });

  it('invalid_code on load (the stored link was replaced) → unpaired with the "ask for the new link" notice', () => {
    expect(gateReducer(loading, { t: 'load_failed', error: { code: 'invalid_code' }, cached: null, stored: null })).toEqual({
      s: 'unpaired',
      notice: 'Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.',
    });
  });

  it('a non-network load failure never opens the cached register: load_error', () => {
    const unknown = { code: 'unknown', detail: 'boom' } as const;
    expect(gateReducer(loading, { t: 'load_failed', error: unknown, cached: ctx, stored: session })).toEqual({ s: 'load_error', error: unknown });
    expect(gateReducer(loading, { t: 'load_failed', error: unknown, cached: null, stored: null })).toEqual({ s: 'load_error', error: unknown });
  });
});

describe('gateReducer — retry', () => {
  it('offline states and load_error → loading', () => {
    expect(gateReducer({ s: 'offline_no_cache' }, { t: 'retry' })).toEqual(loading);
    expect(gateReducer({ ...ready, offline: true }, { t: 'retry' })).toEqual(loading);
    expect(gateReducer({ ...signedOut, offline: true }, { t: 'retry' })).toEqual(loading);
    expect(gateReducer({ s: 'load_error', error: { code: 'unknown', detail: 'x' } }, { t: 'retry' })).toEqual(loading);
  });

  it('is ignored when online or in any other state', () => {
    const unpaired: Gate = { s: 'unpaired', notice: null };
    for (const g of [ready, signedOut, unpaired, loading, { s: 'unconfigured' } as Gate]) {
      expect(gateReducer(g, { t: 'retry' })).toBe(g);
    }
  });
});

describe('gateReducer — transitions', () => {
  it('paired → loading (context is fetched again)', () => {
    expect(gateReducer({ s: 'unpaired', notice: null }, { t: 'paired' })).toEqual(loading);
  });

  it('signed_in from an online signed_out with a matching session → ready', () => {
    expect(gateReducer(signedOut, { t: 'signed_in', session })).toEqual(ready);
  });

  it('signed_in while offline → loading (reload the context before opening the register)', () => {
    expect(gateReducer({ ...signedOut, offline: true }, { t: 'signed_in', session })).toEqual(loading);
  });

  it('signed_in with a session for another business date or shop → loading', () => {
    expect(gateReducer(signedOut, { t: 'signed_in', session: { ...session, businessDate: '2026-11-08' } })).toEqual(loading);
    expect(gateReducer(signedOut, { t: 'signed_in', session: { ...session, shopId: '' } })).toEqual(loading);
  });

  it('signed_in is ignored outside signed_out', () => {
    const unpaired: Gate = { s: 'unpaired', notice: null };
    expect(gateReducer(unpaired, { t: 'signed_in', session })).toBe(unpaired);
  });

  it('signed_out from ready → signed_out with the same context', () => {
    expect(gateReducer(ready, { t: 'signed_out' })).toEqual(signedOut);
  });

  it('server_error session_invalid / wrong_day → loading (fresh context, then sign in again)', () => {
    expect(gateReducer(ready, { t: 'server_error', error: { code: 'session_invalid' } })).toEqual(loading);
    expect(gateReducer(ready, { t: 'server_error', error: { code: 'wrong_day' } })).toEqual(loading);
    expect(gateReducer({ ...signedOut, offline: true }, { t: 'server_error', error: { code: 'wrong_day' } })).toEqual(loading);
  });

  it('after the reload, a matching stored session → ready, otherwise signed_out on the fresh context', () => {
    const today = { ...ctx, businessDate: '2026-11-08' };
    expect(gateReducer(loading, { t: 'loaded', ctx: today, stored: { ...session, businessDate: '2026-11-08' } }).s).toBe('ready');
    expect(gateReducer(loading, { t: 'loaded', ctx: today, stored: null })).toEqual({ s: 'signed_out', ctx: today, offline: false });
  });

  it('server_error device_revoked from ready → unpaired (Review Focus 4)', () => {
    expect(gateReducer(ready, { t: 'server_error', error: { code: 'device_revoked' } })).toEqual({
      s: 'unpaired',
      notice: 'Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.',
    });
    expect(gateReducer(signedOut, { t: 'server_error', error: { code: 'device_revoked' } }).s).toBe('unpaired');
  });

  const NOT_IN_STORE = 'Αυτή η συσκευή δεν είναι σε κατάστημα. Άνοιξε τον σύνδεσμο του καταστήματος.';

  it('server_error not_a_device → loading that remembers why (the load path may return silently with the stored key)', () => {
    expect(gateReducer(ready, { t: 'server_error', error: { code: 'not_a_device' } })).toEqual({ s: 'loading', notice: NOT_IN_STORE });
    expect(gateReducer(signedOut, { t: 'server_error', error: { code: 'not_a_device' } })).toEqual({ s: 'loading', notice: NOT_IN_STORE });
  });

  it('a reload caused by not_a_device that finds no store explains it on the entry screen', () => {
    const reloading = gateReducer(ready, { t: 'server_error', error: { code: 'not_a_device' } });
    expect(gateReducer(reloading, { t: 'loaded', ctx: null, stored: null })).toEqual({ s: 'unpaired', notice: NOT_IN_STORE });
    // A silent return that worked shows no notice.
    expect(gateReducer(reloading, { t: 'loaded', ctx, stored: null })).toEqual({ s: 'signed_out', ctx, offline: false });
    // A plain first load with no store has nothing to explain.
    expect(gateReducer(loading, { t: 'loaded', ctx: null, stored: null })).toEqual({ s: 'unpaired', notice: null });
  });

  it('other server errors leave the gate as it is', () => {
    expect(gateReducer(ready, { t: 'server_error', error: { code: 'network' } })).toBe(ready);
    expect(gateReducer(ready, { t: 'server_error', error: { code: 'bad_inputs' } })).toBe(ready);
  });
});
