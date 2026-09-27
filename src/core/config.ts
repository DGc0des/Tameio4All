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
  | 'bad_float'
  | 'bad_denomination'
  | 'bad_max_expenses'
  | 'bad_id'
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

function checkIds(ids: string[], what: string, errors: ConfigError[]): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.trim() === '') errors.push({ code: 'bad_id', detail: `${what}: empty id` });
    else if (seen.has(id)) errors.push({ code: 'duplicate_id', detail: `${what}: ${id}` });
    seen.add(id);
  }
  return seen;
}

export function validateConfig(config: ShopConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (!Number.isSafeInteger(config.floatCents) || config.floatCents < 0) {
    errors.push({ code: 'bad_float', detail: String(config.floatCents) });
  }

  const seenDenoms = new Set<number>();
  for (const d of config.denominations) {
    if (!EUR_DENOMINATIONS.includes(d) || seenDenoms.has(d)) {
      errors.push({ code: 'bad_denomination', detail: String(d) });
    }
    seenDenoms.add(d);
  }

  if (!Number.isInteger(config.maxExpenses) || config.maxExpenses < 0 || config.maxExpenses > 30) {
    errors.push({ code: 'bad_max_expenses', detail: String(config.maxExpenses) });
  }

  const channelIds = checkIds(config.channels.map((c) => c.id), 'channel', errors);
  const totalIds = checkIds(config.totals.map((t) => t.id), 'total', errors);

  for (const t of config.totals) {
    for (const { ref } of t.terms) {
      if (ref.kind === 'channel' && !channelIds.has(ref.id)) {
        errors.push({ code: 'unknown_channel', detail: `${t.id} → ${ref.id}` });
      }
      if (ref.kind === 'total' && !totalIds.has(ref.id)) {
        errors.push({ code: 'unknown_total', detail: `${t.id} → ${ref.id}` });
      }
    }
  }

  const order = totalOrder(config.totals);
  if (!order.ok) errors.push({ code: 'cycle', detail: order.cycle.join(' → ') });

  if (!totalIds.has(config.envelopeTotalId)) {
    errors.push({ code: 'missing_envelope_total', detail: config.envelopeTotalId });
  }

  for (const item of config.tareItems) {
    if (item.name.trim() === '' || !Number.isSafeInteger(item.tareGrams) || item.tareGrams < 0) {
      errors.push({ code: 'bad_tare', detail: item.name || '(empty name)' });
    }
  }

  return errors;
}
