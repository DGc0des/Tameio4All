-- Stage 1: per-shop day-change time, the business date, and staff sessions (one cashier on one
-- phone for one business date). The business day is computed only by private.business_date.

-- 1. Day-change time. A change takes effect from the next business day: until
--    day_change_switch_at the previous time (prev_day_change_time) is still in force.
--    Owners read these through the existing shops select grant; they change them only through
--    set_day_change_time (no new column update grant).
alter table public.shops
  add column day_change_time time not null default '04:00',
  add column prev_day_change_time time,
  add column day_change_switch_at timestamptz;

-- The business date of a shop at a moment, in Europe/Athens. Before the switch moment the old
-- day-change time applies; from it on, the new time applies but the date never goes back before
-- the switch day (so moving the time later cannot reopen the day that just closed).
create function private.business_date(p_shop_id uuid, p_at timestamptz default now()) returns date
language plpgsql stable security definer set search_path = '' as $$
declare
  v_local timestamp := p_at at time zone 'Europe/Athens';
  s public.shops;
begin
  select * into s from public.shops where id = p_shop_id;
  if not found then return null; end if;
  if s.day_change_switch_at is null or p_at >= s.day_change_switch_at then
    if s.day_change_switch_at is null then
      return (v_local - s.day_change_time::interval)::date;
    end if;
    return greatest((v_local - s.day_change_time::interval)::date,
                    (s.day_change_switch_at at time zone 'Europe/Athens')::date);
  end if;
  return (v_local - coalesce(s.prev_day_change_time, s.day_change_time)::interval)::date;
end $$;

revoke all on function private.business_date(uuid, timestamptz) from public, anon, authenticated;

-- Owner: set the day-change time. Returns the first business date the new time applies to.
create function public.set_day_change_time(p_shop_id uuid, p_time time) returns date
language plpgsql security definer set search_path = '' as $$
declare
  s public.shops;
  v_today date;
  v_in_force time;
begin
  perform private.require_owner(p_shop_id);
  select * into s from public.shops where id = p_shop_id for update;
  v_today := private.business_date(p_shop_id, now());
  v_in_force := case when s.day_change_switch_at is not null and now() < s.day_change_switch_at
                     then coalesce(s.prev_day_change_time, s.day_change_time)
                     else s.day_change_time end;
  update public.shops
     set prev_day_change_time = v_in_force,
         day_change_time = p_time,
         day_change_switch_at = ((v_today + 1) + v_in_force) at time zone 'Europe/Athens'
   where id = p_shop_id;
  return v_today + 1;
end $$;

revoke all on function public.set_day_change_time(uuid, time) from public, anon;
grant execute on function public.set_day_change_time(uuid, time) to authenticated;

-- 2. Staff sessions. Only sha256(token) is stored. No client can touch the table.
create table public.staff_sessions (
  token_hash text primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete cascade,
  device_user_id uuid not null,
  business_date date not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index staff_sessions_shop_idx on public.staff_sessions (shop_id);
create index staff_sessions_staff_idx on public.staff_sessions (staff_id);
create index staff_sessions_device_idx on public.staff_sessions (device_user_id);

alter table public.staff_sessions enable row level security;
revoke all on public.staff_sessions from public, anon, authenticated;

-- Phone: sign a cashier in, ending any other live session on this phone. Never raises for
-- expected failures (check_staff_pin's lockout counter must not be rolled back).
create function public.staff_sign_in(p_staff_id uuid, p_pin text) returns jsonb
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

  -- One cashier per phone at a time: a new sign-in ends this phone's other live sessions.
  update public.staff_sessions set revoked_at = now() where device_user_id = auth.uid() and revoked_at is null;

  select name into v_name from public.staff where id = p_staff_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_date := private.business_date(v_shop);
  insert into public.staff_sessions (token_hash, shop_id, staff_id, device_user_id, business_date)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_shop, p_staff_id, auth.uid(), v_date);

  return jsonb_build_object('ok', true, 'token', v_token, 'staff_id', p_staff_id, 'name', v_name, 'business_date', v_date);
end $$;

-- Phone: end a session. Idempotent; only this phone's sessions; never raises for unknown tokens.
create function public.staff_sign_out(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.staff_sessions set revoked_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and device_user_id = auth.uid() and revoked_at is null;
end $$;

revoke all on function public.staff_sign_in(uuid, text), public.staff_sign_out(text) from public, anon;
grant execute on function public.staff_sign_in(uuid, text), public.staff_sign_out(text) to authenticated;

-- Server-side session check for phone functions: device first, then a live session of this
-- phone, for today's business date, whose cashier is still active in this shop.
create function private.staff_session(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dev jsonb := private.device_shop();
  v_shop uuid;
  v_staff uuid;
begin
  if not (v_dev ->> 'ok')::boolean then return v_dev; end if;
  v_shop := (v_dev ->> 'shop_id')::uuid;
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'session_invalid'); end if;

  select ss.staff_id into v_staff
    from public.staff_sessions ss
    join public.staff st on st.id = ss.staff_id and st.shop_id = v_shop and st.active
   where ss.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and ss.device_user_id = auth.uid()
     and ss.shop_id = v_shop
     and ss.revoked_at is null
     and ss.business_date = private.business_date(v_shop);
  if v_staff is null then return jsonb_build_object('ok', false, 'error', 'session_invalid'); end if;
  return jsonb_build_object('ok', true, 'shop_id', v_shop, 'staff_id', v_staff);
end $$;

revoke all on function private.staff_session(text) from public, anon, authenticated;

-- 3. device_context gains the shop's current business date (return type changes → drop + create).
drop function public.device_context();
create function public.device_context()
returns table (shop_id uuid, shop_name text, config_id uuid, version int, config jsonb, business_date date)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, c.id, c.version, c.config, private.business_date(s.id)
  from public.devices d
  join public.shops s on s.id = d.shop_id
  join lateral (
    select sc.id, sc.version, sc.config from public.shop_configs sc
    where sc.shop_id = s.id order by sc.version desc limit 1
  ) c on true
  where d.user_id = (select auth.uid()) and d.revoked_at is null;
$$;

revoke all on function public.device_context() from public, anon;
grant execute on function public.device_context() to authenticated;
