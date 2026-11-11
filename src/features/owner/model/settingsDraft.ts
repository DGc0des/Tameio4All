import { validateConfig, type ChannelType, type ShopConfig, type Term, type TotalDef } from '../../../core/config';
import { EUR_DENOMINATIONS } from '../../../core/denominations';
import type { Cents } from '../../../core/money';

export type SettingsAction =
  | { type: 'setFloat'; cents: Cents }
  | { type: 'toggleDenomination'; cents: Cents }
  | { type: 'setEnvelopeTotal'; id: string }
  | { type: 'addChannel'; label: string; channelType: ChannelType }
  | { type: 'renameChannel'; id: string; label: string }
  | { type: 'setChannelType'; id: string; channelType: ChannelType }
  | { type: 'removeChannel'; id: string }
  | { type: 'addTotal'; label: string }
  | { type: 'renameTotal'; id: string; label: string }
  | { type: 'removeTotal'; id: string }
  | { type: 'moveTotal'; id: string; delta: -1 | 1 }
  | { type: 'setTotalFlag'; id: string; flag: 'showInSummary' | 'showInShare'; value: boolean }
  | { type: 'addTerm'; totalId: string; term: Term }
  | { type: 'removeTerm'; totalId: string; index: number }
  | { type: 'flipTerm'; totalId: string; index: number }
  | { type: 'addTare'; name: string; tareGrams: number }
  | { type: 'updateTare'; index: number; name?: string; tareGrams?: number }
  | { type: 'removeTare'; index: number };

/** `blockedBy` non-empty ⇒ the action was refused and `config` is the input, unchanged. */
export interface ApplyResult {
  config: ShopConfig;
  blockedBy: string[];
}

export function nextId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Structurally a ShopConfig (content errors such as an empty label are allowed while editing). */
export function isEditableConfig(x: unknown): x is ShopConfig {
  return validateConfig(x).every((e) => e.code !== 'bad_shape');
}

const flip = (term: Term): Term => ({ ...term, sign: term.sign === 1 ? -1 : 1 });
const usesChannel = (t: TotalDef, id: string): boolean => t.terms.some((x) => x.ref.kind === 'channel' && x.ref.id === id);
const usesTotal = (t: TotalDef, id: string): boolean => t.terms.some((x) => x.ref.kind === 'total' && x.ref.id === id);

/** Pure: never mutates `config`. Refuses removals that would leave dangling references. */
export function applySettings(config: ShopConfig, action: SettingsAction): ApplyResult {
  const ok = (next: ShopConfig): ApplyResult => ({ config: next, blockedBy: [] });
  const mapTotal = (id: string, f: (t: TotalDef) => TotalDef): ApplyResult =>
    ok({ ...config, totals: config.totals.map((t) => (t.id === id ? f(t) : t)) });

  switch (action.type) {
    case 'setFloat':
      return ok({ ...config, floatCents: action.cents });
    case 'toggleDenomination': {
      const on = config.denominations.includes(action.cents);
      const denominations = on
        ? config.denominations.filter((d) => d !== action.cents)
        : EUR_DENOMINATIONS.filter((d) => d === action.cents || config.denominations.includes(d));
      return ok({ ...config, denominations });
    }
    case 'setEnvelopeTotal':
      return ok({ ...config, envelopeTotalId: action.id });
    case 'addChannel': {
      const id = nextId('ch', new Set(config.channels.map((c) => c.id)));
      return ok({ ...config, channels: [...config.channels, { id, label: action.label, type: action.channelType }] });
    }
    case 'renameChannel':
      return ok({ ...config, channels: config.channels.map((c) => (c.id === action.id ? { ...c, label: action.label } : c)) });
    case 'setChannelType':
      return ok({ ...config, channels: config.channels.map((c) => (c.id === action.id ? { ...c, type: action.channelType } : c)) });
    case 'removeChannel': {
      const users = config.totals.filter((t) => usesChannel(t, action.id)).map((t) => t.label);
      if (users.length > 0) return { config, blockedBy: users };
      return ok({ ...config, channels: config.channels.filter((c) => c.id !== action.id) });
    }
    case 'addTotal': {
      const id = nextId('t', new Set(config.totals.map((t) => t.id)));
      const total: TotalDef = { id, label: action.label, terms: [], showInSummary: true, showInShare: true };
      return ok({ ...config, totals: [...config.totals, total] });
    }
    case 'renameTotal':
      return mapTotal(action.id, (t) => ({ ...t, label: action.label }));
    case 'removeTotal': {
      const users = config.totals.filter((t) => t.id !== action.id && usesTotal(t, action.id)).map((t) => t.label);
      if (config.envelopeTotalId === action.id) users.push('Φάκελος');
      if (users.length > 0) return { config, blockedBy: users };
      return ok({ ...config, totals: config.totals.filter((t) => t.id !== action.id) });
    }
    case 'moveTotal': {
      const i = config.totals.findIndex((t) => t.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= config.totals.length) return ok(config);
      const totals = [...config.totals];
      const a = totals[i];
      const b = totals[j];
      if (a === undefined || b === undefined) return ok(config);
      totals[i] = b;
      totals[j] = a;
      return ok({ ...config, totals });
    }
    case 'setTotalFlag':
      return mapTotal(action.id, (t) => ({ ...t, [action.flag]: action.value }));
    case 'addTerm':
      return mapTotal(action.totalId, (t) => ({ ...t, terms: [...t.terms, action.term] }));
    case 'removeTerm':
      return mapTotal(action.totalId, (t) => ({ ...t, terms: t.terms.filter((_, i) => i !== action.index) }));
    case 'flipTerm':
      return mapTotal(action.totalId, (t) => ({ ...t, terms: t.terms.map((x, i) => (i === action.index ? flip(x) : x)) }));
    case 'addTare':
      return ok({ ...config, tareItems: [...config.tareItems, { name: action.name, tareGrams: action.tareGrams }] });
    case 'updateTare':
      return ok({
        ...config,
        tareItems: config.tareItems.map((item, i) =>
          i === action.index
            ? { name: action.name ?? item.name, tareGrams: action.tareGrams ?? item.tareGrams }
            : item,
        ),
      });
    case 'removeTare':
      return ok({ ...config, tareItems: config.tareItems.filter((_, i) => i !== action.index) });
  }
}
