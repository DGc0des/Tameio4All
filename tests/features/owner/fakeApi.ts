import { vi } from 'vitest';
import type { LiveHandlers } from '../../../src/data/remote/live';
import { fakeLive } from '../phone/fakeDeviceApi';
import type { OwnerApi, Result } from '../../../src/data/remote/ownerApi';

export const ok = <T,>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });
export const fail = <T,>(error: Extract<Result<T>, { ok: false }>['error']): Promise<Result<T>> =>
  Promise.resolve({ ok: false, error });

/** A signed-in owner with one empty shop unless overridden. Every method is a vi.fn. */
export function fakeApi(overrides: Partial<OwnerApi> = {}): OwnerApi {
  const base: OwnerApi = {
    session: vi.fn(() => Promise.resolve({ email: 'owner@test.gr', anonymous: false })),
    onAuthChange: vi.fn(() => () => {}),
    signIn: vi.fn(() => ok(undefined)),
    signUp: vi.fn(() => ok(undefined)),
    sendReset: vi.fn(() => ok(undefined)),
    exchangeCode: vi.fn(() => ok(undefined)),
    updatePassword: vi.fn(() => ok(undefined)),
    signOut: vi.fn(() => Promise.resolve()),
    listShops: vi.fn(() => ok([])),
    createShop: vi.fn(() => ok('11111111-1111-4111-8111-111111111111')),
    renameShop: vi.fn(() => ok(undefined)),
    latestConfig: vi.fn(() => ok(null)),
    publishConfig: vi.fn(() => ok(2)),
    dayChange: vi.fn(() => ok({ time: '04:00', fromDate: null })),
    setDayChange: vi.fn(() => ok('2026-11-08')),
    listStaff: vi.fn(() => ok([])),
    createStaff: vi.fn(() => ok('staff-1')),
    setStaffPin: vi.fn(() => ok(undefined)),
    unlockStaff: vi.fn(() => ok(undefined)),
    updateStaff: vi.fn(() => ok(undefined)),
    joinKey: vi.fn(() => ok('ABCDEFGHJKLMNPQR')),
    rotateJoinKey: vi.fn(() => ok('STUVWXYZ23456789')),
    listDevices: vi.fn(() => ok([])),
    renameDevice: vi.fn(() => ok(undefined)),
    removeDevice: vi.fn(() => ok(undefined)),
    todayClosing: vi.fn(() =>
      ok({ id: 'oc-1', businessDate: '2026-11-07', configId: 'config-1', config: {}, revision: 0, lastSubmit: null, fields: {} }),
    ),
    setTodayField: vi.fn(() => ok({ version: 1, revision: 1 })),
    listClosings: vi.fn(() => ok({ today: '2026-11-11', from: '2026-10-13', to: '2026-11-11', configs: {}, days: [] })),
    closingDay: vi.fn(() =>
      ok({ today: '2026-11-11', businessDate: '2026-11-10', versions: [], configs: {}, staffNames: {}, open: null }),
    ),
    saveClosing: vi.fn(() => ok({ closingId: 'c-new', repeat: false })),
    live: vi.fn((_shopId: string, _me: { name: string }, h: LiveHandlers) => fakeLive(h)),
  };
  return { ...base, ...overrides };
}
