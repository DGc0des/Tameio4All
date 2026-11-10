import { vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
import type { LiveChannel, LiveFieldEvent, LiveHandlers, LiveStatus } from '../../../src/data/remote/live';
import type { FieldKey } from '../../../src/features/register/live/fields';
import type { DResult, DeviceApi, DeviceError, StaffSession } from '../../../src/data/remote/deviceApi';

export const ok = <T,>(data: T): Promise<DResult<T>> => Promise.resolve({ ok: true, data });
export const fail = <T,>(error: DeviceError): Promise<DResult<T>> => Promise.resolve({ ok: false, error });

export const FAKE_SHOP_ID = 'shop-1';
export const FAKE_CONFIG_ID = 'config-1';
export const FAKE_PIN = '1234';
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

/** A paired phone for shop «Join Juice»; PIN 1234 signs in. Every method is a vi.fn. */
export function fakeDeviceApi(overrides: Partial<DeviceApi> = {}): DeviceApi {
  const base: DeviceApi = {
    session: vi.fn(() => ok({ anonymous: true })),
    pair: vi.fn(() => ok(undefined)),
    context: vi.fn(() =>
      ok({
        shopId: FAKE_SHOP_ID,
        shopName: 'Join Juice',
        configId: FAKE_CONFIG_ID,
        config: joinJuicePreset,
        businessDate: '2026-11-07',
      }),
    ),
    listStaff: vi.fn(() => ok(FAKE_STAFF)),
    signIn: vi.fn((staffId: string, pin: string): Promise<DResult<StaffSession>> => {
      const person = FAKE_STAFF.find((s) => s.id === staffId);
      if (!person) return fail({ code: 'staff_not_found' });
      if (pin !== FAKE_PIN) return fail({ code: 'bad_pin' });
      return ok({ token: 'token-1', staffId, name: person.name, businessDate: '2026-11-07', shopId: FAKE_SHOP_ID });
    }),
    signOut: vi.fn(() => Promise.resolve()),
    submit: vi.fn(() => ok({ closingId: 'closing-1', repeat: false })),
    suggestionData: vi.fn(() => ok([])),
    getOpenClosing: vi.fn(() =>
      ok({ id: 'oc-1', businessDate: '2026-11-07', configId: FAKE_CONFIG_ID, config: joinJuicePreset, revision: 0, lastSubmit: null, fields: {} }),
    ),
    setField: vi.fn(() => ok({ version: 1, revision: 1 })),
    live: vi.fn((_shopId: string, _me: { name: string }, h: LiveHandlers) => fakeLive(h)),
  };
  return { ...base, ...overrides };
}
