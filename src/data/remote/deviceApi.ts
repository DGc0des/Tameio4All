import type { ClosingInputs } from '../../core/formula';
import type { PastExpense } from '../../core/suggestions';

/** Every failure a phone action can report. A new one needs a case in deviceErrors.ts and a Greek message in features/phone/model/messages.ts. */
export type DeviceError =
  | { code: 'not_a_device' }
  | { code: 'device_revoked' }
  | { code: 'invalid_code' }
  | { code: 'owner_signed_in' }
  | { code: 'staff_not_found' }
  | { code: 'bad_pin' }
  | { code: 'staff_locked'; lockedUntil: string | null }
  | { code: 'session_invalid' }
  | { code: 'wrong_day' }
  | { code: 'config_mismatch' }
  | { code: 'bad_inputs' }
  | { code: 'idempotency_conflict' }
  | { code: 'network' }
  | { code: 'unknown'; detail: string };

export type DResult<T> = { ok: true; data: T } | { ok: false; error: DeviceError };

export interface DeviceContext {
  shopId: string;
  shopName: string;
  configId: string;
  config: unknown;
  businessDate: string;
}

export interface StaffSession {
  token: string;
  staffId: string;
  name: string;
  businessDate: string;
  shopId: string;
}

/** The one path for phone reads and writes. Never throws. */
export interface DeviceApi {
  /**
   * null data = definitely no auth session; anonymous=false means an owner is signed in in this browser.
   * A failure means "couldn't tell" (e.g. offline with an expired access token) — never treat it as no session.
   */
  session(): Promise<DResult<{ anonymous: boolean } | null>>;
  /** Signs in anonymously if needed, then redeems. `force` signs an owner out first. */
  pair(code: string, label: string, opts?: { force?: boolean }): Promise<DResult<void>>;
  /** null data = signed in but not paired. */
  context(): Promise<DResult<DeviceContext | null>>;
  listStaff(): Promise<DResult<{ id: string; name: string }[]>>;
  signIn(staffId: string, pin: string): Promise<DResult<StaffSession>>;
  signOut(token: string): Promise<void>;
  submit(
    token: string,
    configId: string,
    businessDate: string,
    inputs: ClosingInputs,
    idempotencyKey: string,
  ): Promise<DResult<{ closingId: string; repeat: boolean }>>;
  suggestionData(): Promise<DResult<PastExpense[]>>;
}
