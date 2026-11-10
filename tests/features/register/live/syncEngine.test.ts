// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../../../src/core/presets';
import { loadPending, loadSnapshot, savePending, saveSnapshot } from '../../../../src/data/local/openClosing';
import { memoryStore, type KeyValueStore } from '../../../../src/data/local/storage';
import type { DResult, DeviceError } from '../../../../src/data/remote/deviceApi';
import type { LiveHandlers } from '../../../../src/data/remote/live';
import type { FieldAck, PendingEdit, ServerField, Snapshot } from '../../../../src/features/register/live/fields';
import { SIGN_OUT_DRAIN_MS, WRITE_DEBOUNCE_MS, WRONG_DAY_NOTICE, type Writer } from '../../../../src/features/register/live/syncEngine';
import { useLiveClosing } from '../../../../src/features/register/live/useLiveClosing';
import { fakeLive, type FakeLive } from '../../phone/fakeDeviceApi';

const SHOP = 'shop-1';
const DAY = '2026-11-07';
const ME = { name: 'ΜΑΡΙΑ', id: 'staff-maria' };
const NOW = () => new Date('2026-11-07T10:00:00Z');

const field = (key: string, text: string, version: number, by = 'ΝΙΚΟΣ'): ServerField => ({
  key, value: { text }, version, updatedByName: by, updatedAt: '2026-11-07T09:00:00Z',
});
function snap(fields: ServerField[] = [], over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'oc-1', businessDate: DAY, configId: 'config-1', config: joinJuicePreset, revision: 1, lastSubmit: null,
    fields: Object.fromEntries(fields.map((f) => [f.key, f])), ...over,
  };
}

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const okR = <T,>(data: T): DResult<T> => ({ ok: true, data });
const failR = <T,>(error: DeviceError): DResult<T> => ({ ok: false, error });

/** A fake server: load returns `server`; write acks with the next version of the key (unless overridden). */
function fakeWriter(initial: Snapshot) {
  const state = { server: initial };
  const channels: FakeLive[] = [];
  const writer = {
    load: vi.fn((): Promise<DResult<Snapshot>> => Promise.resolve(okR(state.server))),
    write: vi.fn((e: PendingEdit): Promise<DResult<FieldAck>> => {
      const cur = state.server.fields[e.key];
      if (e.baseVersion !== null && e.baseVersion !== (cur?.version ?? 0)) {
        return Promise.resolve(failR({ code: 'stale', current: { key: e.key, value: cur?.value ?? null, version: cur?.version ?? 0, updatedByName: cur?.updatedByName ?? '', updatedAt: '' } }));
      }
      const version = (state.server.fields[e.key]?.version ?? 0) + 1;
      const revision = state.server.revision + 1;
      state.server = {
        ...state.server, revision,
        fields: { ...state.server.fields, [e.key]: { key: e.key, value: e.value, version, updatedByName: ME.name, updatedAt: '' } },
      };
      return Promise.resolve(okR({ version, revision }));
    }),
    live: vi.fn((h: LiveHandlers) => {
      const c = fakeLive(h);
      channels.push(c);
      return c;
    }),
  } satisfies Writer;
  return { writer, state, channels, get ch(): FakeLive { return channels[channels.length - 1]!; } };
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

async function mount(server: Snapshot, opts: { store?: KeyValueStore; strict?: boolean; goLive?: boolean } = {}) {
  const store = opts.store ?? memoryStore();
  const fw = fakeWriter(server);
  const onFatal = vi.fn();
  const hook = renderHook(() => useLiveClosing(fw.writer, store, SHOP, ME, NOW, { onFatal }), { reactStrictMode: opts.strict ?? false });
  await settle();
  if (opts.goLive ?? true) {
    act(() => fw.ch.emitStatus('live'));
    await settle();
  }
  return { ...fw, store, onFatal, hook, get r() { return hook.result.current; } };
}
const wolt = (r: { draft: { channels: Record<string, string> } | null }) => r.draft?.channels.wolt;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useLiveClosing — debounce and flush', () => {
  it('coalesces typing in one box into one write after 400 ms, persisting every keystroke immediately', async () => {
    const t = await mount(snap());
    act(() => t.r.edit('c:wolt', { text: '1' }));
    act(() => { vi.advanceTimersByTime(100); t.r.edit('c:wolt', { text: '12' }); });
    act(() => { vi.advanceTimersByTime(100); t.r.edit('c:wolt', { text: '123' }); });
    expect(wolt(t.r)).toBe('123');
    expect(loadPending(t.store, SHOP).map((p) => p.value)).toEqual([{ text: '123' }]);
    act(() => { vi.advanceTimersByTime(WRITE_DEBOUNCE_MS - 1); });
    expect(t.writer.write).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.writer.write.mock.calls[0]![0]).toMatchObject({ key: 'c:wolt', value: { text: '123' }, businessDate: DAY, baseVersion: null, queuedOffline: false });
    expect(t.r.state.pending).toEqual([]);
    expect(t.r.state.snapshot?.fields['c:wolt']).toMatchObject({ value: { text: '123' }, version: 1, updatedByName: ME.name });
    expect(t.r.state.snapshot?.revision).toBe(2);
    expect(loadSnapshot(t.store, SHOP)?.fields['c:wolt']?.version).toBe(1);
  });

  it('each box debounces on its own; flush(key) sends that box at once (blur)', async () => {
    const t = await mount(snap());
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.edit('c:efood', { text: '2' }); });
    act(() => t.r.flush('c:efood'));
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.writer.write.mock.calls[0]![0].key).toBe('c:efood');
    act(() => t.r.flush());
    await settle();
    expect(t.writer.write.mock.calls.map((c) => c[0].key)).toEqual(['c:efood', 'c:wolt']);
  });
});

