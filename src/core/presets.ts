import { defaultTotals, plus, type ShopConfig } from './config';
import { EUR_DENOMINATIONS } from './denominations';

/** Recursively freezes an object/array so shared presets can't be mutated by a consumer. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Join Juice Bars, Thessaloniki — reproduces tameioV2 exactly. First real shop and parity test. */
export const joinJuicePreset: ShopConfig = deepFreeze({
  schema: 1,
  floatCents: 100000,
  denominations: EUR_DENOMINATIONS.filter((d) => d <= 10000),
  channels: [
    { id: 'kermata', label: 'ΚΕΡΜΑΤΑ', type: 'cash_extra' },
    { id: 'wolt', label: 'WOLT', type: 'delivery' },
    { id: 'efood', label: 'EFOOD', type: 'delivery' },
    { id: 'mypos', label: 'myPos', type: 'card' },
    { id: 'eurobank', label: 'Eurobank', type: 'card' },
  ],
  totals: [
    ...defaultTotals(),
    {
      id: 'cash_lim',
      label: 'ΜΕΤΡΗΤΑ LIM',
      terms: [plus({ kind: 'total', id: 'cash' }), plus({ kind: 'expenses' })],
      showInSummary: true,
      showInShare: false,
    },
    {
      id: 'income_lim',
      label: 'ΕΣΟΔΑ LIM',
      terms: [
        plus({ kind: 'total', id: 'cash' }),
        plus({ kind: 'expenses' }),
        plus({ kind: 'type', type: 'card' }),
      ],
      showInSummary: true,
      showInShare: false,
    },
  ],
  envelopeTotalId: 'cash',
  maxExpenses: 10,
  tareItems: [
    { name: 'Σολομός μπροστά', tareGrams: 360 },
    { name: 'Σολομός πίσω', tareGrams: 260 },
    { name: 'Μους Αβοκάντο / Dressing', tareGrams: 88 },
    { name: 'Pesto (χωρίς καπάκι)', tareGrams: 226 },
    { name: 'Κοτόπουλο', tareGrams: 500 },
  ],
});
