import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceError } from '../../src/data/remote/deviceApi';
import { fromServerResult, mapDeviceError } from '../../src/data/remote/deviceErrors';
import { deviceErrorMessage } from '../../src/features/phone/model/messages';

describe('mapDeviceError', () => {
  it('maps fetch failures to network', () => {
    expect(mapDeviceError(new TypeError('Failed to fetch'))).toEqual({ code: 'network' });
    expect(mapDeviceError(new Error('request_timeout'))).toEqual({ code: 'network' });
    expect(mapDeviceError({ message: 'Error: request_timeout', code: '' })).toEqual({ code: 'network' });
    expect(mapDeviceError({ name: 'AuthRetryableFetchError', message: 'x' })).toEqual({ code: 'network' });
  });
  it('maps raised postgres messages', () => {
    expect(mapDeviceError({ message: 'invalid_code', code: '22023' })).toEqual({ code: 'invalid_code' });
    expect(mapDeviceError({ message: 'not_a_device_session', code: '42501' })).toEqual({ code: 'not_a_device' });
    expect(mapDeviceError({ message: 'other_shop', code: '22023' })).toEqual({ code: 'other_shop' });
  });
  it('maps a permission refusal (no auth session, or anon) and lost auth sessions to not_a_device', () => {
    expect(mapDeviceError({ message: 'permission denied for function device_context', code: '42501' })).toEqual({ code: 'not_a_device' });
    expect(mapDeviceError({ message: 'JWT expired', code: 'PGRST301' })).toEqual({ code: 'not_a_device' });
    expect(mapDeviceError({ message: 'x', code: 'PGRST303' })).toEqual({ code: 'not_a_device' });
    expect(mapDeviceError({ message: 'x', code: 'session_not_found' })).toEqual({ code: 'not_a_device' });
    expect(mapDeviceError({ message: 'x', code: 'refresh_token_not_found' })).toEqual({ code: 'not_a_device' });
  });
  it('never throws on garbage', () => {
    expect(mapDeviceError(null).code).toBe('unknown');
    expect(mapDeviceError(undefined).code).toBe('unknown');
    expect(mapDeviceError({ message: 'boom' })).toEqual({ code: 'unknown', detail: 'boom' });
  });
});

describe('fromServerResult', () => {
  it('maps staff_locked with its deadline', () => {
    expect(fromServerResult({ ok: false, error: 'staff_locked', locked_until: '2026-11-07T10:00:00Z' })).toEqual({
      code: 'staff_locked',
      lockedUntil: '2026-11-07T10:00:00Z',
    });
    expect(fromServerResult({ ok: false, error: 'staff_locked' })).toEqual({ code: 'staff_locked', lockedUntil: null });
  });
  it('maps device_locked with its deadline', () => {
    expect(fromServerResult({ ok: false, error: 'device_locked', locked_until: '2026-11-14T10:00:00Z' })).toEqual({
      code: 'device_locked',
      lockedUntil: '2026-11-14T10:00:00Z',
    });
    expect(fromServerResult({ ok: false, error: 'device_locked' })).toEqual({ code: 'device_locked', lockedUntil: null });
    expect(fromServerResult({ ok: false, error: 'device_locked', locked_until: 5 })).toEqual({ code: 'device_locked', lockedUntil: null });
  });
  it('returns null on success', () => {
    expect(fromServerResult({ ok: true })).toBeNull();
  });
  it('maps known codes and sends unknown/garbage to unknown', () => {
    expect(fromServerResult({ ok: false, error: 'bad_pin' })).toEqual({ code: 'bad_pin' });
    expect(fromServerResult({ ok: false, error: 'pin_not_set' })).toEqual({ code: 'pin_not_set' });
    expect(fromServerResult({ ok: false, error: 'nope' })).toEqual({ code: 'unknown', detail: 'nope' });
    expect(fromServerResult('x')?.code).toBe('unknown');
    expect(fromServerResult(null)?.code).toBe('unknown');
    expect(fromServerResult({})?.code).toBe('unknown');
  });
});

