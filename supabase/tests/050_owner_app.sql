-- 050 — owner app support: shop rename, unlock_staff, (pairing-code cleanup removed in stage 4). One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner B: a shop of their own
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;

-- Owner A: shop + staff member
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.staff_a', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);

-- T1 owner A renames their own shop
do $$ declare n int; begin
  update public.shops set name = 'Join Juice Καλαμαριά' where id = current_setting('t.shop_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'T1 own rename changed % rows', n; end if;
end $$;

-- T2 owner A cannot rename owner B's shop (row is invisible → 0 rows)
do $$ declare n int; begin
  update public.shops set name = 'hijacked' where id = current_setting('t.shop_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T2 renamed a foreign shop'; end if;
end $$;
reset role;

-- T2b an anonymous phone session cannot rename shop A either (row is invisible → 0 rows)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ declare n int; begin
  update public.shops set name = 'phone-hijack' where id = current_setting('t.shop_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T2b anonymous phone renamed a shop'; end if;
end $$;
reset role;

-- back to owner A for the rest of this block
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;

-- T3 an 81-character name is refused by the CHECK
do $$ begin
  begin update public.shops set name = repeat('α', 81) where id = current_setting('t.shop_a')::uuid;
  exception when check_violation then return; end;
  raise exception 'T3 81-char name accepted';
end $$;

-- T4 owner_id is not updatable (column grant is name only)
do $$ begin
  begin update public.shops set owner_id = '00000000-0000-0000-0000-0000000000b1' where id = current_setting('t.shop_a')::uuid;
  exception when insufficient_privilege then return; end;
  raise exception 'T4 owner_id was updatable';
end $$;
reset role;

-- Lock ΜΑΡΙΑ directly (as the table owner) for the unlock tests
update public.staff set failed_attempts = 3, locked_until = now() + interval '15 minutes' where id = current_setting('t.staff_a')::uuid;

-- T5 owner B cannot unlock A's staff; a missing id answers the same way
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.unlock_staff(current_setting('t.staff_a')::uuid);
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T5 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T5 owner B unlocked A''s staff';
end $$;
do $$ begin
  begin perform public.unlock_staff('00000000-0000-0000-0000-00000000ffff');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T5b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T5b missing id did not answer not_owner';
end $$;
reset role;

-- T6 an anonymous phone session cannot unlock staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.unlock_staff(current_setting('t.staff_a')::uuid);
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T6 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T6 phone unlocked staff';
end $$;
reset role;

-- T7 owner A unlocks without touching the PIN
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.unlock_staff(current_setting('t.staff_a')::uuid);
reset role;
do $$ begin
  if (select failed_attempts = 0 and locked_until is null and extensions.crypt('1234', pin_hash) = pin_hash
      from public.staff where id = current_setting('t.staff_a')::uuid) is not true then
    raise exception 'T7 not unlocked or PIN changed';
  end if;
end $$;

-- T8 anon role cannot execute unlock_staff
set local role anon;
do $$ begin
  begin perform public.unlock_staff(current_setting('t.staff_a')::uuid); exception when insufficient_privilege then return; end;
  raise exception 'T8 anon can execute unlock_staff';
end $$;
reset role;

rollback;
