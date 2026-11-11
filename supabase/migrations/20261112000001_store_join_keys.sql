-- Stage 4: a permanent store key replaces the single-use pairing code.
-- A phone is still "an anonymous auth user with a live devices row"; only how it gets the row changes.

-- 1. The store key. One per shop; readable only through owner_get_join_key.
create table public.shop_join_keys (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  key text not null unique check (key ~ '^[A-HJ-NP-Z2-9]{16}$'),
  created_at timestamptz not null default now()
);
alter table public.shop_join_keys enable row level security;
revoke all on public.shop_join_keys from public, anon, authenticated;

-- 2. Devices remember when and by whom they were last used (owner list, 30-day prune).
alter table public.devices
  add column last_seen_at timestamptz,
  add column last_staff_id uuid references public.staff (id) on delete set null;

-- Backfill from what already happened, so the 30-day prune never removes a phone that is in use today:
-- its last staff session or its last submitted closing in its current shop. A phone with neither stays null
-- (falls back to its pairing date: a long-unused copy is exactly what the prune is for).
update public.devices d set
  last_seen_at = (
    select max(t.at) from (
      select max(ss.created_at) as at from public.staff_sessions ss where ss.device_user_id = d.user_id and ss.shop_id = d.shop_id
      union all
      select max(c.created_at) from public.closings c where c.device_user_id = d.user_id and c.shop_id = d.shop_id
    ) t
  ),
  last_staff_id = (
    select ss.staff_id from public.staff_sessions ss
     where ss.device_user_id = d.user_id and ss.shop_id = d.shop_id
     order by ss.created_at desc limit 1
  );

-- 16 characters of the pairing alphabet (32 symbols: byte % 32 is unbiased). Cross-file invariant:
-- the format ^[A-HJ-NP-Z2-9]{16}$ is checked by parseJoinKey (src/app/joinKey.ts).
create function private.new_join_key() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(16);
  v_key text := '';
begin
  for i in 0..15 loop
    v_key := v_key || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_key;
end $$;
revoke all on function private.new_join_key() from public, anon, authenticated;

-- Owner: the shop's key, created on first use.
create function public.owner_get_join_key(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
begin
  perform private.require_owner(p_shop_id);
  insert into public.shop_join_keys (shop_id, key) values (p_shop_id, private.new_join_key())
  on conflict (shop_id) do nothing;
  select k.key into v_key from public.shop_join_keys k where k.shop_id = p_shop_id;
  return v_key;
end $$;

-- Owner: replace the key. Every phone of the shop leaves the store and every staff session ends.
create function public.owner_rotate_join_key(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
begin
  perform private.require_owner(p_shop_id);
  v_key := private.new_join_key();
  update public.staff_sessions set revoked_at = now() where shop_id = p_shop_id and revoked_at is null;
  delete from public.devices where shop_id = p_shop_id;
  insert into public.shop_join_keys (shop_id, key) values (p_shop_id, v_key)
  on conflict (shop_id) do update set key = excluded.key, created_at = now();
  return v_key;
end $$;

-- Phone: enter the store of a key. Raises not_a_device_session (42501), invalid_code / other_shop (22023).
-- A caller already in another (live) store must pass p_switch = true; switching ends its staff sessions.
create function public.join_shop(p_key text, p_label text default '', p_switch boolean default false) returns uuid
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
    insert into public.devices (user_id, shop_id, label)
    values (v_uid, v_shop, left(btrim(coalesce(p_label, '')), 60))
    on conflict (user_id) do update
      set shop_id = excluded.shop_id, label = excluded.label, revoked_at = null, created_at = now(),
          last_seen_at = null, last_staff_id = null;
  end if;

  -- Dead copies stop piling up: the shop's other devices unused for 30 days go.
  delete from public.devices d
   where d.shop_id = v_shop and d.user_id <> v_uid
     and coalesce(d.last_seen_at, d.created_at) < now() - interval '30 days';
  return v_shop;
end $$;

-- Owner: remove a device for real (cleanup, not a ban: a phone with the key can come back).
-- Missing and foreign ids both raise not_owner.
create function public.owner_remove_device(p_device_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select d.shop_id into v_shop from public.devices d where d.user_id = p_device_user_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  update public.staff_sessions set revoked_at = now() where device_user_id = p_device_user_id and revoked_at is null;
  delete from public.devices where user_id = p_device_user_id;
end $$;

-- Owner: the shop's devices, most recently used first.
create function public.owner_list_devices(p_shop_id uuid)
returns table (user_id uuid, label text, created_at timestamptz, last_seen_at timestamptz, last_staff_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_owner(p_shop_id);
  return query
    select d.user_id, d.label, d.created_at, d.last_seen_at, st.name
      from public.devices d
      left join public.staff st on st.id = d.last_staff_id
     where d.shop_id = p_shop_id and d.revoked_at is null
     order by coalesce(d.last_seen_at, d.created_at) desc, d.user_id;
end $$;

-- 3. staff_sign_in: as in 20261107000001_staff_sessions.sql, plus the device's last use after a correct PIN.
create or replace function public.staff_sign_in(p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev jsonb := private.device_shop();
  v_shop uuid;
  v_pin jsonb;
  v_token text;
  v_date date;
  v_name text;
begin
  if not (v_dev ->> 'ok')::boolean then return v_dev; end if;
  v_shop := (v_dev ->> 'shop_id')::uuid;

  v_pin := private.check_staff_pin(v_shop, p_staff_id, p_pin);
  if not (v_pin ->> 'ok')::boolean then return v_pin; end if;

  update public.devices set last_seen_at = now(), last_staff_id = p_staff_id where user_id = auth.uid();

  -- One cashier per phone at a time: a new sign-in ends this phone's other live sessions.
  update public.staff_sessions set revoked_at = now() where device_user_id = auth.uid() and revoked_at is null;

  select name into v_name from public.staff where id = p_staff_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_date := private.business_date(v_shop);
  insert into public.staff_sessions (token_hash, shop_id, staff_id, device_user_id, business_date)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_shop, p_staff_id, auth.uid(), v_date);

  return jsonb_build_object('ok', true, 'token', v_token, 'staff_id', p_staff_id, 'name', v_name, 'business_date', v_date);
end $$;

-- 4. The pairing code is removed (no second way into a store). Revoked rows go; nothing sets revoked_at any more.
drop function public.create_pairing_code(uuid);
drop function public.redeem_pairing_code(text, text);
drop table public.pairing_codes;
delete from public.devices where revoked_at is not null;
revoke update (revoked_at) on public.devices from authenticated;

revoke all on function public.owner_get_join_key(uuid), public.owner_rotate_join_key(uuid),
  public.join_shop(text, text, boolean), public.owner_remove_device(uuid), public.owner_list_devices(uuid)
  from public, anon;
grant execute on function public.owner_get_join_key(uuid), public.owner_rotate_join_key(uuid),
  public.join_shop(text, text, boolean), public.owner_remove_device(uuid), public.owner_list_devices(uuid)
  to authenticated;
