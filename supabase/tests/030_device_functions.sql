-- 030 — pairing and phone functions. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A sets up a shop, two staff, a second settings version and a pairing code.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop', public.create_shop('Shop A', '{"schema":1}')::text, true);
select public.publish_config(current_setting('t.shop')::uuid, 1, '{"schema":1,"floatCents":100000}');
select set_config('t.maria', public.create_staff(current_setting('t.shop')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop')::uuid, 'ΝΙΚΟΣ', '5555')::text, true);
update public.staff set active = false where id = current_setting('t.nikos')::uuid;
select set_config('t.code', public.create_pairing_code(current_setting('t.shop')::uuid), true);

-- T1 an owner (non-anonymous) session cannot redeem a code
do $$ begin
  begin perform public.redeem_pairing_code(current_setting('t.code'), 'x');
  exception when others then if sqlerrm not like '%not_a_device_session%' then raise exception 'T1 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T1 owner redeemed a code';
end $$;
reset role;

-- Phone D1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

-- T2 before pairing: no context, not a device
do $$ begin
  if (select count(*) from public.device_context()) <> 0 then raise exception 'T2 unpaired phone has context'; end if;
  if public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'error' <> 'not_a_device' then raise exception 'T2 expected not_a_device'; end if;
end $$;

-- T3 redeem works with lowercase and spaces, once
do $$ begin
  if public.redeem_pairing_code('  ' || lower(current_setting('t.code')) || ' ', 'Ταμείο 1') <> current_setting('t.shop')::uuid then
    raise exception 'T3 redeem returned wrong shop';
  end if;
end $$;

-- T4 context = latest settings version; staff list = active only
do $$ begin
  if (select version from public.device_context()) <> 2 then raise exception 'T4 context not latest version'; end if;
  if (select config ->> 'floatCents' from public.device_context()) <> '100000' then raise exception 'T4 wrong config'; end if;
  if (select array_agg(name) from public.list_staff()) is distinct from array['ΜΑΡΙΑ'] then raise exception 'T4 staff list wrong'; end if;
end $$;

-- T5 correct PIN ok; wrong PIN ×4 bad_pin; 5th → locked; correct PIN while locked → still locked
do $$ declare r jsonb; begin
  if (public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'ok')::boolean is not true then raise exception 'T5 correct PIN refused'; end if;
  for i in 1..4 loop
    r := public.verify_staff_pin(current_setting('t.maria')::uuid, '0000');
    if r ->> 'error' <> 'bad_pin' then raise exception 'T5 attempt % expected bad_pin, got %', i, r; end if;
  end loop;
  r := public.verify_staff_pin(current_setting('t.maria')::uuid, '0000');
  if r ->> 'error' <> 'staff_locked' then raise exception 'T5 5th attempt expected staff_locked, got %', r; end if;
  r := public.verify_staff_pin(current_setting('t.maria')::uuid, '1234');
  if r ->> 'error' <> 'staff_locked' then raise exception 'T5 correct PIN while locked should stay locked, got %', r; end if;
end $$;
reset role;

-- T6 the lockout was persisted (the function returned instead of raising) — lock ≈ 15 minutes
do $$ begin
  if (select locked_until from public.staff where id = current_setting('t.maria')::uuid) not between now() + interval '14 minutes' and now() + interval '16 minutes' then
    raise exception 'T6 lockout not persisted for ~15 minutes';
  end if;
end $$;

-- T7 after the lock expires, the correct PIN works and resets the counter
update public.staff set locked_until = now() - interval '1 second', failed_attempts = 2 where id = current_setting('t.maria')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'ok')::boolean is not true then raise exception 'T7 correct PIN refused after lock expired'; end if;
  if public.verify_staff_pin(current_setting('t.nikos')::uuid, '5555') ->> 'error' <> 'staff_not_found' then raise exception 'T7 inactive staff accepted'; end if;
  if public.verify_staff_pin(current_setting('t.maria')::uuid, '12') ->> 'error' <> 'bad_pin' then raise exception 'T7 malformed PIN not bad_pin'; end if;
end $$;
reset role;
do $$ begin
  if (select failed_attempts from public.staff where id = current_setting('t.maria')::uuid) <> 1 then raise exception 'T7 counter not reset by correct PIN then +1 by bad one'; end if;
end $$;

-- T8 the used code cannot be redeemed again (by another phone); an expired code is refused
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.redeem_pairing_code(current_setting('t.code'), 'x');
  exception when others then if sqlerrm not like '%invalid_code%' then raise exception 'T8 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T8 code reused';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.code2', public.create_pairing_code(current_setting('t.shop')::uuid), true);
reset role;
update public.pairing_codes set expires_at = now() - interval '1 second' where code_hash = encode(extensions.digest(current_setting('t.code2'), 'sha256'), 'hex');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.redeem_pairing_code(current_setting('t.code2'), 'x');
  exception when others then if sqlerrm not like '%invalid_code%' then raise exception 'T8b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T8b expired code accepted';
end $$;
reset role;

-- T9 a revoked phone gets nothing
update public.devices set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.device_context()) <> 0 then raise exception 'T9 revoked phone has context'; end if;
  if (select count(*) from public.list_staff()) <> 0 then raise exception 'T9 revoked phone lists staff'; end if;
  if public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'error' <> 'device_revoked' then raise exception 'T9 expected device_revoked'; end if;
end $$;
reset role;

rollback;
