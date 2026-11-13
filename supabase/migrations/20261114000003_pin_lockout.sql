-- H24 + M39 + L93: an escalating PIN lockout that cannot be used to lock a shop out, and no second PIN entry point.
--
-- A phone is *trusted for a cashier* once that cashier entered a correct PIN on it (a `device_staff_trust` row).
-- Wrong PINs are counted on two tracks:
--   - phone not trusted for this cashier → `staff.failed_attempts`; at 5 the CASHIER is locked, which blocks only
--     phones not trusted for that cashier (an outsider with the link cannot lock a cashier out of their usual phone);
--   - phone trusted for this cashier → `device_staff_trust.failed_attempts`; at 5 the PHONE is locked, for everyone
--     on it (an insider on the shop phone).
-- Lock time escalates (private.lock_duration): 15 m, 30 m, 1 h, … 16 h, then 24 h; the level restarts at 0 when
-- the previous lock ended more than 7 days ago (or there was none). A correct PIN never clears `locked_until` or
-- the level; it resets only the counter of its own track.
-- Lock order wherever both rows are locked: the device row first, then the staff row.

-- 1. Columns and the trust table (no client access: RLS on, no policies, everything revoked).
alter table public.staff add column lock_level int not null default 0;
alter table public.devices
  add column locked_until timestamptz,
  add column lock_level int not null default 0;

create table public.device_staff_trust (
  device_user_id uuid references public.devices (user_id) on delete cascade,
  staff_id uuid references public.staff (id) on delete cascade,
  failed_attempts int not null default 0 check (failed_attempts >= 0),
  created_at timestamptz not null default now(),
  primary key (device_user_id, staff_id)
);
create index device_staff_trust_staff_idx on public.device_staff_trust (staff_id);
alter table public.device_staff_trust enable row level security;
revoke all on public.device_staff_trust from public, anon, authenticated;

-- 2. Back-fill: a phone where a cashier has signed in before (a session row, still in the same shop) is trusted.
insert into public.device_staff_trust (device_user_id, staff_id) select distinct ss.device_user_id, ss.staff_id from public.staff_sessions ss join public.devices d on d.user_id = ss.device_user_id and d.shop_id = ss.shop_id on conflict do nothing;

-- 3. Lock duration for a level: 15 minutes doubled per level, at most 24 hours.
create function private.lock_duration(p_level int) returns interval
language sql immutable security definer set search_path = '' as $$
  select least(interval '15 minutes' * power(2::double precision, least(greatest(coalesce(p_level, 0), 0), 7)),
               interval '24 hours');
$$;

revoke all on function private.lock_duration(int) from public, anon, authenticated;

-- 4. check_staff_pin: same signature; two counting tracks; new result {ok:false, error:'device_locked', locked_until}.
--    Returns a result instead of raising so the counters are never rolled back.
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

  select * into v_trust from public.device_staff_trust where device_user_id = v_dev.user_id and staff_id = v_staff.id;
  v_trusted := found;

  if not v_trusted and v_staff.locked_until is not null and v_staff.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', v_staff.locked_until);
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
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

-- 5. staff_sign_in is not re-created: it passes check_staff_pin's result through (device_locked included), and
--    the trust row is written inside check_staff_pin.

-- 6. unlock_staff (body of 20260929000006_owner_app.sql) and set_staff_pin (body of
--    20260929000002_owner_functions.sql): also reset the lock level.
create or replace function public.unlock_staff(p_staff_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  update public.staff set failed_attempts = 0, locked_until = null, lock_level = 0 where id = p_staff_id;
end $$;
revoke all on function public.unlock_staff(uuid) from public, anon;
grant execute on function public.unlock_staff(uuid) to authenticated;

create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';  -- don't reveal whether the staff id exists
  end if;
  perform private.require_owner(v_shop);
  perform private.check_pin(p_pin);
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null,
         lock_level = 0
   where id = p_staff_id;
end $$;
revoke all on function public.set_staff_pin(uuid, text) from public, anon;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;

-- 7. join_shop (body of 20261112000001_store_join_keys.sql): a phone that moves to another shop loses its trust
--    rows and its lock (it starts untrusted there, so its wrong PINs count on the cashier track).
create or replace function public.join_shop(p_key text, p_label text default '', p_switch boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text := upper(regexp_replace(coalesce(p_key, ''), '[^A-Za-z0-9]', '', 'g'));
  v_shop uuid;
  v_cur uuid;
  v_revoked timestamptz;
begin
  if v_uid is null or not private.is_anonymous() then
    raise exception 'not_a_device_session' using errcode = '42501';
  end if;
  select k.shop_id into v_shop from public.shop_join_keys k where k.key = v_key;
  if v_shop is null then raise exception 'invalid_code' using errcode = '22023'; end if;

  select d.shop_id, d.revoked_at into v_cur, v_revoked from public.devices d where d.user_id = v_uid for update;
  if v_cur = v_shop then
    update public.devices set revoked_at = null where user_id = v_uid;
  else
    if v_cur is not null and v_revoked is null and not coalesce(p_switch, false) then
      raise exception 'other_shop' using errcode = '22023';
    end if;
    update public.staff_sessions set revoked_at = now() where device_user_id = v_uid and revoked_at is null;
    delete from public.device_staff_trust where device_user_id = v_uid;
    insert into public.devices (user_id, shop_id, label)
    values (v_uid, v_shop, left(btrim(coalesce(p_label, '')), 60))
    on conflict (user_id) do update
      set shop_id = excluded.shop_id, label = excluded.label, revoked_at = null, created_at = now(),
          last_seen_at = null, last_staff_id = null, locked_until = null, lock_level = 0;
  end if;

  -- Dead copies stop piling up: the shop's other devices unused for 30 days go.
  delete from public.devices d
   where d.shop_id = v_shop and d.user_id <> v_uid
     and coalesce(d.last_seen_at, d.created_at) < now() - interval '30 days';
  return v_shop;
end $$;
revoke all on function public.join_shop(text, text, boolean) from public, anon;
grant execute on function public.join_shop(text, text, boolean) to authenticated;

-- 8. L93: the leftover second PIN entry point goes.
drop function public.verify_staff_pin(uuid, text);
