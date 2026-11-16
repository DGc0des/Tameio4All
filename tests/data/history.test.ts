import { describe, expect, it } from 'vitest';
import { parseDayDetail, parseHistoryList } from '../../src/data/remote/history';

const version = (over: Record<string, unknown> = {}) => ({
  id: 'v1', kind: 'staff', author_name: 'Μαρία', created_at: '2026-11-10T20:00:00Z', config_id: 'cfg1',
  inputs: { schema: 2, anything: true }, corrects_closing_id: null, ...over,
});
const open = (over: Record<string, unknown> = {}) => ({
  id: 'oc-1', business_date: '2026-11-08', config_id: 'cfg1', config: { x: 1 }, revision: 2, last_submit: null,
  fields: [{ key: 'c:cash', value: { text: '5' }, version: 1, updated_by_name: 'Μαρία', updated_at: 't' }], ...over,
});
const list = (days: unknown[]) => ({ ok: true, today: '2026-11-11', from: '2026-10-13', to: '2026-11-11', configs: { cfg1: { a: 1 } }, days });

const sub = (no: number, over: Record<string, unknown> = {}) => ({ closing_no: no, status: 'submitted', version_count: 1, current: version(), ...over });
const unsub = (no: number, over: Record<string, unknown> = {}) => ({ closing_no: no, status: 'unsubmitted', open: open({ closing_no: no }), ...over });
const day = (closings: unknown[], over: Record<string, unknown> = {}) => ({
  business_date: '2026-11-10', cash_mode: 'separate', closings_planned: 3, closings, ...over,
});

describe('parseHistoryList', () => {
  it('maps a full payload to camelCase', () => {
    const r = parseHistoryList(list([
      day([sub(1, { version_count: 2, current: version({ kind: 'owner_correction', corrects_closing_id: 'v0' }) }), unsub(2)], { cash_mode: 'running' }),
      day([unsub(1)], { business_date: '2026-11-08', closings_planned: 1 }),
    ]));
    expect(r).not.toBeNull();
    expect(r!.today).toBe('2026-11-11');
    expect(r!.from).toBe('2026-10-13');
    expect(r!.to).toBe('2026-11-11');
    expect(r!.configs).toEqual({ cfg1: { a: 1 } });
    expect(r!.days).toHaveLength(2);
    const d0 = r!.days[0]!;
    expect(d0.businessDate).toBe('2026-11-10');
    expect(d0.cashMode).toBe('running');
    expect(d0.closingsPlanned).toBe(3);
    expect(d0.closings).toHaveLength(2);
    expect(d0.closings[0]).toEqual({
      closingNo: 1, status: 'submitted', versionCount: 2,
      current: {
        id: 'v1', kind: 'owner_correction', authorName: 'Μαρία', createdAt: '2026-11-10T20:00:00Z', configId: 'cfg1',
        inputs: { schema: 2, anything: true }, correctsId: 'v0',
      },
    });
    const c1 = d0.closings[1]!;
    expect(c1.closingNo).toBe(2);
    expect(c1.status).toBe('unsubmitted');
    if (c1.status === 'unsubmitted') {
      expect(c1.open.id).toBe('oc-1');
      expect(c1.open.fields['c:cash']?.value).toEqual({ text: '5' });
    }
  });

  it('keeps closings in closing_no order', () => {
    const r = parseHistoryList(list([day([sub(2), sub(1)])]));
    expect(r!.days[0]!.closings.map((c) => c.closingNo)).toEqual([1, 2]);
  });

  it('drops a bad entry individually while its siblings stay', () => {
    const r = parseHistoryList(list([day([
      sub(1, { current: version({ id: undefined }) }),
      sub(2, { current: version({ kind: 'weird' }) }),
      unsub(3, { open: { id: '' } }),
      sub(4, { closing_no: 7 }),
      { closing_no: 5, status: 'other' },
      null,
      sub(6),
    ])]));
    expect(r!.days[0]!.closings.map((c) => c.closingNo)).toEqual([6]);
  });

  it('drops a day with no closings or only bad ones, and a day with a bad date, mode or plan, keeping the others', () => {
    const r = parseHistoryList(list([
      day([]),
      day([null, { closing_no: 1, status: 'other' }], { business_date: '2026-11-09' }),
      day([sub(1)], { business_date: 'nope' }),
      day([sub(1)], { business_date: '2026-11-08', cash_mode: 'weird' }),
      day([sub(1)], { business_date: '2026-11-07', closings_planned: 0 }),
      day([sub(1)], { business_date: '2026-11-06', closings_planned: 7 }),
      day([sub(1)], { business_date: '2026-11-05', closings_planned: undefined }),
      day([sub(1)], { business_date: '2026-11-04', closings: 'x' }),
      null,
      day([sub(1)], { business_date: '2026-11-03' }),
    ]));
    expect(r!.days.map((d) => d.businessDate)).toEqual(['2026-11-03']);
  });

  it('returns null for an unexpected payload', () => {
    expect(parseHistoryList(null)).toBeNull();
    expect(parseHistoryList('x')).toBeNull();
    expect(parseHistoryList({ ok: true, today: '2026-11-11', from: '2026-10-13', to: '2026-11-11' })).toBeNull();
    expect(parseHistoryList({ ok: true, from: '2026-10-13', to: '2026-11-11', days: [] })).toBeNull();
    expect(parseHistoryList({ ...list([]), today: 'bad' })).toBeNull();
  });

  it('accepts an empty list', () => {
    expect(parseHistoryList(list([]))!.days).toEqual([]);
  });
});

