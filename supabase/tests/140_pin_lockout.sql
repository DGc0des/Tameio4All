-- 140 — PIN lockout (H24, M39, L93): two counting tracks (cashier / trusted phone), escalating lock time,
-- owner unlock, trust rows going with the device, verify_staff_pin gone, back-fill. One transaction, ends in ROLLBACK.
-- now() is the transaction start time, so it is the same in every statement here.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, cashiers S1 (1111) and S2 (2222), the store key. Owner B: a second shop (for T12).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.s1', public.create_staff(current_setting('t.shop')::uuid, 'ΜΑΡΙΑ', '1111')::text, true);
select set_config('t.s2', public.create_staff(current_setting('t.shop')::uuid, 'ΝΙΚΟΣ', '2222')::text, true);
select set_config('t.key', public.owner_get_join_key(current_setting('t.shop')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.key_b', public.owner_get_join_key(current_setting('t.shop_b')::uuid), true);
reset role;

-- Phones d1 (shop phone), d2 (attacker), d3, d4 all join shop A.
-- S1 signs in once on d1 (d1 now trusted for S1); S1 and S2 each sign in once on d4.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Ταμείο');
do $$ begin
  if (public.staff_sign_in(current_setting('t.s1')::uuid, '1111') ->> 'ok')::boolean is not true then raise exception 'setup S1 on d1 failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Ξένο');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Τρίτο');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Τέταρτο');
do $$ begin
  if (public.staff_sign_in(current_setting('t.s1')::uuid, '1111') ->> 'ok')::boolean is not true then raise exception 'setup S1 on d4 failed'; end if;
  if (public.staff_sign_in(current_setting('t.s2')::uuid, '2222') ->> 'ok')::boolean is not true then raise exception 'setup S2 on d4 failed'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d1' and staff_id = current_setting('t.s1')::uuid) then
    raise exception 'setup d1 not trusted for S1 after a correct PIN';
  end if;
  if (select count(*) from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d4') <> 2 then
    raise exception 'setup d4 not trusted for S1 and S2';
  end if;
end $$;

-- T1 d2 (untrusted): 4 wrong PINs for S1 → bad_pin; the 5th → staff_locked ≈ now + 15 min, lock_level 1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  for i in 1..4 loop
    r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
    if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_pin') then raise exception 'T1 attempt % expected bad_pin: %', i, r; end if;
  end loop;
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
  if r ->> 'error' is distinct from 'staff_locked' then raise exception 'T1 5th attempt expected staff_locked: %', r; end if;
  if (r ->> 'locked_until')::timestamptz is distinct from now() + interval '15 minutes' then raise exception 'T1 locked_until not now + 15 min: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select locked_until from public.staff where id = current_setting('t.s1')::uuid) is distinct from now() + interval '15 minutes' then
    raise exception 'T1 staff lock not persisted for 15 minutes';
  end if;
  if (select lock_level from public.staff where id = current_setting('t.s1')::uuid) <> 1 then raise exception 'T1 lock_level not 1'; end if;
  if (select failed_attempts from public.staff where id = current_setting('t.s1')::uuid) <> 0 then raise exception 'T1 counter not reset when the lock starts'; end if;
  if (select locked_until from public.devices where user_id = '00000000-0000-0000-0000-0000000000d2') is not null then raise exception 'T1 untrusted track locked the phone'; end if;
end $$;

-- T2 d2, S1 locked: the correct PIN → staff_locked (no PIN comparison leaks), no trust row, no session
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '1111');
  if r ->> 'error' is distinct from 'staff_locked' or r ->> 'locked_until' is null then raise exception 'T2 correct PIN while locked: %', r; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d2') then raise exception 'T2 locked attempt made d2 trusted'; end if;
  if exists (select 1 from public.staff_sessions where device_user_id = '00000000-0000-0000-0000-0000000000d2') then raise exception 'T2 locked attempt created a session'; end if;
end $$;

-- T3 (Review Focus 2) d1, trusted for S1, while S1 is locked: the correct PIN → ok with a token; the lock stays
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '1111');
  if (r ->> 'ok')::boolean is not true or r ->> 'token' !~ '^[0-9a-f]{64}$' then raise exception 'T3 trusted phone refused while cashier locked: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select locked_until from public.staff where id = current_setting('t.s1')::uuid) is distinct from now() + interval '15 minutes' then
    raise exception 'T3 a correct PIN cleared locked_until';
  end if;
  if (select lock_level from public.staff where id = current_setting('t.s1')::uuid) <> 1 then raise exception 'T3 a correct PIN changed lock_level'; end if;
end $$;

