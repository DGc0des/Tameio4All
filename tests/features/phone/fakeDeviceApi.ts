import { vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
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
  };
  return { ...base, ...overrides };
}