describe('parseDayDetail', () => {
  const closing = (no: unknown, over: Record<string, unknown> = {}) => ({ closing_no: no, versions: [version({ id: 'b' }), version({ id: 'a' })], open: null, ...over });
  const day = (over: Record<string, unknown> = {}) => ({
    ok: true, today: '2026-11-11', business_date: '2026-11-10', cash_mode: 'separate', closings_planned: 2, live_closing_no: null,
    closings: [closing(1)], configs: { cfg1: { a: 1 } }, staff_names: { s1: 'Μαρία' }, ...over,
  });

  it('reads the per-closing shape, keeps version order and maps fields', () => {
    const r = parseDayDetail(day({ cash_mode: 'running', closings: [closing(2, { versions: [version({ id: 'c' })] }), closing(1)] }));
    expect(r!.today).toBe('2026-11-11');
    expect(r!.businessDate).toBe('2026-11-10');
    expect(r!.cashMode).toBe('running');
    expect(r!.closingsPlanned).toBe(2);
    expect(r!.liveClosingNo).toBeNull();
    expect(r!.closings.map((c) => c.closingNo)).toEqual([1, 2]);
    expect(r!.closings[0]!.versions.map((v) => v.id)).toEqual(['b', 'a']);
    expect(r!.closings[1]!.versions.map((v) => v.id)).toEqual(['c']);
    expect(r!.closings[0]!.open).toBeNull();
    expect(r!.configs).toEqual({ cfg1: { a: 1 } });
    expect(r!.staffNames).toEqual({ s1: 'Μαρία' });
  });

  it('reads live_closing_no as a number or null; an out-of-range one becomes null, not a rejected payload', () => {
    expect(parseDayDetail(day({ live_closing_no: 2 }))!.liveClosingNo).toBe(2);
    expect(parseDayDetail(day({ live_closing_no: null }))!.liveClosingNo).toBeNull();
    expect(parseDayDetail(day({ live_closing_no: 0 }))!.liveClosingNo).toBeNull();
    expect(parseDayDetail(day({ live_closing_no: 7 }))!.liveClosingNo).toBeNull();
  });

  it('drops a bad closing item alone', () => {
    const r = parseDayDetail(day({ closings: [closing(0), closing(7), closing('2'), 5, closing(3, { versions: 'x' }), closing(2)] }));
    expect(r!.closings.map((c) => c.closingNo)).toEqual([2]);
  });

  it('drops a bad version inside a closing alone, and a non-string staff name', () => {
    const r = parseDayDetail(day({ closings: [closing(1, { versions: [version({ id: 'b' }), version({ kind: 'x' }), 5] })], staff_names: { s1: 'Μαρία', s2: 7 } }));
    expect(r!.closings[0]!.versions.map((v) => v.id)).toEqual(['b']);
    expect(r!.staffNames).toEqual({ s1: 'Μαρία' });
  });

  it('parses an open snapshot per closing; a closing left with neither versions nor a readable open is dropped', () => {
    expect(parseDayDetail(day({ closings: [closing(1, { versions: [], open: open() })] }))!.closings[0]!.open?.id).toBe('oc-1');
    const r = parseDayDetail(day({ closings: [closing(1, { versions: [], open: { id: '' } }), closing(2, { open: { id: '' } })] }));
    expect(r!.closings.map((c) => c.closingNo)).toEqual([2]);
    expect(r!.closings[0]!.open).toBeNull();
  });

  it('accepts a day without closings', () => {
    expect(parseDayDetail(day({ closings: [] }))!.closings).toEqual([]);
  });

  it('returns null for an unexpected payload', () => {
    expect(parseDayDetail(null)).toBeNull();
    expect(parseDayDetail({ ok: true })).toBeNull();
    expect(parseDayDetail(day({ closings: 'x' }))).toBeNull();
    expect(parseDayDetail(day({ business_date: 'bad' }))).toBeNull();
    expect(parseDayDetail(day({ cash_mode: 'mixed' }))).toBeNull();
    expect(parseDayDetail(day({ closings_planned: 0 }))).toBeNull();
  });
});