-- T4 escalation: the lock just ended → next lock 30 min, level 2; the previous lock ended over 7 days ago →
-- the level restarts: 15 min, level 1. (locked_until is set as the migration owner.)
update public.staff set locked_until = now() - interval '1 minute' where id = current_setting('t.s1')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  for i in 1..4 loop
    r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
    if r ->> 'error' is distinct from 'bad_pin' then raise exception 'T4 attempt % expected bad_pin: %', i, r; end if;
  end loop;
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
  if r ->> 'error' is distinct from 'staff_locked' or (r ->> 'locked_until')::timestamptz is distinct from now() + interval '30 minutes' then
    raise exception 'T4 second lock not 30 min: %', r;
  end if;
end $$;
reset role;
do $$ begin
  if (select locked_until from public.staff where id = current_setting('t.s1')::uuid) is distinct from now() + interval '30 minutes' then raise exception 'T4 second lock not persisted'; end if;
  if (select lock_level from public.staff where id = current_setting('t.s1')::uuid) <> 2 then raise exception 'T4 lock_level not 2'; end if;
end $$;
update public.staff set locked_until = now() - interval '8 days' where id = current_setting('t.s1')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  for i in 1..4 loop
    r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
    if r ->> 'error' is distinct from 'bad_pin' then raise exception 'T4 (decay) attempt % expected bad_pin: %', i, r; end if;
  end loop;
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
  if r ->> 'error' is distinct from 'staff_locked' or (r ->> 'locked_until')::timestamptz is distinct from now() + interval '15 minutes' then
    raise exception 'T4 lock after 7 quiet days not 15 min: %', r;
  end if;
end $$;
reset role;
do $$ begin
  if (select lock_level from public.staff where id = current_setting('t.s1')::uuid) <> 1 then raise exception 'T4 lock_level did not restart (expected 1)'; end if;
end $$;

