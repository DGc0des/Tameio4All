import { EUR_DENOMINATIONS } from './denominations';
import type { Cents } from './money';

/**
 * card: card terminals (myPos, Eurobank). delivery: platforms (WOLT, EFOOD).
 * noncash_other: any other income not in the till. cash_extra: cash kept outside the counted
 * notes/coins but still cash (ΚΕΡΜΑΤΑ bags in the safe).
 */
export type ChannelType = 'card' | 'delivery' | 'noncash_other' | 'cash_extra';
export const CHANNEL_TYPES: readonly ChannelType[] = ['cash_extra', 'card', 'delivery', 'noncash_other'];

export interface Channel {
  id: string;
  label: string;
  type: ChannelType;
}

export type TermRef =
  | { kind: 'counted' }
  | { kind: 'float' }
  | { kind: 'expenses' }
  | { kind: 'channel'; id: string }
  | { kind: 'type'; type: ChannelType }
  | { kind: 'total'; id: string };

export interface Term {
  sign: 1 | -1;
  ref: TermRef;
}

export interface TotalDef {
  id: string;
  label: string;
  terms: Term[];
  showInSummary: boolean;
  showInShare: boolean;
}

export interface TareItem {
  name: string;
  tareGrams: number;
}

/** Everything shop-specific. Staff and PINs are deliberately NOT here (server-side only). */
export interface ShopConfig {
  /** Bumped whenever the stored shape changes; lets validators reject configs from a future/past shape. */
  schema: 1;
  floatCents: Cents;
  denominations: Cents[];
  channels: Channel[];
  totals: TotalDef[];
  envelopeTotalId: string;
  maxExpenses: number;
  tareItems: TareItem[];
  seedSuppliers: Record<string, Cents[]>;
}

export type ConfigErrorCode =
  | 'bad_shape'
  | 'bad_float'
  | 'bad_denomination'
  | 'bad_max_expenses'
  | 'bad_id'
  | 'bad_label'
  | 'duplicate_id'
  | 'unknown_channel'
  | 'unknown_total'
  | 'cycle'
  | 'missing_envelope_total'
  | 'bad_tare';

export interface ConfigError {
  code: ConfigErrorCode;
  detail: string;
}

export const plus = (ref: TermRef): Term => ({ sign: 1, ref });
export const minus = (ref: TermRef): Term => ({ sign: -1, ref });

const NON_CASH: readonly ChannelType[] = ['card', 'delivery', 'noncash_other'];

/** ΤΑΜΕΙΟ = everything; ΜΕΤΡΗΤΑ = ΤΑΜΕΙΟ − float − expenses − non-cash channels. */
export function defaultTotals(): TotalDef[] {
  return [
    {
      id: 'tameio',
      label: 'ΤΑΜΕΙΟ',
      terms: [
        plus({ kind: 'counted' }),
        ...CHANNEL_TYPES.map((type) => plus({ kind: 'type', type })),
        plus({ kind: 'expenses' }),
      ],
      showInSummary: true,
      showInShare: true,
    },
    {
      id: 'expenses_total',
      label: 'ΣΥΝΟΛΟ ΕΞΟΔΩΝ',
      terms: [plus({ kind: 'expenses' })],
      showInSummary: true,
      showInShare: true,
    },
    {
      id: 'cash',
      label: 'ΜΕΤΡΗΤΑ',
      terms: [
        plus({ kind: 'total', id: 'tameio' }),
        minus({ kind: 'float' }),
        minus({ kind: 'expenses' }),
        ...NON_CASH.map((type) => minus({ kind: 'type', type })),
      ],
      showInSummary: true,
      showInShare: true,
    },
  ];
}

export function newShopConfig(): ShopConfig {
  return {
    schema: 1,
    floatCents: 0,
    denominations: EUR_DENOMINATIONS.filter((d) => d <= 10000),
    channels: [],
    totals: defaultTotals(),
    envelopeTotalId: 'cash',
    maxExpenses: 10,
    tareItems: [],
    seedSuppliers: {},
  };
}

