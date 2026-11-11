-- 100 — stage 3 history: closings as a version log (seq), owner_list_closings, owner_get_closing_day,
-- expense_suggestion_data on the current version. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.code', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code'), 'Ταμείο');
select set_config('t.token', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);

-- T0 privileges (before anything else is exercised)
do $$ begin
  if not has_function_privilege('authenticated', 'public.owner_list_closings(uuid,date,date)', 'execute')
     or has_function_privilege('anon', 'public.owner_list_closings(uuid,date,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_get_closing_day(uuid,date)', 'execute')
     or has_function_privilege('anon', 'public.owner_get_closing_day(uuid,date)', 'execute') then
    raise exception 'T0 wrong execute privileges on the public history functions';
  end if;
  if has_function_privilege('authenticated', 'private.current_closing(uuid,date)', 'execute')
     or has_function_privilege('authenticated', 'private.closing_version_json(public.closings)', 'execute') then
    raise exception 'T0 private helpers executable by authenticated';
  end if;
end $$;

-- Setup: two submissions today (the second with another expense); old open closings.
set local role authenticated;
do $$
declare
  tok text := current_setting('t.token');
  cfg uuid := current_setting('t.cfg_a')::uuid;
  bd date := current_setting('t.bd')::date;
  maria jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'));
  in1 jsonb; in2 jsonb; r jsonb;
begin
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"45,60"}', 0);
  if r ->> 'ok' <> 'true' then raise exception 'setup write failed: %', r; end if;
  in1 := jsonb_build_object('schema', 2, 'counts', jsonb_build_object('10000', 5), 'channelCents', jsonb_build_object('wolt', 4560),
    'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300, 'addedBy', maria)));
  in2 := jsonb_build_object('schema', 2, 'counts', jsonb_build_object('10000', 5), 'channelCents', jsonb_build_object('wolt', 4560),
    'expenses', jsonb_build_array(
      jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300, 'addedBy', maria),
      jsonb_build_object('id', 'e2', 'description', 'Μεβγάλ', 'cents', 2160, 'addedBy', maria)));
  r := public.submit_closing(tok, cfg, bd, in1, 1, 'h-1');
  if r ->> 'ok' <> 'true' then raise exception 'setup submit 1 failed: %', r; end if;
  perform set_config('t.c1', r ->> 'closing_id', true);
  r := public.submit_closing(tok, cfg, bd, in2, 1, 'h-2');
  if r ->> 'ok' <> 'true' then raise exception 'setup submit 2 failed: %', r; end if;
  perform set_config('t.c2', r ->> 'closing_id', true);
  perform set_config('t.in2', in2::text, true);
end $$;
reset role;

insert into public.open_closings (id, shop_id, business_date, config_id) values
  ('00000000-0000-0000-0000-0000000000f1', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 1, current_setting('t.cfg_a')::uuid),
  ('00000000-0000-0000-0000-0000000000f2', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 2, current_setting('t.cfg_a')::uuid);
insert into public.open_closing_fields (open_closing_id, key, value, version) values
  ('00000000-0000-0000-0000-0000000000f1', 'd:10000', '{"text":"3","mode":"count"}', 1);

-- Rows of one transaction share now(): make the SECOND submission the older one by created_at, so any
-- implementation that orders by created_at (forbidden) picks the first one and fails T1/T2/T6/T8.
update public.closings set created_at = now() - interval '1 hour' where id = current_setting('t.c2')::uuid;

-- T1 seq unique + increasing; current_closing = the second submission
do $$ begin
  if (select seq from public.closings where id = current_setting('t.c2')::uuid) <= (select seq from public.closings where id = current_setting('t.c1')::uuid) then
    raise exception 'T1 second submission does not have the higher seq';
  end if;
  if (select created_at from public.closings where id = current_setting('t.c2')::uuid) >= (select created_at from public.closings where id = current_setting('t.c1')::uuid) then
    raise exception 'T1 setup: second submission is not older by created_at';
  end if;
  if (select count(distinct seq) from public.closings) <> (select count(*) from public.closings) then raise exception 'T1 seq not unique'; end if;
  if (select id from private.current_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date)) is distinct from current_setting('t.c2')::uuid then
    raise exception 'T1 current_closing is not the second submission';
  end if;
