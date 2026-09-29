import { describe, expect, it } from 'vitest';
import { minus, newShopConfig, plus, validateConfig, type ShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { applySettings, isEditableConfig, nextId, type SettingsAction } from '../../../src/features/owner/model/settingsDraft';
import { formulaText, termLabel, termOptions } from '../../../src/features/owner/model/terms';

const jj = (): ShopConfig => structuredClone(joinJuicePreset) as ShopConfig;
const apply = (c: ShopConfig, ...actions: SettingsAction[]) =>
  actions.reduce((acc, a) => applySettings(acc, a).config, c);

describe('applySettings', () => {
  it('edits general settings and keeps denominations in EUR order', () => {
    let c = apply(newShopConfig(), { type: 'setFloat', cents: 50000 }, { type: 'setMaxExpenses', value: 12 });
    expect(c.floatCents).toBe(50000);
    expect(c.maxExpenses).toBe(12);
    c = apply(c, { type: 'toggleDenomination', cents: 20000 });
    expect(c.denominations[0]).toBe(20000);
    c = apply(c, { type: 'toggleDenomination', cents: 20000 });
    expect(c.denominations.includes(20000)).toBe(false);
    expect(validateConfig(c)).toEqual([]);
  });

  it('adds channels with fresh ids and renames/retypes them', () => {
    let c = apply(newShopConfig(), { type: 'addChannel', label: 'WOLT', channelType: 'delivery' }, { type: 'addChannel', label: 'POS', channelType: 'card' });
    expect(c.channels.map((ch) => ch.id)).toEqual(['ch_1', 'ch_2']);
    c = apply(c, { type: 'renameChannel', id: 'ch_2', label: 'myPos' }, { type: 'setChannelType', id: 'ch_2', channelType: 'noncash_other' });
    expect(c.channels[1]).toEqual({ id: 'ch_2', label: 'myPos', type: 'noncash_other' });
    expect(validateConfig(c)).toEqual([]);
  });

  it('refuses to remove a channel a total refers to, naming that total', () => {
    const c = apply(jj(), { type: 'addTotal', label: 'WOLT ΜΟΝΟ' });
    const withTerm = apply(c, { type: 'addTerm', totalId: 't_1', term: plus({ kind: 'channel', id: 'wolt' }) });
    const r = applySettings(withTerm, { type: 'removeChannel', id: 'wolt' });
    expect(r.blockedBy).toEqual(['WOLT ΜΟΝΟ']);
    expect(r.config).toBe(withTerm);
    expect(applySettings(jj(), { type: 'removeChannel', id: 'wolt' }).blockedBy).toEqual([]);
  });

  it('refuses to remove a total used by another total or by Φάκελος', () => {
    expect(applySettings(jj(), { type: 'removeTotal', id: 'tameio' }).blockedBy).toEqual(['ΜΕΤΡΗΤΑ']);
    expect(applySettings(jj(), { type: 'removeTotal', id: 'cash' }).blockedBy).toEqual(['ΜΕΤΡΗΤΑ LIM', 'ΕΣΟΔΑ LIM', 'Φάκελος']);
    const r = applySettings(jj(), { type: 'removeTotal', id: 'income_lim' });
    expect(r.blockedBy).toEqual([]);
    expect(r.config.totals.some((t) => t.id === 'income_lim')).toBe(false);
  });

  it('edits terms: add, flip, remove; flags; reorder', () => {
    let c = apply(newShopConfig(), { type: 'addTotal', label: 'ΤΕΣΤ' });
    c = apply(c, { type: 'addTerm', totalId: 't_1', term: plus({ kind: 'counted' }) }, { type: 'addTerm', totalId: 't_1', term: minus({ kind: 'float' }) });
    c = apply(c, { type: 'flipTerm', totalId: 't_1', index: 1 });
    expect(c.totals.find((t) => t.id === 't_1')?.terms).toEqual([plus({ kind: 'counted' }), plus({ kind: 'float' })]);
    c = apply(c, { type: 'removeTerm', totalId: 't_1', index: 0 }, { type: 'setTotalFlag', id: 't_1', flag: 'showInShare', value: false });
    const t = c.totals.find((x) => x.id === 't_1');
    expect(t?.terms).toEqual([plus({ kind: 'float' })]);
    expect(t?.showInShare).toBe(false);
    c = apply(c, { type: 'moveTotal', id: 't_1', delta: -1 });
    expect(c.totals.map((x) => x.id)).toEqual(['tameio', 'expenses_total', 't_1', 'cash']);
    expect(apply(c, { type: 'moveTotal', id: 'tameio', delta: -1 })).toEqual(c);
  });

  it('edits tare items; out-of-range indexes change nothing', () => {
    let c = apply(newShopConfig(), { type: 'addTare', name: 'Σολομός', tareGrams: 360 });
    c = apply(c, { type: 'updateTare', index: 0, tareGrams: 260 }, { type: 'updateTare', index: 5, name: 'x' });
    expect(c.tareItems).toEqual([{ name: 'Σολομός', tareGrams: 260 }]);
    expect(apply(c, { type: 'removeTare', index: 0 }).tareItems).toEqual([]);
  });

  it('does not mutate the input config', () => {
    const c = newShopConfig();
    const before = structuredClone(c);
    apply(c, { type: 'addChannel', label: 'X', channelType: 'card' }, { type: 'setFloat', cents: 1 });
    expect(c).toEqual(before);
  });
});

describe('nextId / isEditableConfig', () => {
  it('picks the smallest free id', () => {
    expect(nextId('ch', new Set(['ch_1', 'ch_3']))).toBe('ch_2');
  });

  it('accepts content errors but not structural ones', () => {
    const emptyLabel = { ...newShopConfig(), channels: [{ id: 'ch_1', label: '', type: 'card' }] };
    expect(isEditableConfig(emptyLabel)).toBe(true);
    expect(isEditableConfig({ schema: 1 })).toBe(false);
    expect(isEditableConfig(null)).toBe(false);
  });
});

describe('terms', () => {
  it('labels refs in Greek and lists options without the total itself', () => {
    const c = jj();
    expect(termLabel(c, { kind: 'channel', id: 'wolt' })).toBe('WOLT');
    expect(termLabel(c, { kind: 'type', type: 'card' })).toBe('Όλες οι κάρτες');
    expect(termLabel(c, { kind: 'total', id: 'nope' })).toBe('(δεν υπάρχει)');
    const keys = termOptions(c, 'cash').map((o) => o.key);
    expect(keys).toContain('counted');
    expect(keys).toContain('channel:wolt');
    expect(keys).toContain('total:tameio');
    expect(keys).not.toContain('total:cash');
  });

  it('writes a formula line', () => {
    const c = jj();
    const cash = c.totals.find((t) => t.id === 'cash');
    if (!cash) throw new Error('preset has cash');
    expect(formulaText(c, cash)).toBe('ΤΑΜΕΙΟ − Αρχικό ταμείο − Έξοδα − Όλες οι κάρτες − Όλα τα delivery − Όλα τα άλλα μη μετρητά');
  });
});
