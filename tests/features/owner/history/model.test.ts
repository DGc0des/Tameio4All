import { describe, expect, it } from 'vitest';
import { joinJuicePreset } from '../../../../src/core/presets';
import { evaluateTotals, type ClosingInputs } from '../../../../src/core/formula';
import { planEnvelope } from '../../../../src/core/envelope';
import { deriveClosing } from '../../../../src/features/register/derive';
import { draftFromFields } from '../../../../src/features/register/live/merge';
import { denomKey, expenseKey, expenseMetaValue, textValue, type Snapshot } from '../../../../src/features/register/live/fields';
import {
  OWNER_NAME, UNKNOWN_AUTHOR, applyLocalEdit, breakdown, openInputs, snapshotFromInputs, summarizeInputs, summarizeOpen,
} from '../../../../src/features/owner/history/model';

const config = joinJuicePreset;
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const inputs2: ClosingInputs = {
  schema: 2,
  counts: { '10000': 3, '500': 2 },
  channelCents: { wolt: 4550, mypos: 12000 },
  expenses: [
    { id: 'x1', description: 'Γάλα', cents: 850, addedBy: { kind: 'staff', id: S1 } },
    { id: 'x2', description: 'Πάγος', cents: 300, addedBy: { kind: 'owner' } },
  ],
};
const inputs1: ClosingInputs = { schema: 1, counts: { '10000': 1 }, channelCents: {}, expenses: [{ description: 'Κάτι', cents: 500 }] };
const snap = (inp: ClosingInputs, newId = () => 'new-1') =>
  snapshotFromInputs({ config, configId: 'cfg1', businessDate: '2026-11-09', inputs: inp, newId });

describe('summarizeInputs', () => {
  it('returns exactly the showInSummary totals in config order and the expense sum', () => {
    const s = summarizeInputs(config, inputs2)!;
    const all = evaluateTotals(config, inputs2);
    const expected = config.totals.filter((t) => t.showInSummary).map((t) => ({ id: t.id, label: t.label, cents: all[t.id] ?? 0 }));
    expect(s.totals).toEqual(expected);
    expect(s.expensesCents).toBe(1150);
  });
  it('returns null without throwing for unreadable input', () => {
    expect(summarizeInputs({}, inputs2)).toBeNull();
    expect(summarizeInputs(config, null)).toBeNull();
    expect(summarizeInputs(config, { ...inputs2, counts: { '10000': -1 } })).toBeNull();
    expect(summarizeInputs(config, { ...inputs2, expenses: [{ id: 'a', description: 'x', cents: 5 }] })).toBeNull();
  });
  it('summarizes a valid schema-1 row', () => {
    expect(summarizeInputs(config, inputs1)?.expensesCents).toBe(500);
  });
});

describe('breakdown', () => {
  it('lists counted denominations largest first, non-zero channels, and the envelope', () => {
    const b = breakdown(config, inputs2, {})!;
    expect(b.denominations).toEqual([
      { denom: 10000, count: 3, cents: 30000 },
      { denom: 500, count: 2, cents: 1000 },
    ]);
    expect(b.channels.map((c) => c.id)).toEqual(['wolt', 'mypos']);
    expect(b.totals.map((t) => t.id)).toEqual(config.totals.map((t) => t.id));
    const totals = evaluateTotals(config, inputs2);
    expect(b.envelope).toEqual(planEnvelope(totals[config.envelopeTotalId] ?? 0, inputs2.counts, config.denominations));
  });
  it('resolves authors', () => {
    const b = breakdown(config, inputs2, { [S1]: 'ΜΑΡΙΑ' })!;
    expect(b.expenses.map((e) => e.author)).toEqual(['ΜΑΡΙΑ', OWNER_NAME]);
    expect(breakdown(config, inputs2, {})!.expenses[0]!.author).toBe(UNKNOWN_AUTHOR);
    expect(breakdown(config, inputs1, {})!.expenses[0]!.author).toBe(UNKNOWN_AUTHOR);
  });
  it('returns null for unreadable input', () => {
    expect(breakdown({}, inputs2, {})).toBeNull();
    expect(breakdown(config, 5, {})).toBeNull();
  });
});

describe('snapshotFromInputs', () => {
  it('round-trips through draftFromFields and deriveClosing', () => {
    const d = deriveClosing(config, draftFromFields(snap(inputs2), []));
    expect(d.errors).toEqual([]);
    expect(d.inputs).toEqual(inputs2);
  });
  it('gives new ids to schema-1 lines and ids failing the key charset', () => {
    let n = 0;
    const s = snap(inputs1, () => `n${++n}`);
    expect((s.fields['e:n1']!.value as { addedBy: unknown }).addedBy).toEqual({ kind: 'owner' });
    const bad: ClosingInputs = { ...inputs2, expenses: [{ id: 'a b', description: 'x', cents: 100, addedBy: { kind: 'staff', id: S1 } }] };
    const s2 = snap(bad, () => 'fresh');
    expect((s2.fields['e:fresh']!.value as { addedBy: unknown }).addedBy).toEqual({ kind: 'staff', id: S1 });
    expect(s2.fields['e:a b']).toBeUndefined();
  });
  it('stores denominations as counts, revision 0, no last submit', () => {
    const s = snap(inputs2);
    expect(s.fields['d:10000']!.value).toEqual({ text: '3', mode: 'count' });
    expect(s.revision).toBe(0);
    expect(s.lastSubmit).toBeNull();
    expect(s.fields['d:10000']!.version).toBe(1);
  });
});

describe('applyLocalEdit', () => {
  it('changes the derived count', () => {
    const s = applyLocalEdit(snap(inputs2), denomKey(10000), { text: '5', mode: 'count' });
    expect(deriveClosing(config, draftFromFields(s, [])).inputs.counts['10000']).toBe(5);
    expect(s.fields['d:10000']!.version).toBe(2);
  });
  it('removing a line drops it', () => {
    const s0 = snap(inputs2);
    const meta = s0.fields[expenseKey('x1')]!.value as { addedBy: never; order: number };
    const s = applyLocalEdit(s0, expenseKey('x1'), expenseMetaValue(meta.addedBy, meta.order, true));
    expect(deriveClosing(config, draftFromFields(s, [])).inputs.expenses.map((e) => e.id)).toEqual(['x2']);
  });
  it('ignores bad keys and bad values', () => {
    const s = snap(inputs2);
    expect(applyLocalEdit(s, 'zzz', textValue('x'))).toBe(s);
    expect(applyLocalEdit(s, denomKey(10000), { nope: 1 })).toBe(s);
  });
});

describe('summarizeOpen / openInputs', () => {
  const open = (fields: Snapshot['fields'], cfg: unknown = config): Snapshot => ({
    id: 'o', businessDate: '2026-11-09', configId: 'cfg1', config: cfg, revision: 3, lastSubmit: null, fields,
  });
  it('matches the same numbers as stored inputs', () => {
    const f = { 'd:10000': { key: 'd:10000', value: { text: '300', mode: 'amount' }, version: 1, updatedByName: '', updatedAt: '' } };
    const o = open(f);
    expect(summarizeOpen(o)).toEqual(summarizeInputs(config, { schema: 2, counts: { '10000': 3 }, channelCents: {}, expenses: [] }));
    expect(openInputs(o)?.inputs.counts).toEqual({ '10000': 3 });
  });
  it('is null for an unreadable config', () => {
    expect(summarizeOpen(open({}, {}))).toBeNull();
    expect(openInputs(open({}, {}))).toBeNull();
  });
});
