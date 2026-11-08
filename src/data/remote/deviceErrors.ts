import type { DeviceError } from './deviceApi';

const NETWORK_RE = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Server functions raise these as the error message (redeem_pairing_code). */
const RAISED = new Set(['invalid_code', 'not_a_device_session']);

/** Codes a `{ok:false,error}` payload may carry. */
const PLAIN = [
  'not_a_device',
  'device_revoked',
  'staff_not_found',
  'bad_pin',
  'session_invalid',
  'wrong_day',
  'config_mismatch',
  'bad_inputs',
  'idempotency_conflict',
] as const;
type Plain = (typeof PLAIN)[number];
const isPlain = (s: string): s is Plain => (PLAIN as readonly string[]).includes(s);

/** Never throws, whatever it is given. */
export function mapDeviceError(err: unknown): DeviceError {
  if (typeof err !== 'object' || err === null) return { code: 'unknown', detail: String(err) };
  const e = err as Record<string, unknown>;
  const message = str(e.message);
  const name = str(e.name);
  const code = str(e.code);

  if (name === 'AuthRetryableFetchError' || NETWORK_RE.test(message)) return { code: 'network' };
  if (RAISED.has(message)) return message === 'invalid_code' ? { code: 'invalid_code' } : { code: 'not_a_device' };
  // 42501 = insufficient privilege: device functions are granted to `authenticated` only, so a browser with
  // no auth session (calling as anon) lands here. Such a browser is not a paired device.
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303' || code === 'session_not_found' || code === 'refresh_token_not_found') {
    return { code: 'not_a_device' };
  }
  return { code: 'unknown', detail: message || code || name || 'error' };
}

/** For `{ok:false,error}` payloads. null when the payload is a success. Unknown codes become `unknown`. */
export function fromServerResult(json: unknown): DeviceError | null {
  if (typeof json !== 'object' || json === null) return { code: 'unknown', detail: 'bad_response' };
  const j = json as Record<string, unknown>;
  if (j.ok === true) return null;
  const error = str(j.error);
  if (j.ok !== false) return { code: 'unknown', detail: 'bad_response' };
  if (error === 'staff_locked') {
    return { code: 'staff_locked', lockedUntil: typeof j.locked_until === 'string' ? j.locked_until : null };
  }
  if (isPlain(error)) return { code: error };
  return { code: 'unknown', detail: error || 'error' };
}
