import { describe, expect, it } from 'vitest';
import {
  loadEntryMode, loadPending, loadSnapshot, saveEntryMode, savePending, saveSnapshot,
} from '../../src/data/local/openClosing';
import { memoryStore, type KeyValueStore } from '../../src/data/local/storage';
import type { PendingEdit, Snapshot } from '../../src/features/register/live/fields';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};
const K = (n: string) => `tameio4all:v1:shop-1:${n}`;
const edit = (over: Partial<PendingEdit> = {}): PendingEdit => ({
  author: 'staff-maria', key: 'c:wolt', value: { text: '5' }, businessDate: '2026-11-07', baseVersion: 2, queuedOffline: false, seq: 1, ...over,
});
const snap: Snapshot = {
  id: 'oc1', businessDate: '2026-11-07', configId: 'cfg', config: { schema: 1 }, revision: 3,
  lastSubmit: { closingId: 'x', staffName: 'ΜΑΡΙΑ', at: '2026-11-07T10:00:00Z' },
  fields: { 'c:wolt': { key: 'c:wolt', value: { text: '5' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T10:00:00Z' } },
};

describe('pending queue', () => {
  it('round-trips under its key', () => {
    const s = memoryStore();
    expect(loadPending(s, 'shop-1')).toEqual([]);
    const list = [edit(), edit({ key: 'd:100', value: { text: '1', mode: 'count' }, baseVersion: null, queuedOffline: true, seq: 2 })];
    expect(savePending(s, 'shop-1', 'staff-maria', list)).toBe(true);
    expect(s.getItem(K('pending'))).not.toBeNull();
    expect(loadPending(s, 'shop-1')).toEqual(list);
    expect(loadPending(s, 'shop-1', 'staff-maria')).toEqual(list);
    expect(loadPending(s, 'shop-1', 'staff-nikos')).toEqual([]);
    expect(loadPending(s, 'shop-2')).toEqual([]);
  });
  it('is per author: saving one person\'s items keeps everyone else\'s (I1)', () => {
    const s = memoryStore();
    const maria = edit({ seq: 1 });
    const nikos = edit({ author: 'staff-nikos', value: { text: '7' }, seq: 2 });
    const owner = edit({ author: 'owner', key: 'c:efood', seq: 3 });
    savePending(s, 'shop-1', 'staff-maria', [maria]);
    savePending(s, 'shop-1', 'staff-nikos', [nikos]);
    savePending(s, 'shop-1', 'owner', [owner]);
    expect(loadPending(s, 'shop-1', 'staff-maria')).toEqual([maria]);
    expect(loadPending(s, 'shop-1', 'staff-nikos')).toEqual([nikos]);
    expect(loadPending(s, 'shop-1', 'owner')).toEqual([owner]);
    // Μαρία's queue drains: only hers goes
    savePending(s, 'shop-1', 'staff-maria', []);
    expect(loadPending(s, 'shop-1').map((p) => p.author).sort()).toEqual(['owner', 'staff-nikos']);
  });
  it('drops other authors\' items of a day before the current one (they can never be sent)', () => {
    const s = memoryStore();
    const old = edit({ author: 'staff-nikos', businessDate: '2026-11-06' });
    const today = edit({ author: 'staff-nikos', businessDate: '2026-11-07', seq: 2 });
    const tomorrow = edit({ author: 'owner', businessDate: '2026-11-08', seq: 3 });
    savePending(s, 'shop-1', 'staff-nikos', [old, today]);
    savePending(s, 'shop-1', 'owner', [tomorrow]);
    savePending(s, 'shop-1', 'staff-maria', [], '2026-11-07');
    expect(loadPending(s, 'shop-1')).toEqual([today, tomorrow]);
  });
  it('an item stored without an author (before the queue was author-tagged) is dropped, never sent', () => {
    const s = memoryStore();
    const { author: _a, ...untagged } = edit();
    s.setItem(K('pending'), JSON.stringify([untagged, edit({ seq: 4 }), { ...edit(), author: '' }, { ...edit(), author: 5 }]));
    expect(loadPending(s, 'shop-1')).toEqual([edit({ seq: 4 })]);
  });
  it('corrupt or non-array -> []', () => {
    const s = memoryStore();
    s.setItem(K('pending'), '{nope');
    expect(loadPending(s, 'shop-1')).toEqual([]);
    s.setItem(K('pending'), '{"a":1}');
    expect(loadPending(s, 'shop-1')).toEqual([]);
  });
  it('drops only the malformed items, keeping the good ones', () => {
    const s = memoryStore();
    const bad: unknown[] = [
      edit({ key: 'bad key' }), edit({ key: 'd:0100' }), { ...edit(), businessDate: 5 }, { ...edit(), baseVersion: '1' },
      { ...edit(), queuedOffline: 'y' }, { ...edit(), seq: 'a' }, { ...edit(), seq: Number.NaN }, null, 7,
      { ...edit(), value: { text: 'x', extra: 1 } },
    ];
    s.setItem(K('pending'), JSON.stringify([bad[0], edit({ seq: 9 }), ...bad.slice(1)]));
    expect(loadPending(s, 'shop-1')).toEqual([edit({ seq: 9 })]);
  });
  it('failure-safe with a throwing store', () => {
    expect(loadPending(throwing, 'shop-1')).toEqual([]);
    expect(savePending(throwing, 'shop-1', 'staff-maria', [edit()])).toBe(false);
  });
});

describe('snapshot cache', () => {
  it('round-trips', () => {
    const s = memoryStore();
    expect(loadSnapshot(s, 'shop-1')).toBeNull();
    expect(saveSnapshot(s, 'shop-1', snap)).toBe(true);
    expect(s.getItem(K('snapshot'))).not.toBeNull();
    expect(loadSnapshot(s, 'shop-1')).toEqual(snap);
    expect(saveSnapshot(s, 'shop-1', { ...snap, lastSubmit: null })).toBe(true);
    expect(loadSnapshot(s, 'shop-1')?.lastSubmit).toBeNull();
  });
  it('any malformed part -> null', () => {
    const s = memoryStore();
    const put = (v: unknown) => s.setItem(K('snapshot'), typeof v === 'string' ? v : JSON.stringify(v));
    put('{nope'); expect(loadSnapshot(s, 'shop-1')).toBeNull();
    put([]); expect(loadSnapshot(s, 'shop-1')).toBeNull();
    for (const v of [
      { ...snap, id: 1 }, { ...snap, businessDate: undefined }, { ...snap, configId: null }, { ...snap, revision: '3' },
      { ...snap, lastSubmit: { closingId: 'x' } }, { ...snap, lastSubmit: undefined }, { ...snap, fields: [] }, { ...snap, fields: null },
      { ...snap, fields: { 'bad key': snap.fields['c:wolt'] } },
      { ...snap, fields: { 'c:wolt': { ...snap.fields['c:wolt'], version: 'x' } } },
      { ...snap, fields: { 'c:wolt': { ...snap.fields['c:wolt'], key: 'c:other' } } },
      { ...snap, fields: { 'c:wolt': { ...snap.fields['c:wolt'], value: { text: 1 } } } },
      { ...snap, fields: { 'c:wolt': { ...snap.fields['c:wolt'], updatedByName: 3 } } },
    ]) {
      put(v);
      expect(loadSnapshot(s, 'shop-1'), JSON.stringify(v)).toBeNull();
    }
  });
  it('failure-safe with a throwing store', () => {
    expect(loadSnapshot(throwing, 'shop-1')).toBeNull();
    expect(saveSnapshot(throwing, 'shop-1', snap)).toBe(false);
  });
});

describe('entry mode', () => {
  it('defaults to amount, round-trips, ignores junk', () => {
    const s = memoryStore();
    expect(loadEntryMode(s, 'shop-1')).toBe('amount');
    expect(saveEntryMode(s, 'shop-1', 'count')).toBe(true);
    expect(s.getItem(K('entryMode'))).not.toBeNull();
    expect(loadEntryMode(s, 'shop-1')).toBe('count');
    expect(loadEntryMode(s, 'shop-2')).toBe('amount');
    s.setItem(K('entryMode'), '"bogus"');
    expect(loadEntryMode(s, 'shop-1')).toBe('amount');
    s.setItem(K('entryMode'), '{x');
    expect(loadEntryMode(s, 'shop-1')).toBe('amount');
  });
  it('failure-safe with a throwing store', () => {
    expect(loadEntryMode(throwing, 'shop-1')).toBe('amount');
    expect(saveEntryMode(throwing, 'shop-1', 'count')).toBe(false);
  });
});
