-- 110 — stage 3 owner corrections: owner_save_closing (a correction is a NEW closings row, guarded on the
-- current version; the original rows, open_closings.revision and last_submit are never touched).
-- One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.shop_c', public.create_shop('Shop C', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.eleni', public.create_staff(current_setting('t.shop_a')::uuid, 'ΕΛΕΝΗ', '4321')::text, true);
select set_config('t.code', public.create_pairing_code(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_c', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_c')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop_b')::uuid, 'ΝΙΚΟΣ', '1111')::text, true);
select set_config('t.cfg_b', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_b')::uuid), true);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.redeem_pairing_code(current_setting('t.code'), 'Ταμείο');
select set_config('t.token', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);

-- T0 privileges (before anything else is exercised)
do $$ begin
  if not has_function_privilege('authenticated', 'public.owner_save_closing(uuid,date,uuid,jsonb,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.owner_save_closing(uuid,date,uuid,jsonb,uuid,text)', 'execute') then
    raise exception 'T0 wrong execute privileges on owner_save_closing';
  end if;
end $$;

-- Setup: one staff submission today by ΜΑΡΙΑ (e1), an unsubmitted today-1 with one field, an empty today-2.
set local role authenticated;
do $$
declare
  tok text := current_setting('t.token');
  cfg uuid := current_setting('t.cfg_a')::uuid;
  bd date := current_setting('t.bd')::date;
  maria jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'));
  in1 jsonb; fix jsonb; r jsonb;
begin
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"45,60"}', 0);
  if r ->> 'ok' <> 'true' then raise exception 'setup write failed: %', r; end if;
  in1 := jsonb_build_object('schema', 2, 'counts', jsonb_build_object('10000', 5), 'channelCents', jsonb_build_object('wolt', 4560),
    'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300, 'addedBy', maria)));
  fix := jsonb_build_object('schema', 2, 'counts', jsonb_build_object('10000', 5), 'channelCents', jsonb_build_object('wolt', 4560),
    'expenses', jsonb_build_array(
      jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1500, 'addedBy', maria),
      jsonb_build_object('id', 'e2', 'description', 'Ιδιοκτήτης έξοδο', 'cents', 700, 'addedBy', jsonb_build_object('kind', 'owner'))));
  r := public.submit_closing(tok, cfg, bd, in1, 1, 'h-1');
  if r ->> 'ok' <> 'true' then raise exception 'setup submit failed: %', r; end if;
  perform set_config('t.c1', r ->> 'closing_id', true);
  perform set_config('t.in1', in1::text, true);
  perform set_config('t.fix', fix::text, true);
end $$;
reset role;

insert into public.open_closings (id, shop_id, business_date, config_id) values
  ('00000000-0000-0000-0000-0000000000f1', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 1, current_setting('t.cfg_a')::uuid),
  ('00000000-0000-0000-0000-0000000000f2', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 2, current_setting('t.cfg_a')::uuid);
insert into public.open_closing_fields (open_closing_id, key, value, version) values
  ('00000000-0000-0000-0000-0000000000f1', 'd:10000', '{"text":"3","mode":"count"}', 1);

-- Snapshots taken before any owner save
select set_config('t.c1_before', (select to_jsonb(c)::text from public.closings c where id = current_setting('t.c1')::uuid), true);
select set_config('t.oc_before', (select jsonb_build_object('revision', revision, 'last_submit', last_submit)::text
  from public.open_closings where shop_id = current_setting('t.shop_a')::uuid and business_date = current_setting('t.bd')::date), true);
select set_config('t.n_before', (select count(*)::text from public.closings), true);

-- T1 owner A corrects today
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.r1', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, current_setting('t.c1')::uuid, 'k1')::text, true);
reset role;
do $$
declare r jsonb := current_setting('t.r1')::jsonb; c public.closings;
begin
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T1 not ok: %', r; end if;
  select * into c from public.closings where id = (r ->> 'closing_id')::uuid;
  if c.kind <> 'owner_correction' or c.corrected_by is distinct from '00000000-0000-0000-0000-0000000000a1'::uuid
     or c.staff_id is not null or c.device_user_id is not null
     or c.corrects_closing_id is distinct from current_setting('t.c1')::uuid
     or c.config_id <> current_setting('t.cfg_a')::uuid or c.business_date <> current_setting('t.bd')::date
     or c.inputs <> current_setting('t.fix')::jsonb or c.idempotency_key <> 'k1' then
    raise exception 'T1 wrong row: %', to_jsonb(c);
  end if;
  perform set_config('t.corr', c.id::text, true);
  -- T2 the original is untouched
  if (select to_jsonb(x) from public.closings x where id = current_setting('t.c1')::uuid) <> current_setting('t.c1_before')::jsonb then
    raise exception 'T2 original row changed';
  end if;
  if (select count(*) from public.closings) <> current_setting('t.n_before')::int + 1 then raise exception 'T1 row count'; end if;
  -- T3 open closing untouched
  if (select jsonb_build_object('revision', revision, 'last_submit', last_submit) from public.open_closings
       where shop_id = current_setting('t.shop_a')::uuid and business_date = current_setting('t.bd')::date) <> current_setting('t.oc_before')::jsonb then
    raise exception 'T3 open_closings changed by the save';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare r jsonb := public.owner_get_closing_day(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date);
begin
  if jsonb_array_length(r -> 'versions') <> 2 or r #>> '{versions,0,kind}' <> 'owner_correction'
     or r #>> '{versions,0,author_name}' <> 'Ιδιοκτήτης' or r #>> '{versions,0,id}' <> current_setting('t.corr') then
    raise exception 'T3 wrong day: %', r -> 'versions';
  end if;
end $$;
reset role;

-- T4 retry with the same key is a repeat; same key, other inputs is a conflict
set local role authenticated;
select set_config('t.r4a', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, current_setting('t.c1')::uuid, 'k1')::text, true);
select set_config('t.r4b', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.in1')::jsonb, current_setting('t.c1')::uuid, 'k1')::text, true);
reset role;
do $$ begin
  if current_setting('t.r4a')::jsonb <> jsonb_build_object('ok', true, 'repeat', true, 'closing_id', current_setting('t.corr')) then
    raise exception 'T4 repeat wrong: %', current_setting('t.r4a');
  end if;
  if current_setting('t.r4b')::jsonb <> '{"ok":false,"error":"idempotency_conflict"}'::jsonb then
    raise exception 'T4 conflict wrong: %', current_setting('t.r4b');
  end if;
  if (select count(*) from public.closings) <> current_setting('t.n_before')::int + 1 then raise exception 'T4 row count'; end if;
end $$;

-- T5 stale expectation
set local role authenticated;
select set_config('t.r5a', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, current_setting('t.c1')::uuid, 'k2')::text, true);
select set_config('t.r5b', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, null, 'k3')::text, true);
reset role;
do $$ begin
  if current_setting('t.r5a')::jsonb <> jsonb_build_object('ok', false, 'error', 'closing_changed', 'current_id', current_setting('t.corr'))
     or current_setting('t.r5b')::jsonb <> jsonb_build_object('ok', false, 'error', 'closing_changed', 'current_id', current_setting('t.corr')) then
    raise exception 'T5 wrong: % / %', current_setting('t.r5a'), current_setting('t.r5b');
  end if;
  if (select count(*) from public.closings) <> current_setting('t.n_before')::int + 1 then raise exception 'T5 row count'; end if;
