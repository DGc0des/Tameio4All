import { vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
import type { LiveChannel, LiveFieldEvent, LiveHandlers, LiveStatus } from '../../../src/data/remote/live';
import type { FieldKey, ServerField, Snapshot } from '../../../src/features/register/live/fields';
import type { DResult, DeviceApi, DeviceError, StaffSession } from '../../../src/data/remote/deviceApi';

export const ok = <T,>(data: T): Promise<DResult<T>> => Promise.resolve({ ok: true, data });
export const fail = <T,>(error: DeviceError): Promise<DResult<T>> => Promise.resolve({ ok: false, error });

export const FAKE_SHOP_ID = 'shop-1';
export const FAKE_CONFIG_ID = 'config-1';
export const FAKE_PIN = '1234';
export const FAKE_DATE = '2026-11-07';
export const FAKE_STAFF = [
  { id: 'staff-maria', name: 'ΜΑΡΙΑ' },
  { id: 'staff-nikos', name: 'ΝΙΚΟΣ' },
];

/** A controllable realtime channel: tests emit events into the handlers and inspect focus/close. */
export interface FakeLive extends LiveChannel {
  setFocus: ReturnType<typeof vi.fn<(key: FieldKey | null) => void>>;
  close: ReturnType<typeof vi.fn<() => void>>;
  emitField(f: LiveFieldEvent): void;
  emitSubmitted(s: { closingId: string; staffName: string; at: string }): void;
  emitPresence(p: { name: string; focus: FieldKey | null }[]): void;
  emitStatus(s: LiveStatus): void;
}
export function fakeLive(h: LiveHandlers): FakeLive {
  let closed = false;
  const guard = <A,>(fn: (a: A) => void) => (a: A) => { if (!closed) fn(a); };
  return {
    setFocus: vi.fn(),
    close: vi.fn(() => { closed = true; }),
    emitField: guard(h.onField),
    emitSubmitted: guard(h.onSubmitted),
    emitPresence: guard(h.onPresence),
    emitStatus: guard(h.onStatus),
  };
}

/**
 * One shop's open closing held in memory, shared by any number of fake phones. Writes bump the field's
 * version and the closing's revision and are broadcast (on a microtask, like a socket) to every open
 * channel — the writer's own included, as the real server does. Presence goes to the other channels.
 */
export interface FakeServer {
  businessDate: string;
  revision: number;
  fields: Record<FieldKey, ServerField>;
  lastSubmit: Snapshot['lastSubmit'];
  config: unknown;
  /** token → staff name (who a write/submit is attributed to). */
  names: Record<string, string>;
  /** token → staff id: the server-decided author of a new `e:<id>` line (an existing line keeps its own). */
  staffIds: Record<string, string>;
  /** Timestamp stamped on writes and submits. */
  at: string;
  snapshot(): Snapshot;
  setField: DeviceApi['setField'];
  submit: DeviceApi['submit'];
  live: DeviceApi['live'];
  /** Open channels right now. */
  openChannels(): number;
}

export function fakeServer(init: Partial<Pick<FakeServer, 'businessDate' | 'config' | 'names' | 'staffIds' | 'at'>> = {}): FakeServer {
  type Conn = { live: FakeLive; name: string; focus: FieldKey | null; open: boolean };
  const conns = new Set<Conn>();
  const later = (fn: () => void) => queueMicrotask(fn);
  const presence = () =>
    later(() => {
      for (const c of conns) c.live.emitPresence([...conns].filter((o) => o !== c).map((o) => ({ name: o.name, focus: o.focus })));
    });

  const server: FakeServer = {
    businessDate: init.businessDate ?? FAKE_DATE,
    revision: 0,
    fields: {},
    lastSubmit: null,
    config: init.config ?? joinJuicePreset,
    names: init.names ?? { 'token-1': 'ΜΑΡΙΑ', 'token-2': 'ΝΙΚΟΣ' },
    staffIds: init.staffIds ?? { 'token-1': 'staff-maria', 'token-2': 'staff-nikos' },
    at: init.at ?? '2026-11-07T19:42:00.000Z',
    snapshot: () => ({
      id: 'oc-1',
      businessDate: server.businessDate,
      configId: FAKE_CONFIG_ID,
      config: server.config,
      revision: server.revision,
      lastSubmit: server.lastSubmit,
      fields: structuredClone(server.fields),
    }),
    setField(token, businessDate, key, value, baseVersion) {
      if (businessDate !== server.businessDate) return fail({ code: 'wrong_day' });
      const current = server.fields[key];
      if (baseVersion !== null && (current?.version ?? 0) !== baseVersion) {
        return fail({ code: 'stale', current: current ?? { key, value: null, version: 0, updatedByName: '', updatedAt: '' } });
      }
      const version = (current?.version ?? 0) + 1;
      const revision = ++server.revision;
      // Like write_closing_field: an expense line's author is the server's call.
      let stored = structuredClone(value);
      if (/^e:[A-Za-z0-9-]{1,64}$/.test(key) && typeof stored === 'object' && stored !== null) {
        const prev = current?.value as { addedBy?: unknown } | undefined;
        const author = prev?.addedBy ?? (server.staffIds[token] ? { kind: 'staff', id: server.staffIds[token] } : (stored as { addedBy?: unknown }).addedBy);
        stored = { ...(stored as object), addedBy: author };
      }
      const field: ServerField = { key, value: stored, version, updatedByName: server.names[token] ?? '?', updatedAt: server.at };
      server.fields[key] = field;
      later(() => {
        for (const c of conns) c.live.emitField({ ...structuredClone(field), revision, businessDate });
      });
      return ok({ version, revision, value: structuredClone(stored) });
    },
    submit(token, _configId, businessDate, _inputs, revision) {
      if (businessDate !== server.businessDate) return fail({ code: 'wrong_day' });
      if (revision !== server.revision) return fail({ code: 'draft_changed', revision: server.revision });
      const info = { closingId: `closing-${server.revision}`, staffName: server.names[token] ?? '?', at: server.at, revision: server.revision };
      server.lastSubmit = info;
      later(() => {
        for (const c of conns) c.live.emitSubmitted(info);
      });
      return ok({ closingId: info.closingId, repeat: false });
    },
    live(_shopId, me, h) {
      const live = fakeLive(h);
      const conn: Conn = { live, name: me.name, focus: null, open: true };
      conns.add(conn);
      live.setFocus.mockImplementation((key) => {
        conn.focus = key;
        presence();
      });
      live.close.mockImplementation(() => {
        conns.delete(conn);
        presence();
      });
      h.onStatus('connecting');
      later(() => {
        if (conns.has(conn)) live.emitStatus('live');
        presence();
      });
      return live;
    },
    openChannels: () => conns.size,
  };
  return server;
}

/**
 * A paired phone for shop «Join Juice»; PIN 1234 signs in. Every method is a vi.fn. The live-closing
 * calls go to `server` (a fresh one unless shared, e.g. by two phones in one test).
 */
export function fakeDeviceApi(overrides: Partial<DeviceApi> = {}, server: FakeServer = fakeServer()): DeviceApi {
  const base: DeviceApi = {
    session: vi.fn(() => ok({ anonymous: true })),
    join: vi.fn(() => ok(undefined)),
    context: vi.fn(() =>
      ok({
        shopId: FAKE_SHOP_ID,
        shopName: 'Join Juice',
        configId: FAKE_CONFIG_ID,
        config: joinJuicePreset,
        businessDate: FAKE_DATE,
      }),
    ),
    listStaff: vi.fn(() => ok(FAKE_STAFF)),
    signIn: vi.fn((staffId: string, pin: string): Promise<DResult<StaffSession>> => {
      const person = FAKE_STAFF.find((s) => s.id === staffId);
      if (!person) return fail({ code: 'staff_not_found' });
      if (pin !== FAKE_PIN) return fail({ code: 'bad_pin' });
      return ok({ token: 'token-1', staffId, name: person.name, businessDate: FAKE_DATE, shopId: FAKE_SHOP_ID });
    }),
    signOut: vi.fn(() => Promise.resolve()),
    submit: vi.fn<DeviceApi['submit']>((...a) => server.submit(...a)),
    suggestionData: vi.fn(() => ok([])),
    getOpenClosing: vi.fn(() => ok(server.snapshot())),
    setField: vi.fn<DeviceApi['setField']>((...a) => server.setField(...a)),
    live: vi.fn<DeviceApi['live']>((...a) => server.live(...a)),
  };
  return { ...base, ...overrides };
}
