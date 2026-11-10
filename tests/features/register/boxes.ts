import type { EntryMode } from '../../../src/core/denominations';
import type { BoxText } from '../../../src/features/register/draft';

/** Test helper: plain texts per denomination → boxes typed in one mode. */
export function boxes(texts: Record<string, string>, mode: EntryMode = 'amount'): Record<string, BoxText> {
  return Object.fromEntries(Object.entries(texts).map(([k, text]) => [k, { text, mode }]));
}