/** Dependency order of totals (referenced totals first), or the first cycle found. */
export function totalOrder(
  totals: TotalDef[],
): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  const byId = new Map(totals.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    const def = byId.get(id);
    if (!def) return null; // unknown ids are reported by validateConfig
    state.set(id, 'visiting');
    stack.push(id);
    for (const term of def.terms) {
      if (term.ref.kind === 'total') {
        const cycle = visit(term.ref.id);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, 'done');
    order.push(id);
    return null;
  };

  for (const t of totals) {
    const cycle = visit(t.id);
    if (cycle) return { ok: false, cycle };
  }
  return { ok: true, order };
}

/** Ids must be lowercase/digits/underscore and never an Object.prototype property name
 * (constructor, toString, __proto__, …) — a JSON-parsed config could otherwise pollute lookups. */
const ID_RE = /^[a-z0-9_]{1,40}$/;
const isValidIdContent = (id: string): boolean => ID_RE.test(id) && !(id in Object.prototype);

function checkIds(ids: string[], what: string, errors: ConfigError[]): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isValidIdContent(id)) errors.push({ code: 'bad_id', detail: `${what}: ${id}` });
    else if (seen.has(id)) errors.push({ code: 'duplicate_id', detail: `${what}: ${id}` });
    seen.add(id);
  }
  return seen;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isSafeNonNegInt = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/**
 * Validates a config of unknown origin (e.g. jsonb read back from storage). Structural problems
 * (wrong shape, wrong primitive type, missing arrays) are reported as `bad_shape` and never throw,
 * even for completely foreign input; content problems keep their specific codes.
 */