end $$;

-- Owner A calls
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_a')::uuid;
  bd date := current_setting('t.bd')::date;
  r jsonb; d jsonb; i int; prev date;
begin
  r := public.owner_list_closings(shop, null, null);
  -- T2
  if r ->> 'ok' <> 'true' or (r ->> 'today')::date <> bd or (r ->> 'to')::date <> bd or (r ->> 'from')::date <> bd - 29 then
    raise exception 'T2 wrong envelope: %', r - 'days' - 'configs';
  end if;
  select x into d from jsonb_array_elements(r -> 'days') x where (x ->> 'business_date')::date = bd;
  if d is null or d ->> 'status' <> 'submitted' or (d ->> 'version_count')::int <> 2
     or d #>> '{current,id}' <> current_setting('t.c2') or d #>> '{current,kind}' <> 'staff'
     or d #>> '{current,author_name}' <> 'ΜΑΡΙΑ' or d #> '{current,inputs}' is distinct from current_setting('t.in2')::jsonb then
    raise exception 'T2 wrong today entry: %', d;
  end if;
  if not (r -> 'configs') ? (d #>> '{current,config_id}') then raise exception 'T2 configs misses the current config'; end if;
  -- T3
  select x into d from jsonb_array_elements(r -> 'days') x where (x ->> 'business_date')::date = bd - 1;
  if d is null or d ->> 'status' <> 'unsubmitted' or jsonb_path_query_first(d, '$.open.fields[*] ? (@.key == "d:10000")') is null then
    raise exception 'T3 yesterday not an unsubmitted day with d:10000: %', d;
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'days') x where (x ->> 'business_date')::date = bd - 2) then
    raise exception 'T3 a day without fields is listed';
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'days') x where (x ->> 'business_date')::date = bd and x ->> 'status' = 'unsubmitted') then
    raise exception 'T3 today is unsubmitted';
  end if;
  prev := null;
  for i in 0 .. jsonb_array_length(r -> 'days') - 1 loop
    if prev is not null and (r -> 'days' -> i ->> 'business_date')::date >= prev then raise exception 'T3 not newest first'; end if;
    prev := (r -> 'days' -> i ->> 'business_date')::date;
  end loop;
  -- T5
  if public.owner_list_closings(shop, bd, bd - 1) is distinct from '{"ok":false,"error":"bad_range"}'::jsonb
     or public.owner_list_closings(shop, bd - 400, bd) is distinct from '{"ok":false,"error":"bad_range"}'::jsonb then
    raise exception 'T5 bad_range not returned';
  end if;
  r := public.owner_list_closings(shop, bd - 1000, bd - 900);
  if r ->> 'ok' <> 'true' or r -> 'days' <> '[]'::jsonb then raise exception 'T5 range before data: %', r; end if;
  -- T6
  r := public.owner_get_closing_day(shop, bd);
  if r ->> 'ok' <> 'true' or jsonb_array_length(r -> 'versions') <> 2 or r #>> '{versions,0,id}' <> current_setting('t.c2')
     or r #>> '{versions,1,id}' <> current_setting('t.c1')
     or r -> 'staff_names' ->> current_setting('t.maria') <> 'ΜΑΡΙΑ' or r -> 'open' <> 'null'::jsonb or (r ->> 'today')::date <> bd then
    raise exception 'T6 wrong today detail: %', r;
  end if;
  r := public.owner_get_closing_day(shop, bd - 1);
  if r -> 'versions' <> '[]'::jsonb or r -> 'open' = 'null'::jsonb then raise exception 'T6 wrong yesterday detail: %', r; end if;
  foreach d in array array[to_jsonb(bd - 2), to_jsonb(bd + 5), 'null'::jsonb] loop
    r := public.owner_get_closing_day(shop, nullif(d #>> '{}', '')::date);
    if r ->> 'ok' <> 'true' or r -> 'versions' <> '[]'::jsonb or r -> 'open' <> 'null'::jsonb then
      raise exception 'T6 wrong empty detail for %: %', d, r;
    end if;
  end loop;
end $$;
reset role;

-- T4 a voided current version falls back to the first submission
update public.closings set voided_at = now() where id = current_setting('t.c2')::uuid;
set local role authenticated;
do $$
declare d jsonb; r jsonb;
begin
  r := public.owner_list_closings(current_setting('t.shop_a')::uuid, null, null);
  select x into d from jsonb_array_elements(r -> 'days') x where (x ->> 'business_date')::date = current_setting('t.bd')::date;
  if (d ->> 'version_count')::int <> 1 or d #>> '{current,id}' <> current_setting('t.c1') then raise exception 'T4 void not handled: %', d; end if;
end $$;
reset role;
update public.closings set voided_at = null where id = current_setting('t.c2')::uuid;

-- T7 owner B / phone / unknown shop: not_owner, same message
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare ids uuid[] := array[current_setting('t.shop_a')::uuid, gen_random_uuid()]; s uuid; msgs text[] := '{}'; m text;
begin
  foreach s in array ids loop
    begin perform public.owner_list_closings(s, null, null); raise exception 'T7 list allowed'; exception when others then
      if sqlerrm = 'T7 list allowed' then raise; end if; msgs := msgs || sqlerrm; end;
    begin perform public.owner_get_closing_day(s, current_setting('t.bd')::date); raise exception 'T7 day allowed'; exception when others then
      if sqlerrm = 'T7 day allowed' then raise; end if; msgs := msgs || sqlerrm; end;
  end loop;
  foreach m in array msgs loop if m <> 'not_owner' then raise exception 'T7 unexpected message %', m; end if; end loop;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.owner_list_closings(current_setting('t.shop_a')::uuid, null, null); raise exception 'T7 phone allowed';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
  begin perform public.owner_get_closing_day(current_setting('t.shop_a')::uuid, null); raise exception 'T7 phone allowed (day)';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
  -- T8 suggestions come from the current version only (the first submission has no 'Μεβγάλ'... it has only Nice)
  if (select array_agg(description order by description) from public.expense_suggestion_data()) is distinct from array['Nice', 'Μεβγάλ'] then
    raise exception 'T8 wrong suggestions: %', (select array_agg(description) from public.expense_suggestion_data());
  end if;
  if (select count(*) from public.expense_suggestion_data() where description = 'Nice') <> 1 then
    raise exception 'T8 both versions counted';
  end if;
end $$;
reset role;

-- T9 pre-existing rows are staff rows; the shape check holds
do $$ begin
  if exists (select 1 from public.closings where kind <> 'staff' or staff_id is null or device_user_id is null) then raise exception 'T9 existing row not a staff row'; end if;
  begin
    insert into public.closings (shop_id, kind, config_id, business_date, inputs, idempotency_key)
    values (current_setting('t.shop_a')::uuid, 'staff', current_setting('t.cfg_a')::uuid, current_date, '{}', 't9a');
    raise exception 'T9 staff row without staff_id accepted';
  exception when check_violation then null; end;
  begin
    insert into public.closings (shop_id, kind, staff_id, device_user_id, corrected_by, config_id, business_date, inputs, idempotency_key)
    values (current_setting('t.shop_a')::uuid, 'owner_correction', current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000a1', current_setting('t.cfg_a')::uuid, current_date, '{}', 't9b');
    raise exception 'T9 owner_correction with staff_id accepted';
  exception when check_violation then null; end;
end $$;
rollback;
