import { isIsoDate } from '../../app/dates';
import type { ClosingVersion, DayDetail, HistoryDay, HistoryList } from '../../features/owner/history/types';
import { parseSnapshot } from './live';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === 'string' && x !== '';
const isDate = (x: unknown): x is string => typeof x === 'string' && isIsoDate(x);

/** A plain object passed through untouched (values stay `unknown`); anything else → null. */
const asRecord = (x: unknown): Record<string, unknown> | null => (isObj(x) ? x : null);

/** One version object (`private.closing_version_json`); null when malformed. */
function parseVersion(x: unknown): ClosingVersion | null {
  if (!isObj(x) || !isId(x.id) || (x.kind !== 'staff' && x.kind !== 'owner_correction')) return null;
  if (typeof x.author_name !== 'string' || typeof x.created_at !== 'string' || !isId(x.config_id)) return null;
  if (x.corrects_closing_id !== null && x.corrects_closing_id !== undefined && !isId(x.corrects_closing_id)) return null;
  return {
    id: x.id, kind: x.kind, authorName: x.author_name, createdAt: x.created_at, configId: x.config_id,
    inputs: x.inputs, correctsId: x.corrects_closing_id ?? null,
  };
}

function parseDay(x: unknown): HistoryDay | null {
  if (!isObj(x) || !isDate(x.business_date)) return null;
  if (x.status === 'submitted') {
    const current = parseVersion(x.current);
    const n = x.version_count;
    if (!current || typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
    return { status: 'submitted', businessDate: x.business_date, current, versionCount: n };
  }
  if (x.status === 'unsubmitted') {
    const open = parseSnapshot(x.open);
    return open ? { status: 'unsubmitted', businessDate: x.business_date, open } : null;
  }
  return null;
}

/** The ok payload of owner_list_closings. Bad days are dropped individually; a bad top level → null. */
export function parseHistoryList(x: unknown): HistoryList | null {
  if (!isObj(x) || !isDate(x.today) || !isDate(x.from) || !isDate(x.to) || !Array.isArray(x.days)) return null;
  const configs = x.configs === undefined || x.configs === null ? {} : asRecord(x.configs);
  if (!configs) return null;
  const days: HistoryDay[] = [];
  for (const raw of x.days as unknown[]) {
    const d = parseDay(raw);
    if (d) days.push(d);
  }
  return { today: x.today, from: x.from, to: x.to, configs, days };
}

/** The ok payload of owner_get_closing_day. Bad versions/names are dropped; a bad `open` becomes null. */
export function parseDayDetail(x: unknown): DayDetail | null {
  if (!isObj(x) || !isDate(x.today) || !isDate(x.business_date) || !Array.isArray(x.versions)) return null;
  const configs = x.configs === undefined || x.configs === null ? {} : asRecord(x.configs);
  const names = x.staff_names === undefined || x.staff_names === null ? {} : asRecord(x.staff_names);
  if (!configs || !names) return null;
  const versions: ClosingVersion[] = [];
  for (const raw of x.versions as unknown[]) {
    const v = parseVersion(raw);
    if (v) versions.push(v);
  }
  const staffNames: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) if (typeof name === 'string') staffNames[id] = name;
  return {
    today: x.today, businessDate: x.business_date, versions, configs, staffNames,
    open: x.open === null || x.open === undefined ? null : parseSnapshot(x.open),
  };
}
