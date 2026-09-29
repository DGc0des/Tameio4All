import { vi } from 'vitest';
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
    listStaff: vi.fn(() => ok([])),
    createStaff: vi.fn(() => ok('staff-1')),
    setStaffPin: vi.fn(() => ok(undefined)),
    unlockStaff: vi.fn(() => ok(undefined)),
    updateStaff: vi.fn(() => ok(undefined)),
    createPairingCode: vi.fn(() => ok('ABCDEFGH')),
    listDevices: vi.fn(() => ok([])),
    updateDevice: vi.fn(() => ok(undefined)),
  };
  return { ...base, ...overrides };
}