end $$;

-- T6 ΜΑΡΙΑ resubmits (current revision); the owner's stale save is refused with the resubmission's id
select set_config('t.rev', (select revision::text from public.open_closings
  where shop_id = current_setting('t.shop_a')::uuid and business_date = current_setting('t.bd')::date), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select set_config('t.r6s', public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.in1')::jsonb, current_setting('t.rev')::bigint, 'h-3')::text, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.r6o', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, current_setting('t.corr')::uuid, 'k4')::text, true);
select set_config('t.r6d', public.owner_get_closing_day(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date)::text, true);
reset role;
do $$
declare s jsonb := current_setting('t.r6s')::jsonb;
begin
  if s ->> 'ok' <> 'true' then raise exception 'T6 resubmit failed: %', s; end if;
  perform set_config('t.c3', s ->> 'closing_id', true);
  if current_setting('t.r6d')::jsonb #>> '{versions,0,id}' <> s ->> 'closing_id' then raise exception 'T6 resubmission is not [0]'; end if;
  if current_setting('t.r6o')::jsonb <> jsonb_build_object('ok', false, 'error', 'closing_changed', 'current_id', s ->> 'closing_id') then
    raise exception 'T6 owner save after resubmit: %', current_setting('t.r6o');
  end if;
  if (select count(*) from public.closings) <> current_setting('t.n_before')::int + 2 then raise exception 'T6 row count'; end if;
