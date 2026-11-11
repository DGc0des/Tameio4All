import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { parseJoinKey } from '../../app/joinKey';
import { mapError, type OwnerError } from './errors';
import { parseDayDetail, parseHistoryList } from './history';
import { openShopChannel, parseFieldAck, parseSnapshot, parseStaleCurrent } from './live';
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

const BAD_RESPONSE = { code: 'unknown', detail: 'bad_response' } as const;

/** An `{ok:false,error}` payload from an owner function → OwnerError (unknown codes stay `unknown`). */
const payloadError = (j: Record<string, unknown> | null): OwnerError =>
  j && j.ok === false && typeof j.error === 'string' ? mapError({ message: j.error }) : BAD_RESPONSE;

/** A store-key payload: anything parseJoinKey refuses is a bad response, never shown as a key. */
const keyResult = (r: Result<unknown>): Result<string> => {
  if (!r.ok) return r;
  const key = typeof r.data === 'string' ? parseJoinKey(r.data) : null;
  return key === null ? { ok: false, error: BAD_RESPONSE } : { ok: true, data: key };
};

const done = (r: Result<unknown>): Result<void> => (r.ok ? { ok: true, data: undefined } : r);

/** RLS hides rows the caller doesn't own, so an update that touched nothing means "not yours". */
const oneRow = (r: Result<unknown[] | null>): Result<void> =>
  !r.ok ? r : (r.data?.length ?? 0) > 0 ? { ok: true, data: undefined } : { ok: false, error: { code: 'not_owner' } };

const toInfo = (s: Session | null): SessionInfo | null =>
  s ? { email: s.user.email ?? null, anonymous: s.user.is_anonymous === true } : null;

/** en-CA formats as YYYY-MM-DD. */
const ATHENS_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' });

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
    async dayChange(shopId) {
      const r = await run(client.from('shops').select('day_change_time, day_change_switch_at').eq('id', shopId).limit(1));
      if (!r.ok) return r;
      const row = (r.data as { day_change_time: string; day_change_switch_at: string | null }[] | null)?.[0];
      if (!row) return { ok: false, error: { code: 'not_owner' } };
      const switchAt = row.day_change_switch_at ? new Date(row.day_change_switch_at) : null;
      const pending = switchAt !== null && switchAt.getTime() > Date.now();
      return {
        ok: true,
        data: { time: row.day_change_time.slice(0, 5), fromDate: pending ? ATHENS_DATE.format(switchAt) : null },
      };
    },
    setDayChange: (shopId, time) => run(client.rpc('set_day_change_time', { p_shop_id: shopId, p_time: time })),
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
    joinKey: async (shopId) => keyResult(await run(client.rpc('owner_get_join_key', { p_shop_id: shopId }))),
    rotateJoinKey: async (shopId) => keyResult(await run(client.rpc('owner_rotate_join_key', { p_shop_id: shopId }))),
    async listDevices(shopId) {
      const r = await run(client.rpc('owner_list_devices', { p_shop_id: shopId }));
      if (!r.ok) return r;
      if (r.data !== null && !Array.isArray(r.data)) return { ok: false, error: BAD_RESPONSE };
      const rows = (r.data ?? []) as {
        user_id: string;
        label: string;
        created_at: string;
        last_seen_at: string | null;
        last_staff_name: string | null;
      }[];
      return {
        ok: true,
        data: rows.map(
          (d): DeviceRow => ({
            userId: d.user_id,
            label: d.label,
            createdAt: d.created_at,
            lastSeenAt: d.last_seen_at,
            lastStaffName: d.last_staff_name,
          }),
        ),
      };
    },
    renameDevice: async (userId, label) =>
      oneRow(await run(client.from('devices').update({ label }).eq('user_id', userId).select('user_id'))),
    removeDevice: async (userId) => done(await run(client.rpc('owner_remove_device', { p_device_user_id: userId }))),
    async todayClosing(shopId) {
      const r = await run(client.rpc('owner_get_open_closing', { p_shop_id: shopId }));
      if (!r.ok) return r;
      const j = r.data as Record<string, unknown> | null;
      if (j?.ok !== true) return { ok: false, error: payloadError(j) };
      const snap = parseSnapshot(j.closing);
      return snap ? { ok: true, data: snap } : { ok: false, error: BAD_RESPONSE };
    },
    async setTodayField(shopId, businessDate, key, value, baseVersion) {
      const r = await run(
        client.rpc('owner_set_closing_field', {
          p_shop_id: shopId, p_business_date: businessDate, p_key: key, p_value: value, p_base_version: baseVersion,
        }),
      );
      if (!r.ok) return r;
      const j = r.data as Record<string, unknown> | null;
      if (j?.ok !== true) {
        if (j?.ok === false && j.error === 'stale') {
          const current = parseStaleCurrent(key, j.current);
          return current ? { ok: true, data: { stale: current } } : { ok: false, error: BAD_RESPONSE };
        }
        return { ok: false, error: payloadError(j) };
      }
      const ack = parseFieldAck(j);
      return ack ? { ok: true, data: ack } : { ok: false, error: BAD_RESPONSE };
    },
    async listClosings(shopId, from, to) {
      const r = await run(client.rpc('owner_list_closings', { p_shop_id: shopId, p_from: from, p_to: to }));
      if (!r.ok) return r;
      const j = r.data as Record<string, unknown> | null;
      if (j?.ok !== true) return { ok: false, error: payloadError(j) };
      const list = parseHistoryList(j);
      return list ? { ok: true, data: list } : { ok: false, error: BAD_RESPONSE };
    },
    async closingDay(shopId, businessDate) {
      const r = await run(client.rpc('owner_get_closing_day', { p_shop_id: shopId, p_business_date: businessDate }));
      if (!r.ok) return r;
      const j = r.data as Record<string, unknown> | null;
      if (j?.ok !== true) return { ok: false, error: payloadError(j) };
      const day = parseDayDetail(j);
      return day ? { ok: true, data: day } : { ok: false, error: BAD_RESPONSE };
    },
    async saveClosing(shopId, args) {
      const r = await run(
        client.rpc('owner_save_closing', {
          p_shop_id: shopId, p_business_date: args.businessDate, p_config_id: args.configId, p_inputs: args.inputs,
          p_expected_current_id: args.expectedCurrentId, p_idempotency_key: args.key, p_revision: args.revision ?? null,
        }),
      );
      if (!r.ok) return r;
      const j = r.data as Record<string, unknown> | null;
      if (j?.ok !== true) {
        if (j?.ok === false && j.error === 'closing_changed') {
          const id = j.current_id;
          return { ok: false, error: { code: 'closing_changed', currentId: typeof id === 'string' && id !== '' ? id : null } };
        }
        return { ok: false, error: payloadError(j) };
      }
      if (typeof j.closing_id !== 'string' || j.closing_id === '' || typeof j.repeat !== 'boolean') return { ok: false, error: BAD_RESPONSE };
      return { ok: true, data: { closingId: j.closing_id, repeat: j.repeat } };
    },
    live: (shop, me, h) => openShopChannel(client, shop, me, h),
  };
}

type ConfigRowRaw = { id: string; version: number; config: unknown };
