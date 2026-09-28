-- 010 — direct table access. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Data inserted as the migration owner (bypasses RLS).
insert into public.shops (id, owner_id, name) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'Shop A'),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', 'Shop B');
insert into public.shop_configs (id, shop_id, version, config) values
  ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000aa01', 1, '{"schema":1}'),
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-00000000bb01', 1, '{"schema":1}');
insert into public.staff (id, shop_id, name, pin_hash) values
  ('00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-00000000aa01', 'ΜΑΡΙΑ', 'x'),
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000bb01', 'ΝΙΚΟΣ', 'x');
insert into public.devices (user_id, shop_id, label) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000aa01', 'Ταμείο');
insert into public.closings (id, shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000a501',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000ac01', '2026-09-28',
   '{"schema":1,"counts":{},"channelCents":{},"expenses":[]}', 'k1'),
  ('00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000b501',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000bc01', '2026-09-28',
   '{"schema":1,"counts":{},"channelCents":{},"expenses":[]}', 'k1');

-- T1 the anon role has no table access at all
set local role anon;
do $$ begin
  begin perform 1 from public.shops; exception when insufficient_privilege then return; end;
  raise exception 'T1 anon can read shops';
end $$;
reset role;

-- T2 a stranger (regular user, owns nothing) sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.shops) <> 0 then raise exception 'T2 stranger sees shops'; end if;
  if (select count(*) from public.shop_configs) <> 0 then raise exception 'T2 stranger sees configs'; end if;
  if (select count(id) from public.staff) <> 0 then raise exception 'T2 stranger sees staff'; end if;
  if (select count(*) from public.devices) <> 0 then raise exception 'T2 stranger sees devices'; end if;
  if (select count(*) from public.closings) <> 0 then raise exception 'T2 stranger sees closings'; end if;
end $$;
reset role;

-- T3–T8 as owner A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ declare n int; begin
  -- T3 sees only own rows
  if (select array_agg(name) from public.shops) is distinct from array['Shop A'] then raise exception 'T3 owner A sees wrong shops'; end if;
  if (select count(*) from public.shop_configs where shop_id <> '00000000-0000-0000-0000-00000000aa01') <> 0 then raise exception 'T3 owner A sees B configs'; end if;
  if (select array_agg(id) from public.staff) is distinct from array['00000000-0000-0000-0000-00000000a501'::uuid] then raise exception 'T3 owner A sees wrong staff'; end if;
  if (select array_agg(id) from public.closings) is distinct from array['00000000-0000-0000-0000-00000000ae01'::uuid] then raise exception 'T3 owner A sees wrong closings'; end if;
  if (select count(*) from public.devices) <> 1 then raise exception 'T3 owner A sees wrong devices'; end if;

  -- T4 pin_hash is unreadable
  begin perform pin_hash from public.staff; raise exception 'T4 owner can read pin_hash';
  exception when insufficient_privilege then null; end;

  -- T5 no direct inserts into protected tables
  begin insert into public.shops (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'X'); raise exception 'T5 owner can insert shops';
  exception when insufficient_privilege then null; end;
  begin insert into public.shop_configs (shop_id, version, config) values ('00000000-0000-0000-0000-00000000aa01', 2, '{"schema":1}'); raise exception 'T5 owner can insert configs';
  exception when insufficient_privilege then null; end;
  begin insert into public.staff (shop_id, name, pin_hash) values ('00000000-0000-0000-0000-00000000aa01', 'Y', 'x'); raise exception 'T5 owner can insert staff';
  exception when insufficient_privilege then null; end;
  begin insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
        values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-00000000ac01', '2026-09-28', '{}', 'k9');
        raise exception 'T5 owner can insert closings';
  exception when insufficient_privilege then null; end;

  -- T6 owner renames own staff; B's staff is untouched
  update public.staff set name = 'ΜΑΡΙΑ Κ' where id = '00000000-0000-0000-0000-00000000a501';
  get diagnostics n = row_count; if n <> 1 then raise exception 'T6 owner cannot rename own staff'; end if;
  update public.staff set name = 'hacked' where id = '00000000-0000-0000-0000-00000000b501';
  get diagnostics n = row_count; if n <> 0 then raise exception 'T6 owner renamed B staff'; end if;
  begin update public.staff set pin_hash = 'y' where id = '00000000-0000-0000-0000-00000000a501'; raise exception 'T6 owner can write pin_hash';
  exception when insufficient_privilege then null; end;

  -- T7 owner voids own closing but cannot change inputs; B's closing untouched
  update public.closings set voided_at = now() where id = '00000000-0000-0000-0000-00000000ae01';
  get diagnostics n = row_count; if n <> 1 then raise exception 'T7 owner cannot void own closing'; end if;
  begin update public.closings set inputs = '{}' where id = '00000000-0000-0000-0000-00000000ae01'; raise exception 'T7 owner can change inputs';
  exception when insufficient_privilege then null; end;
  update public.closings set voided_at = now() where id = '00000000-0000-0000-0000-00000000be01';
  get diagnostics n = row_count; if n <> 0 then raise exception 'T7 owner voided B closing'; end if;

  -- T8 pairing codes are not readable at all
  begin perform 1 from public.pairing_codes; raise exception 'T8 pairing codes readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- T9 an anonymous session carrying owner A's id sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.shops) <> 0 then raise exception 'T9 anonymous session sees shops'; end if;
  if (select count(*) from public.shop_configs) <> 0 then raise exception 'T9 anonymous session sees shop_configs'; end if;
  if (select count(id) from public.staff) <> 0 then raise exception 'T9 anonymous session sees staff'; end if;
  if (select count(*) from public.devices) <> 0 then raise exception 'T9 anonymous session sees devices'; end if;
  if (select count(*) from public.closings) <> 0 then raise exception 'T9 anonymous session sees closings'; end if;
end $$;
reset role;

-- T10 a paired phone has no direct table access to its shop's rows
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.shops) <> 0 then raise exception 'T10 phone reads shops directly'; end if;
  if (select count(*) from public.shop_configs) <> 0 then raise exception 'T10 phone reads shop_configs directly'; end if;
  if (select count(id) from public.staff) <> 0 then raise exception 'T10 phone reads staff directly'; end if;
  if (select count(*) from public.devices) <> 0 then raise exception 'T10 phone reads devices directly'; end if;
  if (select count(*) from public.closings) <> 0 then raise exception 'T10 phone reads closings directly'; end if;
end $$;
reset role;

rollback;
