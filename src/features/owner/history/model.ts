import { addDaysIso, isIsoDate } from '../../../app/dates';
import type { ShopConfig } from '../../../core/config';
import { isShopConfig } from '../../../core/config';
import { evaluateTotals, validateClosingInputs, type ClosingInputs } from '../../../core/formula';
import { planEnvelope, type EnvelopePlan } from '../../../core/envelope';
import { centsToPlain, type Cents } from '../../../core/money';
import { deriveClosing } from '../../register/derive';
import { draftFromFields } from '../../register/live/merge';
import {
  KEY_RE, amountValue, channelKey, denomKey, denomValue, expenseAmountKey, expenseDescKey, expenseKey, expenseMetaValue,
  isFieldValue, parseKey, textValue, type FieldKey, type ServerField, type Snapshot,
} from '../../register/live/fields';
import type { ClosingVersion, HistoryDay, HistoryList } from './types';

export const OWNER_NAME = 'Ιδιοκτήτης';
export const UNKNOWN_AUTHOR = '—';

export interface TotalLine { id: string; label: string; cents: Cents }
export interface Summary { totals: TotalLine[]; expensesCents: Cents }

export interface Breakdown {
  config: ShopConfig; inputs: ClosingInputs;
  denominations: { denom: Cents; count: number; cents: Cents }[];
  channels: { id: string; label: string; cents: Cents }[];
  expenses: { key: string; description: string; cents: Cents; author: string }[];
  totals: TotalLine[];
  expensesCents: Cents; envelope: EnvelopePlan;
}

/** The config and inputs, only when both are readable (stored jsonb is untrusted). */
function readable(config: unknown, inputs: unknown): { config: ShopConfig; inputs: ClosingInputs } | null {
  if (!isShopConfig(config)) return null;
  if (validateClosingInputs(config, inputs).length > 0) return null;
  return { config, inputs: inputs as ClosingInputs };
}

const sumExpenses = (inputs: ClosingInputs): Cents => inputs.expenses.reduce((s, e) => s + e.cents, 0);

function lines(config: ShopConfig, totals: Record<string, Cents>, onlySummary: boolean): TotalLine[] {
  return config.totals
    .filter((t) => !onlySummary || t.showInSummary)
    .map((t) => ({ id: t.id, label: t.label, cents: totals[t.id] ?? 0 }));
}

/** null when the config or the inputs cannot be read. Never throws. */
export function summarizeInputs(config: unknown, inputs: unknown): Summary | null {
  const r = readable(config, inputs);
  if (r === null) return null;
  const totals = evaluateTotals(r.config, r.inputs);
  return { totals: lines(r.config, totals, true), expensesCents: sumExpenses(r.inputs) };
}

/** The open closing as inputs, for showing an unsubmitted day. */
export function openInputs(open: Snapshot): { config: ShopConfig; inputs: ClosingInputs } | null {
  if (!isShopConfig(open.config)) return null;
  const config = open.config;
  return { config, inputs: deriveClosing(config, draftFromFields(open, [])).inputs };
}

/** The open closing's last numbers (invalid boxes left out, as on the register). */
export function summarizeOpen(open: Snapshot): Summary | null {
  const o = openInputs(open);
  return o === null ? null : summarizeInputs(o.config, o.inputs);
}

export function breakdown(config: unknown, inputs: unknown, staffNames: Record<string, string>): Breakdown | null {
  const r = readable(config, inputs);
  if (r === null) return null;
  const { config: cfg, inputs: inp } = r;
  const totals = evaluateTotals(cfg, inp);

  const denominations = cfg.denominations
    .map((denom) => ({ denom, count: Object.hasOwn(inp.counts, String(denom)) ? inp.counts[String(denom)] ?? 0 : 0 }))
    .filter((d) => d.count > 0)
    .map((d) => ({ ...d, cents: d.count * d.denom }))
    .sort((a, b) => b.denom - a.denom);

  const channels = cfg.channels
    .map((ch) => ({ id: ch.id, label: ch.label, cents: Object.hasOwn(inp.channelCents, ch.id) ? inp.channelCents[ch.id] ?? 0 : 0 }))
    .filter((c) => c.cents > 0);

  const expenses = inp.expenses.map((e, i) => ({
    key: e.id ?? `i${i}`,
    description: e.description,
    cents: e.cents,
    author:
      e.addedBy === undefined ? UNKNOWN_AUTHOR
      : e.addedBy.kind === 'owner' ? OWNER_NAME
      : Object.hasOwn(staffNames, e.addedBy.id) ? staffNames[e.addedBy.id] ?? UNKNOWN_AUTHOR
      : UNKNOWN_AUTHOR,
  }));

  return {
    config: cfg, inputs: inp, denominations, channels, expenses,
    totals: lines(cfg, totals, false),
    expensesCents: sumExpenses(inp),
    envelope: planEnvelope(totals[cfg.envelopeTotalId] ?? 0, inp.counts, cfg.denominations),
  };
}

/**
 * The staff submission an owner correction is measured against: the newest `staff` version older than
 * `index` (versions are newest first). null for a staff version itself, or a day the owner filed alone.
 */
export function originalOf(versions: readonly ClosingVersion[], index: number): ClosingVersion | null {
  if (versions[index]?.kind !== 'owner_correction') return null;
  return versions.slice(index + 1).find((v) => v.kind === 'staff') ?? null;
}

