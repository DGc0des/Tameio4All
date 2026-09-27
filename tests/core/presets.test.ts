import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/core/config';
import { evaluateTotals, type ClosingInputs } from '../../src/core/formula';
import { joinJuicePreset } from '../../src/core/presets';

describe('joinJuicePreset', () => {
  it('is a valid config', () => {
    expect(validateConfig(joinJuicePreset)).toEqual([]);
  });

  it('matches tameioV2 formulas on a full closing', () => {
    // V2 amount-mode entry: 100€:500, 50€:300, 20€:240, 10€:90, 5€:35, 2€:24, 1€:17,
    // 0.50:6.5, 0.20:3.4, 0.10:1.2, 0.05:0.45, ΚΕΡΜΑΤΑ 150, ΈΞΟΔΑ 12.50 + 7.80,
    // WOLT 45.60, EFOOD 23.10, myPos 310.25, Eurobank 88.40
    const inputs: ClosingInputs = {
      counts: {
        '10000': 5, '5000': 6, '2000': 12, '1000': 9, '500': 7,
        '200': 12, '100': 17, '50': 13, '20': 17, '10': 12, '5': 9,
      },
      channelCents: { kermata: 15000, wolt: 4560, efood: 2310, mypos: 31025, eurobank: 8840 },
      expenses: [
        { description: 'Nice', cents: 1250 },
        { description: 'Nice', cents: 780 },
      ],
    };
    expect(evaluateTotals(joinJuicePreset, inputs)).toEqual({
      tameio: 185520,
      expenses_total: 2030,
      cash: 36755,
      cash_lim: 38785,
      income_lim: 78650,
    });
  });

  it('matches tameioV2 on an empty form (ΜΕΤΡΗΤΑ −1000)', () => {
    const empty: ClosingInputs = { counts: {}, channelCents: {}, expenses: [] };
    expect(evaluateTotals(joinJuicePreset, empty)).toEqual({
      tameio: 0,
      expenses_total: 0,
      cash: -100000,
      cash_lim: -100000,
      income_lim: -100000,
    });
  });

  it('carries the V2 tare products and supplier history', () => {
    expect(joinJuicePreset.tareItems).toContainEqual({ name: 'Σολομός μπροστά', tareGrams: 360 });
    expect(joinJuicePreset.seedSuppliers['Ντόντης']).toEqual([1800, 2400]);
    expect(joinJuicePreset.seedSuppliers['Μεβγάλ']).toContain(2964);
  });
});
