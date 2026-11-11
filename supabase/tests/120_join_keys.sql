-- 120 — store join keys: owner_get_join_key, owner_rotate_join_key, join_shop, owner_remove_device,
-- owner_list_devices, staff_sign_in stamping. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop A, one cashier.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);

-- T1 the key has the store-key format and is stable across calls
select set_config('t.key_a', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
do $$ begin
  if current_setting('t.key_a') !~ '^[A-HJ-NP-Z2-9]{16}$' then raise exception 'T1 bad key format: %', current_setting('t.key_a'); end if;
  if public.owner_get_join_key(current_setting('t.shop_a')::uuid) <> current_setting('t.key_a') then raise exception 'T1 key changed on a second call'; end if;
end $$;

-- T3a an owner (non-anonymous) session cannot join
do $$ begin
  begin perform public.join_shop(current_setting('t.key_a'), 'x');
  exception when others then if sqlerrm not like '%not_a_device_session%' then raise exception 'T3 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T3 owner joined a shop';
end $$;
reset role;

-- Owner B: shop B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.key_b', public.owner_get_join_key(current_setting('t.shop_b')::uuid), true);

-- T2 owner B gets not_owner from every owner function on shop A
do $$ begin
  begin perform public.owner_get_join_key(current_setting('t.shop_a')::uuid);
    raise exception 'T2 owner B read shop A key';
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2 get wrong error: %', sqlerrm; end if; end;
  begin perform public.owner_rotate_join_key(current_setting('t.shop_a')::uuid);
    raise exception 'T2 owner B rotated shop A';
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2 rotate wrong error: %', sqlerrm; end if; end;
  begin perform * from public.owner_list_devices(current_setting('t.shop_a')::uuid);
    raise exception 'T2 owner B listed shop A devices';
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2 list wrong error: %', sqlerrm; end if; end;
  begin perform public.owner_remove_device(gen_random_uuid());
    raise exception 'T2 remove of a missing id succeeded';
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2 remove missing wrong error: %', sqlerrm; end if; end;
end $$;
reset role;

-- Phone D1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

-- T2b a phone gets not_owner too
do $$ begin
  begin perform public.owner_get_join_key(current_setting('t.shop_a')::uuid);
    raise exception 'T2b phone read the key';
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2b wrong error: %', sqlerrm; end if; end;
end $$;

-- T3b a wrong key is invalid_code
do $$ begin
  begin perform public.join_shop('ABCDEFGHJKLMNPQR', 'x');
  exception when others then if sqlerrm not like '%invalid_code%' then raise exception 'T3b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T3b wrong key accepted';
end $$;

-- T4 join with lower case, dashes and spaces
do $$ declare k text := current_setting('t.key_a'); begin
  if public.join_shop('  ' || lower(substr(k, 1, 4) || '-' || substr(k, 5, 4) || '-' || substr(k, 9, 4) || '-' || substr(k, 13, 4)) || ' ', 'iPhone')
     <> current_setting('t.shop_a')::uuid then
    raise exception 'T4 join returned wrong shop';
  end if;
  if (select count(*) from public.device_context()) <> 1 then raise exception 'T4 no context after join'; end if;
end $$;
reset role;
do $$ begin
  if (select label from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') <> 'iPhone' then raise exception 'T4 label not stored'; end if;
end $$;
update public.devices set created_at = now() - interval '1 day' where user_id = '00000000-0000-0000-0000-0000000000d1';

-- T5 joining again keeps one row, its created_at and its label
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'Other label');
reset role;
do $$ begin
  if (select count(*) from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') <> 1 then raise exception 'T5 not one row'; end if;
  if (select created_at from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') > now() - interval '23 hours' then raise exception 'T5 created_at reset'; end if;
  if (select label from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') <> 'iPhone' then raise exception 'T5 label changed'; end if;
end $$;

-- T7 staff_sign_in stamps last_seen_at/last_staff_id only on a correct PIN
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.staff_sign_in(current_setting('t.maria')::uuid, '0000') ->> 'error' <> 'bad_pin' then raise exception 'T7 wrong PIN not bad_pin'; end if;
end $$;
reset role;
do $$ begin
  if (select last_seen_at from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is not null then raise exception 'T7 wrong PIN stamped last_seen_at'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select set_config('t.tok1', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
do $$ begin
  if current_setting('t.tok1') = '' then raise exception 'T7 correct PIN refused'; end if;
  if (select last_seen_at from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is null then raise exception 'T7 last_seen_at not set'; end if;
  if (select last_staff_id from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') <> current_setting('t.maria')::uuid then raise exception 'T7 last_staff_id not set'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if (select last_staff_name from public.owner_list_devices(current_setting('t.shop_a')::uuid) where user_id = '00000000-0000-0000-0000-0000000000d1') <> 'ΜΑΡΙΑ' then
    raise exception 'T7 owner_list_devices has no last_staff_name';
  end if;
end $$;
reset role;

-- T6 another shop's key: other_shop without switch; with switch the row moves and shop A's session ends
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.join_shop(current_setting('t.key_b'), 'x');
  exception when others then if sqlerrm not like '%other_shop%' then raise exception 'T6 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T6 silent store switch';
end $$;
do $$ begin
  if public.join_shop(current_setting('t.key_b'), 'iPhone', true) <> current_setting('t.shop_b')::uuid then raise exception 'T6 switch returned wrong shop'; end if;
end $$;
reset role;
do $$ begin
  if (select shop_id from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') <> current_setting('t.shop_b')::uuid then raise exception 'T6 row not moved'; end if;
  if (select last_seen_at from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is not null then raise exception 'T6 last_seen_at kept'; end if;
  if (select last_staff_id from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is not null then raise exception 'T6 last_staff_id kept'; end if;
  if exists (select 1 from public.staff_sessions where device_user_id = '00000000-0000-0000-0000-0000000000d1' and revoked_at is null) then
    raise exception 'T6 shop A session still live';
  end if;
end $$;

-- Back to shop A for the rest (switch again).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'iPhone', true);
reset role;

-- T8 owner_remove_device ends D2's session; D2 can come back with the key
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'Android');
select set_config('t.s2', public.staff_sign_in(current_setting('t.maria')::uuid, '1234')::text, true);
select set_config('t.tok2', current_setting('t.s2')::jsonb ->> 'token', true);
select set_config('t.date', current_setting('t.s2')::jsonb ->> 'business_date', true);
reset role;

-- owner B cannot remove shop A's device
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.owner_remove_device('00000000-0000-0000-0000-0000000000d2');
    raise exception 'T2c owner B removed shop A device';
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2c wrong error: %', sqlerrm; end if; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_remove_device('00000000-0000-0000-0000-0000000000d2');
reset role;
do $$ begin
  if exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d2') then raise exception 'T8 row kept'; end if;
  if exists (select 1 from public.staff_sessions where device_user_id = '00000000-0000-0000-0000-0000000000d2' and revoked_at is null) then
    raise exception 'T8 session still live';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.set_closing_field(current_setting('t.tok2'), current_setting('t.date')::date, 'c:card', '{"text":"1"}'::jsonb, null) ->> 'error' <> 'not_a_device' then
    raise exception 'T8 removed phone could still write';
  end if;
  if public.join_shop(current_setting('t.key_a'), 'Android') <> current_setting('t.shop_a')::uuid then raise exception 'T8 removed phone could not rejoin'; end if;
end $$;
reset role;

-- T10 prune: unused 30+ days devices of the joined shop go; other shops' stay
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'D3');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_b'), 'D4');
reset role;
update public.devices set created_at = now() - interval '31 days' where user_id in ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4');
update public.devices set created_at = now() - interval '40 days', last_seen_at = now() - interval '31 days' where user_id = '00000000-0000-0000-0000-0000000000d2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'iPhone');
reset role;
do $$ begin
  if exists (select 1 from public.devices where user_id in ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3')) then
    raise exception 'T10 unused devices of shop A kept';
  end if;
  if not exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T10 the joining device was pruned'; end if;
  if not exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d4') then raise exception 'T10 shop B device pruned'; end if;
end $$;

-- T9 rotation: new key, every device of the shop gone, sessions ended, old key refused, new key joins
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select set_config('t.tok1', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.key_a2', public.owner_rotate_join_key(current_setting('t.shop_a')::uuid), true);
reset role;
do $$ begin
  if current_setting('t.key_a2') = current_setting('t.key_a') or current_setting('t.key_a2') !~ '^[A-HJ-NP-Z2-9]{16}$' then raise exception 'T9 bad new key'; end if;
  if exists (select 1 from public.devices where shop_id = current_setting('t.shop_a')::uuid) then raise exception 'T9 devices kept'; end if;
  if exists (select 1 from public.staff_sessions where shop_id = current_setting('t.shop_a')::uuid and revoked_at is null) then raise exception 'T9 sessions live'; end if;
  if not exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d4') then raise exception 'T9 shop B device removed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.join_shop(current_setting('t.key_a'), 'iPhone');
    raise exception 'T9 old key accepted';
  exception when others then if sqlerrm not like '%invalid_code%' then raise exception 'T9 old key wrong error: %', sqlerrm; end if; end;
  if public.join_shop(current_setting('t.key_a2'), 'iPhone') <> current_setting('t.shop_a')::uuid then raise exception 'T9 new key refused'; end if;
end $$;
reset role;

-- T11 anon gets nothing; the key table is closed; the pairing code is gone; revoked_at is not owner-writable
set local role anon;
do $$ begin
  begin perform public.join_shop('x'); raise exception 'T11 anon join_shop';
  exception when insufficient_privilege then null; end;
  begin perform public.owner_get_join_key(gen_random_uuid()); raise exception 'T11 anon owner_get_join_key';
  exception when insufficient_privilege then null; end;
  begin perform public.owner_rotate_join_key(gen_random_uuid()); raise exception 'T11 anon owner_rotate_join_key';
  exception when insufficient_privilege then null; end;
  begin perform public.owner_remove_device(gen_random_uuid()); raise exception 'T11 anon owner_remove_device';
  exception when insufficient_privilege then null; end;
  begin perform * from public.owner_list_devices(gen_random_uuid()); raise exception 'T11 anon owner_list_devices';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform 1 from public.shop_join_keys; raise exception 'T11 shop_join_keys readable';
  exception when insufficient_privilege then null; end;
  begin update public.devices set revoked_at = now() where shop_id = current_setting('t.shop_a')::uuid; raise exception 'T11 owner set revoked_at';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if to_regclass('public.pairing_codes') is not null then raise exception 'T11 pairing_codes still exists'; end if;
  if to_regprocedure('public.create_pairing_code(uuid)') is not null then raise exception 'T11 create_pairing_code still exists'; end if;
  if to_regprocedure('public.redeem_pairing_code(text, text)') is not null then raise exception 'T11 redeem_pairing_code still exists'; end if;
  if has_function_privilege('authenticated', 'private.new_join_key()', 'execute') then raise exception 'T11 new_join_key executable by clients'; end if;
end $$;

rollback;
