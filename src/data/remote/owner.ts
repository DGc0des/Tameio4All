import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { mapError } from './errors';
import type { DeviceRow, OwnerApi, Result, SessionInfo, ShopRow, StaffRow } from './ownerApi';

/**
 * supabase-js's auth responses are a success/failure union whose `data` shape differs per branch
 * (e.g. `user: User` vs `user: null`), which `run`'s generic can't unify against a fixed T. These
 * calls only need ok/error, never the payload, so the response is read structurally instead.
 */
type AuthCall = PromiseLike<{ data: unknown; error: unknown }>;

/** Awaits a supabase call; never throws — errors (returned or thrown) become OwnerError. */
async function run<T>(call: PromiseLike<{ data: T; error: unknown }>): Promise<Result<T>> {
  try {
    const { data, error } = await call;
    return error ? { ok: false, error: mapError(error) } : { ok: true, data };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

const done = (r: Result<unknown>): Result<void> => (r.ok ? { ok: true, data: undefined } : r);

/** RLS hides rows the caller doesn't own, so an update that touched nothing means "not yours". */
const oneRow = (r: Result<unknown[] | null>): Result<void> =>
  !r.ok ? r : (r.data?.length ?? 0) > 0 ? { ok: true, data: undefined } : { ok: false, error: { code: 'not_owner' } };

const toInfo = (s: Session | null): SessionInfo | null =>
  s ? { email: s.user.email ?? null, anonymous: s.user.is_anonymous === true } : null;

/** The one path for owner reads and writes. */
export function createOwnerApi(client: SupabaseClient): OwnerApi {
  return {
    async session() {
      try {
        const { data } = await client.auth.getSession();
        return toInfo(data.session);
      } catch {
        return null;
      }
    },
    onAuthChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, s) => cb(toInfo(s)));
      return () => data.subscription.unsubscribe();
    },
    signIn: async (email, password) =>
      done(await run(client.auth.signInWithPassword({ email, password }) as AuthCall)),
    signUp: async (email, password, redirectTo) =>
      done(await run(client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }))),
    sendReset: async (email, redirectTo) => done(await run(client.auth.resetPasswordForEmail(email, { redirectTo }))),
    async exchangeCode(code) {
      const r = await run(client.auth.exchangeCodeForSession(code) as AuthCall);
      if (r.ok) return { ok: true, data: undefined };
      return r.error.code === 'network' ? r : { ok: false, error: { code: 'link_invalid' } };
    },
    updatePassword: async (password) => done(await run(client.auth.updateUser({ password }) as AuthCall)),
    async signOut() {
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        // scope 'local' clears the stored session even when the server can't be reached
      }
    },
    async listShops() {
      const r = await run(client.from('shops').select('id, name').order('created_at'));
      return r.ok ? { ok: true, data: (r.data ?? []) as ShopRow[] } : r;
    },
    createShop: (name, config) => run(client.rpc('create_shop', { p_name: name, p_config: config })),
    renameShop: async (shopId, name) => oneRow(await run(client.from('shops').update({ name }).eq('id', shopId).select('id'))),
    async latestConfig(shopId) {
      const r = await run(
        client.from('shop_configs').select('id, version, config').eq('shop_id', shopId).order('version', { ascending: false }).limit(1),
      );
      return r.ok ? { ok: true, data: (r.data as ConfigRowRaw[] | null)?.[0] ?? null } : r;
    },
    publishConfig: (shopId, expectedVersion, config) =>
      run(client.rpc('publish_config', { p_shop_id: shopId, p_expected_version: expectedVersion, p_config: config })),
    async listStaff(shopId) {
      const r = await run(client.from('staff').select('id, name, active, locked_until').eq('shop_id', shopId).order('name'));
      if (!r.ok) return r;
      const rows = (r.data ?? []) as { id: string; name: string; active: boolean; locked_until: string | null }[];
      return { ok: true, data: rows.map((s): StaffRow => ({ id: s.id, name: s.name, active: s.active, lockedUntil: s.locked_until })) };
    },
    createStaff: (shopId, name, pin) => run(client.rpc('create_staff', { p_shop_id: shopId, p_name: name, p_pin: pin })),
    setStaffPin: async (staffId, pin) => done(await run(client.rpc('set_staff_pin', { p_staff_id: staffId, p_pin: pin }))),
    unlockStaff: async (staffId) => done(await run(client.rpc('unlock_staff', { p_staff_id: staffId }))),
    updateStaff: async (staffId, patch) => oneRow(await run(client.from('staff').update(patch).eq('id', staffId).select('id'))),
    createPairingCode: (shopId) => run(client.rpc('create_pairing_code', { p_shop_id: shopId })),
    async listDevices(shopId) {
      const r = await run(
        client.from('devices').select('user_id, label, created_at, revoked_at').eq('shop_id', shopId).order('created_at', { ascending: false }),
      );
      if (!r.ok) return r;
      const rows = (r.data ?? []) as { user_id: string; label: string; created_at: string; revoked_at: string | null }[];
      return {
        ok: true,
        data: rows.map((d): DeviceRow => ({ userId: d.user_id, label: d.label, createdAt: d.created_at, revokedAt: d.revoked_at })),
      };
    },
    async updateDevice(userId, patch) {
      const values: { label?: string; revoked_at?: string } = {};
      if (patch.label !== undefined) values.label = patch.label;
      if (patch.revoke) values.revoked_at = new Date().toISOString();
      return oneRow(await run(client.from('devices').update(values).eq('user_id', userId).select('user_id')));
    },
  };
}

type ConfigRowRaw = { id: string; version: number; config: unknown };
