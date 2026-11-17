import { describe, expect, it } from 'vitest';
import { plus, type ShopConfig } from '../../../../src/core/config';
import { juiceBarPreset } from '../../../../src/core/presets';
import { evaluateTotals, type ClosingInputs } from '../../../../src/core/formula';
import { planEnvelope } from '../../../../src/core/envelope';
import { deriveClosing } from '../../../../src/features/register/derive';
import { draftFromFields } from '../../../../src/features/register/live/merge';
import type { HistoryDay, HistoryList } from '../../../../src/features/owner/history/types';
import { denomKey, expenseKey, expenseMetaValue, textValue, type Snapshot } from '../../../../src/features/register/live/fields';
import {
  OFFICE_NAME, UNKNOWN_AUTHOR, applyLocalEdit, breakdown, openInputs, snapshotFromInputs, combineDay, summarizeDay, summarizeInputs, summarizeOpen, weekCells,
} from '../../../../src/features/owner/history/model';

const config = juiceBarPreset;
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
    expect(b.expenses.map((e) => e.author)).toEqual(['ΜΑΡΙΑ', OFFICE_NAME]);
    expect(OFFICE_NAME).toBe('Διαχείριση');
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
    id: 'o', businessDate: '2026-11-09', configId: 'cfg1', config: cfg, revision: 3, closingNo: 1, closingsPlanned: 1, cashMode: 'separate' as const, lastSubmit: null, fields,
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

