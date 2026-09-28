import type { Cents } from './money';

export interface EnvelopePlan {
  targetCents: Cents;
  /** Pieces to put in the envelope, keyed by String(denominationCents); zero entries omitted. */
  put: Record<string, number>;
  /** Pieces left in the till for every denomination. */
  remaining: Record<string, number>;
  putCents: Cents;
  /** How much of the target could not be covered (0 when exact). */
  shortCents: Cents;
}

const gcd = (a: number, b: number): number => {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
};

/** A count that isn't a non-negative safe integer (NaN, negative, fractional, missing) is 0 —
 * counts come back as JSON and must never corrupt the plan with a NaN. */
const safeCount = (n: number | undefined): number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;

/** Caps the exact DP to ~20 000€ worth of 5c units so it stays fast and bounded in memory. */
const MAX_UNITS = 400_000;

/**
 * Chooses notes/coins summing exactly to the target when possible (else the closest amount
 * under it), preferring the largest denominations. Replaces tameioV2's greedy loop, which
 * reported a shortfall whenever an early large note blocked an exact answer.
 *
 * Exact for targets up to ~20 000€ (MAX_UNITS·unit). Above that, whole pieces of the largest
 * denominations are pre-taken greedily (never enough to push the remaining target below 0) until
 * what's left is ≤ MAX_UNITS·unit, then the exact DP runs on the remainder — best-effort, not
 * guaranteed exact, above ~20 000€.
 */
export function planEnvelope(
  targetCents: Cents,
  counts: Record<string, number>,
  denominations: readonly Cents[],
): EnvelopePlan {
  const denoms = [...new Set(denominations)].filter((d) => d > 0).sort((a, b) => b - a);
  const avail = denoms.map((d) => safeCount(counts[String(d)]));

  const build = (put: Record<string, number>, putCents: Cents): EnvelopePlan => ({
    targetCents,
    put,
    remaining: Object.fromEntries(denoms.map((d, i) => [String(d), (avail[i] ?? 0) - (put[String(d)] ?? 0)])),
    putCents,
    shortCents: Math.max(0, targetCents) - putCents,
  });

  if (targetCents <= 0 || denoms.length === 0) return build({}, 0);

  const unit = denoms.reduce(gcd);
  const tillCents = denoms.reduce((sum, d, i) => sum + d * (avail[i] ?? 0), 0);
  let T = Math.floor(Math.min(targetCents, tillCents) / unit);
  const n = denoms.length;

  const preTaken: Record<string, number> = {};
  const availForDp = [...avail];
  for (let i = 0; i < n && T > MAX_UNITS; i++) {
    const step = (denoms[i] ?? 0) / unit;
    const cap = availForDp[i] ?? 0;
    if (step <= 0 || cap <= 0) continue;
    const take = Math.min(cap, Math.floor((T - MAX_UNITS) / step));
    if (take <= 0) continue;
    preTaken[String(denoms[i])] = take;
    availForDp[i] = cap - take;
    T -= take * step;
  }

  const size = T + 1;

  // reach[i * size + s] === 1 iff s units are makeable from denoms[i..n-1] within their counts.
  const reach = new Uint8Array((n + 1) * size);
  reach[n * size] = 1;
  const used = new Int32Array(size);
  for (let i = n - 1; i >= 0; i--) {
    const step = (denoms[i] ?? 0) / unit;
    const cap = availForDp[i] ?? 0;
    const row = i * size;
    const next = (i + 1) * size;
    for (let s = 0; s <= T; s++) {
      if (reach[next + s]) {
        reach[row + s] = 1;
        used[s] = 0;
      } else if (s >= step && reach[row + s - step] && (used[s - step] ?? 0) < cap) {
        reach[row + s] = 1;
        used[s] = (used[s - step] ?? 0) + 1;
      } else {
        used[s] = 0;
      }
    }
  }

  let best = T;
  while (best > 0 && !reach[best]) best--;

  const put: Record<string, number> = { ...preTaken };
  let s = best;
  for (let i = 0; i < n; i++) {
    const step = (denoms[i] ?? 0) / unit;
    for (let k = Math.min(availForDp[i] ?? 0, Math.floor(s / step)); k >= 0; k--) {
      if (reach[(i + 1) * size + s - k * step]) {
        if (k > 0) put[String(denoms[i])] = (put[String(denoms[i])] ?? 0) + k;
        s -= k * step;
        break;
      }
    }
  }

  const preTakenCents = Object.entries(preTaken).reduce((sum, [d, k]) => sum + Number(d) * k, 0);
  return build(put, preTakenCents + best * unit);
}
