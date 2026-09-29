/**
 * Every failure an owner action can report. Server functions raise these codes as the error
 * message (Plan 3 migrations); Auth errors carry a `code`. A new server error needs a case here
 * and a Greek message in features/owner/model/messages.ts.
 */
export type OwnerError =
  | { code: 'not_owner' }
  | { code: 'version_conflict'; currentVersion: number | null }
  | { code: 'staff_name_taken' }
  | { code: 'bad_pin_format' }
  | { code: 'bad_config' }
  | { code: 'bad_name' }
  | { code: 'invalid_credentials' }
  | { code: 'email_not_confirmed' }
  | { code: 'email_taken' }
  | { code: 'weak_password' }
  | { code: 'rate_limited' }
  | { code: 'link_invalid' }
  | { code: 'session_expired' }
  | { code: 'network' }
  | { code: 'unknown'; detail: string };

const NETWORK_RE = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Never throws, whatever it is given. */
export function mapError(err: unknown): OwnerError {
  if (typeof err !== 'object' || err === null) return { code: 'unknown', detail: String(err) };
  const e = err as Record<string, unknown>;
  const message = str(e.message);
  const code = str(e.code);
  const name = str(e.name);

  if (name === 'AuthRetryableFetchError' || NETWORK_RE.test(message)) return { code: 'network' };
  if (message === 'version_conflict') {
    const m = /current version is (\d+)/.exec(str(e.details));
    return { code: 'version_conflict', currentVersion: m?.[1] !== undefined ? Number(m[1]) : null };
  }
  if (message === 'not_owner' || message === 'staff_name_taken' || message === 'bad_pin_format' || message === 'bad_config') {
    return { code: message };
  }
  switch (code) {
    case '23505': // unique name index on a direct staff rename
      return { code: 'staff_name_taken' };
    case '23514': // length CHECK on a direct rename
      return { code: 'bad_name' };
    case 'PGRST301':
    case 'PGRST303':
    case 'session_not_found':
    case 'refresh_token_not_found':
      return { code: 'session_expired' };
    case 'invalid_credentials':
      return { code: 'invalid_credentials' };
    case 'email_not_confirmed':
      return { code: 'email_not_confirmed' };
    case 'user_already_exists':
    case 'email_exists':
      return { code: 'email_taken' };
    case 'weak_password':
      return { code: 'weak_password' };
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return { code: 'rate_limited' };
  }
  return { code: 'unknown', detail: message || code || name || 'error' };
}
