import type { ClosingInputs } from '../../../core/formula';
import type { Snapshot } from '../../register/live/fields';

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

export type HistoryDay =
  | { status: 'submitted'; businessDate: string; current: ClosingVersion; versionCount: number }
  | { status: 'unsubmitted'; businessDate: string; open: Snapshot };

export interface HistoryList {
  today: string;
  from: string;
  to: string;
  /** Untrusted jsonb by config id — check with isShopConfig. */
  configs: Record<string, unknown>;
  days: HistoryDay[];
}

export interface DayDetail {
  today: string;
  businessDate: string;
  /** Newest first; [0] is the current version. */
  versions: ClosingVersion[];
  configs: Record<string, unknown>;
  staffNames: Record<string, string>;
  open: Snapshot | null;
}

export interface SaveClosingArgs {
  businessDate: string;
  configId: string;
  inputs: ClosingInputs;
  /** The version the owner saw as current (null: the day has none); a different current → `closing_changed`. */
  expectedCurrentId: string | null;
  key: string;
}