/** What changed from the original to the shown version; each map holds the original value of a changed line. */
export interface BreakdownDiff {
  denominations: Map<Cents, Cents>;
  channels: Map<string, Cents>;
  expenses: Map<string, { description: string; cents: Cents }>;
  addedExpenses: Set<string>;
  totals: Map<string, Cents>;
  /** Lines of the original that the shown version no longer has. */
  removedDenominations: Breakdown['denominations'];
  removedChannels: Breakdown['channels'];
  removedExpenses: Breakdown['expenses'];
}

export function diffBreakdown(shown: Breakdown, original: Breakdown): BreakdownDiff {
  const byKey = <T, K>(xs: readonly T[], k: (x: T) => K) => new Map(xs.map((x) => [k(x), x] as const));
  const oDen = byKey(original.denominations, (d) => d.denom);
  const oCh = byKey(original.channels, (c) => c.id);
  const oEx = byKey(original.expenses, (e) => e.key);
  const oTot = byKey(original.totals, (t) => t.id);
  const sDen = new Set(shown.denominations.map((d) => d.denom));
  const sCh = new Set(shown.channels.map((c) => c.id));
  const sEx = new Set(shown.expenses.map((e) => e.key));

  const diff: BreakdownDiff = {
    denominations: new Map(), channels: new Map(), expenses: new Map(), addedExpenses: new Set(), totals: new Map(),
    removedDenominations: original.denominations.filter((d) => !sDen.has(d.denom)),
    removedChannels: original.channels.filter((c) => !sCh.has(c.id)),
    removedExpenses: original.expenses.filter((e) => !sEx.has(e.key)),
  };
  for (const d of shown.denominations) {
    const o = oDen.get(d.denom)?.cents ?? 0;
    if (o !== d.cents) diff.denominations.set(d.denom, o);
  }
  for (const c of shown.channels) {
    const o = oCh.get(c.id)?.cents ?? 0;
    if (o !== c.cents) diff.channels.set(c.id, o);
  }
  for (const e of shown.expenses) {
    const o = oEx.get(e.key);
    if (o === undefined) diff.addedExpenses.add(e.key);
    else if (o.cents !== e.cents || o.description !== e.description) diff.expenses.set(e.key, { description: o.description, cents: o.cents });
  }
  for (const t of shown.totals) {
    const o = oTot.get(t.id);
    if (o !== undefined && o.cents !== t.cents) diff.totals.set(t.id, o.cents);
  }
  return diff;
}

/** A local, editable copy of stored inputs (never sent to the server as fields). */
export function snapshotFromInputs(a: {
  config: ShopConfig; configId: string; businessDate: string; inputs: ClosingInputs; newId: () => string;
}): Snapshot {
  const fields: Record<FieldKey, ServerField> = {};
  const put = (key: FieldKey, value: unknown): void => {
    fields[key] = { key, value, version: 1, updatedByName: '', updatedAt: '' };
  };

  for (const [k, count] of Object.entries(a.inputs.counts)) {
    const key = denomKey(Number(k));
    if (parseKey(key) !== null && key === `d:${k}`) put(key, denomValue(String(count), 'count'));
  }
  for (const [id, cents] of Object.entries(a.inputs.channelCents)) {
    const key = channelKey(id);
    if (KEY_RE.test(key)) put(key, amountValue(centsToPlain(cents)));
  }
  const used = new Set<string>();
  a.inputs.expenses.forEach((e, i) => {
    const usable = e.id !== undefined && /^[A-Za-z0-9-]{1,64}$/.test(e.id) && !used.has(e.id);
    const id = usable ? (e.id as string) : a.newId();
    used.add(id);
    put(expenseKey(id), expenseMetaValue(e.addedBy ?? { kind: 'owner' }, i, false));
    put(expenseDescKey(id), textValue(e.description));
    put(expenseAmountKey(id), amountValue(centsToPlain(e.cents)));
  });

  return {
    id: 'local', businessDate: a.businessDate, configId: a.configId, config: a.config,
    revision: 0, lastSubmit: null, fields,
  };
}

/** Applies one box edit locally; an invalid key/value returns the same snapshot. */
export function applyLocalEdit(s: Snapshot, key: FieldKey, value: unknown): Snapshot {
  if (!isFieldValue(key, value)) return s;
  const version = (Object.hasOwn(s.fields, key) ? s.fields[key]?.version ?? 0 : 0) + 1;
  return { ...s, fields: { ...s.fields, [key]: { key, value, version, updatedByName: '', updatedAt: '' } } };
}


/** What one day of the week view shows. */
export type WeekCellKind = 'submitted' | 'unsubmitted' | 'in_progress' | 'empty' | 'future';
export interface WeekCell { date: string; kind: WeekCellKind; /** The list's day for a submitted/unsubmitted cell. */ day?: HistoryDay }

/**
 * The seven days Monday → Sunday of the week starting at `monday`. «Today» is the server's `list.today`
 * (never the browser's clock): a day with no row is in progress today, empty before today, future after it.
 * Days of the list outside the week are ignored; an unknown `monday` gives no cells.
 */
export function weekCells(list: HistoryList, monday: string): WeekCell[] {
  if (!isIsoDate(monday)) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(monday, i);
    const day = list.days.find((d) => d.businessDate === date);
    if (day !== undefined) return { date, kind: day.status, day };
    if (date > list.today) return { date, kind: 'future' };
    return { date, kind: date === list.today ? 'in_progress' : 'empty' };
  });
}
