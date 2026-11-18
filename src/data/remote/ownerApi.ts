import type { ShopConfig } from '../../core/config';
import type { DayDetail, HistoryList, SaveClosingArgs } from '../../features/owner/history/types';
import type { CashMode, FieldAck, FieldKey, ServerField, Snapshot } from '../../features/register/live/fields';
import type { MemberRole, ShopRole } from '../../features/owner/model/roles';
import type { OwnerError } from './errors';
import type { LiveChannel, LiveHandlers } from './live';

export type Result<T> = { ok: true; data: T } | { ok: false; error: OwnerError };

export interface SessionInfo {
  email: string | null;
  /** The auth user id (session.user.id). */
  userId: string | null;
  /** true for a paired phone's session — an owner sign-in in this browser would unpair it. */
  anonymous: boolean;
}

export interface ShopRow {
  id: string;
  name: string;
  /** The caller's role in this shop. */
  role: ShopRole;
  /** How the shop calls the caller («Ιδιοκτήτης» for the owner, the member's display name otherwise); made by the server. */
  myName: string;
}

export interface MemberRow {
  id: string;
  email: string | null;
  displayName: string;
  role: MemberRole;
  status: 'pending' | 'expired' | 'active';
  expiresAt: string | null;
  acceptedAt: string | null;
}

export interface InviteInfo {
  shops: { id: string; name: string }[];
  role: MemberRole;
  displayName: string;
  email: string;
  expiresAt: string;
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
  /** false = no PIN set (staff.has_pin): the cashier cannot sign in until the owner sets one. */
  hasPin: boolean;
}

export interface DeviceRow {
  userId: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** The cashier of the device's most recent staff session, if any. */
  lastStaffName: string | null;
}

export interface DayChange {
  /** HH:MM — closings before this time count for the previous day. */
  time: string;
  /** YYYY-MM-DD (Athens) the current time starts to apply on, while that is still ahead; else null. */
  fromDate: string | null;
}

export interface ClosingPlan {
  /** Closings per business day, 1..6. */
  count: number;
  cashMode: CashMode;
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
  /** Invites a collaborator to one or more of the caller's shops; resolves to the invite token (32 characters). */
  inviteMember(shopIds: string[], email: string, name: string, role: MemberRole): Promise<Result<string>>;
  listMembers(shopId: string): Promise<Result<MemberRow[]>>;
  setMemberRole(memberId: string, role: MemberRole): Promise<Result<void>>;
  removeMember(memberId: string): Promise<Result<void>>;
  /** A new token for a pending or expired invite. */
  reissueInvite(memberId: string): Promise<Result<string>>;
  inviteInfo(token: string): Promise<Result<InviteInfo>>;
  /** Accepts the invite; resolves to the accepted shop ids. */
  acceptInvite(token: string): Promise<Result<string[]>>;
  createShop(name: string, config: ShopConfig): Promise<Result<string>>;
  renameShop(shopId: string, name: string): Promise<Result<void>>;
  latestConfig(shopId: string): Promise<Result<ConfigRow | null>>;
  publishConfig(shopId: string, expectedVersion: number, config: ShopConfig): Promise<Result<number>>;
  dayChange(shopId: string): Promise<Result<DayChange>>;
  /** Resolves to the first business date (YYYY-MM-DD) the new time applies to. */
  setDayChange(shopId: string, time: string): Promise<Result<string>>;
  closingPlan(shopId: string): Promise<Result<ClosingPlan>>;
  setClosingPlan(shopId: string, plan: ClosingPlan): Promise<Result<void>>;
  listStaff(shopId: string): Promise<Result<StaffRow[]>>;
  createStaff(shopId: string, name: string, pin: string): Promise<Result<string>>;
  setStaffPin(staffId: string, pin: string): Promise<Result<void>>;
  unlockStaff(staffId: string): Promise<Result<void>>;
  updateStaff(staffId: string, patch: { name?: string; active?: boolean }): Promise<Result<void>>;
  /** Erases a cashier for good: the row stays (closings keep it) under a placeholder name; never listed again. */
  eraseStaff(staffId: string): Promise<Result<void>>;
  /** Deletes the shop and everything in it. `confirmName` must be the shop's name (`confirm_mismatch` otherwise). */
  deleteShop(shopId: string, confirmName: string): Promise<Result<void>>;
  /** Deletes the account and all its shops, then signs out of this browser. */
  deleteAccount(): Promise<Result<void>>;
  /** The shop's permanent store key (16 characters, created on first use). */
  joinKey(shopId: string): Promise<Result<string>>;
  /** Replaces the store key; the old link stops working and every device leaves the shop. */
  rotateJoinKey(shopId: string): Promise<Result<string>>;
  listDevices(shopId: string): Promise<Result<DeviceRow[]>>;
  renameDevice(userId: string, label: string): Promise<Result<void>>;
  /** Deletes the device row; whoever is signed in on it is signed out. */
  removeDevice(userId: string): Promise<Result<void>>;
  /** Today's shared open closing for the shop. */
  todayClosing(shopId: string): Promise<Result<Snapshot>>;
  /**
   * Writes one field of the shop's closing for `businessDate` (the day on screen; another day than the
   * shop's current one is `wrong_day`). `stale` (baseVersion mismatch) is data, not an error: it carries
   * the field's current server state. The ack carries the value the server stored.
   */
  setTodayField(shopId: string, businessDate: string, closingNo: number, key: FieldKey, value: unknown, baseVersion: number | null): Promise<Result<FieldAck | { stale: ServerField }>>;
  /** Submitted and unsubmitted days in a range (null = the server's default: the last 30 days up to its today). */
  listClosings(shopId: string, from: string | null, to: string | null): Promise<Result<HistoryList>>;
  /** Every version of one day, with the configs and staff names needed to read them. */
  closingDay(shopId: string, businessDate: string): Promise<Result<DayDetail>>;
  /** Saves a correction as a new version; guarded on the version the owner saw (`closing_changed` otherwise). */
  saveClosing(shopId: string, args: SaveClosingArgs): Promise<Result<{ closingId: string; repeat: boolean }>>;
  /** Realtime channel for the shop (broadcasts + presence). */
  live(shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel;
}