describe('Review Focus 1 — same box typed on two clients', () => {
  it('local pending text wins over a broadcast until ack; then a later server version wins; older broadcasts are ignored', async () => {
    const t = await mount(snap([field('c:wolt', '0', 1)]));
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);

    act(() => t.r.edit('c:wolt', { text: '5' }));
    // A broadcast while the edit is still debouncing: local text stays.
    act(() => t.ch.emitField({ ...field('c:wolt', '9', 2), revision: 2, businessDate: DAY }));
    expect(wolt(t.r)).toBe('5');
    act(() => t.r.flush('c:wolt'));
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    // ...and while it is in flight.
    act(() => t.ch.emitField({ ...field('c:wolt', '8', 3), revision: 3, businessDate: DAY }));
    expect(wolt(t.r)).toBe('5');

    await act(async () => { ack.resolve(okR({ version: 4, revision: 4 })); });
    await settle();
    expect(t.r.state.pending).toEqual([]);
    expect(wolt(t.r)).toBe('5');
    expect(t.r.state.snapshot?.fields['c:wolt']).toMatchObject({ version: 4, updatedByName: ME.name });

    // Older than the snapshot: ignored, no flip-flop.
    act(() => t.ch.emitField({ ...field('c:wolt', '8', 3), revision: 3, businessDate: DAY }));
    expect(wolt(t.r)).toBe('5');
    // Newer from another phone: wins.
    act(() => t.ch.emitField({ ...field('c:wolt', '7', 5), revision: 5, businessDate: DAY }));
    expect(wolt(t.r)).toBe('7');
    expect(t.r.state.snapshot?.revision).toBe(5);
  });

  it('when the other write reached the server last, the ack does not overwrite it: both end on the server value', async () => {
    const t = await mount(snap([field('c:wolt', '0', 1)]));
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);
    act(() => { t.r.edit('c:wolt', { text: '5' }); t.r.flush('c:wolt'); });
    await settle();
    // Ours landed as v2 (rev 2), the other phone's as v3 (rev 3) — its broadcast arrives before our ack.
    t.state.server = snap([field('c:wolt', '9', 3)], { revision: 3 });
    const loads = t.writer.load.mock.calls.length;
    act(() => t.ch.emitField({ ...field('c:wolt', '9', 3), revision: 3, businessDate: DAY }));
    // rev 3 while at 1 is a gap (rev 2 not seen yet): field applied, revision kept, resync asked.
    expect(t.r.state.snapshot?.revision).toBe(1);
    await act(async () => { ack.resolve(okR({ version: 2, revision: 2 })); });
    await settle();
    expect(wolt(t.r)).toBe('9');
    expect(t.r.state.snapshot?.fields['c:wolt']?.version).toBe(3);
    expect(t.writer.load.mock.calls.length).toBeGreaterThan(loads);
    expect(t.r.state.snapshot?.revision).toBe(3);
  });
});

