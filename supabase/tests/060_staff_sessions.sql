-- 060 — day-change time, business date, staff sessions. One transaction, ends in ROLLBACK.
-- private.* functions are not callable by clients, so they are called as the postgres role with
-- request.jwt.claims set to the phone (auth.uid() reads the claims, not the role).
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, staff ΜΑΡΙΑ, code. Owner B: shop + staff ΝΙΚΟΣ (for cross-shop checks).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.code', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop_b')::uuid, 'ΝΙΚΟΣ', '1234')::text, true);
reset role;

-- Phone D1 pairs with shop A; phone D2 stays unpaired.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code'), 'Ταμείο');
reset role;
select set_config('t.bd_a', private.business_date(current_setting('t.shop_a')::uuid)::text, true);

-- T1 sign in from d1 → ok, 64-hex token, today's business date
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.staff_sign_in(current_setting('t.maria')::uuid, '1234');
  if (r ->> 'ok')::boolean is not true then raise exception 'T1 sign-in failed: %', r; end if;
  if r ->> 'token' !~ '^[0-9a-f]{64}$' then raise exception 'T1 token not 64 hex: %', r; end if;
  if r ->> 'staff_id' <> current_setting('t.maria') or r ->> 'name' <> 'ΜΑΡΙΑ' then raise exception 'T1 wrong staff: %', r; end if;
  perform set_config('t.token', r ->> 'token', true);
  perform set_config('t.bd_signin', r ->> 'business_date', true);
end $$;
reset role;
-- The returned date is the shop's business date (either side of the call, so a run that
-- crosses the day-change moment can't fail falsely).
do $$ begin
  if current_setting('t.bd_signin')::date not in (current_setting('t.bd_a')::date, private.business_date(current_setting('t.shop_a')::uuid, now())) then
    raise exception 'T1 wrong business_date: %', current_setting('t.bd_signin');
  end if;
end $$;

-- T2 the raw token is not stored, only its sha256
do $$ begin
  if exists (select 1 from public.staff_sessions where token_hash = current_setting('t.token')) then
    raise exception 'T2 raw token stored';
  end if;
  if not exists (select 1 from public.staff_sessions
                 where token_hash = encode(extensions.digest(current_setting('t.token'), 'sha256'), 'hex')
                   and staff_id = current_setting('t.maria')::uuid
                   and device_user_id = '00000000-0000-0000-0000-0000000000d1'
                   and business_date = current_setting('t.bd_signin')::date) then
    raise exception 'T2 session row (hash) missing';
  end if;
end $$;

-- T3 unpaired phone → not_a_device; another shop's staff → staff_not_found
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.staff_sign_in(current_setting('t.maria')::uuid, '1234') is distinct from jsonb_build_object('ok', false, 'error', 'not_a_device') then
    raise exception 'T3 unpaired phone signed in';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.staff_sign_in(current_setting('t.nikos')::uuid, '1234') is distinct from jsonb_build_object('ok', false, 'error', 'staff_not_found') then
    raise exception 'T3 other shop staff signed in';
  end if;
end $$;
reset role;

-- T5 staff_session: d1 → ok with maria; d2 → not_a_device; random token → session_invalid
do $$
declare r jsonb;
begin
  r := private.staff_session(current_setting('t.token'));
  if r is distinct from jsonb_build_object('ok', true, 'shop_id', current_setting('t.shop_a')::uuid, 'staff_id', current_setting('t.maria')::uuid) then
    raise exception 'T5 session not recognised: %', r;
  end if;
  if private.staff_session(encode(extensions.gen_random_bytes(32), 'hex')) is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then
    raise exception 'T5 random token accepted';
  end if;
  if private.staff_session(null) is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then
    raise exception 'T5 null token accepted';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
  if private.staff_session(current_setting('t.token')) is distinct from jsonb_build_object('ok', false, 'error', 'not_a_device') then
    raise exception 'T5 d2 used d1 session';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
end $$;

-- T6 sign out → session_invalid; signing out twice (or an unknown token) does not raise
set local role authenticated;
select public.staff_sign_out(current_setting('t.token'));
select public.staff_sign_out(current_setting('t.token'));
select public.staff_sign_out('not-a-token');
select public.staff_sign_out(null);
reset role;
do $$ begin
  if private.staff_session(current_setting('t.token')) is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then
    raise exception 'T6 signed-out session still valid';
  end if;
end $$;

