import { describe, expect, it } from 'vitest';
import type { DeviceError } from '../../src/data/remote/deviceApi';
import { fromServerResult, mapDeviceError } from '../../src/data/remote/deviceErrors';
import { deviceErrorMessage } from '../../src/features/phone/model/messages';

describe('mapDeviceError', () => {
  it('maps fetch failures to network', () => {
    expect(mapDeviceError(new TypeError('Failed to fetch'))).toEqual({ code: 'network' });
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
  it('returns null on success', () => {
    expect(fromServerResult({ ok: true })).toBeNull();
  });
  it('maps known codes and sends unknown/garbage to unknown', () => {
    expect(fromServerResult({ ok: false, error: 'bad_pin' })).toEqual({ code: 'bad_pin' });
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
  ];
  it('has a non-empty message for every code', () => {
    for (const e of all) expect(deviceErrorMessage(e).length).toBeGreaterThan(0);
  });
  it('uses the agreed wording', () => {
    expect(deviceErrorMessage({ code: 'bad_pin' })).toBe('Λάθος PIN.');
    expect(deviceErrorMessage({ code: 'network' })).toBe('Δεν υπάρχει σύνδεση.');
    expect(deviceErrorMessage({ code: 'invalid_code' })).toBe('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.');
    expect(deviceErrorMessage({ code: 'not_a_device' })).toBe('Αυτή η συσκευή δεν είναι σε κατάστημα. Άνοιξε τον σύνδεσμο του καταστήματος.');
    expect(deviceErrorMessage({ code: 'other_shop' })).toBe('Η συσκευή είναι ήδη σε άλλο κατάστημα.');
  });
});