describe('Review Focus 2 — offline edit to a box someone else changed', () => {
  it('queues with baseVersion, then stale → server value shown and the notice names the person', async () => {
    const t = await mount(snap([field('c:wolt', '10', 1)]));
    act(() => t.ch.emitStatus('offline'));
    expect(t.r.state.status).toBe('offline');
    act(() => { t.r.edit('c:wolt', { text: '20' }); t.r.edit('c:efood', { text: '3' }); });
    act(() => t.r.flush());
    await settle();
    expect(t.writer.write).not.toHaveBeenCalled();
    expect(t.r.state.pending.map((p) => [p.key, p.baseVersion, p.queuedOffline])).toEqual([
      ['c:wolt', 1, true],
      ['c:efood', 0, true], // a key missing on the server is version 0 (write_closing_field)
    ]);

    // Meanwhile ΝΙΚΟΣ changed WOLT.
    const nikos = field('c:wolt', '30', 2);
    t.state.server = snap([nikos], { revision: 2 });
    t.writer.write.mockImplementationOnce(() => Promise.resolve(failR({ code: 'stale', current: { ...nikos, updatedAt: '' } })));
    act(() => t.ch.emitStatus('live'));
    await settle();
    await settle();

    expect(t.writer.write.mock.calls[0]![0]).toMatchObject({ key: 'c:wolt', baseVersion: 1, queuedOffline: true });
    expect(wolt(t.r)).toBe('30');
    expect(t.r.state.notice).toBe('Το πεδίο WOLT άλλαξε από ΝΙΚΟΣ');
    expect(t.r.state.pending).toEqual([]); // efood (unchanged on the server) was then accepted
    expect(t.r.draft?.channels.efood).toBe('3');
  });
});

describe('wrong day', () => {
  it('wrong_day drops every queued edit of that date, shows the notice and resyncs', async () => {
    const t = await mount(snap());
    act(() => t.ch.emitStatus('offline'));
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.edit('c:efood', { text: '2' }); t.r.flush(); });
    t.writer.write.mockImplementationOnce(() => Promise.resolve(failR({ code: 'wrong_day' })));
    // The reconnect load still sees the old day; the day changes before the write lands.
    t.writer.load.mockImplementationOnce(() => Promise.resolve(okR(snap())));
    t.state.server = snap([], { id: 'oc-2', businessDate: '2026-11-08' });
    const loadsBefore = t.writer.load.mock.calls.length;
    act(() => t.ch.emitStatus('live'));
    await settle();
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.r.state.pending).toEqual([]);
    expect(t.r.state.notice).toBe(WRONG_DAY_NOTICE);
    expect(WRONG_DAY_NOTICE).toBe('Η ημέρα άλλαξε — οι αλλαγές εκτός σύνδεσης δεν αποθηκεύτηκαν');
    expect(t.writer.load.mock.calls.length).toBeGreaterThanOrEqual(loadsBefore + 2);
    expect(t.r.state.snapshot?.businessDate).toBe('2026-11-08');
    expect(t.r.draft?.channels).toEqual({});
  });

  it('a resync that brings a new business date drops queued edits of the old date without sending them', async () => {
    const t = await mount(snap());
    act(() => t.ch.emitStatus('offline'));
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush(); });
    t.state.server = snap([], { id: 'oc-2', businessDate: '2026-11-08' });
    act(() => t.ch.emitStatus('live'));
    await settle();
    expect(t.writer.write).not.toHaveBeenCalled();
    expect(t.r.state.pending).toEqual([]);
    expect(loadPending(t.store, SHOP)).toEqual([]);
    expect(t.r.state.notice).toBe(WRONG_DAY_NOTICE);
  });

  it('a broadcast for another business date triggers a resync', async () => {
    const t = await mount(snap());
    const loads = t.writer.load.mock.calls.length;
    t.state.server = snap([], { id: 'oc-2', businessDate: '2026-11-08' });
    act(() => t.ch.emitField({ ...field('c:wolt', '1', 1), revision: 1, businessDate: '2026-11-08' }));
    await settle();
    expect(t.writer.load.mock.calls.length).toBe(loads + 1);
    expect(t.r.state.snapshot?.businessDate).toBe('2026-11-08');
    expect(wolt(t.r)).toBeUndefined(); // the event itself is not applied; the resync is the source
  });
});

