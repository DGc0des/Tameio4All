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
    session: vi.fn(() => Promise.resolve({ email: 'owner@test.gr', userId: 'owner-uid', anonymous: false })),
    onAuthChange: vi.fn(() => () => {}),
    signIn: vi.fn(() => ok(undefined)),
    signUp: vi.fn(() => ok(undefined)),
    sendReset: vi.fn(() => ok(undefined)),
    exchangeCode: vi.fn(() => ok(undefined)),
    updatePassword: vi.fn(() => ok(undefined)),
    signOut: vi.fn(() => Promise.resolve()),
    listShops: vi.fn(() => ok([])),
    inviteMember: vi.fn(() => ok('A'.repeat(32))),
    listMembers: vi.fn(() => ok([])),
    setMemberRole: vi.fn(() => ok(undefined)),
    removeMember: vi.fn(() => ok(undefined)),
    reissueInvite: vi.fn(() => ok('A'.repeat(32))),
    inviteInfo: vi.fn(() => ok({ shops: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Δοκιμαστικό' }], role: 'manager' as const, displayName: 'Νίκος', email: 'nikos@test.gr', expiresAt: '2026-11-24T00:00:00Z' })),
    acceptInvite: vi.fn(() => ok(['11111111-1111-4111-8111-111111111111'])),
    createShop: vi.fn(() => ok('11111111-1111-4111-8111-111111111111')),
    renameShop: vi.fn(() => ok(undefined)),
    latestConfig: vi.fn(() => ok(null)),
    publishConfig: vi.fn(() => ok(2)),
    dayChange: vi.fn(() => ok({ time: '04:00', fromDate: null })),
    setDayChange: vi.fn(() => ok('2026-11-08')),
    closingPlan: vi.fn(() => ok({ count: 1, cashMode: 'separate' as const })),
    setClosingPlan: vi.fn(() => ok(undefined)),
    listStaff: vi.fn(() => ok([])),
    createStaff: vi.fn(() => ok('staff-1')),
    setStaffPin: vi.fn(() => ok(undefined)),
    unlockStaff: vi.fn(() => ok(undefined)),
    updateStaff: vi.fn(() => ok(undefined)),
    eraseStaff: vi.fn(() => ok(undefined)),
    deleteShop: vi.fn(() => ok(undefined)),
    deleteAccount: vi.fn(() => ok(undefined)),
    joinKey: vi.fn(() => ok('ABCDEFGHJKLMNPQR')),
    rotateJoinKey: vi.fn(() => ok('STUVWXYZ23456789')),
    listDevices: vi.fn(() => ok([])),
    renameDevice: vi.fn(() => ok(undefined)),
    removeDevice: vi.fn(() => ok(undefined)),
    todayClosing: vi.fn(() =>
      ok({ id: 'oc-1', businessDate: '2026-11-07', configId: 'config-1', config: {}, revision: 0, closingNo: 1, closingsPlanned: 1, cashMode: 'separate' as const, lastSubmit: null, fields: {} }),
    ),
    setTodayField: vi.fn(() => ok({ version: 1, revision: 1 })),
    listClosings: vi.fn(() => ok({ today: '2026-11-11', from: '2026-10-13', to: '2026-11-11', configs: {}, days: [] })),
    closingDay: vi.fn(() =>
      ok({
        today: '2026-11-11', businessDate: '2026-11-10', cashMode: 'separate' as const, closingsPlanned: 1, liveClosingNo: null,
        closings: [], configs: {}, staffNames: {},
      }),
    ),
    saveClosing: vi.fn(() => ok({ closingId: 'c-new', repeat: false })),
    live: vi.fn((_shopId: string, _me: { name: string }, h: LiveHandlers) => fakeLive(h)),
  };
  return { ...base, ...overrides };
}