describe('weekCells', () => {
  const MON = '2026-11-09';
  const current = { id: 'v1', kind: 'staff' as const, authorName: 'ΜΑΡΙΑ', createdAt: '2026-11-09T21:00:00Z', configId: 'cfg1', inputs: inputs2, correctsId: null };
  const submittedDay = (businessDate: string): HistoryDay => ({ businessDate, cashMode: 'separate', closingsPlanned: 1, closings: [{ closingNo: 1, status: 'submitted', current, versionCount: 1 }] });
  const open: Snapshot = { id: 'o', businessDate: '2026-11-10', configId: 'cfg1', config, revision: 1, closingNo: 1, closingsPlanned: 1, cashMode: 'separate' as const, lastSubmit: null, fields: {} };
  const unsubmittedDay = (businessDate: string): HistoryDay => ({ businessDate, cashMode: 'separate', closingsPlanned: 1, closings: [{ closingNo: 1, status: 'unsubmitted', open: { ...open, businessDate } }] });
  const listOf = (today: string, days: HistoryDay[]): HistoryList => ({ today, from: '2026-10-13', to: today, configs: {}, days });

  it('has seven cells, Monday first, dates in order', () => {
    const cells = weekCells(listOf('2026-11-11', []), MON);
    expect(cells.map((c) => c.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('classifies each day of the current week: submitted, unsubmitted, in progress, empty past, future', () => {
    const days = [submittedDay('2026-11-09'), unsubmittedDay('2026-11-10')];
    const cells = weekCells(listOf('2026-11-12', days), MON);
    expect(cells.map((c) => c.kind)).toEqual(['submitted', 'unsubmitted', 'empty', 'in_progress', 'future', 'future', 'future']);
    expect(cells[0]!.day).toBe(days[0]);
    expect(cells[1]!.day).toBe(days[1]);
    expect(cells[2]!.day).toBeUndefined();
    expect(cells[3]!.day).toBeUndefined();
  });

  it('a day with one submitted and one unsubmitted closing is submitted', () => {
    const day: HistoryDay = {
      businessDate: '2026-11-10', cashMode: 'separate', closingsPlanned: 2,
      closings: [{ closingNo: 1, status: 'submitted', current, versionCount: 1 }, { closingNo: 2, status: 'unsubmitted', open }],
    };
    expect(weekCells(listOf('2026-11-12', [day]), MON)[1]!.kind).toBe('submitted');
  });

  it('today with a submission is a submitted cell', () => {
    const cells = weekCells(listOf('2026-11-11', [submittedDay('2026-11-11')]), MON);
    expect(cells[2]!.kind).toBe('submitted');
  });

  it('a past week has no future and no in-progress cells', () => {
    const cells = weekCells(listOf('2026-11-20', [submittedDay('2026-11-12')]), MON);
    expect(cells.map((c) => c.kind)).toEqual(['empty', 'empty', 'empty', 'submitted', 'empty', 'empty', 'empty']);
  });

  it('a week entirely after today is all future', () => {
    expect(weekCells(listOf('2026-11-01', []), MON).every((c) => c.kind === 'future')).toBe(true);
  });

  it('ignores days outside the week, and an unknown Monday gives no cells', () => {
    const cells = weekCells(listOf('2026-11-20', [submittedDay('2026-11-08'), submittedDay('2026-11-16')]), MON);
    expect(cells.every((c) => c.kind === 'empty')).toBe(true);
    expect(weekCells(listOf('2026-11-20', []), 'nonsense')).toEqual([]);
  });
});

describe('combineDay and summarizeDay', () => {
  /** A small config whose ΜΕΤΡΗΤΑ is just the counted cash, so the expected sums are plain literals. */
  const cfg: ShopConfig = {
    ...juiceBarPreset, floatCents: 0, channels: [],
    totals: [
      { id: 'cash', label: 'ΜΕΤΡΗΤΑ', terms: [plus({ kind: 'counted' })], showInSummary: true, showInShare: true },
      { id: 'exp', label: 'ΕΞΟΔΑ', terms: [plus({ kind: 'expenses' })], showInSummary: true, showInShare: true },
    ],
    envelopeTotalId: 'cash',
  };
  const inp = (counts: Record<string, number>, expenseCents = 0): ClosingInputs => ({
    schema: 2, counts, channelCents: {},
    expenses: expenseCents > 0 ? [{ id: 'x', description: 'Γ', cents: expenseCents, addedBy: { kind: 'owner' } }] : [],
  });
  const res = (closingNo: number, i: ClosingInputs, configId = 'cfg1') => ({ closingNo, configId, summary: summarizeInputs(cfg, i) });
  const cash = (s: ReturnType<typeof combineDay>) => s!.totals.find((t) => t.id === 'cash')!.cents;

  it('separate of 100,00 € and 250,50 € ΜΕΤΡΗΤΑ is 350,50 €, expenses added, labels and order kept', () => {
    const a = res(1, inp({ '10000': 1 }, 200));
    const b = res(2, inp({ '10000': 2, '5000': 1, '50': 1 }, 300));
    const s = combineDay('separate', [a, b])!;
    expect(cash(s)).toBe(35050);
    expect(s.expensesCents).toBe(500);
    expect(s.totals.map((t) => [t.id, t.label])).toEqual([['cash', 'ΜΕΤΡΗΤΑ'], ['exp', 'ΕΞΟΔΑ']]);
  });

  it('running is the summary of the highest-numbered closing', () => {
    const rs = [res(1, inp({ '10000': 1 })), res(2, inp({ '10000': 2 })), res(3, inp({ '10000': 5 }))];
    expect(combineDay('running', [rs[1]!, rs[2]!, rs[0]!])).toEqual(rs[2]!.summary);
  });

  it('is null for an unreadable item, mixed configs, an unreadable last running item and an empty list', () => {
    expect(combineDay('separate', [res(1, inp({ '10000': 1 })), { closingNo: 2, configId: 'cfg1', summary: null }])).toBeNull();
    expect(combineDay('separate', [res(1, inp({ '10000': 1 })), res(2, inp({ '10000': 1 }), 'cfg2')])).toBeNull();
    expect(combineDay('running', [res(1, inp({ '10000': 1 })), { closingNo: 2, configId: 'cfg1', summary: null }])).toBeNull();
    expect(combineDay('separate', [])).toBeNull();
    expect(combineDay('running', [])).toBeNull();
  });

  const cur = (id: string, i: ClosingInputs) => ({ id, kind: 'staff' as const, authorName: 'Μ', createdAt: 't', configId: 'cfg1', inputs: i, correctsId: null });
  const openSnap = (n: number): Snapshot => ({ id: 'o', businessDate: '2026-11-10', configId: 'cfg1', config: cfg, revision: 1, closingNo: n, closingsPlanned: 3, cashMode: 'separate', lastSubmit: null, fields: {} });
  const configs = { cfg1: cfg };

  it('summarizeDay counts done/planned and sums only the submitted closings', () => {
    const day: HistoryDay = {
      businessDate: '2026-11-10', cashMode: 'separate', closingsPlanned: 3,
      closings: [
        { closingNo: 1, status: 'submitted', current: cur('a', inp({ '10000': 1 })), versionCount: 1 },
        { closingNo: 2, status: 'submitted', current: cur('b', inp({ '10000': 2 })), versionCount: 1 },
        { closingNo: 3, status: 'unsubmitted', open: openSnap(3) },
      ],
    };
    const d = summarizeDay(day, configs);
    expect([d.done, d.planned, d.hasUnsubmitted]).toEqual([2, 3, true]);
    expect(cash(d.result)).toBe(30000);
  });

  it('planned is at least the number of closings', () => {
    const day: HistoryDay = {
      businessDate: '2026-11-10', cashMode: 'separate', closingsPlanned: 3,
      closings: [1, 2, 3, 4].map((n) => ({ closingNo: n, status: 'submitted' as const, current: cur(`v${n}`, inp({ '10000': 1 })), versionCount: 1 })),
    };
    expect(summarizeDay(day, configs).planned).toBe(4);
  });

  it('a one-closing day has the result of summarizeInputs', () => {
    const day: HistoryDay = { businessDate: '2026-11-10', cashMode: 'separate', closingsPlanned: 1, closings: [{ closingNo: 1, status: 'submitted', current: cur('a', inp({ '10000': 3 }, 850)), versionCount: 1 }] };
    const d = summarizeDay(day, configs);
    expect(d.result).toEqual(summarizeInputs(cfg, inp({ '10000': 3 }, 850)));
    expect([d.done, d.planned, d.hasUnsubmitted]).toEqual([1, 1, false]);
  });

  it('an unknown config makes the result null without throwing', () => {
    const day: HistoryDay = { businessDate: '2026-11-10', cashMode: 'separate', closingsPlanned: 1, closings: [{ closingNo: 1, status: 'submitted', current: cur('a', inp({ '10000': 3 }, 850)), versionCount: 1 }] };
    expect(summarizeDay(day, {}).result).toBeNull();
  });
});