end $$;

-- T7 not_owner: owner B, owner A with an unknown shop, a phone
do $$
declare n int := (select count(*) from public.closings); begin perform set_config('t.n7', n::text, true); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date, current_setting('t.cfg_a')::uuid,
      current_setting('t.fix')::jsonb, current_setting('t.c3')::uuid, 'k7a'); raise exception 'T7 owner B allowed';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.owner_save_closing(gen_random_uuid(), current_setting('t.bd')::date, current_setting('t.cfg_a')::uuid,
      current_setting('t.fix')::jsonb, current_setting('t.c3')::uuid, 'k7b'); raise exception 'T7 unknown shop allowed';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date, current_setting('t.cfg_a')::uuid,
      current_setting('t.fix')::jsonb, current_setting('t.c3')::uuid, 'k7c'); raise exception 'T7 phone allowed';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.closings) <> current_setting('t.n7')::int then raise exception 'T7 rows stored'; end if;
end $$;

-- T8 bad_inputs, nothing stored
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_a')::uuid; bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid; cur uuid := current_setting('t.c3')::uuid;
  fix jsonb := current_setting('t.fix')::jsonb;
  nikos jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.nikos'));
  badx jsonb := jsonb_build_object('kind', 'staff', 'id', 'x');
  exp_ jsonb := jsonb_build_array(jsonb_build_object('id', 'e9', 'description', 'X', 'cents', 100, 'addedBy', null));
  r jsonb; i int;
  cases jsonb[]; k text; d date; inp jsonb; label text;
begin
  for i in 1 .. 9 loop
    k := 'k8-' || i; d := bd; inp := fix;
    if i = 1 then inp := fix || '{"schema":1}'; label := 'schema-1';
    elsif i = 2 then inp := fix || '{"counts":[]}'; label := 'counts array';
    elsif i = 3 then k := null; label := 'null key';
    elsif i = 4 then k := repeat('k', 101); label := '101-char key';
    elsif i = 5 then d := null; label := 'null date';
    elsif i = 6 then inp := fix || jsonb_build_object('expenses', jsonb_build_array(jsonb_build_object('id', 'e9', 'description', 'X', 'cents', 100, 'addedBy', nikos))); label := 'staff of shop B';
    elsif i = 7 then inp := fix || jsonb_build_object('expenses', jsonb_build_array(jsonb_build_object('id', 'e9', 'description', 'X', 'cents', 100, 'addedBy', badx))); label := 'addedBy id x';
    elsif i = 8 then inp := null; label := 'null inputs';
    else inp := fix - 'expenses'; label := 'no expenses'; end if;
    r := public.owner_save_closing(shop, d, cfg, inp, cur, k);
    if r is distinct from '{"ok":false,"error":"bad_inputs"}'::jsonb then raise exception 'T8 % gave %', label, r; end if;
  end loop;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.closings) <> current_setting('t.n7')::int then raise exception 'T8 rows stored'; end if;
end $$;

-- T9 authorship: a deactivated ΜΑΡΙΑ's line is kept; a line by ΕΛΕΝΗ (never signed in) is accepted
update public.staff set active = false where id = current_setting('t.maria')::uuid;
select set_config('t.fix9', jsonb_set(current_setting('t.fix')::jsonb, '{expenses}',
  (current_setting('t.fix')::jsonb -> 'expenses') || jsonb_build_array(jsonb_build_object('id', 'e3', 'description', 'Ελένη', 'cents', 250,
     'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.eleni')))))::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.r9', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix9')::jsonb, current_setting('t.c3')::uuid, 'k9')::text, true);
