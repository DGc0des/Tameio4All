import { parseAmount, type Cents } from '../../core/money';

/** Sum of several typed batch amounts (the V2 ΚΕΡΜΑΤΑ calculator). Empty rows are ignored. */
export function sumAmounts(texts: readonly string[]): { cents: Cents; invalidIndexes: number[] } {
  let cents = 0;
  const invalidIndexes: number[] = [];
  texts.forEach((text, i) => {
    const r = parseAmount(text);
    if (r.ok) cents += r.value;
    else if (r.reason !== 'empty') invalidIndexes.push(i);
  });
  return { cents, invalidIndexes };
}
