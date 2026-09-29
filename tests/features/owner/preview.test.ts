import { describe, expect, it } from 'vitest';
import { newShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { previewTotals } from '../../../src/features/owner/model/preview';

describe('previewTotals', () => {
  it('evaluates the configured totals on sample amounts', () => {
    const r = previewTotals(joinJuicePreset, { counted: '1500', expenses: '20,30', channels: { mypos: '310.25', wolt: '' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = Object.fromEntries(r.totals.map((t) => [t.id, t.cents]));
    expect(byId.tameio).toBe(150000 + 31025 + 2030);
    expect(byId.cash).toBe(150000 + 31025 + 2030 - 100000 - 2030 - 31025);
    expect(r.totals[0]?.label).toBe('ΤΑΜΕΙΟ');
  });

  it('reports unusable sample fields instead of guessing', () => {
    expect(previewTotals(joinJuicePreset, { counted: '10.02', expenses: 'x', channels: { wolt: '-5' } }))
      .toEqual({ ok: false, reason: 'bad_sample', fields: ['counted', 'wolt', 'expenses'] });
  });

  it('needs expenses allowed when an expense amount is given', () => {
    const c = { ...newShopConfig(), maxExpenses: 0 };
    expect(previewTotals(c, { counted: '', expenses: '5', channels: {} })).toEqual({ ok: false, reason: 'bad_sample', fields: ['expenses'] });
  });

  it('says the config is invalid rather than throwing', () => {
    const broken = { ...newShopConfig(), envelopeTotalId: 'nope' };
    expect(previewTotals(broken, { counted: '', expenses: '', channels: {} })).toEqual({ ok: false, reason: 'invalid_config' });
  });

  it('empty samples evaluate as zero', () => {
    const r = previewTotals(newShopConfig(), { counted: '', expenses: '', channels: {} });
    expect(r.ok && r.totals.every((t) => t.cents === 0)).toBe(true);
  });
});