describe('deviceErrorMessage', () => {
  const all: DeviceError[] = [
    { code: 'not_a_device' }, { code: 'device_revoked' }, { code: 'invalid_code' }, { code: 'owner_signed_in' },
    { code: 'staff_not_found' }, { code: 'bad_pin' }, { code: 'staff_locked', lockedUntil: null }, { code: 'session_invalid' },
    { code: 'wrong_day' }, { code: 'config_mismatch' }, { code: 'bad_inputs' }, { code: 'idempotency_conflict' },
    { code: 'network' }, { code: 'unknown', detail: 'x' },
    { code: 'stale', current: { key: 'c:a', value: null, version: 0, updatedByName: '', updatedAt: '' } }, { code: 'bad_field' },
    { code: 'too_many_expenses' }, { code: 'draft_changed', revision: 3 }, { code: 'other_shop' },
    { code: 'device_locked', lockedUntil: null }, { code: 'pin_not_set' },
  ];
  it('has a non-empty message for every code', () => {
    for (const e of all) expect(deviceErrorMessage(e).length).toBeGreaterThan(0);
  });
  it('uses the agreed wording', () => {
    expect(deviceErrorMessage({ code: 'bad_pin' })).toBe('Λάθος PIN.');
    expect(deviceErrorMessage({ code: 'pin_not_set' })).toBe('Δεν έχει οριστεί PIN. Ζήτα από τον ιδιοκτήτη να ορίσει νέο PIN 6 ψηφίων.');
    expect(deviceErrorMessage({ code: 'network' })).toBe('Δεν υπάρχει σύνδεση.');
    expect(deviceErrorMessage({ code: 'invalid_code' })).toBe('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.');
    expect(deviceErrorMessage({ code: 'not_a_device' })).toBe('Αυτή η συσκευή δεν είναι σε κατάστημα. Άνοιξε τον σύνδεσμο του καταστήματος.');
    expect(deviceErrorMessage({ code: 'other_shop' })).toBe('Η συσκευή είναι ήδη σε άλλο κατάστημα.');
  });
  const DEV = 'Πολλές λάθος προσπάθειες σε αυτή τη συσκευή. Δοκίμασε ξανά ';
  const HINT = ', ή ζήτα από τον ιδιοκτήτη «Αφαίρεση» της συσκευής στις «Συσκευές».';
  const STAFF = 'Κλείδωσε μετά από 5 λάθος PIN. Δοκίμασε ξανά ';
  // A fixed "now" through fake timers (the default `now` argument is `new Date()`).
  const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
  afterEach(() => { vi.useRealTimers(); });

  it('says until when a lock lasts, in shop time (Europe/Athens), and how the owner frees the phone', () => {
    at('2026-11-14T09:45:00Z'); // 11:45 in Athens (UTC+2 in November)
    // 10:00Z in November = 12:00 in Athens, the same day.
    expect(deviceErrorMessage({ code: 'device_locked', lockedUntil: '2026-11-14T10:00:00Z' })).toBe(`${DEV}στις 12:00${HINT}`);
    expect(deviceErrorMessage({ code: 'device_locked', lockedUntil: null })).toBe(`${DEV}αργότερα${HINT}`);
    expect(deviceErrorMessage({ code: 'device_locked', lockedUntil: 'garbage' })).toBe(`${DEV}αργότερα${HINT}`);
    // The lock time escalates, so the cashier message no longer promises 15 minutes.
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-14T10:00:00Z' })).toBe(`${STAFF}στις 12:00.`);
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: null })).toBe(`${STAFF}αργότερα.`);
  });

  it('a 24 h lock ends tomorrow at the same clock time: «αύριο στις»', () => {
    at('2026-11-14T07:14:00Z'); // 09:14 Athens
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-15T07:14:00Z' })).toBe(`${STAFF}αύριο στις 09:14.`);
    expect(deviceErrorMessage({ code: 'device_locked', lockedUntil: '2026-11-15T07:14:00Z' })).toBe(`${DEV}αύριο στις 09:14${HINT}`);
  });

  it('the day is decided at Athens midnight, not UTC midnight', () => {
    // now 23:50 Athens (21:50Z); 00:10 Athens next day is still 22:10Z the same UTC day → «αύριο».
    at('2026-11-14T21:50:00Z');
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-14T22:10:00Z' })).toBe(`${STAFF}αύριο στις 00:10.`);
    // 23:55 Athens the same evening → today.
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-14T21:55:00Z' })).toBe(`${STAFF}στις 23:55.`);
    // now 00:20 Athens (22:20Z the previous UTC day); 01:00 Athens → today, though the UTC date differs.
    at('2026-11-14T22:20:00Z');
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-14T23:00:00Z' })).toBe(`${STAFF}στις 01:00.`);
  });

  it('more than one day later shows the date (never happens with a 24 h maximum, but stays unambiguous)', () => {
    at('2026-11-14T07:00:00Z');
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-16T08:30:00Z' })).toBe(`${STAFF}στις 16/11 10:30.`);
  });

  it('an explicit now argument works without fake timers', () => {
    expect(deviceErrorMessage({ code: 'staff_locked', lockedUntil: '2026-11-15T07:14:00Z' }, new Date('2026-11-14T07:14:00Z'))).toBe(
      `${STAFF}αύριο στις 09:14.`,
    );
  });
});