describe('network and reconnect', () => {
  it('a network failure keeps the queue, goes offline and retries only when the channel is live again', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementationOnce(() => Promise.resolve(failR({ code: 'network' })));
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush(); });
    await settle();
    expect(t.r.state.status).toBe('offline');
    expect(t.r.state.pending.map((p) => p.key)).toEqual(['c:wolt']);
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    act(() => t.ch.emitStatus('offline'));
    act(() => { vi.advanceTimersByTime(60_000); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);

    act(() => t.ch.emitStatus('live'));
    await settle();
    await settle();
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(2);
    expect(t.writer.write.mock.calls[1]![0]).toMatchObject({ key: 'c:wolt', value: { text: '1' }, baseVersion: null });
    expect(t.r.state.pending).toEqual([]);
    expect(t.r.state.status).toBe('live');
  });

  it('reconnect (offline → live, no connecting) resyncs before sending', async () => {
    const t = await mount(snap());
    act(() => t.ch.emitStatus('offline'));
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush(); });
    const load = deferred<DResult<Snapshot>>();
    t.writer.load.mockImplementationOnce(() => load.promise);
    const loadsBefore = t.writer.load.mock.calls.length;
    act(() => t.ch.emitStatus('live'));
    await settle();
    expect(t.writer.load.mock.calls.length).toBe(loadsBefore + 1);
    expect(t.writer.write).not.toHaveBeenCalled();
    expect(t.r.state.status).not.toBe('live');
    await act(async () => { load.resolve(okR(snap([], { revision: 7 }))); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.writer.load.mock.invocationCallOrder[loadsBefore]!).toBeLessThan(t.writer.write.mock.invocationCallOrder[0]!);
    expect(t.r.state.status).toBe('live');
  });

  it('a network failure while the channel still reports live is retried by a timer', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementationOnce(() => Promise.resolve(failR({ code: 'network' })));
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush(); });
    await settle();
    expect(t.r.state.status).toBe('offline');
    await act(async () => { vi.advanceTimersByTime(5000); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(2);
    expect(t.r.state.pending).toEqual([]);
    expect(t.r.state.status).toBe('live');
  });
});

