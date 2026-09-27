import { defaultTotals, plus, type ShopConfig } from './config';
import { EUR_DENOMINATIONS } from './denominations';
import type { Cents } from './money';

// Converts the euro literals copied from tameioV2 once, at load time.
const euros = (values: number[]): Cents[] => values.map((v) => Math.round(v * 100));

/** Join Juice Bars, Thessaloniki — reproduces tameioV2 exactly. First real shop and parity test. */
export const joinJuicePreset: ShopConfig = {
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
  seedSuppliers: {
    'ΛΑ': euros([6, 6, 5.9, 3.45, 9.5, 16, 8.5, 12, 4, 2.8, 12.5, 7.4, 8.4, 5.6, 6.5, 6.3, 5.5, 10.3, 7.7, 0.5, 3.9, 4.5, 11, 5.4, 28.6, 6.4, 3.6, 8.5, 3.8, 13.7, 7.9, 8.5, 5.5]),
    'Nice': euros([13, 13, 5.2, 7.8, 13, 10.4, 5.2, 15.6, 5.2, 10.4, 5.2, 5.2, 7.8, 10.4, 5.2, 5.2, 7.8, 7.8, 7.8, 10.4, 10.4, 10.4, 10.4, 10.4, 10.4, 10.4, 10.4, 5.2]),
    'Μεβγάλ': euros([60.9, 13.3, 13.5, 33.9, 21.6, 21.6, 15.6, 29.64, 31.75, 27, 15.6, 17.75, 29.65, 20.2, 39.35, 21.6, 20.4, 13.5, 21.6, 23.7, 29.65]),
    'Τσακίρης': euros([23.4, 23, 21.2, 28.6, 22, 14.7, 28.55, 12.25, 14.7, 15.07, 26.75, 18.6, 21.2, 28.1]),
    'Αμπατζής': euros([59.4, 44.6, 45, 29.7, 45, 44.6, 50, 60]),
    'Μενεξόπουλος': euros([31.3, 49.7, 59.5, 25.8, 59.3, 73.5, 45, 44.9, 52.9]),
    'Ροδούλα': euros([75.31, 73.75]),
    'Μάνος νες': euros([72]),
    'Foodwise': euros([57, 52, 52]),
    'Xtreme': euros([177, 129.74, 90, 159.7]),
    'Ψυκτικός': euros([150, 80]),
    'Μασούτης': euros([7.6, 6.27, 6.88, 6]),
    'Ντόντης': euros([18, 24]),
    'Σιδηρόπουλος': euros([56.4]),
    'Εν Καρπώ': euros([19.8, 7.3, 2.5]),
    'Ιανός': euros([3.4, 2.2]),
    'Super Market': euros([5.3, 4.25, 4.75]),
    'Netways': euros([48.36]),
    'Πολίτης-Δασκαλάκη': euros([24]),
    'Xcopy': euros([1, 0.5]),
    'Βιβλιοπωλείο': euros([1.5]),
    'Vicko': euros([7.7]),
    'Public': euros([1.7]),
    'Απεντόμωση': euros([64]),
    'Ανδρουλάκης': euros([64]),
    'Ακυρωμένη Efood': euros([12.65, 7, 5.15]),
    'Mega light': euros([37.2]),
    'Γράσο πορτοκαλιού': euros([6]),
  },
};