reset role;
do $$
declare r jsonb := current_setting('t.r9')::jsonb;
begin
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T9 not ok: %', r; end if;
  perform set_config('t.c9', r ->> 'closing_id', true);
  if (select count(*) from public.closings) <> current_setting('t.n7')::int + 1 then raise exception 'T9 row count'; end if;
end $$;

-- T10 config_mismatch: another version of shop A's config, and shop B's config
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.publish_config(current_setting('t.shop_a')::uuid, 1, '{"schema":1,"floatCents":50000}');
select set_config('t.cfg_a2', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid and id <> current_setting('t.cfg_a')::uuid), true);
select set_config('t.r10a', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a2')::uuid, current_setting('t.fix')::jsonb, current_setting('t.c9')::uuid, 'k10a')::text, true);
select set_config('t.r10b', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_b')::uuid, current_setting('t.fix')::jsonb, current_setting('t.c9')::uuid, 'k10b')::text, true);
reset role;
do $$ begin
  if current_setting('t.r10a')::jsonb <> '{"ok":false,"error":"config_mismatch"}'::jsonb
     or current_setting('t.r10b')::jsonb <> '{"ok":false,"error":"config_mismatch"}'::jsonb then
    raise exception 'T10 wrong: % / %', current_setting('t.r10a'), current_setting('t.r10b');
  end if;
  if (select count(*) from public.closings) <> current_setting('t.n7')::int + 1 then raise exception 'T10 row count'; end if;
end $$;

-- T11 unsubmitted day (today - 1): the owner's first save creates its first version
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.r11', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 1,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, null, 'k11')::text, true);
select set_config('t.r11l', public.owner_list_closings(current_setting('t.shop_a')::uuid, null, null)::text, true);
reset role;
do $$
declare r jsonb := current_setting('t.r11')::jsonb; c public.closings; d jsonb;
begin
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T11 not ok: %', r; end if;
  select * into c from public.closings where id = (r ->> 'closing_id')::uuid;
  if c.kind <> 'owner_correction' or c.corrects_closing_id is not null or c.business_date <> current_setting('t.bd')::date - 1 then
    raise exception 'T11 wrong row: %', to_jsonb(c);
  end if;
  select x into d from jsonb_array_elements(current_setting('t.r11l')::jsonb -> 'days') x
   where (x ->> 'business_date')::date = current_setting('t.bd')::date - 1;
  if d ->> 'status' <> 'submitted' then raise exception 'T11 day not submitted: %', d; end if;
end $$;
-- a phone reads its suggestions: the new day's lines are in (relies on the day being within the window)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.expense_suggestion_data() where description = 'Ιδιοκτήτης έξοδο' and business_date = current_setting('t.bd')::date - 1) then
    raise exception 'T11 suggestions miss the corrected day';
  end if;
end $$;
reset role;

-- T12 no_closing_day, nothing stored
do $$ begin perform set_config('t.n12', (select count(*)::text from public.closings), true); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  bd date := current_setting('t.bd')::date;
  fix jsonb := '{"schema":2,"counts":{},"channelCents":{},"expenses":[]}';  -- no staff lines: shop C has no ΜΑΡΙΑ
  r jsonb; i int; shop uuid; d date; cfg uuid;
begin
  for i in 1 .. 4 loop
    shop := current_setting('t.shop_a')::uuid; cfg := current_setting('t.cfg_a')::uuid;
    if i = 1 then shop := current_setting('t.shop_c')::uuid; cfg := current_setting('t.cfg_c')::uuid; d := bd;
    elsif i = 2 then d := bd + 1;
    elsif i = 3 then d := bd - 5;
    else d := bd - 2; end if;
    r := public.owner_save_closing(shop, d, cfg, fix, null, 'k12-' || i);
    if r is distinct from '{"ok":false,"error":"no_closing_day"}'::jsonb then raise exception 'T12 case % gave %', i, r; end if;
  end loop;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.closings) <> current_setting('t.n12')::int then raise exception 'T12 rows stored'; end if;
end $$;
rollback;
