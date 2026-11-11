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

describe('parseHistoryList', () => {
  it('maps a full payload to camelCase', () => {
    const r = parseHistoryList(list([
      { business_date: '2026-11-10', status: 'submitted', version_count: 2, current: version({ kind: 'owner_correction', corrects_closing_id: 'v0' }) },
      { business_date: '2026-11-08', status: 'unsubmitted', open: open() },
    ]));
    expect(r).not.toBeNull();
    expect(r!.today).toBe('2026-11-11');
    expect(r!.from).toBe('2026-10-13');
    expect(r!.to).toBe('2026-11-11');
    expect(r!.configs).toEqual({ cfg1: { a: 1 } });
    expect(r!.days).toHaveLength(2);
    expect(r!.days[0]).toEqual({
      status: 'submitted', businessDate: '2026-11-10', versionCount: 2,
      current: {
        id: 'v1', kind: 'owner_correction', authorName: 'Μαρία', createdAt: '2026-11-10T20:00:00Z', configId: 'cfg1',
        inputs: { schema: 2, anything: true }, correctsId: 'v0',
      },
    });
    const d1 = r!.days[1]!;
    expect(d1.status).toBe('unsubmitted');
    if (d1.status === 'unsubmitted') {
      expect(d1.businessDate).toBe('2026-11-08');
      expect(d1.open.id).toBe('oc-1');
      expect(d1.open.fields['c:cash']?.value).toEqual({ text: '5' });
    }
  });

  it('drops a malformed day individually', () => {
    const good = { business_date: '2026-11-10', status: 'submitted', version_count: 1, current: version() };
    const r = parseHistoryList(list([
      { ...good, current: version({ id: undefined }) },
      { ...good, current: version({ kind: 'weird' }) },
      { business_date: '2026-11-08', status: 'unsubmitted', open: { id: '' } },
      { business_date: 'nope', status: 'submitted', version_count: 1, current: version() },
      { business_date: '2026-11-09', status: 'other' },
      null,
      good,
    ]));
    expect(r!.days).toHaveLength(1);
    expect(r!.days[0]!.businessDate).toBe('2026-11-10');
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
