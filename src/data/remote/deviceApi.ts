import type { ClosingInputs } from '../../core/formula';
import type { PastExpense } from '../../core/suggestions';
import type { FieldAck, FieldKey, ServerField, Snapshot } from '../../features/register/live/fields';
import type { LiveChannel, LiveHandlers } from './live';

/** Every failure a phone action can report. A new one needs a case in deviceErrors.ts and a Greek message in features/phone/model/messages.ts. */
export type DeviceError =
  | { code: 'not_a_device' }
  | { code: 'device_revoked' }
  | { code: 'invalid_code' }
  /** join_shop: the phone is in another store; ask, then re-send with `switchShop`. */
  | { code: 'other_shop' }
  | { code: 'owner_signed_in' }
  | { code: 'staff_not_found' }
  | { code: 'bad_pin' }
  | { code: 'staff_locked'; lockedUntil: string | null }
  | { code: 'session_invalid' }
  | { code: 'wrong_day' }
  | { code: 'config_mismatch' }
  | { code: 'stale'; current: ServerField }
  | { code: 'bad_field' }
  | { code: 'too_many_expenses' }
  | { code: 'draft_changed'; revision: number }
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
  /**
   * Enters the store of `key` (join_shop). Signs in anonymously if needed; `force` signs an owner out first;
   * `switchShop` moves a phone that is in another store. Refuses on a failed session lookup.
   * Call it only through features/phone/model/join.ts (`joinStore`), which keeps the stored key right.
   */
  join(key: string, label: string, opts?: { force?: boolean; switchShop?: boolean }): Promise<DResult<void>>;
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
    revision: number,
    idempotencyKey: string,
  ): Promise<DResult<{ closingId: string; repeat: boolean }>>;
  suggestionData(): Promise<DResult<PastExpense[]>>;
  /** Today's shared open closing (fields, revision, pinned config). */
  getOpenClosing(token: string): Promise<DResult<Snapshot>>;
  /**
   * Writes one field. baseVersion null = last-write-wins; a mismatch is `stale` (carries the current field).
   * The ack carries the value the server stored (`FieldAck.value`).
   */
  setField(token: string, businessDate: string, key: FieldKey, value: unknown, baseVersion: number | null): Promise<DResult<FieldAck>>;
  /** Realtime channel for the shop (broadcasts + presence). */
  live(shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel;
}