export function validateConfig(config: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (!isObj(config)) {
    errors.push({ code: 'bad_shape', detail: 'config is not an object' });
    return errors;
  }
  const c = config;

  if (c.schema !== 1) errors.push({ code: 'bad_shape', detail: 'schema' });

  const floatOk = typeof c.floatCents === 'number' && Number.isSafeInteger(c.floatCents) && c.floatCents >= 0;
  if (!floatOk) errors.push({ code: 'bad_float', detail: String(c.floatCents) });

  if (!Array.isArray(c.denominations)) {
    errors.push({ code: 'bad_shape', detail: 'denominations' });
  } else {
    const seenDenoms = new Set<unknown>();
    for (const d of c.denominations) {
      if (typeof d !== 'number' || !EUR_DENOMINATIONS.includes(d) || seenDenoms.has(d)) {
        errors.push({ code: 'bad_denomination', detail: String(d) });
      }
      seenDenoms.add(d);
    }
  }

  const maxExpensesOk =
    typeof c.maxExpenses === 'number' &&
    Number.isInteger(c.maxExpenses) &&
    c.maxExpenses >= 0 &&
    c.maxExpenses <= 30;
  if (!maxExpensesOk) errors.push({ code: 'bad_max_expenses', detail: String(c.maxExpenses) });

  // channels
  let channelIds = new Set<string>();
  if (!Array.isArray(c.channels)) {
    errors.push({ code: 'bad_shape', detail: 'channels' });
  } else {
    const idList: string[] = [];
    for (const item of c.channels) {
      if (
        !isObj(item) ||
        typeof item.id !== 'string' ||
        typeof item.label !== 'string' ||
        typeof item.type !== 'string' ||
        !CHANNEL_TYPES.includes(item.type as ChannelType)
      ) {
        errors.push({ code: 'bad_shape', detail: 'channel' });
        continue;
      }
      idList.push(item.id);
      if (item.label.trim() === '') errors.push({ code: 'bad_label', detail: `channel: ${item.id}` });
    }
    channelIds = checkIds(idList, 'channel', errors);
  }

  // totals
  let totalIds = new Set<string>();
  let totalsShapeOk = Array.isArray(c.totals);
  const channelRefs: { totalId: string; id: string }[] = [];
  const totalRefs: { totalId: string; id: string }[] = [];

  if (!Array.isArray(c.totals)) {
    errors.push({ code: 'bad_shape', detail: 'totals' });
  } else {
    const idList: string[] = [];
    for (const item of c.totals) {
      if (
        !isObj(item) ||
        typeof item.id !== 'string' ||
        typeof item.label !== 'string' ||
        !Array.isArray(item.terms) ||
        typeof item.showInSummary !== 'boolean' ||
        typeof item.showInShare !== 'boolean'
      ) {
        errors.push({ code: 'bad_shape', detail: 'total' });
        totalsShapeOk = false;
        continue;
      }
      idList.push(item.id);
      if (item.label.trim() === '') errors.push({ code: 'bad_label', detail: `total: ${item.id}` });

      for (const term of item.terms) {
        if (!isObj(term) || (term.sign !== 1 && term.sign !== -1) || !isObj(term.ref)) {
          errors.push({ code: 'bad_shape', detail: `total ${item.id}: term` });
          totalsShapeOk = false;
          continue;
        }
        const ref = term.ref;
        switch (ref.kind) {
          case 'counted':
          case 'float':
          case 'expenses':
            break;
          case 'channel':
            if (typeof ref.id !== 'string') {
              errors.push({ code: 'bad_shape', detail: `total ${item.id}: channel ref` });
              totalsShapeOk = false;
            } else {
              channelRefs.push({ totalId: item.id, id: ref.id });
            }
            break;
          case 'total':
            if (typeof ref.id !== 'string') {
              errors.push({ code: 'bad_shape', detail: `total ${item.id}: total ref` });
              totalsShapeOk = false;
            } else {
              totalRefs.push({ totalId: item.id, id: ref.id });
            }
            break;
          case 'type':
            if (typeof ref.type !== 'string' || !CHANNEL_TYPES.includes(ref.type as ChannelType)) {
              errors.push({ code: 'bad_shape', detail: `total ${item.id}: type ref` });
              totalsShapeOk = false;
            }
            break;
          default:
            errors.push({ code: 'bad_shape', detail: `total ${item.id}: ref kind` });
            totalsShapeOk = false;
        }
      }
    }
    totalIds = checkIds(idList, 'total', errors);
  }

  for (const r of channelRefs) {
    if (!channelIds.has(r.id)) errors.push({ code: 'unknown_channel', detail: `${r.totalId} → ${r.id}` });
  }
  for (const r of totalRefs) {
    if (!totalIds.has(r.id)) errors.push({ code: 'unknown_total', detail: `${r.totalId} → ${r.id}` });
  }

  if (totalsShapeOk) {
    const order = totalOrder(c.totals as TotalDef[]);
    if (!order.ok) errors.push({ code: 'cycle', detail: order.cycle.join(' → ') });
  }

  if (!totalIds.has(c.envelopeTotalId as string)) {
    errors.push({ code: 'missing_envelope_total', detail: String(c.envelopeTotalId) });
  }

  if (!Array.isArray(c.tareItems)) {
    errors.push({ code: 'bad_shape', detail: 'tareItems' });
  } else {
    for (const item of c.tareItems) {
      if (!isObj(item) || typeof item.name !== 'string' || typeof item.tareGrams !== 'number') {
        errors.push({ code: 'bad_shape', detail: 'tareItems' });
        continue;
      }
      if (item.name.trim() === '' || !Number.isSafeInteger(item.tareGrams) || item.tareGrams < 0) {
        errors.push({ code: 'bad_tare', detail: item.name || '(empty name)' });
      }
    }
  }

  if (!isObj(c.seedSuppliers)) {
    errors.push({ code: 'bad_shape', detail: 'seedSuppliers' });
  } else {
    for (const [name, values] of Object.entries(c.seedSuppliers)) {
      if (!Array.isArray(values) || !values.every(isSafeNonNegInt)) {
        errors.push({ code: 'bad_shape', detail: `seedSuppliers: ${name}` });
      }
    }
  }

  return errors;
}

/** True iff `x` is a `ShopConfig` with no validation errors. */
export function isShopConfig(x: unknown): x is ShopConfig {
  return validateConfig(x).length === 0;
}