-- T4 5 wrong PINs → 5th is staff_locked; the lock is persisted (returned, not raised)
set local role authenticated;
do $$
declare r jsonb;
begin
  for i in 1..4 loop
    r := public.staff_sign_in(current_setting('t.maria')::uuid, '9999');
    if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_pin') then raise exception 'T4 attempt % expected bad_pin: %', i, r; end if;
  end loop;
  r := public.staff_sign_in(current_setting('t.maria')::uuid, '9999');
  if r ->> 'error' is distinct from 'staff_locked' or r ->> 'locked_until' is null then raise exception 'T4 5th attempt expected staff_locked: %', r; end if;
  r := public.staff_sign_in(current_setting('t.maria')::uuid, '1234');
  if r ->> 'error' is distinct from 'staff_locked' then raise exception 'T4 correct PIN while locked: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select locked_until from public.staff where id = current_setting('t.maria')::uuid) is null then
    raise exception 'T4 lockout not persisted';
  end if;
  if exists (select 1 from public.staff_sessions where staff_id = current_setting('t.maria')::uuid and revoked_at is null) then
    raise exception 'T4 failed sign-in created a session';
  end if;
end $$;

-- Owner A unlocks maria for the next tests.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.unlock_staff(current_setting('t.maria')::uuid);
reset role;

