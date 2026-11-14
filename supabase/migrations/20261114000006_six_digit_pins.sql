-- H24 (rest): a staff PIN is exactly 6 digits. Hard cutover: every existing (4-digit) PIN stops working at once;
-- after this migration no cashier has a PIN until the owner sets a new one.
--
-- Cross-file invariant: the PIN format `^[0-9]{6}$` lives in private.check_pin, in private.check_staff_pin and in
-- the client (`isPin`/`PIN_LENGTH` in src/features/owner/model/limits.ts, the PIN inputs). Change them together.
-- `staff.pin_hash is null` = no PIN set: staff_sign_in answers {ok:false, error:'pin_not_set'} and counts nothing.

-- 1. pin_hash may be null; the owner sees whether a PIN is set through a generated column (never pin_hash itself).
alter table public.staff alter column pin_hash drop not null;
alter table public.staff add column has_pin boolean generated always as (pin_hash is not null) stored;
-- Same pattern as the other owner-readable staff columns (20260929000001_schema.sql): a column select grant,
-- rows limited by the staff_owner_read policy.
grant select (has_pin) on public.staff to authenticated;

-- 2. check_pin (body of 20260929000002_owner_functions.sql): 6 digits. Same attributes (immutable, not security
--    definer: it touches no table); create or replace keeps its privileges, restated here.
create or replace function private.check_pin(p_pin text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'bad_pin_format' using errcode = '22023';
  end if;
end $$;

revoke all on function private.check_pin(text) from public, anon, authenticated;

-- 3. check_staff_pin (body of 20261114000003_pin_lockout.sql) with two changes: the 6-digit format, and
--    `pin_not_set` right after the device_locked check. That guard is required: crypt(pin, null) is null, so the
--    mismatch test below would be null and fall through to the correct-PIN path (any PIN would sign in).
--    A cashier with no PIN touches no counter, lock or trust row.
create or replace function private.check_staff_pin(p_shop_id uuid, p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.devices;
  v_staff public.staff;
  v_trust public.device_staff_trust;
  v_trusted boolean;
  v_level int;
  v_until timestamptz;
begin
  -- FOR UPDATE also makes this fail inside a read-only transaction (e.g. a GET RPC call) before
  -- the PIN is compared, so a read-only call can't be used to guess PINs without the counter.
  -- Do not remove.
  -- Device first, then staff: one lock order for every function that locks both.
  select * into v_dev from public.devices where user_id = auth.uid() and shop_id = p_shop_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_a_device'); end if;
  select * into v_staff from public.staff where id = p_staff_id and shop_id = p_shop_id and active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'staff_not_found'); end if;

  if v_dev.locked_until is not null and v_dev.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'device_locked', 'locked_until', v_dev.locked_until);
  end if;

  -- No PIN set (cleared by the 6-digit cutover): never compared, never counted. Do not remove (see above).
  if v_staff.pin_hash is null then
    return jsonb_build_object('ok', false, 'error', 'pin_not_set');
  end if;

  select * into v_trust from public.device_staff_trust where device_user_id = v_dev.user_id and staff_id = v_staff.id;
  v_trusted := found;

  if not v_trusted and v_staff.locked_until is not null and v_staff.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', v_staff.locked_until);
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{6}$' or extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    if v_trusted then
      if v_trust.failed_attempts + 1 >= 5 then
        v_level := case when v_dev.locked_until is null or v_dev.locked_until < now() - interval '7 days'
                        then 0 else v_dev.lock_level end;
        v_until := now() + private.lock_duration(v_level);
        update public.devices set locked_until = v_until, lock_level = v_level + 1 where user_id = v_dev.user_id;
        update public.device_staff_trust set failed_attempts = 0
         where device_user_id = v_dev.user_id and staff_id = v_staff.id;
        return jsonb_build_object('ok', false, 'error', 'device_locked', 'locked_until', v_until);
      end if;
      update public.device_staff_trust set failed_attempts = failed_attempts + 1
       where device_user_id = v_dev.user_id and staff_id = v_staff.id;
      return jsonb_build_object('ok', false, 'error', 'bad_pin');
    end if;
    if v_staff.failed_attempts + 1 >= 5 then
      v_level := case when v_staff.locked_until is null or v_staff.locked_until < now() - interval '7 days'
                      then 0 else v_staff.lock_level end;
      v_until := now() + private.lock_duration(v_level);
      update public.staff set failed_attempts = 0, locked_until = v_until, lock_level = v_level + 1 where id = v_staff.id;
      return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', v_until);
    end if;
    update public.staff set failed_attempts = failed_attempts + 1 where id = v_staff.id;
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;

  -- Correct PIN: reset only this track's counter; never clear locked_until or the level.
  if v_trusted then
    if v_trust.failed_attempts <> 0 then
      update public.device_staff_trust set failed_attempts = 0
       where device_user_id = v_dev.user_id and staff_id = v_staff.id;
    end if;
  else
    if v_staff.failed_attempts <> 0 then
      update public.staff set failed_attempts = 0 where id = v_staff.id;
    end if;
    insert into public.device_staff_trust (device_user_id, staff_id) values (v_dev.user_id, v_staff.id)
    on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.check_staff_pin(uuid, uuid, text) from public, anon, authenticated;

-- 4. Cutover: no PIN for anyone; sessions opened with a 4-digit PIN are no longer trusted. It runs after 2 and 3, so
--    a null pin_hash never meets the old check_staff_pin body (which has no pin_not_set guard).
--    Trust rows (device_staff_trust), lock times and lock levels stay.
update public.staff set pin_hash = null, failed_attempts = 0;
update public.staff_sessions set revoked_at = now() where revoked_at is null;

-- 5. create_staff / set_staff_pin are not re-created: they validate through private.check_pin. staff_sign_in is
--    not re-created: it passes check_staff_pin's result (pin_not_set included) through.
