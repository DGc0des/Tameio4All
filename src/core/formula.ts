import {
  totalOrder,
  validateConfig,
  type ConfigError,
  type ShopConfig,
  type TermRef,
} from './config';
import type { Cents } from './money';

export interface ExpenseEntry {
  description: string;
  cents: Cents;
}

/** Raw, already-parsed inputs of one closing. This is what gets stored — never the totals. */
export interface ClosingInputs {
  /** Bumped whenever the stored shape changes; lets validators reject inputs from a future/past shape. */
  schema: 1;
  /** Piece count per denomination, keyed by String(denominationCents). */
  counts: Record<string, number>;
  /** Amount per channel id. */
  channelCents: Record<string, Cents>;
  expenses: ExpenseEntry[];
}

export class ConfigInvalidError extends Error {
  constructor(readonly errors: ConfigError[]) {
    super(`Invalid shop config: ${errors.map((e) => `${e.code} (${e.detail})`).join(', ')}`);
    this.name = 'ConfigInvalidError';
  }
}

export type InputErrorCode = 'bad_shape' | 'bad_count' | 'bad_amount' | 'too_many_expenses';

export interface InputError {
  code: InputErrorCode;
  detail: string;
}

export class ClosingInputsInvalidError extends Error {
  constructor(readonly errors: InputError[]) {
    super(`Invalid closing inputs: ${errors.map((e) => `${e.code} (${e.detail})`).join(', ')}`);
    this.name = 'ClosingInputsInvalidError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isSafeNonNegInt = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/**
 * Validates closing inputs of unknown origin (e.g. read back as JSON from storage). Keys for
 * denominations/channels no longer in the config stay allowed — stale drafts are just ignored,
 * never rejected.
 */
export function validateClosingInputs(config: ShopConfig, inputs: unknown): InputError[] {
  const errors: InputError[] = [];

  if (!isObj(inputs)) {
    errors.push({ code: 'bad_shape', detail: 'inputs is not an object' });
    return errors;
  }
  const c = inputs;

  if (c.schema !== 1) errors.push({ code: 'bad_shape', detail: 'schema' });

  if (!isObj(c.counts)) {
    errors.push({ code: 'bad_shape', detail: 'counts' });
  } else {
    for (const [key, value] of Object.entries(c.counts)) {
      if (!isSafeNonNegInt(value)) errors.push({ code: 'bad_count', detail: `${key}: ${String(value)}` });
    }
  }

  if (!isObj(c.channelCents)) {
    errors.push({ code: 'bad_shape', detail: 'channelCents' });
  } else {
    for (const [key, value] of Object.entries(c.channelCents)) {
      if (!isSafeNonNegInt(value)) errors.push({ code: 'bad_amount', detail: `${key}: ${String(value)}` });
    }
  }

  if (!Array.isArray(c.expenses)) {
    errors.push({ code: 'bad_shape', detail: 'expenses' });
  } else {
    for (const e of c.expenses) {
      if (!isObj(e) || typeof e.description !== 'string' || !isSafeNonNegInt(e.cents)) {
        errors.push({ code: 'bad_amount', detail: 'expense' });
      }
    }
    if (c.expenses.length > config.maxExpenses) {
      errors.push({ code: 'too_many_expenses', detail: `${c.expenses.length} > ${config.maxExpenses}` });
    }
  }

  return errors;
}

/** Value of the counted notes and coins, only for denominations the shop has enabled. */
export function countedCents(config: ShopConfig, inputs: ClosingInputs): Cents {
  return config.denominations.reduce((sum, d) => {
    const key = String(d);
    return sum + d * (Object.hasOwn(inputs.counts, key) ? inputs.counts[key] ?? 0 : 0);
  }, 0);
}

export function expensesCents(inputs: ClosingInputs): Cents {
  return inputs.expenses.reduce((sum, e) => sum + e.cents, 0);
}

/** The one place totals are computed. Throws ConfigInvalidError/ClosingInputsInvalidError if invalid. */
export function evaluateTotals(config: ShopConfig, inputs: ClosingInputs): Record<string, Cents> {
  const errors = validateConfig(config);
  if (errors.length > 0) throw new ConfigInvalidError(errors);
  const inputErrors = validateClosingInputs(config, inputs);
  if (inputErrors.length > 0) throw new ClosingInputsInvalidError(inputErrors);
  const order = totalOrder(config.totals);
  if (!order.ok) throw new ConfigInvalidError([{ code: 'cycle', detail: order.cycle.join(' → ') }]);

  const counted = countedCents(config, inputs);
  const expenses = expensesCents(inputs);
  const channel = (id: string): Cents =>
    Object.hasOwn(inputs.channelCents, id) ? inputs.channelCents[id] ?? 0 : 0;
  const values: Record<string, Cents> = {};

  const resolve = (ref: TermRef): Cents => {
    switch (ref.kind) {
      case 'counted':
        return counted;
      case 'float':
        return config.floatCents;
      case 'expenses':
        return expenses;
      case 'channel':
        return channel(ref.id);
      case 'type':
        return config.channels
          .filter((c) => c.type === ref.type)
          .reduce((sum, c) => sum + channel(c.id), 0);
      case 'total':
        return values[ref.id] ?? 0;
      default: {
        const exhaustive: never = ref;
        throw new Error(`Unknown term ref kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  };

  const byId = new Map(config.totals.map((t) => [t.id, t]));
  for (const id of order.order) {
    const def = byId.get(id);
    if (def) values[id] = def.terms.reduce((sum, t) => sum + t.sign * resolve(t.ref), 0);
  }
  return values;
}
