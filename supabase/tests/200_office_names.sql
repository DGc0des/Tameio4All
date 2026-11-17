-- 200 — office names (20261117000004_office_names, stage 6): fields, versions and last_submit name the office-side
-- person who acted («Νίκος» for manager M) instead of always «Ιδιοκτήτης»: private.office_name, closing_snapshot
-- (`updated_by_name`), write_closing_field (`current` of a stale answer and the `field` broadcast),
-- closing_version_json (`author_name`), owner_save_closing (`last_submit.staff_name`); removal keeps the name, a
-- re-invite under a new name renames the old rows too (latest accepted_at wins), account deletion shows the tombstone.
-- One transaction, ends in ROLLBACK. Owner/member/phone calls run as `authenticated`; results are stored with
-- set_config and read back as postgres. T5 reads realtime.messages as postgres (skipped where it has no partition, like 080).
-- Users: owner A `…a1` (shop A: ΜΑΡΙΑ, phone `…d1`), manager M `…c1` (m@test.local). Order: T1, T2, T5, T3 (removal),
-- T4 (re-invite), T3b (removal + account deletion).
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm@test.local', false, now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now(), null);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.a', public.create_shop('Shop A', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}]}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.a')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.key', public.owner_get_join_key(current_setting('t.a')::uuid), true);
select set_config('t.tok_m', public.owner_invite_member(array[current_setting('t.a')::uuid], 'm@test.local', 'Νίκος', 'manager'), true);
reset role;
select set_config('t.cfg', (select id::text from public.shop_configs where shop_id = current_setting('t.a')::uuid), true);
select set_config('t.bd', private.business_date(current_setting('t.a')::uuid)::text, true);
select set_config('t.fix', '{"schema":2,"counts":{"10000":2},"channelCents":{},"expenses":[]}', true);
select set_config('t.fix2', '{"schema":2,"counts":{"10000":3},"channelCents":{},"expenses":[]}', true);
-- A past staff closing (bd-5), written as the migration owner (like 190)
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
values (current_setting('t.a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg')::uuid,
        current_setting('t.bd')::date - 5, '{"schema":2,"counts":{"10000":5},"channelCents":{},"expenses":[]}', 's-past');
