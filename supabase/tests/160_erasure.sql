-- 160 — erasure and deletion (LG2, L81): owner_erase_staff (tombstone row, no copy of the old name left, live
-- sessions dead, the erased author's lines still submittable), owner_delete_shop (typed-name confirmation, every
-- row of the shop gone, its anonymous phones kept and able to join elsewhere), owner_delete_account, private.purge_stale, grants.
-- One transaction, ends in ROLLBACK. Row checks and private.* calls run as the migration owner.
-- T9 deletes owner A's account, so it is the last block.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop A (cashiers ΜΑΡΙΑ = X, ΝΙΚΟΣ = Y) and shop A2 (cashier ΕΛΕΝΗ = Z). Owner B: shop B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop', public.create_shop('Shop A', '{"schema":1,"maxExpenses":2,"denominations":[5000,10000],"channels":[{"id":"wolt"}]}')::text, true);
select set_config('t.x', public.create_staff(current_setting('t.shop')::uuid, 'ΜΑΡΙΑ', '111111')::text, true);
select set_config('t.y', public.create_staff(current_setting('t.shop')::uuid, 'ΝΙΚΟΣ', '222222')::text, true);
select set_config('t.key', public.owner_get_join_key(current_setting('t.shop')::uuid), true);
select set_config('t.shop2', public.create_shop('Shop A2', '{"schema":1,"maxExpenses":2,"denominations":[5000,10000],"channels":[{"id":"wolt"}]}')::text, true);
select set_config('t.z', public.create_staff(current_setting('t.shop2')::uuid, 'ΕΛΕΝΗ', '333333')::text, true);
select set_config('t.key2', public.owner_get_join_key(current_setting('t.shop2')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;
select set_config('t.cfg', (select id::text from public.shop_configs where shop_id = current_setting('t.shop')::uuid), true);
select set_config('t.cfg2', (select id::text from public.shop_configs where shop_id = current_setting('t.shop2')::uuid), true);
select set_config('t.bd', private.business_date(current_setting('t.shop')::uuid)::text, true);
select set_config('t.bd2', private.business_date(current_setting('t.shop2')::uuid)::text, true);

-- Phone d1 (shop A): X signs in, adds expense line l1 and submits. Phone d3 (shop A): Y signs in.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Ταμείο');
select set_config('t.tx', public.staff_sign_in(current_setting('t.x')::uuid, '111111') ->> 'token', true);
do $$
declare
  tok text := current_setting('t.tx');
  bd date := current_setting('t.bd')::date;
  r jsonb;
begin
  r := public.set_closing_field(tok, bd, 'e:l1', '{"addedBy":{"kind":"owner"},"removed":false,"order":1000}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup line l1 failed: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:l1:d', '{"text":"Γάλα"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup l1 description failed: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:l1:a', '{"text":"5"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup l1 amount failed: %', r; end if;
  r := public.submit_closing(tok, current_setting('t.cfg')::uuid, bd, jsonb_build_object(
         'schema', 2, 'counts', jsonb_build_object('10000', 1), 'channelCents', jsonb_build_object(),
         'expenses', jsonb_build_array(jsonb_build_object('id', 'l1', 'description', 'Γάλα', 'cents', 500,
                       'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.x'))))),
         3, 'k-x');
  if (r ->> 'ok')::boolean is not true then raise exception 'setup X submit failed: %', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Δεύτερο');
select set_config('t.ty', public.staff_sign_in(current_setting('t.y')::uuid, '222222') ->> 'token', true);
reset role;
do $$ begin
  if (select last_submit ->> 'staff_name' from public.open_closings where shop_id = current_setting('t.shop')::uuid) is distinct from 'ΜΑΡΙΑ' then
    raise exception 'setup last_submit does not name ΜΑΡΙΑ';
  end if;
  if not exists (select 1 from public.device_staff_trust where staff_id = current_setting('t.x')::uuid) then raise exception 'setup no trust row for X'; end if;
  if (select last_staff_id from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') is distinct from current_setting('t.x')::uuid then
    raise exception 'setup d1 last_staff_id is not X';
  end if;
end $$;

-- T1 owner B, a phone, and an unknown id → not_owner; nothing changed
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_erase_staff(current_setting('t.x')::uuid);
    raise exception 'T1 owner B erased a cashier of shop A';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T1 owner B: expected not_owner, got %', sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_erase_staff(current_setting('t.x')::uuid);
    raise exception 'T1 a phone erased a cashier';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T1 phone: expected not_owner, got %', sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_erase_staff(gen_random_uuid());
    raise exception 'T1 an unknown id did not raise';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T1 unknown id: expected not_owner, got %', sqlerrm; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select name from public.staff where id = current_setting('t.x')::uuid) <> 'ΜΑΡΙΑ' then raise exception 'T1 a refused erase changed the row'; end if;
end $$;

-- T2 owner A erases X: tombstone row, no sessions/trust rows, last_staff_id cleared; a second call changes nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_erase_staff(current_setting('t.x')::uuid);
reset role;
select set_config('t.placeholder', 'Διαγραμμένος υπάλληλος ' || left(current_setting('t.x'), 8), true);
select set_config('t.xmin', (select xmin::text from public.staff where id = current_setting('t.x')::uuid), true);
do $$
declare s public.staff;
begin
  select * into s from public.staff where id = current_setting('t.x')::uuid;
  if s.name <> current_setting('t.placeholder') then raise exception 'T2 name not the placeholder: %', s.name; end if;
  if s.pin_hash is not null or s.active or s.erased_at is null or s.failed_attempts <> 0 or s.locked_until is not null
     or s.lock_level <> 0 then
    raise exception 'T2 personal/lock state left on the erased row';
  end if;
  if exists (select 1 from public.staff_sessions where staff_id = s.id) then raise exception 'T2 staff_sessions rows left'; end if;
  if exists (select 1 from public.device_staff_trust where staff_id = s.id) then raise exception 'T2 device_staff_trust rows left'; end if;
  if exists (select 1 from public.devices where last_staff_id = s.id) then raise exception 'T2 devices.last_staff_id still points to X'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_erase_staff(current_setting('t.x')::uuid);
reset role;
do $$ begin
  if (select xmin::text from public.staff where id = current_setting('t.x')::uuid) <> current_setting('t.xmin') then
    raise exception 'T2 second erase rewrote the row';
  end if;
end $$;

-- T3 the old name is in no row of the shop (staff, open closings, their fields, closings)
do $$
declare v_shop uuid := current_setting('t.shop')::uuid;
begin
  if exists (select 1 from public.staff s where s.shop_id = v_shop and s::text like '%ΜΑΡΙΑ%') then raise exception 'T3 name left in staff'; end if;
  if exists (select 1 from public.open_closings oc where oc.shop_id = v_shop and oc::text like '%ΜΑΡΙΑ%') then raise exception 'T3 name left in open_closings'; end if;
  if exists (select 1 from public.open_closing_fields f join public.open_closings oc on oc.id = f.open_closing_id
              where oc.shop_id = v_shop and f::text like '%ΜΑΡΙΑ%') then raise exception 'T3 name left in open_closing_fields'; end if;
  if exists (select 1 from public.closings c where c.shop_id = v_shop and c::text like '%ΜΑΡΙΑ%') then raise exception 'T3 name left in closings'; end if;
  if (select last_submit ->> 'staff_name' from public.open_closings where shop_id = v_shop) is distinct from current_setting('t.placeholder') then
    raise exception 'T3 last_submit.staff_name is not the placeholder';
  end if;
end $$;

-- T4 X's token from before the erase is dead; the old PIN never signs in
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.set_closing_field(current_setting('t.tx'), current_setting('t.bd')::date, 'c:wolt', '{"text":"1"}', null);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T4 write with the old token: %', r; end if;
  r := public.submit_closing(current_setting('t.tx'), current_setting('t.cfg')::uuid, current_setting('t.bd')::date,
         '{"schema":2,"counts":{},"channelCents":{},"expenses":[]}', 3, 'k-x2');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T4 submit with the old token: %', r; end if;
  r := public.staff_sign_in(current_setting('t.x')::uuid, '111111');
  if (r ->> 'ok')::boolean is not false or r ->> 'error' not in ('pin_not_set', 'staff_not_found') then
    raise exception 'T4 erased cashier sign-in: %', r;
  end if;
end $$;
reset role;

-- T5 Y submits a closing holding X's line → ok; the day shows the placeholder as the author name
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.ty');
  snap jsonb := public.get_open_closing(current_setting('t.ty'));
  added jsonb;
  r jsonb;
begin
  select f -> 'value' -> 'addedBy' into added from jsonb_array_elements(snap #> '{closing,fields}') f where f ->> 'key' = 'e:l1';
  if added is distinct from jsonb_build_object('kind', 'staff', 'id', current_setting('t.x')) then raise exception 'T5 line author changed: %', added; end if;
  r := public.submit_closing(tok, current_setting('t.cfg')::uuid, current_setting('t.bd')::date, jsonb_build_object(
         'schema', 2, 'counts', jsonb_build_object('10000', 2), 'channelCents', jsonb_build_object(),
         'expenses', jsonb_build_array(jsonb_build_object('id', 'l1', 'description', 'Γάλα', 'cents', 500, 'addedBy', added))),
         (snap #>> '{closing,revision}')::bigint, 'k-y');
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 submit with the erased author''s line refused: %', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare d jsonb := public.owner_get_closing_day(current_setting('t.shop')::uuid, current_setting('t.bd')::date);
begin
  if d -> 'staff_names' ->> current_setting('t.x') is distinct from current_setting('t.placeholder') then
    raise exception 'T5 staff_names does not carry the placeholder: %', d -> 'staff_names';
  end if;
  -- since 20261117000002 the versions are per closing (a 1-closing day: closings[0])
  if jsonb_array_length(d #> '{closings,0,versions}') <> 2 or d #>> '{closings,0,versions,1,author_name}' is distinct from current_setting('t.placeholder')
     or d #>> '{closings,0,versions,0,author_name}' is distinct from 'ΝΙΚΟΣ' then
    raise exception 'T5 version authors wrong: %', d -> 'closings';
  end if;
end $$;
reset role;

-- T6 shop A2 with a staff closing, an owner correction, an open closing and two config versions.
--    Owner B → not_owner; a wrong name → confirm_mismatch; the name with surrounding spaces → every row gone.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key2'), 'Ταμείο 2');
select set_config('t.tz', public.staff_sign_in(current_setting('t.z')::uuid, '333333') ->> 'token', true);
do $$
declare r jsonb;
begin
  r := public.set_closing_field(current_setting('t.tz'), current_setting('t.bd2')::date, 'c:wolt', '{"text":"10"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup T6 write failed: %', r; end if;
  r := public.submit_closing(current_setting('t.tz'), current_setting('t.cfg2')::uuid, current_setting('t.bd2')::date,
         '{"schema":2,"counts":{},"channelCents":{"wolt":1000},"expenses":[]}', 1, 'k-z');
  if (r ->> 'ok')::boolean is not true then raise exception 'setup T6 submit failed: %', r; end if;
  perform set_config('t.closing2', r ->> 'closing_id', true);
end $$;
reset role;
select set_config('t.oc2', (select id::text from public.open_closings where shop_id = current_setting('t.shop2')::uuid), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.owner_save_closing(current_setting('t.shop2')::uuid, current_setting('t.bd2')::date, current_setting('t.cfg2')::uuid,
         '{"schema":2,"counts":{},"channelCents":{"wolt":2000},"expenses":[]}', current_setting('t.closing2')::uuid, 'o-1', 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup T6 owner correction failed: %', r; end if;
  perform public.publish_config(current_setting('t.shop2')::uuid, 1, '{"schema":1,"maxExpenses":2}');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.closings where shop_id = current_setting('t.shop2')::uuid and kind = 'owner_correction'
        and corrects_closing_id = current_setting('t.closing2')::uuid) <> 1 then raise exception 'setup T6 no correction row'; end if;
  if (select count(*) from public.shop_configs where shop_id = current_setting('t.shop2')::uuid) <> 2 then raise exception 'setup T6 not two configs'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_delete_shop(current_setting('t.shop2')::uuid, 'Shop A2');
    raise exception 'T6 owner B deleted shop A2';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T6 owner B: expected not_owner, got %', sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_delete_shop(current_setting('t.shop2')::uuid, 'shop a2');
    raise exception 'T6 a wrong-case name deleted the shop';
  exception when sqlstate '22023' then
    if sqlerrm <> 'confirm_mismatch' then raise exception 'T6 wrong name: expected confirm_mismatch, got %', sqlerrm; end if;
  end;
  begin
    perform public.owner_delete_shop(current_setting('t.shop2')::uuid, null);
    raise exception 'T6 a null name deleted the shop';
  exception when sqlstate '22023' then
    if sqlerrm <> 'confirm_mismatch' then raise exception 'T6 null name: expected confirm_mismatch, got %', sqlerrm; end if;
  end;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.shops where id = current_setting('t.shop2')::uuid) then raise exception 'T6 a refused delete removed the shop'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_delete_shop(current_setting('t.shop2')::uuid, '  Shop A2  ');
reset role;
do $$
declare v_shop uuid := current_setting('t.shop2')::uuid;
begin
  if exists (select 1 from public.shops where id = v_shop) then raise exception 'T6 shops row left'; end if;
  if exists (select 1 from public.shop_configs where shop_id = v_shop) then raise exception 'T6 shop_configs rows left'; end if;
  if exists (select 1 from public.staff where shop_id = v_shop) then raise exception 'T6 staff rows left'; end if;
  if exists (select 1 from public.devices where shop_id = v_shop) then raise exception 'T6 devices rows left'; end if;
  if exists (select 1 from public.staff_sessions where shop_id = v_shop) then raise exception 'T6 staff_sessions rows left'; end if;
  if exists (select 1 from public.device_staff_trust where staff_id = current_setting('t.z')::uuid
                or device_user_id = '00000000-0000-0000-0000-0000000000d2') then raise exception 'T6 device_staff_trust rows left'; end if;
  if exists (select 1 from public.shop_join_keys where shop_id = v_shop) then raise exception 'T6 shop_join_keys row left'; end if;
  if exists (select 1 from public.open_closings where shop_id = v_shop) then raise exception 'T6 open_closings rows left'; end if;
  if exists (select 1 from public.open_closing_fields where open_closing_id = current_setting('t.oc2')::uuid) then raise exception 'T6 open_closing_fields rows left'; end if;
  if exists (select 1 from public.closings where shop_id = v_shop) then raise exception 'T6 closings rows left'; end if;
end $$;

-- T7 the shop's anonymous phone identity stays (purge_stale removes it later); owner A and shop A are untouched
do $$ begin
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d2') then raise exception 'T7 phone d2 auth user deleted at once'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'T7 owner A auth user deleted'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T7 a phone of shop A was deleted'; end if;
  if (select count(*) from public.staff where shop_id = current_setting('t.shop')::uuid) <> 2 then raise exception 'T7 shop A staff touched'; end if;
  if (select count(*) from public.closings where shop_id = current_setting('t.shop')::uuid) <> 2 then raise exception 'T7 shop A closings touched'; end if;
end $$;

-- T8 a phone of the deleted shop has no store any more (device_context: no row, like an unpaired phone)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.device_context()) then raise exception 'T8 device_context still answers for a deleted shop'; end if;
  if exists (select 1 from public.list_staff()) then raise exception 'T8 list_staff still answers for a deleted shop'; end if;
end $$;
reset role;
-- … and the same phone identity can join another store (no switch needed: it is in no live store)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.key_b', public.owner_get_join_key(current_setting('t.shop_b')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  perform public.join_shop(current_setting('t.key_b'), 'T8', false);
  if (select shop_id from public.device_context()) is distinct from current_setting('t.shop_b')::uuid then
    raise exception 'T8 phone of a deleted shop could not join another store';
  end if;
end $$;
reset role;

-- T10 an erased row stays erased: no direct rename/re-activation, no PIN, no unlock
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare n int;
begin
  update public.staff set name = 'ΜΑΡΙΑ', active = true where id = current_setting('t.x')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T10 owner updated an erased row directly'; end if;
  update public.staff set active = false where id = current_setting('t.y')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'T10 the policy now blocks a normal row too'; end if;
  begin
    perform public.set_staff_pin(current_setting('t.x')::uuid, '444444');
    raise exception 'T10 set_staff_pin on an erased row';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T10 set_staff_pin: expected not_owner, got %', sqlerrm; end if;
  end;
  begin
    perform public.unlock_staff(current_setting('t.x')::uuid);
    raise exception 'T10 unlock_staff on an erased row';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T10 unlock_staff: expected not_owner, got %', sqlerrm; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select pin_hash from public.staff where id = current_setting('t.x')::uuid) is not null
     or (select name from public.staff where id = current_setting('t.x')::uuid) <> current_setting('t.placeholder') then
    raise exception 'T10 erased row changed';
  end if;
end $$;

-- T11 purge_stale: sessions older than 90 days go; old anonymous users go only without a devices row and without
--     an auth session used in the last 30 days
insert into public.staff_sessions (token_hash, shop_id, staff_id, device_user_id, business_date, created_at) values
  ('t11-91', current_setting('t.shop')::uuid, current_setting('t.y')::uuid, '00000000-0000-0000-0000-0000000000d3', current_date - 91, now() - interval '91 days'),
  ('t11-89', current_setting('t.shop')::uuid, current_setting('t.y')::uuid, '00000000-0000-0000-0000-0000000000d3', current_date - 89, now() - interval '89 days');
update auth.users set created_at = now() - interval '40 days'
 where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d6');
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d6', now() - interval '40 days', now());
select private.purge_stale();
do $$ begin
  if exists (select 1 from public.staff_sessions where token_hash = 't11-91') then raise exception 'T11 91-day session kept'; end if;
  if not exists (select 1 from public.staff_sessions where token_hash = 't11-89') then raise exception 'T11 89-day session deleted'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T11 old phone with a devices row deleted'; end if;
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d5') then raise exception 'T11 old unused anonymous user kept'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d6') then raise exception 'T11 anonymous user with a recent session deleted'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'T11 owner deleted'; end if;
end $$;

-- T12 grants and the job
do $$ begin
  if has_function_privilege('anon', 'public.owner_erase_staff(uuid)', 'execute')
     or has_function_privilege('anon', 'public.owner_delete_shop(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.owner_delete_account()', 'execute') then
    raise exception 'T12 anon can execute an erasure function';
  end if;
  if not has_function_privilege('authenticated', 'public.owner_erase_staff(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_delete_shop(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_delete_account()', 'execute') then
    raise exception 'T12 authenticated cannot execute an erasure function';
  end if;
  if has_function_privilege('authenticated', 'private.delete_shop(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.purge_stale()', 'execute') then
    raise exception 'T12 authenticated can execute a private erasure helper';
  end if;
  if not has_column_privilege('authenticated', 'public.staff', 'erased_at', 'select')
     or has_column_privilege('authenticated', 'public.staff', 'erased_at', 'update') then
    raise exception 'T12 wrong grants on staff.erased_at';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge_stale' and schedule = '30 3 * * *') then
    raise exception 'T12 purge_stale job not scheduled';
  end if;
end $$;

-- T9 (last: it deletes owner A) a phone → not_owner; owner A → every shop and the auth user gone, owner B untouched
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_delete_account();
    raise exception 'T9 a phone deleted an account';
  exception when sqlstate '42501' then
    if sqlerrm <> 'not_owner' then raise exception 'T9 phone: expected not_owner, got %', sqlerrm; end if;
  end;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T9 refused call deleted the phone'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_delete_account();
reset role;
do $$ begin
  if exists (select 1 from public.shops where owner_id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'T9 owner A shops left'; end if;
  if exists (select 1 from public.closings where shop_id = current_setting('t.shop')::uuid) then raise exception 'T9 shop A closings left'; end if;
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'T9 owner A auth user left'; end if;
  if exists (select 1 from public.devices where user_id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d3')) then
    raise exception 'T9 shop A devices rows left';
  end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d1') then
    raise exception 'T9 a phone identity was deleted at once';
  end if;
  if not exists (select 1 from public.shops where id = current_setting('t.shop_b')::uuid) then raise exception 'T9 owner B shop deleted'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000b1') then raise exception 'T9 owner B auth user deleted'; end if;
end $$;

rollback;