-- T7 a revoked d1 → device_revoked; owner deactivates maria → session_invalid
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select set_config('t.token2', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
-- Nothing in the app sets revoked_at any more (stage 4); set it as the migration owner to keep the check.
update public.devices set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
do $$ begin
  if current_setting('t.token2') !~ '^[0-9a-f]{64}$' then raise exception 'T7 setup sign-in failed'; end if;
  if private.staff_session(current_setting('t.token2')) is distinct from jsonb_build_object('ok', false, 'error', 'device_revoked') then
    raise exception 'T7 revoked phone session still valid';
  end if;
end $$;
-- Restore the device (as postgres) to isolate the staff-deactivation case.
update public.devices set revoked_at = null where user_id = '00000000-0000-0000-0000-0000000000d1';
do $$ begin
  if (private.staff_session(current_setting('t.token2')) ->> 'ok')::boolean is not true then raise exception 'T7 setup: session should be valid again'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
update public.staff set active = false where id = current_setting('t.maria')::uuid;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
do $$ begin
  if private.staff_session(current_setting('t.token2')) is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then
    raise exception 'T7 deactivated staff session still valid';
  end if;
end $$;
update public.staff set active = true where id = current_setting('t.maria')::uuid;

-- T8 the business day changed since sign-in → session_invalid
do $$ begin
  if (private.staff_session(current_setting('t.token2')) ->> 'ok')::boolean is not true then raise exception 'T8 setup: session should be valid'; end if;
end $$;
update public.staff_sessions set business_date = business_date - 1
  where token_hash = encode(extensions.digest(current_setting('t.token2'), 'sha256'), 'hex');
do $$ begin
  if private.staff_session(current_setting('t.token2')) is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then
    raise exception 'T8 yesterday''s session still valid';
  end if;
end $$;

-- T9 business_date boundary at the default 04:00 day change
update public.shops set day_change_time = '04:00', prev_day_change_time = null, day_change_switch_at = null
  where id = current_setting('t.shop_a')::uuid;
do $$
declare v_shop uuid := current_setting('t.shop_a')::uuid;
begin
  if (select day_change_time from public.shops where id = current_setting('t.shop_b')::uuid) <> '04:00' then
    raise exception 'T9 default day change is not 04:00';
  end if;
  if private.business_date(v_shop, '2026-11-08 03:59 Europe/Athens') <> '2026-11-07' then
    raise exception 'T9 03:59 should be the previous day: %', private.business_date(v_shop, '2026-11-08 03:59 Europe/Athens');
  end if;
  if private.business_date(v_shop, '2026-11-08 04:00 Europe/Athens') <> '2026-11-08' then
    raise exception 'T9 04:00 should be the new day: %', private.business_date(v_shop, '2026-11-08 04:00 Europe/Athens');
  end if;
end $$;

-- T10 set_day_change_time takes effect from the next business day
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.first_day', public.set_day_change_time(current_setting('t.shop_a')::uuid, '06:00')::text, true);
reset role;
do $$
declare
  v_shop uuid := current_setting('t.shop_a')::uuid;
  v_first date := current_setting('t.first_day')::date;
  s public.shops;
begin
  select * into s from public.shops where id = v_shop;
  -- Tomorrow (as of either side of the call, so crossing 04:00 mid-run can't fail falsely).
  if v_first - 1 not in (current_setting('t.bd_a')::date, private.business_date(v_shop, now() - interval '1 second')) then
    raise exception 'T10 first day should be tomorrow: %', v_first;
  end if;
  if s.day_change_time <> '06:00' or s.prev_day_change_time <> '04:00'
     or s.day_change_switch_at <> (v_first + time '04:00') at time zone 'Europe/Athens' then
    raise exception 'T10 wrong stored change: % % %', s.day_change_time, s.prev_day_change_time, s.day_change_switch_at;
  end if;
  -- Today keeps the old time right up to the switch; the new day starts exactly at it.
  if private.business_date(v_shop, s.day_change_switch_at - interval '1 second') <> v_first - 1 then
    raise exception 'T10 change moved today''s business date';
  end if;
  if private.business_date(v_shop, s.day_change_switch_at) <> v_first then
    raise exception 'T10 first day does not start at the switch';
  end if;
end $$;
-- Fixed-moment checks of the switch-over rule.
update public.shops set day_change_time = '06:00', prev_day_change_time = '04:00',
  day_change_switch_at = '2026-11-08 04:00 Europe/Athens' where id = current_setting('t.shop_a')::uuid;
do $$
declare v_shop uuid := current_setting('t.shop_a')::uuid;
begin
  if private.business_date(v_shop, '2026-11-08 03:59 Europe/Athens') <> '2026-11-07' then raise exception 'T10 before switch should use old time'; end if;
  if private.business_date(v_shop, '2026-11-08 05:00 Europe/Athens') <> '2026-11-08' then
    raise exception 'T10 11-08 05:00 should be 11-08: %', private.business_date(v_shop, '2026-11-08 05:00 Europe/Athens');
  end if;
  if private.business_date(v_shop, '2026-11-09 05:00 Europe/Athens') <> '2026-11-08' then
    raise exception 'T10 11-09 05:00 should be 11-08: %', private.business_date(v_shop, '2026-11-09 05:00 Europe/Athens');
  end if;
  if private.business_date(v_shop, '2026-11-09 06:00 Europe/Athens') <> '2026-11-09' then
    raise exception 'T10 11-09 06:00 should be 11-09: %', private.business_date(v_shop, '2026-11-09 06:00 Europe/Athens');
  end if;
end $$;

-- T11 owner B cannot change shop A's day change; nobody but the server reads staff_sessions
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.set_day_change_time(current_setting('t.shop_a')::uuid, '05:00');
  exception when others then
    if sqlerrm = 'not_owner' then return; end if;
    raise exception 'T11 expected not_owner, got %', sqlerrm;
  end;
  raise exception 'T11 owner B changed shop A day change';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform 1 from public.staff_sessions; exception when insufficient_privilege then return; end;
  raise exception 'T11 phone can read staff_sessions';
end $$;
do $$ begin
  begin perform private.business_date(current_setting('t.shop_a')::uuid); exception when insufficient_privilege then return; end;
  raise exception 'T11 phone can call private.business_date';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.staff_sessions; exception when insufficient_privilege then return; end;
  raise exception 'T11 anon can read staff_sessions';
end $$;
do $$ begin
  begin perform public.staff_sign_in(current_setting('t.maria')::uuid, '1234'); exception when insufficient_privilege then return; end;
  raise exception 'T11 anon can call staff_sign_in';
end $$;
reset role;

-- T12 device_context returns the business date
update public.shops set day_change_time = '04:00', prev_day_change_time = null, day_change_switch_at = null
  where id = current_setting('t.shop_a')::uuid;
set local role authenticated;
select set_config('t.ctx_date', (select business_date::text from public.device_context()), true);
do $$ begin
  if (select shop_id from public.device_context()) is distinct from current_setting('t.shop_a')::uuid then
    raise exception 'T12 device_context shop wrong';
  end if;
end $$;
reset role;
do $$ begin
  if current_setting('t.ctx_date', true) is null
     or current_setting('t.ctx_date')::date is distinct from private.business_date(current_setting('t.shop_a')::uuid, now()) then
    raise exception 'T12 device_context business_date wrong: %', current_setting('t.ctx_date', true);
  end if;
end $$;

-- T13 one cashier per phone: a new sign-in ends the phone's earlier live session
set local role authenticated;
select set_config('t.tok_first', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
select set_config('t.tok_second', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
do $$ begin
  if private.staff_session(current_setting('t.tok_first')) is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then
    raise exception 'T13 earlier session still valid after a new sign-in';
  end if;
  if (private.staff_session(current_setting('t.tok_second')) ->> 'ok')::boolean is not true then
    raise exception 'T13 new session not valid';
  end if;
  if (select count(*) from public.staff_sessions where device_user_id = '00000000-0000-0000-0000-0000000000d1' and revoked_at is null) <> 1 then
    raise exception 'T13 phone has more than one live session';
  end if;
end $$;

rollback;
