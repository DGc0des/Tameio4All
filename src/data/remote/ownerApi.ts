import type { ShopConfig } from '../../core/config';
import type { DayDetail, HistoryList, SaveClosingArgs } from '../../features/owner/history/types';
import type { FieldAck, FieldKey, ServerField, Snapshot } from '../../features/register/live/fields';
import type { OwnerError } from './errors';
import type { LiveChannel, LiveHandlers } from './live';

export type Result<T> = { ok: true; data: T } | { ok: false; error: OwnerError };

export interface SessionInfo {
  email: string | null;
  /** true for a paired phone's session — an owner sign-in in this browser would unpair it. */
  anonymous: boolean;
}

export interface ShopRow {
  id: string;
  name: string;
}

export interface ConfigRow {
  id: string;
  version: number;
  /** Untrusted jsonb — check with isShopConfig / isEditableConfig before use. */
  config: unknown;
}

export interface StaffRow {
  id: string;
  name: string;
  active: boolean;
  lockedUntil: string | null;
}

export interface DeviceRow {
  userId: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface DayChange {
  /** HH:MM — closings before this time count for the previous day. */
  time: string;
  /** YYYY-MM-DD (Athens) the current time starts to apply on, while that is still ahead; else null. */
  fromDate: string | null;
}

/** Everything the owner app does with the server. Screens receive this; tests pass a fake. */
export interface OwnerApi {
  session(): Promise<SessionInfo | null>;
  onAuthChange(cb: (session: SessionInfo | null) => void): () => void;
  signIn(email: string, password: string): Promise<Result<void>>;
  signUp(email: string, password: string, redirectTo: string): Promise<Result<void>>;
  sendReset(email: string, redirectTo: string): Promise<Result<void>>;
  exchangeCode(code: string): Promise<Result<void>>;
  updatePassword(password: string): Promise<Result<void>>;
  signOut(): Promise<void>;
  listShops(): Promise<Result<ShopRow[]>>;
  createShop(name: string, config: ShopConfig): Promise<Result<string>>;
  renameShop(shopId: string, name: string): Promise<Result<void>>;
  latestConfig(shopId: string): Promise<Result<ConfigRow | null>>;
  publishConfig(shopId: string, expectedVersion: number, config: ShopConfig): Promise<Result<number>>;
  dayChange(shopId: string): Promise<Result<DayChange>>;
  /** Resolves to the first business date (YYYY-MM-DD) the new time applies to. */
  setDayChange(shopId: string, time: string): Promise<Result<string>>;
  listStaff(shopId: string): Promise<Result<StaffRow[]>>;
  createStaff(shopId: string, name: string, pin: string): Promise<Result<string>>;
  setStaffPin(staffId: string, pin: string): Promise<Result<void>>;
  unlockStaff(staffId: string): Promise<Result<void>>;
  updateStaff(staffId: string, patch: { name?: string; active?: boolean }): Promise<Result<void>>;
  createPairingCode(shopId: string): Promise<Result<string>>;
  listDevices(shopId: string): Promise<Result<DeviceRow[]>>;
  updateDevice(userId: string, patch: { label?: string; revoke?: true }): Promise<Result<void>>;
  /** Today's shared open closing for the shop. */
  todayClosing(shopId: string): Promise<Result<Snapshot>>;
  /**
   * Writes one field of the shop's closing for `businessDate` (the day on screen; another day than the
   * shop's current one is `wrong_day`). `stale` (baseVersion mismatch) is data, not an error: it carries
   * the field's current server state. The ack carries the value the server stored.
   */
  setTodayField(shopId: string, businessDate: string, key: FieldKey, value: unknown, baseVersion: number | null): Promise<Result<FieldAck | { stale: ServerField }>>;
  /** Submitted and unsubmitted days in a range (null = the server's default: the last 30 days up to its today). */
  listClosings(shopId: string, from: string | null, to: string | null): Promise<Result<HistoryList>>;
  /** Every version of one day, with the configs and staff names needed to read them. */
  closingDay(shopId: string, businessDate: string): Promise<Result<DayDetail>>;
  /** Saves a correction as a new version; guarded on the version the owner saw (`closing_changed` otherwise). */
  saveClosing(shopId: string, args: SaveClosingArgs): Promise<Result<{ closingId: string; repeat: boolean }>>;
  /** Realtime channel for the shop (broadcasts + presence). */
  live(shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel;
}
