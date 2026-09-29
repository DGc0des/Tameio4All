import { describe, expect, it } from 'vitest';
import { authRedirectUrl, parseAuthRedirect } from '../../src/app/authRedirect';

describe('auth redirect', () => {
  it('reads signup and recovery codes', () => {
    expect(parseAuthRedirect('?auth=signup&code=abc')).toEqual({ kind: 'signup', code: 'abc' });
    expect(parseAuthRedirect('?code=xyz&auth=recovery')).toEqual({ kind: 'recovery', code: 'xyz' });
  });

  it('reports errors and missing codes', () => {
    expect(parseAuthRedirect('?auth=recovery&error=access_denied&error_description=Email+link+is+invalid+or+has+expired'))
      .toEqual({ kind: 'error', description: 'Email link is invalid or has expired' });
    expect(parseAuthRedirect('?auth=signup')).toEqual({ kind: 'error', description: 'missing code' });
  });

  it('ignores unrelated query strings', () => {
    expect(parseAuthRedirect('')).toBeNull();
    expect(parseAuthRedirect('?code=abc')).toBeNull();
    expect(parseAuthRedirect('?auth=other&code=abc')).toBeNull();
  });

  it('builds the email redirect URL', () => {
    expect(authRedirectUrl('https://tameio.app/', 'recovery')).toBe('https://tameio.app/?auth=recovery');
  });
});
