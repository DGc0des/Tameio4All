import type { ClosingInputs } from '../../../core/formula';
import type { CashMode, Snapshot } from '../../register/live/fields';

export type VersionKind = 'staff' | 'owner_correction';

/** One stored version of a day's closing. `inputs` is untrusted jsonb — check with validateClosingInputs. */
export interface ClosingVersion {
  id: string;
  kind: VersionKind;
  authorName: string;
  createdAt: string;
  configId: string;
  inputs: unknown;
  correctsId: string | null;
}

export type HistoryClosing =
  | { closingNo: number; status: 'submitted'; current: ClosingVersion; versionCount: number }
  | { closingNo: number; status: 'unsubmitted'; open: Snapshot };

/** One business day of the list: its numbered closings, by closingNo ascending, never empty. */
export interface HistoryDay {
  businessDate: string;
  cashMode: CashMode;
  closingsPlanned: number;
  closings: HistoryClosing[];
}

export interface HistoryList {
  today: string;
  from: string;
  to: string;
  /** Untrusted jsonb by config id — check with isShopConfig. */
  configs: Record<string, unknown>;
  days: HistoryDay[];
}

/** One numbered closing of a day: its versions, or (none submitted) the open closing of a past day. */
export interface DayClosing {
  closingNo: number;
  /** Newest first; [0] is the current version. */
  versions: ClosingVersion[];
  open: Snapshot | null;
}

export interface DayDetail {
  today: string;
  businessDate: string;
  cashMode: CashMode;
  closingsPlanned: number;
  /** The live closing's number when this day is the shop's today; else null. */
  liveClosingNo: number | null;
  /** By closingNo ascending; may be empty. */
  closings: DayClosing[];
  /** Untrusted jsonb by config id — check with isShopConfig. */
  configs: Record<string, unknown>;
  staffNames: Record<string, string>;
}

export interface SaveClosingArgs {
  businessDate: string;
  configId: string;
  inputs: ClosingInputs;
  /** The version the owner saw as current (null: the day has none); a different current → `closing_changed`. */
  expectedCurrentId: string | null;
  key: string;
  /** The closing of the day the inputs belong to (the live one for today). */
  closingNo: number;
  /** Today only: the live closing's revision the inputs were derived from (another value → `draft_changed`). */
  revision?: number;
}