describe('persistence and lifecycle', () => {
  it('the queue survives a remount mid-debounce and the cached snapshot shows at once (offline start)', async () => {
    const store = memoryStore();
    const a = await mount(snap([field('c:efood', '4', 1)]), { store });
    act(() => a.r.edit('c:wolt', { text: '42' }));
    a.hook.unmount();
    expect(a.writer.write).not.toHaveBeenCalled();
    expect(a.ch.close).toHaveBeenCalled();
    expect(loadPending(store, SHOP).map((p) => p.value)).toEqual([{ text: '42' }]);

    const fw = fakeWriter(snap([field('c:efood', '4', 1)]));
    const never = deferred<DResult<Snapshot>>();
    fw.writer.load.mockImplementation(() => never.promise); // offline start: load never answers
    const hook = renderHook(() => useLiveClosing(fw.writer, store, SHOP, ME, NOW));
    expect(hook.result.current.draft?.channels).toEqual({ efood: '4', wolt: '42' });
    expect(hook.result.current.state.status).toBe('connecting');
    hook.unmount();
  });

  it('a remounted queue is sent once the new mount is live', async () => {
    const store = memoryStore();
    saveSnapshot(store, SHOP, snap());
    savePending(store, SHOP, ME.id, [{ author: ME.id, key: 'c:wolt', value: { text: '42' }, businessDate: DAY, baseVersion: 0, queuedOffline: true, seq: 3 }]);
    const t = await mount(snap(), { store });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.writer.write.mock.calls[0]![0]).toMatchObject({ key: 'c:wolt', baseVersion: 0, seq: 3 });
    // A new edit gets a seq after the persisted ones.
    act(() => t.r.edit('c:efood', { text: '1' }));
    expect(t.r.state.pending.find((p) => p.key === 'c:efood')!.seq).toBeGreaterThan(3);
  });

  it('StrictMode double mount leaves one open channel and sends each edit once', async () => {
    const t = await mount(snap(), { strict: true });
    expect(t.writer.live).toHaveBeenCalledTimes(2);
    expect(t.channels[0]!.close).toHaveBeenCalled();
    expect(t.channels[1]!.close).not.toHaveBeenCalled();
    act(() => { t.r.edit('c:wolt', { text: '1' }); });
    act(() => { vi.advanceTimersByTime(WRITE_DEBOUNCE_MS); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    t.hook.unmount();
    expect(t.channels[1]!.close).toHaveBeenCalled();
  });

  it('after unmount no timer fires a write and late results change nothing', async () => {
    const t = await mount(snap());
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);
    act(() => { t.r.edit('c:efood', { text: '1' }); t.r.flush(); });
    await settle();
    act(() => t.r.edit('c:wolt', { text: '2' }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    t.hook.unmount();
    act(() => { vi.advanceTimersByTime(10_000); });
    await act(async () => { ack.resolve(okR({ version: 1, revision: 2 })); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('errors', () => {
  it('a fatal error keeps the item, stops sending and calls onFatal once', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementation(() => Promise.resolve(failR({ code: 'session_invalid' })));
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush(); });
    await settle();
    act(() => { t.r.edit('c:efood', { text: '2' }); t.r.flush(); });
    await settle();
    act(() => t.ch.emitStatus('offline'));
    act(() => t.ch.emitStatus('live'));
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.onFatal).toHaveBeenCalledTimes(1);
    expect(t.onFatal).toHaveBeenCalledWith({ code: 'session_invalid' });
    expect(t.r.state.pending.map((p) => p.key)).toEqual(['c:wolt', 'c:efood']);
  });

  it('bad_field drops the item with a notice and resyncs; the next item still goes', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementationOnce(() => Promise.resolve(failR({ code: 'bad_field' })));
    const loads = t.writer.load.mock.calls.length;
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.edit('c:efood', { text: '2' }); t.r.flush(); });
    await settle();
    await settle();
    expect(t.r.state.notice).toBe('Η τιμή δεν είναι έγκυρη.');
    expect(t.writer.load.mock.calls.length).toBe(loads + 1);
    expect(t.writer.write).toHaveBeenCalledTimes(2);
    expect(t.r.state.pending).toEqual([]);
    expect(wolt(t.r)).toBeUndefined();
  });

  it('a fatal load error calls onFatal', async () => {
    const fw = fakeWriter(snap());
    fw.writer.load.mockImplementation(() => Promise.resolve(failR({ code: 'device_revoked' })));
    const onFatal = vi.fn();
    const store = memoryStore();
    renderHook(() => useLiveClosing(fw.writer, store, SHOP, ME, NOW, { onFatal }));
    await settle();
    act(() => fw.ch.emitStatus('live'));
    await settle();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledWith({ code: 'device_revoked' });
  });
});

describe('presence, focus and submitted', () => {
  it('passes presence through, sends focus to the channel and records a submit', async () => {
    const t = await mount(snap());
    act(() => t.ch.emitPresence([{ name: 'ΝΙΚΟΣ', focus: 'c:wolt' }]));
    expect(t.r.state.presence).toEqual([{ name: 'ΝΙΚΟΣ', focus: 'c:wolt' }]);
    act(() => t.r.focus('c:efood'));
    expect(t.ch.setFocus).toHaveBeenCalledWith('c:efood');
    const s = { closingId: 'cl-1', staffName: 'ΝΙΚΟΣ', at: '2026-11-07T21:00:00Z' };
    act(() => t.ch.emitSubmitted(s));
    expect(t.r.state.snapshot?.lastSubmit).toEqual(s);
    expect(loadSnapshot(t.store, SHOP)?.lastSubmit).toEqual(s);
  });
});

describe('fix round 1', () => {
  it('a replayed online queue item carries a base version: a box changed meanwhile ends on the server value + notice', async () => {
    const store = memoryStore();
    saveSnapshot(store, SHOP, snap([field('c:wolt', '10', 1)]));
    // Typed online (or in flight / mid-debounce) when the register unmounted.
    savePending(store, SHOP, ME.id, [{ author: ME.id, key: 'c:wolt', value: { text: '20' }, businessDate: DAY, baseVersion: null, queuedOffline: false, seq: 1 }]);
    // Meanwhile ΝΙΚΟΣ changed WOLT on the server.
    const t = await mount(snap([field('c:wolt', '30', 2)], { revision: 2 }), { store });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.writer.write.mock.calls[0]![0]).toMatchObject({ key: 'c:wolt', baseVersion: 1, queuedOffline: true });
    expect(wolt(t.r)).toBe('30');
    expect(t.r.state.pending).toEqual([]);
    expect(t.r.state.notice).toBe('Το πεδίο WOLT άλλαξε από ΝΙΚΟΣ');
  });

  it('a replayed item without a cached snapshot gets base version 0', async () => {
    const store = memoryStore();
    savePending(store, SHOP, ME.id, [{ author: ME.id, key: 'c:wolt', value: { text: '20' }, businessDate: DAY, baseVersion: null, queuedOffline: false, seq: 1 }]);
    const t = await mount(snap(), { store });
    await settle();
    expect(t.writer.write.mock.calls[0]![0]).toMatchObject({ baseVersion: 0, queuedOffline: true });
    expect(t.r.state.pending).toEqual([]);
  });

  it('after a fatal error the status is offline and new edits carry a base version', async () => {
    const t = await mount(snap([field('c:wolt', '1', 4)]));
    t.writer.write.mockImplementation(() => Promise.resolve(failR({ code: 'session_invalid' })));
    act(() => { t.r.edit('c:efood', { text: '1' }); t.r.flush(); });
    await settle();
    expect(t.r.state.status).toBe('offline');
    act(() => { t.r.edit('c:wolt', { text: '2' }); });
    expect(t.r.state.pending.find((p) => p.key === 'c:wolt')).toMatchObject({ baseVersion: 4, queuedOffline: true });
  });

  it('typing while the previous value is in flight: the newer value is sent after the ack, never showing the older one', async () => {
    const t = await mount(snap());
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush('c:wolt'); });
    await settle();
    act(() => t.r.edit('c:wolt', { text: '12' }));
    expect(wolt(t.r)).toBe('12');
    t.state.server = snap([field('c:wolt', '1', 1, ME.name)], { revision: 2 }); // the deferred write landed as v1
    await act(async () => { ack.resolve(okR({ version: 1, revision: 2 })); });
    await settle();
    expect(wolt(t.r)).toBe('12');
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(WRITE_DEBOUNCE_MS); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(2);
    expect(t.writer.write.mock.calls[1]![0]).toMatchObject({ value: { text: '12' }, baseVersion: null });
    expect(wolt(t.r)).toBe('12');
    expect(t.r.state.pending).toEqual([]);
  });

  it('a resync landing during an in-flight write: the ack does not lower the newer resynced version', async () => {
    const t = await mount(snap([field('c:wolt', '0', 1)]));
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);
    act(() => { t.r.edit('c:wolt', { text: '5' }); t.r.flush('c:wolt'); });
    await settle();
    // Our write landed as v2, ΝΙΚΟΣ's as v3; a resync sees v3 before our ack arrives.
    t.state.server = snap([field('c:wolt', '9', 3)], { revision: 3 });
    await act(async () => { await t.r.resync(); });
    expect(wolt(t.r)).toBe('5'); // still pending
    await act(async () => { ack.resolve(okR({ version: 2, revision: 2 })); });
    await settle();
    expect(t.r.state.snapshot?.fields['c:wolt']).toMatchObject({ version: 3, value: { text: '9' } });
    expect(t.r.state.snapshot?.revision).toBe(3);
    expect(wolt(t.r)).toBe('9');
  });
});

