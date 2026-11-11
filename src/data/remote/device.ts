import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { PastExpense } from '../../core/suggestions';
import type { DResult, DeviceApi, DeviceContext, StaffSession } from './deviceApi';
import { fromServerResult, mapDeviceError } from './deviceErrors';
import { openShopChannel, parseFieldAck, parseSnapshot } from './live';

type Reply<T> = PromiseLike<{ data: T; error: unknown }>;

/** Awaits a supabase call; never throws — errors (returned or thrown) become DeviceError. */
async function run<T>(call: Reply<T>): Promise<DResult<T>> {
  try {
    const { data, error } = await call;
    return error ? { ok: false, error: mapDeviceError(error) } : { ok: true, data };
  } catch (e) {
    return { ok: false, error: mapDeviceError(e) };
  }
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const bad = { code: 'unknown', detail: 'bad_response' } as const;

/** The one path for phone reads and writes. */
export function createDeviceApi(client: SupabaseClient): DeviceApi {
  /** Remembered from the last successful context() so a StaffSession can carry its shop. */
  let shopId = '';

  // auth-js answers {session:null, error} when an expired access token could not be refreshed (e.g. offline)
  // while the refresh token stays stored: that is "couldn't tell", never "no session".
  const session: DeviceApi['session'] = async () => {
    const r = await run<{ session: Session | null }>(client.auth.getSession());
    if (!r.ok) return r;
    const s = r.data.session;
    return { ok: true, data: s ? { anonymous: s.user.is_anonymous === true } : null };
  };

  return {
    session,
    async join(key, label, opts) {
      const looked = await session();
      // Without knowing who is signed in here, an anonymous sign-in could replace an owner's session unasked.
      if (!looked.ok) return looked;
      const current = looked.data;
      try {
        if (current && !current.anonymous && !opts?.force) return { ok: false, error: { code: 'owner_signed_in' } };
        if (current && !current.anonymous) await client.auth.signOut({ scope: 'local' });
        if (!current || !current.anonymous) {
          const { error } = await client.auth.signInAnonymously();
          if (error) return { ok: false, error: mapDeviceError(error) };
        }
      } catch (e) {
        return { ok: false, error: mapDeviceError(e) };
      }
      const r = await run(client.rpc('join_shop', { p_key: key, p_label: label, p_switch: opts?.switchShop === true }));
      return r.ok ? { ok: true, data: undefined } : r;
    },
    async context() {
      const r = await run(client.rpc('device_context'));
      if (!r.ok) return r;
      const row = (Array.isArray(r.data) ? r.data[0] : null) as Record<string, unknown> | null | undefined;
      if (!row) return { ok: true, data: null };
      const ctx: DeviceContext = {
        shopId: str(row.shop_id),
        shopName: str(row.shop_name),
        configId: str(row.config_id),
        config: row.config,
        businessDate: str(row.business_date),
      };
      shopId = ctx.shopId;
      return { ok: true, data: ctx };
    },
    async listStaff() {
      const r = await run(client.rpc('list_staff'));
      if (!r.ok) return r;
      const rows = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
      return { ok: true, data: rows.map((x) => ({ id: str(x.id), name: str(x.name) })) };
    },
    async signIn(staffId, pin) {
      const r = await run(client.rpc('staff_sign_in', { p_staff_id: staffId, p_pin: pin }));
      if (!r.ok) return r;
      const failure = fromServerResult(r.data);
      if (failure) return { ok: false, error: failure };
      const j = r.data as Record<string, unknown>;
      const out: StaffSession = {
        token: str(j.token),
        staffId: str(j.staff_id),
        name: str(j.name),
        businessDate: str(j.business_date),
        shopId,
      };
      return out.token ? { ok: true, data: out } : { ok: false, error: bad };
    },
    async signOut(token) {
      await run(client.rpc('staff_sign_out', { p_token: token }));
    },
    async submit(token, configId, businessDate, inputs, revision, idempotencyKey) {
      const r = await run(
        client.rpc('submit_closing', {
          p_token: token,
          p_config_id: configId,
          p_business_date: businessDate,
          p_inputs: inputs,
          p_revision: revision,
          p_idempotency_key: idempotencyKey,
        }),
      );
      if (!r.ok) return r;
      const failure = fromServerResult(r.data);
      if (failure) return { ok: false, error: failure };
      const j = r.data as Record<string, unknown>;
      return { ok: true, data: { closingId: str(j.closing_id), repeat: j.repeat === true } };
    },
    async getOpenClosing(token) {
      const r = await run(client.rpc('get_open_closing', { p_token: token }));
      if (!r.ok) return r;
      const failure = fromServerResult(r.data);
      if (failure) return { ok: false, error: failure };
      const snap = parseSnapshot((r.data as Record<string, unknown>).closing);
      return snap ? { ok: true, data: snap } : { ok: false, error: bad };
    },
    async setField(token, businessDate, key, value, baseVersion) {
      const r = await run(
        client.rpc('set_closing_field', {
          p_token: token,
          p_business_date: businessDate,
          p_key: key,
          p_value: value,
          p_base_version: baseVersion,
        }),
      );
      if (!r.ok) return r;
      const failure = fromServerResult(r.data, { key });
      if (failure) return { ok: false, error: failure };
      const ack = parseFieldAck(r.data);
      return ack ? { ok: true, data: ack } : { ok: false, error: bad };
    },
    live: (shop, me, h) => openShopChannel(client, shop, me, h),
    async suggestionData() {
      const r = await run(client.rpc('expense_suggestion_data'));
      if (!r.ok) return r;
      const rows = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
      const data: PastExpense[] = rows
        .map((x) => ({
          description: str(x.description),
          cents: typeof x.cents === 'number' ? x.cents : typeof x.cents === 'string' && x.cents !== '' ? Number(x.cents) : NaN,
          date: str(x.business_date),
        }))
        // A malformed row (NaN, fractional, negative, unsafe) is skipped, never passed on as money.
        .filter((x) => Number.isSafeInteger(x.cents) && x.cents >= 0);
      return { ok: true, data };
    },
  };
}
