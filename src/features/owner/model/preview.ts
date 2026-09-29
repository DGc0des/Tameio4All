import { validateConfig, type ShopConfig } from '../../../core/config';
import { evaluateTotals, type ClosingInputs } from '../../../core/formula';
import { parseAmount, type Cents } from '../../../core/money';

export interface PreviewSample {
  /** Total counted in the till, as typed. */
  counted: string;
  /** Total expenses, as typed. */
  expenses: string;
  /** Amount per channel id, as typed. */
  channels: Record<string, string>;
}

export type PreviewResult =
  | { ok: true; totals: { id: string; label: string; cents: Cents }[] }
  | { ok: false; reason: 'invalid_config' }
  | { ok: false; reason: 'bad_sample'; fields: string[] };

/** Empty → 0; anything parseAmount refuses → null. */
const amountOrZero = (raw: string): Cents | null => {
  if (raw.trim() === '') return 0;
  const r = parseAmount(raw);
  return r.ok ? r.value : null;
};

/**
 * The formula builder's live preview. Counted money is expressed as pieces of the smallest enabled
 * denomination, so it must be a multiple of it. All maths goes through evaluateTotals.
 */
export function previewTotals(config: ShopConfig, sample: PreviewSample): PreviewResult {
  if (validateConfig(config).length > 0) return { ok: false, reason: 'invalid_config' };
  const bad: string[] = [];

  const counted = amountOrZero(sample.counted);
  const smallest = config.denominations.length > 0 ? Math.min(...config.denominations) : null;
  let counts: Record<string, number> = {};
  if (counted === null || (counted > 0 && (smallest === null || counted % smallest !== 0))) bad.push('counted');
  else if (counted > 0 && smallest !== null) counts = { [String(smallest)]: counted / smallest };

  const channelCents: Record<string, Cents> = {};
  for (const ch of config.channels) {
    const v = amountOrZero(sample.channels[ch.id] ?? '');
    if (v === null) bad.push(ch.id);
    else channelCents[ch.id] = v;
  }

  const expenses = amountOrZero(sample.expenses);
  if (expenses === null || (expenses > 0 && config.maxExpenses < 1)) bad.push('expenses');

  if (bad.length > 0) return { ok: false, reason: 'bad_sample', fields: bad };

  const inputs: ClosingInputs = {
    schema: 1,
    counts,
    channelCents,
    expenses: expenses !== null && expenses > 0 ? [{ description: 'Δείγμα', cents: expenses }] : [],
  };
  const values = evaluateTotals(config, inputs);
  return { ok: true, totals: config.totals.map((t) => ({ id: t.id, label: t.label, cents: values[t.id] ?? 0 })) };
}