select set_config('t.s_past', (select id::text from public.closings where idempotency_key = 's-past'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.accept_shop_invite(current_setting('t.tok_m'));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key'), 'Ταμείο 1');
select set_config('t.tok', public.staff_sign_in(current_setting('t.maria')::uuid, '123456') ->> 'token', true);
reset role;
do $$ begin
  if private.shop_role(current_setting('t.a')::uuid) is not null then raise exception 'setup: role as postgres'; end if;
  if (select count(*) from public.shop_members where shop_id = current_setting('t.a')::uuid and accepted_at is not null) <> 1 then
    raise exception 'setup: M not accepted';
  end if;
  if has_function_privilege('authenticated', 'private.office_name(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'private.office_name(uuid,uuid)', 'execute') then
    raise exception 'setup: office_name is executable by a client role';
  end if;
  if private.office_name(current_setting('t.a')::uuid, '00000000-0000-0000-0000-0000000000c1') <> 'Νίκος'
     or private.office_name(current_setting('t.a')::uuid, '00000000-0000-0000-0000-0000000000a1') <> 'Ιδιοκτήτης'
     or private.office_name(current_setting('t.a')::uuid, null) <> 'Ιδιοκτήτης' then
    raise exception 'setup: office_name';
  end if;
end $$;

-- T1 live fields: M, owner A and ΜΑΡΙΑ each write one; the snapshot names each of them.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.w_m', public.owner_set_closing_field(current_setting('t.a')::uuid, current_setting('t.bd')::date, 'c:wolt', '{"text":"12"}', null)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('t.w_a', public.owner_set_closing_field(current_setting('t.a')::uuid, current_setting('t.bd')::date, 'c:card', '{"text":"7"}', null)::text, true);
-- A stale write (base 0, the field exists at 1) answers with the current author's name
select set_config('t.stale_m', public.owner_set_closing_field(current_setting('t.a')::uuid, current_setting('t.bd')::date, 'c:wolt', '{"text":"13"}', 0)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
select set_config('t.w_s', public.set_closing_field(current_setting('t.tok'), current_setting('t.bd')::date, 'd:5000', '{"text":"2","mode":"count"}', null)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('t.snap', public.owner_get_open_closing(current_setting('t.a')::uuid)::text, true);
reset role;
do $$
declare s jsonb := current_setting('t.snap')::jsonb;
begin
  if (current_setting('t.w_m')::jsonb ->> 'ok') <> 'true' or (current_setting('t.w_a')::jsonb ->> 'ok') <> 'true'
     or (current_setting('t.w_s')::jsonb ->> 'ok') <> 'true' then
    raise exception 'T1 writes failed: % % %', current_setting('t.w_m'), current_setting('t.w_a'), current_setting('t.w_s');
  end if;
  if (select f ->> 'updated_by_name' from jsonb_array_elements(s #> '{closing,fields}') f where f ->> 'key' = 'c:wolt') is distinct from 'Νίκος' then
    raise exception 'T1 M''s field not named Νίκος: %', s;
  end if;
  if (select f ->> 'updated_by_name' from jsonb_array_elements(s #> '{closing,fields}') f where f ->> 'key' = 'c:card') is distinct from 'Ιδιοκτήτης' then
    raise exception 'T1 owner''s field not named Ιδιοκτήτης: %', s;
  end if;
  if (select f ->> 'updated_by_name' from jsonb_array_elements(s #> '{closing,fields}') f where f ->> 'key' = 'd:5000') is distinct from 'ΜΑΡΙΑ' then
    raise exception 'T1 ΜΑΡΙΑ''s field not named ΜΑΡΙΑ: %', s;
  end if;
  if current_setting('t.stale_m')::jsonb ->> 'error' is distinct from 'stale'
     or current_setting('t.stale_m')::jsonb #>> '{current,updated_by_name}' is distinct from 'Νίκος' then
    raise exception 'T1 stale answer: %', current_setting('t.stale_m');
  end if;
end $$;

-- T2 ΜΑΡΙΑ submits; M saves the live closing; an owner correction of the past day.
select set_config('t.rev', (select revision::text from public.open_closings
  where shop_id = current_setting('t.a')::uuid and business_date = current_setting('t.bd')::date), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select set_config('t.sub', public.submit_closing(current_setting('t.tok'), current_setting('t.cfg')::uuid, current_setting('t.bd')::date,
  current_setting('t.fix')::jsonb, current_setting('t.rev')::bigint, 'k-sub', 1)::text, true);
reset role;
do $$ begin
  if (current_setting('t.sub')::jsonb ->> 'ok') <> 'true' then raise exception 'T2 submit failed: %', current_setting('t.sub'); end if;
end $$;
select set_config('t.sub_id', (select last_submit ->> 'closing_id' from public.open_closings
  where shop_id = current_setting('t.a')::uuid and business_date = current_setting('t.bd')::date), true);
select set_config('t.rev', (select revision::text from public.open_closings
  where shop_id = current_setting('t.a')::uuid and business_date = current_setting('t.bd')::date), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.save_m', public.owner_save_closing(current_setting('t.a')::uuid, current_setting('t.bd')::date, current_setting('t.cfg')::uuid,
  current_setting('t.fix2')::jsonb, current_setting('t.sub_id')::uuid, 'k-m-live', current_setting('t.rev')::bigint)::text, true);
reset role;
select set_config('t.m_live', current_setting('t.save_m')::jsonb ->> 'closing_id', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.save_a', public.owner_save_closing(current_setting('t.a')::uuid, current_setting('t.bd')::date - 5, current_setting('t.cfg')::uuid,
  current_setting('t.fix')::jsonb, current_setting('t.s_past')::uuid, 'k-a-past')::text, true);
select set_config('t.day', public.owner_get_closing_day(current_setting('t.a')::uuid, current_setting('t.bd')::date)::text, true);
select set_config('t.day_past', public.owner_get_closing_day(current_setting('t.a')::uuid, current_setting('t.bd')::date - 5)::text, true);
select set_config('t.snap', public.owner_get_open_closing(current_setting('t.a')::uuid)::text, true);
reset role;
select set_config('t.a_past', current_setting('t.save_a')::jsonb ->> 'closing_id', true);
do $$
declare d jsonb := current_setting('t.day')::jsonb; p jsonb := current_setting('t.day_past')::jsonb; v jsonb;
begin
  if (current_setting('t.save_m')::jsonb ->> 'ok') <> 'true' then raise exception 'T2 M''s live save failed: %', current_setting('t.save_m'); end if;
  if (current_setting('t.save_a')::jsonb ->> 'ok') <> 'true' then raise exception 'T2 owner''s correction failed: %', current_setting('t.save_a'); end if;
  if current_setting('t.snap')::jsonb #>> '{closing,last_submit,staff_name}' is distinct from 'Νίκος' then
    raise exception 'T2 last_submit.staff_name: %', current_setting('t.snap')::jsonb -> 'closing' -> 'last_submit';
  end if;
  select x into v from jsonb_array_elements(d #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.m_live');
  if v ->> 'author_name' is distinct from 'Νίκος' or v ->> 'kind' <> 'owner_correction' then raise exception 'T2 M''s version: %', v; end if;
  select x into v from jsonb_array_elements(d #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.sub_id');
  if v ->> 'author_name' is distinct from 'ΜΑΡΙΑ' then raise exception 'T2 ΜΑΡΙΑ''s version: %', v; end if;
  select x into v from jsonb_array_elements(p #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.a_past');
  if v ->> 'author_name' is distinct from 'Ιδιοκτήτης' then raise exception 'T2 owner correction: %', v; end if;
end $$;

-- T5 the `field` broadcast names the author (read as postgres; skipped where realtime.messages has no partition)
do $$
declare m record;
begin
  if not exists (select 1 from pg_inherits where inhparent = 'realtime.messages'::regclass) then
    raise notice 'T5 realtime broadcast assertions SKIPPED: realtime.messages has no partitions here';
    return;
  end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.a') and event = 'field'
    and payload ->> 'key' = 'c:wolt' and (payload ->> 'version')::int = 1;
  if m.id is null or m.payload ->> 'updated_by_name' is distinct from 'Νίκος' then
    raise exception 'T5 M''s field broadcast: %', m.payload;
  end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.a') and event = 'field'
    and payload ->> 'key' = 'c:card';
  if m.id is null or m.payload ->> 'updated_by_name' is distinct from 'Ιδιοκτήτης' then
    raise exception 'T5 owner''s field broadcast: %', m.payload;
  end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.a') and event = 'submitted'
    and payload ->> 'closing_id' = current_setting('t.m_live');
  if m.id is null or m.payload ->> 'staff_name' is distinct from 'Νίκος' then
    raise exception 'T5 M''s submitted broadcast: %', m.payload;
  end if;
end $$;

-- T3 A removes M: the names stay.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('t.mid', (select id::text from public.shop_members where shop_id = current_setting('t.a')::uuid and member_uid = '00000000-0000-0000-0000-0000000000c1'), true);
set local role authenticated;
select public.owner_remove_member(current_setting('t.mid')::uuid);
select set_config('t.day', public.owner_get_closing_day(current_setting('t.a')::uuid, current_setting('t.bd')::date)::text, true);
select set_config('t.snap', public.owner_get_open_closing(current_setting('t.a')::uuid)::text, true);
reset role;
do $$
declare v jsonb;
begin
  select x into v from jsonb_array_elements(current_setting('t.day')::jsonb #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.m_live');
  if v ->> 'author_name' is distinct from 'Νίκος' then raise exception 'T3 removed M''s version lost its name: %', v; end if;
  if (select f ->> 'updated_by_name' from jsonb_array_elements(current_setting('t.snap')::jsonb #> '{closing,fields}') f where f ->> 'key' = 'c:wolt') is distinct from 'Νίκος' then
    raise exception 'T3 removed M''s field lost its name';
  end if;
  if (select removed_at from public.shop_members where shop_id = current_setting('t.a')::uuid and member_uid = '00000000-0000-0000-0000-0000000000c1') is null then
    raise exception 'T3 M not removed';
  end if;
end $$;

-- T4 re-invited as «Νίκος Π.»: the earlier row is back-dated (a transaction shares one now()), the latest accepted_at wins.
update public.shop_members set accepted_at = now() - interval '1 day' where shop_id = current_setting('t.a')::uuid and member_uid = '00000000-0000-0000-0000-0000000000c1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.tok_m2', public.owner_invite_member(array[current_setting('t.a')::uuid], 'm@test.local', 'Νίκος Π.', 'manager'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
select public.accept_shop_invite(current_setting('t.tok_m2'));
-- a new version by the re-invited M (correction of the past day, on top of the owner's)
select set_config('t.save_m2', public.owner_save_closing(current_setting('t.a')::uuid, current_setting('t.bd')::date - 5, current_setting('t.cfg')::uuid,
  current_setting('t.fix2')::jsonb, current_setting('t.a_past')::uuid, 'k-m-past')::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('t.day', public.owner_get_closing_day(current_setting('t.a')::uuid, current_setting('t.bd')::date)::text, true);
select set_config('t.day_past', public.owner_get_closing_day(current_setting('t.a')::uuid, current_setting('t.bd')::date - 5)::text, true);
select set_config('t.snap', public.owner_get_open_closing(current_setting('t.a')::uuid)::text, true);
reset role;
do $$
declare v jsonb;
begin
  if (current_setting('t.save_m2')::jsonb ->> 'ok') <> 'true' then raise exception 'T4 re-invited M''s save failed: %', current_setting('t.save_m2'); end if;
  select x into v from jsonb_array_elements(current_setting('t.day')::jsonb #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.m_live');
  if v ->> 'author_name' is distinct from 'Νίκος Π.' then raise exception 'T4 old version not renamed: %', v; end if;
  select x into v from jsonb_array_elements(current_setting('t.day_past')::jsonb #> '{closings,0,versions}') x where x ->> 'id' = (current_setting('t.save_m2')::jsonb ->> 'closing_id');
  if v ->> 'author_name' is distinct from 'Νίκος Π.' then raise exception 'T4 new version: %', v; end if;
  if (select f ->> 'updated_by_name' from jsonb_array_elements(current_setting('t.snap')::jsonb #> '{closing,fields}') f where f ->> 'key' = 'c:wolt') is distinct from 'Νίκος Π.' then
    raise exception 'T4 field not renamed';
  end if;
  -- the owner's own entries keep «Ιδιοκτήτης»
  select x into v from jsonb_array_elements(current_setting('t.day_past')::jsonb #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.a_past');
  if v ->> 'author_name' is distinct from 'Ιδιοκτήτης' then raise exception 'T4 owner version renamed: %', v; end if;
end $$;

-- T3b A removes M again and M deletes the account: every name of M becomes the tombstone.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('t.mid', (select id::text from public.shop_members where shop_id = current_setting('t.a')::uuid and member_uid = '00000000-0000-0000-0000-0000000000c1' and removed_at is null), true);
set local role authenticated;
select public.owner_remove_member(current_setting('t.mid')::uuid);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
select public.owner_delete_account();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('t.day', public.owner_get_closing_day(current_setting('t.a')::uuid, current_setting('t.bd')::date)::text, true);
select set_config('t.snap', public.owner_get_open_closing(current_setting('t.a')::uuid)::text, true);
reset role;
do $$
declare ph text := 'Διαγραμμένος συνεργάτης ' || left(replace('00000000-0000-0000-0000-0000000000c1', '-', ''), 8); v jsonb;
begin
  select x into v from jsonb_array_elements(current_setting('t.day')::jsonb #> '{closings,0,versions}') x where x ->> 'id' = current_setting('t.m_live');
  if v ->> 'author_name' is distinct from ph then raise exception 'T3b version after deletion: %', v; end if;
  if (select f ->> 'updated_by_name' from jsonb_array_elements(current_setting('t.snap')::jsonb #> '{closing,fields}') f where f ->> 'key' = 'c:wolt') is distinct from ph then
    raise exception 'T3b field after deletion';
  end if;
  if exists (select 1 from jsonb_array_elements(current_setting('t.day')::jsonb #> '{closings,0,versions}') x where x ->> 'author_name' like 'Νίκος%') then
    raise exception 'T3b M''s name left in a version';
  end if;
end $$;

rollback;