describe('restart after a fatal error', () => {
  it('disposes the halted engine and starts a fresh one: channel reopened, persisted queue sent', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementationOnce(() => Promise.resolve(failR({ code: 'unknown', detail: 'boom' })));
    act(() => { t.r.edit('c:wolt', { text: '7' }); t.r.flush(); });
    await settle();
    expect(t.onFatal).toHaveBeenCalledTimes(1);
    expect(t.r.state.status).toBe('offline');
    const first = t.channels[0]!;
    act(() => t.r.restart());
    await settle();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(t.channels).toHaveLength(2);
    act(() => t.channels[1]!.emitStatus('live'));
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(2);
    expect(t.state.server.fields['c:wolt']?.value).toEqual({ text: '7' });
    expect(t.r.state.pending).toEqual([]);
    expect(wolt(t.r)).toBe('7');
  });

  it('after a failed first load, restart loads the snapshot; under StrictMode one channel stays open', async () => {
    const fw = fakeWriter(snap([field('c:wolt', '3', 1)]));
    // Fails until the restart (StrictMode's discarded first mount loads too).
    fw.writer.load.mockImplementation(() => Promise.resolve(failR({ code: 'unknown', detail: '500' })));
    const onFatal = vi.fn();
    const store = memoryStore();
    const hook = renderHook(() => useLiveClosing(fw.writer, store, SHOP, ME, NOW, { onFatal }), { reactStrictMode: true });
    await settle();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(hook.result.current.draft).toBeNull();
    fw.writer.load.mockImplementation(() => Promise.resolve(okR(fw.state.server)));
    act(() => hook.result.current.restart());
    await settle();
    act(() => fw.ch.emitStatus('live'));
    await settle();
    expect(wolt(hook.result.current)).toBe('3');
    expect(fw.channels.filter((c) => c.close.mock.calls.length === 0)).toHaveLength(1);
  });
});

