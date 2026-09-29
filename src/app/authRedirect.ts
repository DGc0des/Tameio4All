/**
 * Supabase PKCE email links (confirm sign-up, reset password) come back as `?auth=<kind>&code=…`.
 * The query string never collides with the hash router. `auth` is ours: set in authRedirectUrl.
 */
export type AuthRedirect = { kind: 'signup' | 'recovery'; code: string } | { kind: 'error'; description: string };

export function parseAuthRedirect(search: string): AuthRedirect | null {
  const p = new URLSearchParams(search);
  const kind = p.get('auth');
  if (kind !== 'signup' && kind !== 'recovery') return null;
  const error = p.get('error_description') ?? p.get('error');
  if (error) return { kind: 'error', description: error };
  const code = p.get('code');
  if (!code) return { kind: 'error', description: 'missing code' };
  return { kind, code };
}

/** `base` is origin + pathname of the app, e.g. `https://tameio.app/`. */
export function authRedirectUrl(base: string, kind: 'signup' | 'recovery'): string {
  return `${base}?auth=${kind}`;
}
