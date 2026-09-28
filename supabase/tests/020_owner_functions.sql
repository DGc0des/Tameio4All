-- 020 — owner functions. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- As owner A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;

-- T1 create_shop stores the shop and settings version 1
select set_config('t.shop_a', public.create_shop('  Join Juice  ', '{"schema":1,"floatCents":100000}')::text, true);
do $$ begin
  if (select name from public.shops where id = current_setting('t.shop_a')::uuid) <> 'Join Juice' then raise exception 'T1 shop name not trimmed/stored'; end if;
  if (select array_agg(version) from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid) is distinct from array[1] then raise exception 'T1 no version 1'; end if;
end $$;

-- T2 a malformed config is refused
do $$ begin
  begin perform public.create_shop('X', '{"schema":2}');
  exception when others then if sqlerrm not like '%bad_config%' then raise exception 'T2 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T2 expected bad_config';
end $$;
do $$ begin
  begin perform public.create_shop('X', '[1,2]');
  exception when others then if sqlerrm not like '%bad_config%' then raise exception 'T2b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T2b expected bad_config';
end $$;

-- T3 publish_config: expected version → next version; stale version → version_conflict
do $$ begin
  if public.publish_config(current_setting('t.shop_a')::uuid, 1, '{"schema":1,"floatCents":50000}') <> 2 then raise exception 'T3 not version 2'; end if;
  begin perform public.publish_config(current_setting('t.shop_a')::uuid, 1, '{"schema":1}');
  exception when others then if sqlerrm not like '%version_conflict%' then raise exception 'T3 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T3 expected version_conflict';
end $$;

-- T4 create_staff: 4-digit PIN only, stored hashed, names unique per shop (case/space-insensitive)
select set_config('t.staff_a', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
do $$ begin
  begin perform public.create_staff(current_setting('t.shop_a')::uuid, 'ΝΙΚΟΣ', '12a4');
  exception when others then if sqlerrm not like '%bad_pin_format%' then raise exception 'T4 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T4 expected bad_pin_format';
end $$;
do $$ begin
  begin perform public.create_staff(current_setting('t.shop_a')::uuid, ' μαρια ', '5678');
  exception when others then if sqlerrm not like '%staff_name_taken%' then raise exception 'T4b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T4b expected staff_name_taken';
end $$;

-- T5 create_pairing_code: 8 chars from the unambiguous alphabet
select set_config('t.code', public.create_pairing_code(current_setting('t.shop_a')::uuid), true);
do $$ begin
  if current_setting('t.code') !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'T5 bad code format: %', current_setting('t.code'); end if;
end $$;
reset role;

-- T6 PIN and code are stored hashed only (checked as the migration owner)
do $$ begin
  if (select pin_hash from public.staff where id = current_setting('t.staff_a')::uuid) = '1234' then raise exception 'T6 PIN stored in plain text'; end if;
  if (select extensions.crypt('1234', pin_hash) = pin_hash from public.staff where id = current_setting('t.staff_a')::uuid) is not true then raise exception 'T6 PIN hash does not verify'; end if;
  if (select count(*) from public.pairing_codes where code_hash = encode(extensions.digest(current_setting('t.code'), 'sha256'), 'hex')) <> 1 then raise exception 'T6 code not stored as sha256'; end if;
  if (select expires_at from public.pairing_codes where code_hash = encode(extensions.digest(current_setting('t.code'), 'sha256'), 'hex')) > now() + interval '10 minutes 5 seconds' then raise exception 'T6 code lives longer than 10 minutes'; end if;
end $$;

-- T7 owner B cannot touch shop A through any owner function
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.publish_config(current_setting('t.shop_a')::uuid, 2, '{"schema":1}');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 publish wrong error: %', sqlerrm; end if; end;
  begin perform public.create_staff(current_setting('t.shop_a')::uuid, 'Z', '1111');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 staff wrong error: %', sqlerrm; end if; end;
  begin perform public.set_staff_pin(current_setting('t.staff_a')::uuid, '1111');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 pin wrong error: %', sqlerrm; end if; end;
  begin perform public.create_pairing_code(current_setting('t.shop_a')::uuid);
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 code wrong error: %', sqlerrm; end if; end;
end $$;

-- T7b set_staff_pin on a non-existent staff id also raises not_owner (never reveals existence)
do $$ begin
  begin perform public.set_staff_pin('00000000-0000-0000-0000-00000000dead', '1111');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T7b expected not_owner';
end $$;
reset role;
do $$ begin
  if (select count(*) from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid) <> 2 then raise exception 'T7 B published into A'; end if;
  if (select count(*) from public.staff where shop_id = current_setting('t.shop_a')::uuid) <> 1 then raise exception 'T7 B added staff to A'; end if;
  if (select count(*) from public.pairing_codes where shop_id = current_setting('t.shop_a')::uuid) <> 1 then raise exception 'T7 B made a code for A'; end if;
end $$;

-- T8 anonymous sessions (phones) cannot use owner functions
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.create_shop('Phone shop', '{"schema":1}');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T8 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T8 phone created a shop';
end $$;
reset role;

-- T9 set_staff_pin by the owner changes the PIN and clears a lockout
update public.staff set failed_attempts = 3, locked_until = now() + interval '10 minutes' where id = current_setting('t.staff_a')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.set_staff_pin(current_setting('t.staff_a')::uuid, '9876');
reset role;
do $$ begin
  if (select extensions.crypt('9876', pin_hash) = pin_hash and failed_attempts = 0 and locked_until is null
      from public.staff where id = current_setting('t.staff_a')::uuid) is not true then raise exception 'T9 PIN not reset'; end if;
end $$;

-- T10 the anon role cannot execute any function
set local role anon;
do $$ begin
  begin perform public.create_shop('X', '{"schema":1}'); exception when insufficient_privilege then return; end;
  raise exception 'T10 anon can execute create_shop';
end $$;
reset role;

-- T11 owner A cannot execute the private helper directly — proves EXECUTE was revoked from authenticated
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform private.check_pin('1234'); exception when insufficient_privilege then return; end;
  raise exception 'T11 owner A can execute private.check_pin';
end $$;
reset role;

rollback;
