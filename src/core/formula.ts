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

/** Value of the counted notes and coins, only for denominations the shop has enabled. */
export function countedCents(config: ShopConfig, inputs: ClosingInputs): Cents {
  return config.denominations.reduce((sum, d) => sum + d * (inputs.counts[String(d)] ?? 0), 0);
}

export function expensesCents(inputs: ClosingInputs): Cents {
  return inputs.expenses.reduce((sum, e) => sum + e.cents, 0);
}

/** The one place totals are computed. Throws ConfigInvalidError if the config is not valid. */
export function evaluateTotals(config: ShopConfig, inputs: ClosingInputs): Record<string, Cents> {
  const errors = validateConfig(config);
  if (errors.length > 0) throw new ConfigInvalidError(errors);
  const order = totalOrder(config.totals);
  if (!order.ok) throw new ConfigInvalidError([{ code: 'cycle', detail: order.cycle.join(' → ') }]);

  const counted = countedCents(config, inputs);
  const expenses = expensesCents(inputs);
  const channel = (id: string): Cents => inputs.channelCents[id] ?? 0;
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
    }
  };

  const byId = new Map(config.totals.map((t) => [t.id, t]));
  for (const id of order.order) {
    const def = byId.get(id);
    if (def) values[id] = def.terms.reduce((sum, t) => sum + t.sign * resolve(t.ref), 0);
  }
  return values;
}
