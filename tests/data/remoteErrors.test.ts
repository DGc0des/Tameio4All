import { describe, expect, it } from 'vitest';
import { mapError } from '../../src/data/remote/errors';

describe('mapError', () => {
  it('maps server function errors by message', () => {
    expect(mapError({ message: 'not_owner', code: '42501' })).toEqual({ code: 'not_owner' });
    expect(mapError({ message: 'staff_name_taken', code: '23505' })).toEqual({ code: 'staff_name_taken' });
    expect(mapError({ message: 'bad_pin_format', code: '22023' })).toEqual({ code: 'bad_pin_format' });
    expect(mapError({ message: 'bad_config', code: '22023' })).toEqual({ code: 'bad_config' });
    expect(mapError({ message: 'version_conflict', code: 'P0001', details: 'current version is 7' }))
      .toEqual({ code: 'version_conflict', currentVersion: 7 });
    expect(mapError({ message: 'version_conflict', code: 'P0001', details: null }))
      .toEqual({ code: 'version_conflict', currentVersion: null });
  });

  it('maps direct-update constraint errors', () => {
    expect(mapError({ message: 'duplicate key value violates unique constraint "staff_shop_name_uidx"', code: '23505' }))
      .toEqual({ code: 'staff_name_taken' });
    expect(mapError({ message: 'new row violates check constraint "staff_name_check"', code: '23514' }))
      .toEqual({ code: 'bad_name' });
  });

  it('maps auth errors by code', () => {
    expect(mapError({ name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials' })).toEqual({ code: 'invalid_credentials' });
    expect(mapError({ name: 'AuthApiError', code: 'email_not_confirmed', message: '' })).toEqual({ code: 'email_not_confirmed' });
    expect(mapError({ name: 'AuthApiError', code: 'user_already_exists', message: '' })).toEqual({ code: 'email_taken' });
    expect(mapError({ name: 'AuthWeakPasswordError', code: 'weak_password', message: '' })).toEqual({ code: 'weak_password' });
    expect(mapError({ name: 'AuthApiError', code: 'over_email_send_rate_limit', message: '' })).toEqual({ code: 'rate_limited' });
    expect(mapError({ code: 'PGRST303', message: 'JWT expired' })).toEqual({ code: 'session_expired' });
  });

  it('recognises network failures', () => {
    expect(mapError(new TypeError('Failed to fetch'))).toEqual({ code: 'network' });
    expect(mapError({ message: 'TypeError: Load failed', code: '' })).toEqual({ code: 'network' });
    expect(mapError({ name: 'AuthRetryableFetchError', message: '' })).toEqual({ code: 'network' });
  });

  it('never throws on foreign input', () => {
    expect(mapError(undefined)).toEqual({ code: 'unknown', detail: 'undefined' });
    expect(mapError('boom')).toEqual({ code: 'unknown', detail: 'boom' });
    expect(mapError({ message: 'something else' })).toEqual({ code: 'unknown', detail: 'something else' });
  });
});