-- T5 (Review Focus 1) trusted track: on d1, 4 wrong PINs for S1 → bad_pin and S1's cashier counter is untouched;
-- the 5th → device_locked; then S2's correct PIN on d1 → device_locked; S2's correct PIN on d3 → ok.
select set_config('t.s1_failed', (select failed_attempts from public.staff where id = current_setting('t.s1')::uuid)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  for i in 1..4 loop
    r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
    if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_pin') then raise exception 'T5 attempt % expected bad_pin: %', i, r; end if;
  end loop;
end $$;
reset role;
do $$ begin
  if (select failed_attempts from public.staff where id = current_setting('t.s1')::uuid) <> current_setting('t.s1_failed')::int then
    raise exception 'T5 trusted-phone misses counted on the cashier';
  end if;
  if (select failed_attempts from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d1' and staff_id = current_setting('t.s1')::uuid) <> 4 then
    raise exception 'T5 trust counter not 4';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
  if r ->> 'error' is distinct from 'device_locked' or (r ->> 'locked_until')::timestamptz is distinct from now() + interval '15 minutes' then
    raise exception 'T5 5th attempt expected device_locked for 15 min: %', r;
  end if;
  r := public.staff_sign_in(current_setting('t.s2')::uuid, '2222');
  if r ->> 'error' is distinct from 'device_locked' or r ->> 'locked_until' is null then raise exception 'T5 S2 signed in on a locked phone: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select locked_until from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is distinct from now() + interval '15 minutes' then
    raise exception 'T5 device lock not persisted';
  end if;
  if (select lock_level from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') <> 1 then raise exception 'T5 device lock_level not 1'; end if;
  if (select failed_attempts from public.staff where id = current_setting('t.s1')::uuid) <> current_setting('t.s1_failed')::int then
    raise exception 'T5 device lock touched the cashier counter';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.staff_sign_in(current_setting('t.s2')::uuid, '2222');
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 S2 refused on another phone: %', r; end if;
end $$;
reset role;

-- T6 the trusted counter is per cashier: on d4, 4 wrong for S1, S2 signs in correctly, 1 more wrong for S1 →
-- device_locked (S2's success did not reset S1's count)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  for i in 1..4 loop
    r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
    if r ->> 'error' is distinct from 'bad_pin' then raise exception 'T6 attempt % expected bad_pin: %', i, r; end if;
  end loop;
  r := public.staff_sign_in(current_setting('t.s2')::uuid, '2222');
  if (r ->> 'ok')::boolean is not true then raise exception 'T6 S2 refused on d4: %', r; end if;
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
  if r ->> 'error' is distinct from 'device_locked' then raise exception 'T6 S2 success reset S1 trust counter: %', r; end if;
end $$;
reset role;

-- T7 unlock_staff and set_staff_pin clear the counter, the lock and the level
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.unlock_staff(current_setting('t.s1')::uuid);
reset role;
do $$ begin
  if (select failed_attempts <> 0 or locked_until is not null or lock_level <> 0 from public.staff where id = current_setting('t.s1')::uuid) then
    raise exception 'T7 unlock_staff did not reset failed_attempts/locked_until/lock_level';
  end if;
end $$;
update public.staff set failed_attempts = 3, locked_until = now() + interval '1 hour', lock_level = 4 where id = current_setting('t.s1')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.set_staff_pin(current_setting('t.s1')::uuid, '1111');
reset role;
do $$ begin
  if (select failed_attempts <> 0 or locked_until is not null or lock_level <> 0 from public.staff where id = current_setting('t.s1')::uuid) then
    raise exception 'T7 set_staff_pin did not reset failed_attempts/locked_until/lock_level';
  end if;
end $$;

-- T8 owner_remove_device(d1) deletes its trust rows (and its lock); after re-joining d1 is untrusted for S1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_remove_device('00000000-0000-0000-0000-0000000000d1');
reset role;
do $$ begin
  if exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T8 trust rows survived the removal'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Ταμείο');
do $$ declare r jsonb; begin
  r := public.staff_sign_in(current_setting('t.s1')::uuid, '0000');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_pin') then raise exception 'T8 re-joined phone: %', r; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T8 re-joined phone is trusted'; end if;
  if (select failed_attempts from public.staff where id = current_setting('t.s1')::uuid) <> 1 then raise exception 'T8 miss on the re-joined phone not on the cashier track'; end if;
  if (select locked_until from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is not null then raise exception 'T8 lock survived the removal'; end if;
end $$;

-- T9 private.lock_duration (called as the migration owner)
do $$ begin
  if private.lock_duration(0) <> interval '15 minutes' then raise exception 'T9 level 0 not 15 min: %', private.lock_duration(0); end if;
  if private.lock_duration(1) <> interval '30 minutes' then raise exception 'T9 level 1 not 30 min: %', private.lock_duration(1); end if;
  if private.lock_duration(3) <> interval '2 hours' then raise exception 'T9 level 3 not 2 h: %', private.lock_duration(3); end if;
  if private.lock_duration(6) <> interval '16 hours' then raise exception 'T9 level 6 not 16 h: %', private.lock_duration(6); end if;
  if private.lock_duration(7) <> interval '24 hours' then raise exception 'T9 level 7 not 24 h: %', private.lock_duration(7); end if;
  if private.lock_duration(50) <> interval '24 hours' then raise exception 'T9 level 50 not 24 h: %', private.lock_duration(50); end if;
end $$;

-- T10 verify_staff_pin is gone; no client privilege on device_staff_trust, the new device columns or lock_duration
do $$ begin
  if to_regprocedure('public.verify_staff_pin(uuid, text)') is not null then raise exception 'T10 verify_staff_pin still exists'; end if;
  if has_table_privilege('authenticated', 'public.device_staff_trust', 'select, insert, update, delete')
     or has_table_privilege('anon', 'public.device_staff_trust', 'select, insert, update, delete') then
    raise exception 'T10 a client role has a privilege on device_staff_trust';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.device_staff_trust'::regclass) then raise exception 'T10 RLS off on device_staff_trust'; end if;
  if has_function_privilege('authenticated', 'private.lock_duration(int)', 'execute')
     or has_function_privilege('anon', 'private.lock_duration(int)', 'execute') then
    raise exception 'T10 private.lock_duration is executable by a client role';
  end if;
  if has_column_privilege('authenticated', 'public.devices', 'locked_until', 'update')
     or has_column_privilege('authenticated', 'public.devices', 'lock_level', 'update')
     or has_column_privilege('authenticated', 'public.staff', 'lock_level', 'update') then
    raise exception 'T10 a client can change a lock column';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform 1 from public.device_staff_trust; exception when insufficient_privilege then return; end;
  raise exception 'T10 a phone can read device_staff_trust';
end $$;
reset role;

-- T11 back-fill: a (device, staff) pair with a staff_sessions row gets a trust row (the migration's statement)
delete from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d3';
insert into public.staff_sessions (token_hash, shop_id, staff_id, device_user_id, business_date)
values (encode(extensions.digest('t11-token', 'sha256'), 'hex'), current_setting('t.shop')::uuid,
        current_setting('t.s1')::uuid, '00000000-0000-0000-0000-0000000000d3', current_date);
insert into public.device_staff_trust (device_user_id, staff_id) select distinct ss.device_user_id, ss.staff_id from public.staff_sessions ss join public.devices d on d.user_id = ss.device_user_id and d.shop_id = ss.shop_id on conflict do nothing;
do $$ begin
  if not exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d3' and staff_id = current_setting('t.s1')::uuid) then
    raise exception 'T11 back-fill missed (d3, S1)';
  end if;
  if not exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d3' and staff_id = current_setting('t.s2')::uuid) then
    raise exception 'T11 back-fill missed (d3, S2) from its real sign-in';
  end if;
end $$;

-- T12 a phone that switches to another shop loses its trust rows and its lock (d4 is device_locked from T6)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_b'), 'Αλλού', true);
reset role;
do $$ begin
  if exists (select 1 from public.device_staff_trust where device_user_id = '00000000-0000-0000-0000-0000000000d4') then raise exception 'T12 trust rows kept after switching shop'; end if;
  if (select locked_until is not null or lock_level <> 0 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d4') then
    raise exception 'T12 lock kept after switching shop';
  end if;
end $$;

rollback;