describe('I2 — the revision follows the +1 rule (no submit past a write we have not seen)', () => {
  it('ack rev 6 with rev 5 missing: revision stays, resync is asked; after it the server revision is held', async () => {
    const t = await mount(snap([], { revision: 4 }));
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);
    act(() => { t.r.edit('c:wolt', { text: '1' }); t.r.flush(); });
    await settle();
    // ΝΙΚΟΣ wrote c:efood as rev 5; ours landed as rev 6; his broadcast is late.
    const efood = field('c:efood', '7', 1);
    t.state.server = snap([efood, field('c:wolt', '1', 1, ME.name)], { revision: 6 });
    const load = deferred<DResult<Snapshot>>();
    t.writer.load.mockImplementationOnce(() => load.promise);
    const loads = t.writer.load.mock.calls.length;
    await act(async () => { ack.resolve(okR({ version: 1, revision: 6 })); });
    await settle();
    expect(t.r.state.snapshot?.revision).toBe(4);
    expect(t.r.state.snapshot?.fields['c:wolt']?.version).toBe(1);
    expect(t.writer.load.mock.calls.length).toBe(loads + 1);
    await act(async () => { load.resolve(okR(t.state.server)); });
    await settle();
    expect(t.r.state.snapshot?.revision).toBe(6);
    expect(t.r.draft?.channels.efood).toBe('7');
  });

  it('a lost broadcast (5) then broadcast 6: revision stays at 4 and a resync brings 6', async () => {
    const t = await mount(snap([], { revision: 4 }));
    t.state.server = snap([field('c:efood', '7', 1), field('c:wolt', '2', 1)], { revision: 6 });
    const load = deferred<DResult<Snapshot>>();
    t.writer.load.mockImplementationOnce(() => load.promise);
    const loads = t.writer.load.mock.calls.length;
    act(() => t.ch.emitField({ ...field('c:wolt', '2', 1), revision: 6, businessDate: DAY }));
    expect(wolt(t.r)).toBe('2');
    expect(t.r.state.snapshot?.revision).toBe(4);
    expect(t.writer.load.mock.calls.length).toBe(loads + 1);
    await act(async () => { load.resolve(okR(t.state.server)); });
    await settle();
    expect(t.r.state.snapshot?.revision).toBe(6);
  });

  it('in order (5 then 6) the revision advances with no resync', async () => {
    const t = await mount(snap([], { revision: 4 }));
    const loads = t.writer.load.mock.calls.length;
    act(() => t.ch.emitField({ ...field('c:efood', '7', 1), revision: 5, businessDate: DAY }));
    act(() => t.ch.emitField({ ...field('c:wolt', '2', 1), revision: 6, businessDate: DAY }));
    await settle();
    expect(t.r.state.snapshot?.revision).toBe(6);
    expect(t.writer.load.mock.calls.length).toBe(loads);
  });

  it('a late superseded broadcast (rev + 1, older field version) still advances the revision', async () => {
    const t = await mount(snap([field('c:wolt', '9', 3)], { revision: 4 }));
    act(() => t.ch.emitField({ ...field('c:wolt', '8', 2), revision: 5, businessDate: DAY }));
    expect(wolt(t.r)).toBe('9');
    expect(t.r.state.snapshot?.revision).toBe(5);
  });
});

