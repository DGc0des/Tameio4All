-- 150 — 6-digit staff PINs, hard cutover (H24): check_pin format, `pin_not_set` for a cashier with no PIN (never
-- counted), the owner's `has_pin` column, the migration's cutover statements. One transaction, ends in ROLLBACK.
-- T2/T4/T6 write as the migration owner. T6 runs the cutover on every staff row of the database: it stays last.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, cashiers S1 (123456) and S2 (222222), the store key. Owner B: a shop of their own (for T5).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.s1', public.create_staff(current_setting('t.shop')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.s2', public.create_staff(current_setting('t.shop')::uuid, 'ΝΙΚΟΣ', '222222')::text, true);
select set_config('t.key', public.owner_get_join_key(current_setting('t.shop')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;

-- Phones d1 (S2 signs in once: d1 is trusted for S2) and d2 (trusted for nobody) join shop A.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Ταμείο');
do $$ begin
  if (public.staff_sign_in(current_setting('t.s2')::uuid, '222222') ->> 'ok')::boolean is not true then raise exception 'setup S2 on d1 failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Δεύτερο');
reset role;

-- T1 create_staff and set_staff_pin take exactly 6 digits: 4- and 5-digit PINs are bad_pin_format
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  p text;
  refused boolean;
begin
  foreach p in array array['1234', '12345'] loop
    refused := false;
    begin
      perform public.create_staff(current_setting('t.shop')::uuid, 'ΕΛΕΝΗ', p);
    exception when others then
      if sqlerrm <> 'bad_pin_format' then raise exception 'T1 create_staff % wrong error: %', p, sqlerrm; end if;
      refused := true;
    end;
    if not refused then raise exception 'T1 create_staff accepted PIN %', p; end if;

    refused := false;
    begin
      perform public.set_staff_pin(current_setting('t.s1')::uuid, p);
    exception when others then
      if sqlerrm <> 'bad_pin_format' then raise exception 'T1 set_staff_pin % wrong error: %', p, sqlerrm; end if;
      refused := true;
    end;
    if not refused then raise exception 'T1 set_staff_pin accepted PIN %', p; end if;
  end loop;
end $$;
select set_config('t.s3', public.create_staff(current_setting('t.shop')::uuid, 'ΕΛΕΝΗ', '123456')::text, true);
select public.set_staff_pin(current_setting('t.s3')::uuid, '345678');
reset role;
do $$ begin
  if current_setting('t.s3', true) is null or current_setting('t.s3') = '' then raise exception 'T1 create_staff with 6 digits failed'; end if;
  if (select extensions.crypt('345678', pin_hash) = pin_hash from public.staff where id = current_setting('t.s3')::uuid) is not true then
    raise exception 'T1 set_staff_pin with 6 digits did not store the PIN';
  end if;
  if (select extensions.crypt('123456', pin_hash) = pin_hash from public.staff where id = current_setting('t.s1')::uuid) is not true then
    raise exception 'T1 a refused set_staff_pin changed the PIN';
  end if;
end $$;

-- T2 S2 has no PIN (pin_hash null, set as the migration owner): any PIN → pin_not_set, no token; nothing is counted,
-- locked or trusted, on the trusted phone d1 or the untrusted d2, even after 6 attempts each.
update public.staff set pin_hash = null, failed_attempts = 3 where id = current_setting('t.s2')::uuid;
update public.device_staff_trust set failed_attempts = 2
 where device_user_id = '00000000-0000-0000-0000-0000000000d1' and staff_id = current_setting('t.s2')::uuid;
select set_config('t.t2_sessions', (select count(*) from public.staff_sessions where staff_id = current_setting('t.s2')::uuid)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  r jsonb;
  i int;
begin
  for i in 1..6 loop
    r := public.staff_sign_in(current_setting('t.s2')::uuid, case when i % 2 = 0 then '222222' else '000000' end);
    if r is distinct from jsonb_build_object('ok', false, 'error', 'pin_not_set') then raise exception 'T2 d1 attempt % expected pin_not_set: %', i, r; end if;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  r jsonb;
  i int;
begin
  for i in 1..6 loop
    r := public.staff_sign_in(current_setting('t.s2')::uuid, case when i % 2 = 0 then '222222' else '1234' end);
    if r is distinct from jsonb_build_object('ok', false, 'error', 'pin_not_set') then raise exception 'T2 d2 attempt % expected pin_not_set: %', i, r; end if;
  end loop;
end $$;
reset role;
do $$ begin
  if (select failed_attempts <> 3 or locked_until is not null or lock_level <> 0 from public.staff where id = current_setting('t.s2')::uuid) then
    raise exception 'T2 the cashier counter or lock changed';
  end if;
  if (select failed_attempts from public.device_staff_trust
       where device_user_id = '00000000-0000-0000-0000-0000000000d1' and staff_id = current_setting('t.s2')::uuid) is distinct from 2 then
    raise exception 'T2 the trusted-phone counter changed';
  end if;
  if (select count(*) from public.device_staff_trust where staff_id = current_setting('t.s2')::uuid) <> 1 then
    raise exception 'T2 a trust row was added or removed';
  end if;
  if exists (select 1 from public.devices where shop_id = current_setting('t.shop')::uuid and (locked_until is not null or lock_level <> 0)) then
    raise exception 'T2 a phone was locked';
  end if;
  if (select count(*) from public.staff_sessions where staff_id = current_setting('t.s2')::uuid) <> current_setting('t.t2_sessions')::int then
    raise exception 'T2 a session was created';
  end if;
  if exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d2' and last_staff_id is not null) then
    raise exception 'T2 pin_not_set stamped last use';
  end if;
end $$;

-- T3 the owner sets a new 6-digit PIN: on d2 the old 4-digit form → bad_pin (counted on the cashier track, which
-- set_staff_pin reset to 0); the new PIN signs in.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.set_staff_pin(current_setting('t.s2')::uuid, '654321');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.staff_sign_in(current_setting('t.s2')::uuid, '6543');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_pin') then raise exception 'T3 4-digit PIN: %', r; end if;
end $$;
reset role;
-- (the phone cannot read public.staff, so the counter is checked as the migration owner)
do $$ begin
  if (select failed_attempts from public.staff where id = current_setting('t.s2')::uuid) is distinct from 1 then
    raise exception 'T3 the 4-digit PIN was not counted';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.staff_sign_in(current_setting('t.s2')::uuid, '654321');
  if (r ->> 'ok')::boolean is not true or coalesce(r ->> 'token', '') = '' then raise exception 'T3 new PIN refused: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select failed_attempts from public.staff where id = current_setting('t.s2')::uuid) <> 0 then raise exception 'T3 counter not reset by the correct PIN'; end if;
end $$;

-- T4 a locked phone answers device_locked before pin_not_set; once unlocked, pin_not_set
update public.staff set pin_hash = null where id = current_setting('t.s2')::uuid;
update public.devices set locked_until = now() + interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.staff_sign_in(current_setting('t.s2')::uuid, '654321');
  if r ->> 'error' is distinct from 'device_locked' or r ->> 'locked_until' is null then raise exception 'T4 locked phone: %', r; end if;
end $$;
reset role;
update public.devices set locked_until = null where user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.staff_sign_in(current_setting('t.s2')::uuid, '654321') is distinct from jsonb_build_object('ok', false, 'error', 'pin_not_set') then
    raise exception 'T4 unlocked phone did not answer pin_not_set';
  end if;
end $$;
reset role;

-- T5 the owner's staff read shows has_pin (S2 none, S1 set); pin_hash stays unreadable; has_pin is read-only and
-- not visible to other owners or anon
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if (select has_pin from public.staff where id = current_setting('t.s2')::uuid) is distinct from false then raise exception 'T5 S2 has_pin not false'; end if;
  if (select has_pin from public.staff where id = current_setting('t.s1')::uuid) is distinct from true then raise exception 'T5 S1 has_pin not true'; end if;
  begin perform pin_hash from public.staff; raise exception 'T5 owner can read pin_hash';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.staff where shop_id = current_setting('t.shop')::uuid) then raise exception 'T5 owner B sees shop A staff'; end if;
end $$;
reset role;
do $$ begin
  if not has_column_privilege('authenticated', 'public.staff', 'has_pin', 'select') then raise exception 'T5 has_pin not readable'; end if;
  if has_column_privilege('authenticated', 'public.staff', 'has_pin', 'update') then raise exception 'T5 has_pin writable'; end if;
  if has_column_privilege('authenticated', 'public.staff', 'pin_hash', 'select') then raise exception 'T5 pin_hash readable'; end if;
  if has_column_privilege('anon', 'public.staff', 'has_pin', 'select') then raise exception 'T5 anon can read has_pin'; end if;
  if has_function_privilege('authenticated', 'private.check_pin(text)', 'execute')
     or has_function_privilege('anon', 'private.check_pin(text)', 'execute')
     or has_function_privilege('authenticated', 'private.check_staff_pin(uuid, uuid, text)', 'execute') then
    raise exception 'T5 a private PIN helper is executable by a client role';
  end if;
  if (select provolatile from pg_proc where oid = 'private.check_pin(text)'::regprocedure) <> 'i'
     or (select prosecdef from pg_proc where oid = 'private.check_pin(text)'::regprocedure) then
    raise exception 'T5 check_pin attributes changed';
  end if;
end $$;

-- T6 the migration's cutover statements (verbatim) on S1, who has a PIN and a live session on d2: afterwards no PIN,
-- has_pin false, the session revoked; trust rows, lock times and levels stay.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select set_config('t.s1_token', public.staff_sign_in(current_setting('t.s1')::uuid, '123456') ->> 'token', true);
reset role;
update public.staff set locked_until = now() - interval '1 hour', lock_level = 2 where id = current_setting('t.s1')::uuid;
select set_config('t.t6_trust', (select count(*) from public.device_staff_trust where staff_id in (current_setting('t.s1')::uuid, current_setting('t.s2')::uuid))::text, true);
do $$ begin
  if coalesce(current_setting('t.s1_token'), '') = '' then raise exception 'T6 setup: S1 sign-in failed'; end if;
  if not exists (select 1 from public.staff_sessions where staff_id = current_setting('t.s1')::uuid and revoked_at is null) then
    raise exception 'T6 setup: no live session';
  end if;
end $$;
update public.staff set pin_hash = null, failed_attempts = 0;
update public.staff_sessions set revoked_at = now() where revoked_at is null;
do $$ begin
  if (select pin_hash is not null or has_pin from public.staff where id = current_setting('t.s1')::uuid) then raise exception 'T6 S1 still has a PIN'; end if;
  if exists (select 1 from public.staff_sessions where staff_id = current_setting('t.s1')::uuid and revoked_at is null) then
    raise exception 'T6 S1 session not revoked';
  end if;
  if (select locked_until is null or lock_level <> 2 from public.staff where id = current_setting('t.s1')::uuid) then
    raise exception 'T6 the lock time or level was changed';
  end if;
  if (select count(*) from public.device_staff_trust where staff_id in (current_setting('t.s1')::uuid, current_setting('t.s2')::uuid))
     <> current_setting('t.t6_trust')::int then
    raise exception 'T6 trust rows changed';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.staff_sign_in(current_setting('t.s1')::uuid, '123456') is distinct from jsonb_build_object('ok', false, 'error', 'pin_not_set') then
    raise exception 'T6 the old PIN still signs in';
  end if;
end $$;
reset role;

rollback;
