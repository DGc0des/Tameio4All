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
  const day = (over: Record<string, unknown> = {}) => ({
    ok: true, today: '2026-11-11', business_date: '2026-11-10', versions: [version({ id: 'b' }), version({ id: 'a' })],
    configs: { cfg1: { a: 1 } }, staff_names: { s1: 'Μαρία' }, open: null, ...over,
  });

  it('keeps server order and maps fields', () => {
    const r = parseDayDetail(day());
    expect(r!.versions.map((v) => v.id)).toEqual(['b', 'a']);
    expect(r!.today).toBe('2026-11-11');
    expect(r!.businessDate).toBe('2026-11-10');
    expect(r!.configs).toEqual({ cfg1: { a: 1 } });
    expect(r!.staffNames).toEqual({ s1: 'Μαρία' });
    expect(r!.open).toBeNull();
  });

  it('drops a malformed version and a non-string staff name', () => {
    const r = parseDayDetail(day({ versions: [version({ id: 'b' }), version({ kind: 'x' }), 5], staff_names: { s1: 'Μαρία', s2: 7 } }));
    expect(r!.versions.map((v) => v.id)).toEqual(['b']);
    expect(r!.staffNames).toEqual({ s1: 'Μαρία' });
  });

  it('parses an open snapshot, and turns a bad one into null', () => {
    expect(parseDayDetail(day({ versions: [], open: open() }))!.open?.id).toBe('oc-1');
    expect(parseDayDetail(day({ versions: [], open: { id: '' } }))!.open).toBeNull();
  });

  it('returns null for an unexpected payload', () => {
    expect(parseDayDetail(null)).toBeNull();
    expect(parseDayDetail({ ok: true })).toBeNull();
    expect(parseDayDetail(day({ versions: 'x' }))).toBeNull();
    expect(parseDayDetail(day({ business_date: 'bad' }))).toBeNull();
  });
});