describe('I1 — the queue is per author', () => {
  const nikosEdit = (over: Partial<PendingEdit> = {}): PendingEdit => ({
    author: 'staff-nikos', key: 'e:n1', value: { addedBy: { kind: 'staff', id: 'staff-nikos' }, removed: false, order: 1 },
    businessDate: DAY, baseVersion: 0, queuedOffline: true, seq: 1, ...over,
  });

  it("another cashier's stored edits are neither shown nor sent, and stay stored", async () => {
    const store = memoryStore();
    saveSnapshot(store, SHOP, snap());
    savePending(store, SHOP, 'staff-nikos', [nikosEdit(), nikosEdit({ key: 'c:wolt', value: { text: '50' }, seq: 2 })]);
    const t = await mount(snap(), { store });
    await settle();
    expect(t.writer.write).not.toHaveBeenCalled();
    expect(t.r.draft?.expenses).toEqual([]);
    expect(wolt(t.r)).toBeUndefined();
    expect(t.r.state.pending).toEqual([]);
    // Μαρία types and her edit is sent; ΝΙΚΟΣ's stay in storage, hidden.
    act(() => { t.r.edit('c:efood', { text: '3' }); t.r.flush(); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1);
    expect(t.writer.write.mock.calls[0]![0]).toMatchObject({ author: ME.id, key: 'c:efood' });
    expect(loadPending(store, SHOP, 'staff-nikos')).toHaveLength(2);
    expect(loadPending(store, SHOP, ME.id)).toEqual([]);
  });

  it('new edits are tagged with the current author', async () => {
    const t = await mount(snap());
    act(() => t.r.edit('c:wolt', { text: '1' }));
    expect(loadPending(t.store, SHOP)).toMatchObject([{ author: ME.id, key: 'c:wolt' }]);
  });

  it('the ack applies the value the server stored (server-decided author), not the one sent', async () => {
    const t = await mount(snap());
    const stored = { addedBy: { kind: 'staff', id: 'staff-maria' }, removed: false, order: 5 };
    t.writer.write.mockImplementationOnce(() => Promise.resolve(okR({ version: 1, revision: 2, value: stored })));
    act(() => { t.r.edit('e:x1', { addedBy: { kind: 'staff', id: 'someone-else' }, removed: false, order: 5 }); t.r.flush(); });
    await settle();
    expect(t.r.state.snapshot?.fields['e:x1']?.value).toEqual(stored);
    expect(t.r.draft?.expenses[0]?.addedBy).toEqual({ kind: 'staff', id: 'staff-maria' });
  });

  it('an ack value of the wrong shape is ignored (the sent value is used)', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementationOnce(() => Promise.resolve(okR({ version: 1, revision: 2, value: { text: 5 } })));
    act(() => { t.r.edit('c:wolt', { text: '4' }); t.r.flush(); });
    await settle();
    expect(t.r.state.snapshot?.fields['c:wolt']?.value).toEqual({ text: '4' });
  });
});

describe('drain (sign-out)', () => {
  it('flushes typing and resolves true once the queue is acknowledged', async () => {
    const t = await mount(snap());
    const ack = deferred<DResult<FieldAck>>();
    t.writer.write.mockImplementationOnce(() => ack.promise);
    act(() => t.r.edit('c:wolt', { text: '1' }));
    let done: boolean | null = null;
    act(() => { void t.r.drain(SIGN_OUT_DRAIN_MS).then((v) => { done = v; }); });
    await settle();
    expect(t.writer.write).toHaveBeenCalledTimes(1); // no 400 ms wait
    expect(done).toBeNull();
    await act(async () => { ack.resolve(okR({ version: 1, revision: 2 })); });
    await settle();
    expect(done).toBe(true);
  });

  it('resolves false after the bounded wait when the write does not come back; the item stays stored', async () => {
    const t = await mount(snap());
    t.writer.write.mockImplementationOnce(() => new Promise(() => {}));
    act(() => t.r.edit('c:wolt', { text: '1' }));
    let done: boolean | null = null;
    act(() => { void t.r.drain(SIGN_OUT_DRAIN_MS).then((v) => { done = v; }); });
    await settle();
    act(() => { vi.advanceTimersByTime(SIGN_OUT_DRAIN_MS - 1); });
    await settle();
    expect(done).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    await settle();
    expect(done).toBe(false);
    expect(loadPending(t.store, SHOP, ME.id)).toHaveLength(1);
  });

  it('resolves false at once while offline (nothing can be sent), true at once with nothing queued', async () => {
    const t = await mount(snap());
    let empty: boolean | null = null;
    act(() => { void t.r.drain(SIGN_OUT_DRAIN_MS).then((v) => { empty = v; }); });
    await settle();
    expect(empty).toBe(true);
    act(() => t.ch.emitStatus('offline'));
    act(() => t.r.edit('c:wolt', { text: '1' }));
    let off: boolean | null = null;
    act(() => { void t.r.drain(SIGN_OUT_DRAIN_MS).then((v) => { off = v; }); });
    await settle();
    expect(off).toBe(false);
  });
});
