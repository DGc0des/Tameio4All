-- 180 — history, corrections and suggestions per closing (20261117000002_multi_closing_history): the list and the
-- day detail grouped by closing (old-style day, three closings with a correction, an unsubmitted tail), the plan
-- and live_closing_no, private.current_closing per closing, owner_save_closing per closing (past closing, an
-- earlier closing of today, the live closing), suggestions for 'separate' and 'running' days, grants.
-- One transaction, ends in ROLLBACK. Owner/phone calls run as `authenticated`; row checks, private.* and the
-- "write as the migration owner" steps (back-dated closings / open_closings rows, as 100 does) run as postgres.
-- Shop A (owner A, plan 2 'separate' for today): ΜΑΡΙΑ on phone d1. Past days (bd = shop A's business date):
--   bd-20 old-style (one closings row, no open closing)       bd-13 'running', closings 1 and 2 (suggestions)
--   bd-12 'separate', closings 1 and 2 (suggestions)           bd-10 plan 3, closings 1..3 + a correction on 2
--   bd-9  plan 3, closings 1 and 2 submitted, 3 unsubmitted
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}]}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.key_a', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
-- today's closing 1 does not exist yet, so today pins this plan
select public.set_closing_plan(current_setting('t.shop_a')::uuid, 2, 'separate');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'Ταμείο 1');
select set_config('t.tok', public.staff_sign_in(current_setting('t.maria')::uuid, '123456') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);
select set_config('t.good', '{"schema":2,"counts":{"10000":5},"channelCents":{"wolt":4560},"expenses":[]}', true);
select set_config('t.fix', '{"schema":2,"counts":{"10000":2},"channelCents":{},"expenses":[]}', true);

do $$ begin
  if current_setting('t.tok') !~ '^[0-9a-f]{64}$' then raise exception 'setup: sign-in failed'; end if;
end $$;

-- Past days, written as the migration owner. Staff rows: ΜΑΡΙΑ on d1.
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key, closing_no)
select current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1',
       current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date + v.off, current_setting('t.good')::jsonb, v.k, v.no
  from (values (-20, 's-20-1', 1), (-10, 's-10-1', 1), (-10, 's-10-2', 2), (-10, 's-10-3', 3),
               (-9, 's-9-1', 1), (-9, 's-9-2', 2)) v(off, k, no);
insert into public.open_closings (id, shop_id, business_date, config_id, closing_no, closings_planned, cash_mode) values
  ('00000000-0000-0000-0000-0000000010a1', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 10, current_setting('t.cfg_a')::uuid, 1, 3, 'separate'),
  ('00000000-0000-0000-0000-0000000010a2', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 10, current_setting('t.cfg_a')::uuid, 2, 3, 'separate'),
  ('00000000-0000-0000-0000-0000000010a3', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 10, current_setting('t.cfg_a')::uuid, 3, 3, 'separate'),
  ('00000000-0000-0000-0000-0000000009a1', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 9, current_setting('t.cfg_a')::uuid, 1, 3, 'separate'),
  ('00000000-0000-0000-0000-0000000009a2', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 9, current_setting('t.cfg_a')::uuid, 2, 3, 'separate'),
  ('00000000-0000-0000-0000-0000000009a3', current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 9, current_setting('t.cfg_a')::uuid, 3, 3, 'separate');
insert into public.open_closing_fields (open_closing_id, key, value, version) values
  ('00000000-0000-0000-0000-0000000009a3', 'd:10000', '{"text":"3","mode":"count"}', 1);
select set_config('t.s10_1', (select id::text from public.closings where idempotency_key = 's-10-1'), true);
select set_config('t.s10_2', (select id::text from public.closings where idempotency_key = 's-10-2'), true);
select set_config('t.s10_3', (select id::text from public.closings where idempotency_key = 's-10-3'), true);
-- the correction on closing 2 of bd-10 (a later statement: a higher seq)
insert into public.closings (shop_id, kind, corrected_by, corrects_closing_id, config_id, business_date, inputs, idempotency_key, closing_no)
values (current_setting('t.shop_a')::uuid, 'owner_correction', '00000000-0000-0000-0000-0000000000a1', current_setting('t.s10_2')::uuid,
        current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date - 10, current_setting('t.fix')::jsonb, 'o-10-2', 2);
select set_config('t.o10_2', (select id::text from public.closings where idempotency_key = 'o-10-2'), true);

-- T1 old-style day (bd-20): no open closing -> 'separate', plan 1, one submitted closing 1.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  bd date := current_setting('t.bd')::date;
  r jsonb := public.owner_list_closings(current_setting('t.shop_a')::uuid, bd - 20, bd - 20);
  d jsonb;
begin
  if r ->> 'ok' <> 'true' or jsonb_array_length(r -> 'days') <> 1 then raise exception 'T1 wrong list: %', r; end if;
  d := r -> 'days' -> 0;
  if (d ->> 'business_date')::date <> bd - 20 or d ->> 'cash_mode' is distinct from 'separate'
     or d -> 'closings_planned' is distinct from '1'::jsonb or jsonb_array_length(d -> 'closings') <> 1
     or d #> '{closings,0,closing_no}' is distinct from '1'::jsonb or d #>> '{closings,0,status}' is distinct from 'submitted'
     or d #> '{closings,0,version_count}' is distinct from '1'::jsonb then
    raise exception 'T1 wrong old-style day: %', d;
  end if;
end $$;

-- T2 three closings with a correction on closing 2 (bd-10).
do $$
declare
  bd date := current_setting('t.bd')::date;
  r jsonb := public.owner_list_closings(current_setting('t.shop_a')::uuid, bd - 10, bd - 10);
  d jsonb;
begin
  if r ->> 'ok' <> 'true' or jsonb_array_length(r -> 'days') <> 1 then raise exception 'T2 wrong list: %', r; end if;
  d := r -> 'days' -> 0;
  if d ->> 'cash_mode' is distinct from 'separate' or d -> 'closings_planned' is distinct from '3'::jsonb
     or jsonb_array_length(d -> 'closings') <> 3
     or d #> '{closings,0,closing_no}' is distinct from '1'::jsonb
     or d #> '{closings,1,closing_no}' is distinct from '2'::jsonb
     or d #> '{closings,2,closing_no}' is distinct from '3'::jsonb then
    raise exception 'T2 wrong day: %', d;
  end if;
  if d #>> '{closings,0,current,id}' is distinct from current_setting('t.s10_1')
     or d #> '{closings,0,version_count}' is distinct from '1'::jsonb
     or d #>> '{closings,1,status}' is distinct from 'submitted'
     or d #> '{closings,1,version_count}' is distinct from '2'::jsonb
     or d #>> '{closings,1,current,id}' is distinct from current_setting('t.o10_2')
     or d #>> '{closings,1,current,kind}' is distinct from 'owner_correction'
     or d #>> '{closings,2,current,id}' is distinct from current_setting('t.s10_3') then
    raise exception 'T2 wrong entries: %', d -> 'closings';
  end if;
  if not (r -> 'configs') ? current_setting('t.cfg_a') then raise exception 'T2 configs misses the config: %', r -> 'configs'; end if;
end $$;

-- T3 unsubmitted tail (bd-9): closings 1 and 2 submitted, closing 3 open with a field.
do $$
declare
  bd date := current_setting('t.bd')::date;
  r jsonb := public.owner_list_closings(current_setting('t.shop_a')::uuid, bd - 9, bd - 9);
  d jsonb;
begin
  d := r -> 'days' -> 0;
  if jsonb_array_length(r -> 'days') <> 1 or jsonb_array_length(d -> 'closings') <> 3
     or d #>> '{closings,0,status}' is distinct from 'submitted' or d #>> '{closings,1,status}' is distinct from 'submitted'
     or d #> '{closings,2,closing_no}' is distinct from '3'::jsonb or d #>> '{closings,2,status}' is distinct from 'unsubmitted'
     or d #> '{closings,2,open,closing_no}' is distinct from '3'::jsonb
     or jsonb_path_query_first(d, '$.closings[2].open.fields[*] ? (@.key == "d:10000")') is null
     or d #> '{closings,2,current}' is not null then
    raise exception 'T3 wrong unsubmitted tail: %', d;
  end if;
  -- the whole range: newest day first, bd-20 .. bd-9 are three days (bd-13/bd-12 have no rows yet)
  r := public.owner_list_closings(current_setting('t.shop_a')::uuid, bd - 20, bd - 1);
  if jsonb_array_length(r -> 'days') <> 3 or (r #>> '{days,0,business_date}')::date <> bd - 9
     or (r #>> '{days,1,business_date}')::date <> bd - 10 or (r #>> '{days,2,business_date}')::date <> bd - 20 then
    raise exception 'T3 wrong days order: %', r -> 'days';
  end if;
end $$;

-- T4 day detail of bd-10: three closings, each with its own versions; live_closing_no null.
do $$
declare
  bd date := current_setting('t.bd')::date;
  r jsonb := public.owner_get_closing_day(current_setting('t.shop_a')::uuid, bd - 10);
begin
  if r ->> 'ok' <> 'true' or (r ->> 'business_date')::date <> bd - 10 or (r ->> 'today')::date <> bd
     or r ->> 'cash_mode' is distinct from 'separate' or r -> 'closings_planned' is distinct from '3'::jsonb
     or r -> 'live_closing_no' is distinct from 'null'::jsonb or jsonb_array_length(r -> 'closings') <> 3 then
    raise exception 'T4 wrong detail: %', r - 'configs' - 'staff_names';
  end if;
  if r #> '{closings,0,closing_no}' is distinct from '1'::jsonb
     or jsonb_array_length(r #> '{closings,0,versions}') <> 1 or r #>> '{closings,0,versions,0,id}' is distinct from current_setting('t.s10_1')
     or r #> '{closings,1,closing_no}' is distinct from '2'::jsonb
     or jsonb_array_length(r #> '{closings,1,versions}') <> 2
     or r #>> '{closings,1,versions,0,id}' is distinct from current_setting('t.o10_2')
     or r #>> '{closings,1,versions,1,id}' is distinct from current_setting('t.s10_2')
     or r #> '{closings,2,closing_no}' is distinct from '3'::jsonb
     or jsonb_array_length(r #> '{closings,2,versions}') <> 1 or r #>> '{closings,2,versions,0,id}' is distinct from current_setting('t.s10_3')
     or r #> '{closings,0,open}' is distinct from 'null'::jsonb or r #> '{closings,1,open}' is distinct from 'null'::jsonb
     or r #> '{closings,2,open}' is distinct from 'null'::jsonb then
    raise exception 'T4 wrong closings: %', r -> 'closings';
  end if;
  if not (r -> 'configs') ? current_setting('t.cfg_a') or r -> 'staff_names' ->> current_setting('t.maria') is distinct from 'ΜΑΡΙΑ' then
    raise exception 'T4 configs / staff_names wrong: % / %', r -> 'configs', r -> 'staff_names';
  end if;
  -- the unsubmitted closing 3 of bd-9 carries its open closing, the submitted ones none
  r := public.owner_get_closing_day(current_setting('t.shop_a')::uuid, bd - 9);
  if jsonb_array_length(r -> 'closings') <> 3 or r #> '{closings,2,versions}' is distinct from '[]'::jsonb
     or r #> '{closings,2,open,closing_no}' is distinct from '3'::jsonb or r #> '{closings,0,open}' is distinct from 'null'::jsonb then
    raise exception 'T4 wrong bd-9 detail: %', r -> 'closings';
  end if;
  -- an empty day: no closings
  r := public.owner_get_closing_day(current_setting('t.shop_a')::uuid, bd - 2);
  if r ->> 'ok' <> 'true' or r -> 'closings' is distinct from '[]'::jsonb or r -> 'live_closing_no' is distinct from 'null'::jsonb then
    raise exception 'T4 wrong empty day: %', r;
  end if;
end $$;
reset role;

-- Today (plan 2 'separate'): ΜΑΡΙΑ submits closing 1, starts closing 2, writes and submits it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok');
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  good jsonb := current_setting('t.good')::jsonb;
  r jsonb;
begin
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"10"}', 0, 1);
  if (r ->> 'ok')::boolean is not true or r ->> 'revision' is distinct from '1' then raise exception 'setup today write 1: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, good, 1, 'p-1', 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup today submit 1: %', r; end if;
  perform set_config('t.t1', r ->> 'closing_id', true);
  r := public.start_next_closing(tok, bd, 1);
  if (r ->> 'ok')::boolean is not true or r #> '{closing,closing_no}' is distinct from '2'::jsonb then raise exception 'setup start 2: %', r; end if;
  perform set_config('t.oc_t2', r #>> '{closing,id}', true);
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"20"}', 0, 2);
  if (r ->> 'ok')::boolean is not true or r ->> 'revision' is distinct from '1' then raise exception 'setup today write 2: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, good, 1, 'p-2', 2);
  if (r ->> 'ok')::boolean is not true then raise exception 'setup today submit 2: %', r; end if;
  perform set_config('t.t2', r ->> 'closing_id', true);
end $$;
reset role;
select set_config('t.oc_t1', (select id::text from public.open_closings
  where shop_id = current_setting('t.shop_a')::uuid and business_date = current_setting('t.bd')::date and closing_no = 1), true);

-- T4 today with closing 2 live: live_closing_no = 2, two closings.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare r jsonb := public.owner_get_closing_day(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date);
begin
  if r -> 'live_closing_no' is distinct from '2'::jsonb or r -> 'closings_planned' is distinct from '2'::jsonb
     or r ->> 'cash_mode' is distinct from 'separate' or jsonb_array_length(r -> 'closings') <> 2
     or r #>> '{closings,0,versions,0,id}' is distinct from current_setting('t.t1')
     or r #>> '{closings,1,versions,0,id}' is distinct from current_setting('t.t2')
     or r #> '{closings,0,open}' is distinct from 'null'::jsonb or r #> '{closings,1,open}' is distinct from 'null'::jsonb then
    raise exception 'T4 wrong today detail: %', r - 'configs' - 'staff_names';
  end if;
end $$;
reset role;

-- T5 the current version per closing.
do $$
declare bd date := current_setting('t.bd')::date;
begin
  if (private.current_closing(current_setting('t.shop_a')::uuid, bd - 10, 2)).id::text is distinct from current_setting('t.o10_2') then
    raise exception 'T5 closing 2 current is not the correction';
  end if;
  if (private.current_closing(current_setting('t.shop_a')::uuid, bd - 10, 1)).id::text is distinct from current_setting('t.s10_1') then
    raise exception 'T5 closing 1 current is not its own row';
  end if;
  if (private.current_closing(current_setting('t.shop_a')::uuid, bd - 10, 4)).id is not null then
    raise exception 'T5 a closing without rows has a current version';
  end if;
end $$;

-- T6 save a past closing (bd-10, closing 2); guarded on closing 1's current -> closing_changed; bad numbers.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_a')::uuid;
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  inp jsonb := '{"schema":2,"counts":{"10000":7},"channelCents":{},"expenses":[]}';
  r jsonb;
  n int;
begin
  r := public.owner_save_closing(shop, bd - 10, cfg, inp, current_setting('t.o10_2')::uuid, 'k6', p_closing_no => 2);
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T6 save of closing 2 refused: %', r; end if;
  perform set_config('t.k6', r ->> 'closing_id', true);
  r := public.owner_save_closing(shop, bd - 10, cfg, inp, current_setting('t.s10_1')::uuid, 'k6b', p_closing_no => 2);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'closing_changed', 'current_id', current_setting('t.k6')) then
    raise exception 'T6 guard on closing 1''s current: %', r;
  end if;
  -- the same key naming another closing is not a repeat
  r := public.owner_save_closing(shop, bd - 10, cfg, inp, current_setting('t.s10_1')::uuid, 'k6', p_closing_no => 1);
  if r is distinct from '{"ok":false,"error":"idempotency_conflict"}'::jsonb then raise exception 'T6 same key, closing 1: %', r; end if;
  n := (select count(*) from public.closings);
  foreach r in array array['0'::jsonb, '7'::jsonb, 'null'::jsonb] loop
    if public.owner_save_closing(shop, bd - 10, cfg, inp, current_setting('t.s10_1')::uuid, 'k6c', null, (r #>> '{}')::int)
       is distinct from '{"ok":false,"error":"bad_inputs"}'::jsonb then
      raise exception 'T6 closing number % accepted', r;
    end if;
  end loop;
  if (select count(*) from public.closings) <> n then raise exception 'T6 a refused save stored a row'; end if;
  -- M7: the guard is per closing. Closing 1's current (s10_1) is not the day's newest row (k6 is), yet a save of
  -- closing 1 guarded on it lands.
  r := public.owner_save_closing(shop, bd - 10, cfg, inp, current_setting('t.s10_1')::uuid, 'k6d', p_closing_no => 1);
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T6 save of closing 1 on its own current refused: %', r; end if;
  perform set_config('t.k6d', r ->> 'closing_id', true);
end $$;
reset role;
do $$
declare c public.closings;
begin
  select * into c from public.closings where id = current_setting('t.k6')::uuid;
  if c.closing_no <> 2 or c.kind <> 'owner_correction' or c.corrects_closing_id is distinct from current_setting('t.o10_2')::uuid
     or c.business_date <> current_setting('t.bd')::date - 10 then
    raise exception 'T6 wrong row: %', to_jsonb(c);
  end if;
  -- closing 2's save did not touch closing 1; closing 1's own save (M7) is its new current, correcting s10_1
  select * into c from public.closings where id = current_setting('t.k6d')::uuid;
  if c.closing_no <> 1 or c.kind <> 'owner_correction' or c.corrects_closing_id is distinct from current_setting('t.s10_1')::uuid then
    raise exception 'T6 wrong closing 1 row: %', to_jsonb(c);
  end if;
  if (private.current_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 10, 1)).id::text is distinct from current_setting('t.k6d') then
    raise exception 'T6 closing 1 current is not its own save';
  end if;
  if (private.current_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 10, 2)).id::text is distinct from current_setting('t.k6') then
    raise exception 'T6 closing 2 current changed by the closing 1 save';
  end if;
end $$;

-- T7 an earlier closing of today (closing 1, closing 2 live) is corrected like a past day: no p_revision, no
-- open_closings change.
select set_config('t.oc_before', (select jsonb_agg(jsonb_build_object('id', id, 'revision', revision, 'last_submit', last_submit) order by business_date, closing_no)::text
  from public.open_closings where shop_id = current_setting('t.shop_a')::uuid), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.r7', public.owner_save_closing(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date,
  current_setting('t.cfg_a')::uuid, current_setting('t.fix')::jsonb, current_setting('t.t1')::uuid, 'k7', p_closing_no => 1)::text, true);
reset role;
do $$
declare r jsonb := current_setting('t.r7')::jsonb; c public.closings;
begin
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T7 save of today''s closing 1 refused: %', r; end if;
  select * into c from public.closings where id = (r ->> 'closing_id')::uuid;
  if c.closing_no <> 1 or c.corrects_closing_id is distinct from current_setting('t.t1')::uuid then raise exception 'T7 wrong row: %', to_jsonb(c); end if;
  if (select jsonb_agg(jsonb_build_object('id', id, 'revision', revision, 'last_submit', last_submit) order by business_date, closing_no)
        from public.open_closings where shop_id = current_setting('t.shop_a')::uuid) <> current_setting('t.oc_before')::jsonb then
    raise exception 'T7 an open closing changed';
  end if;
end $$;

-- T8 the live closing keeps today's rule: wrong revision -> draft_changed; the right one -> ok, last_submit on
-- closing 2's open closing only.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_a')::uuid;
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  fix jsonb := current_setting('t.fix')::jsonb;
  r jsonb;
begin
  r := public.owner_save_closing(shop, bd, cfg, fix, current_setting('t.t2')::uuid, 'k8a', 0, 2);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', 1) then raise exception 'T8 wrong revision: %', r; end if;
  r := public.owner_save_closing(shop, bd, cfg, fix, current_setting('t.t2')::uuid, 'k8b', null, 2);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', 1) then raise exception 'T8 null revision: %', r; end if;
  r := public.owner_save_closing(shop, bd, cfg, fix, current_setting('t.t2')::uuid, 'k8c', 1, 2);
  if r ->> 'ok' <> 'true' or r ->> 'repeat' <> 'false' then raise exception 'T8 save with the live revision refused: %', r; end if;
  perform set_config('t.k8', r ->> 'closing_id', true);
end $$;
reset role;
do $$
declare o1 public.open_closings; o2 public.open_closings;
begin
  select * into o1 from public.open_closings where id = current_setting('t.oc_t1')::uuid;
  select * into o2 from public.open_closings where id = current_setting('t.oc_t2')::uuid;
  if o2.last_submit ->> 'staff_name' is distinct from 'Ιδιοκτήτης' or o2.last_submit ->> 'closing_id' is distinct from current_setting('t.k8')
     or o2.last_submit -> 'closing_no' is distinct from '2'::jsonb or o2.last_submit -> 'revision' is distinct from '1'::jsonb
     or o2.revision <> 1 then
    raise exception 'T8 closing 2 last_submit wrong: % (revision %)', o2.last_submit, o2.revision;
  end if;
  if o1.last_submit ->> 'staff_name' is distinct from 'ΜΑΡΙΑ' or o1.last_submit ->> 'closing_id' is distinct from current_setting('t.t1') then
    raise exception 'T8 closing 1 last_submit changed: %', o1.last_submit;
  end if;
  if (select closing_no from public.closings where id = current_setting('t.k8')::uuid) is distinct from 2 then raise exception 'T8 row not closing 2'; end if;
end $$;

-- T9 suggestions: bd-12 'separate' (one line in each closing -> both); bd-13 'running' (closing 2 repeats closing
-- 1's line and adds one -> each line once, from closing 2).
insert into public.open_closings (shop_id, business_date, config_id, closing_no, closings_planned, cash_mode) values
  (current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 12, current_setting('t.cfg_a')::uuid, 1, 2, 'separate'),
  (current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 12, current_setting('t.cfg_a')::uuid, 2, 2, 'separate'),
  (current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 13, current_setting('t.cfg_a')::uuid, 1, 2, 'running'),
  (current_setting('t.shop_a')::uuid, current_setting('t.bd')::date - 13, current_setting('t.cfg_a')::uuid, 2, 2, 'running');
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key, closing_no)
select current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1',
       current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date + v.off,
       jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb, 'expenses', v.exp), v.k, v.no
  from (values
    (-12, 's-12-1', 1, '[{"id":"a","description":"Νερό","cents":200,"addedBy":{"kind":"owner"}}]'::jsonb),
    (-12, 's-12-2', 2, '[{"id":"b","description":"Χαρτί","cents":450,"addedBy":{"kind":"owner"}}]'::jsonb),
    (-13, 's-13-1', 1, '[{"id":"m","description":"Γάλα","cents":350,"addedBy":{"kind":"owner"}}]'::jsonb),
    (-13, 's-13-2', 2, '[{"id":"m","description":"Γάλα","cents":350,"addedBy":{"kind":"owner"}},{"id":"p","description":"Ψωμί","cents":120,"addedBy":{"kind":"owner"}}]'::jsonb)
  ) v(off, k, no, exp);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare bd date := current_setting('t.bd')::date;
begin
  if (select array_agg(description || ':' || cents order by description) from public.expense_suggestion_data(current_setting('t.tok'))
       where business_date = bd - 12) is distinct from array['Νερό:200', 'Χαρτί:450'] then
    raise exception 'T9 separate day wrong: %', (select array_agg(description) from public.expense_suggestion_data(current_setting('t.tok')) where business_date = bd - 12);
  end if;
  if (select array_agg(description || ':' || cents order by description) from public.expense_suggestion_data(current_setting('t.tok'))
       where business_date = bd - 13) is distinct from array['Γάλα:350', 'Ψωμί:120'] then
    raise exception 'T9 running day wrong: %', (select array_agg(description) from public.expense_suggestion_data(current_setting('t.tok')) where business_date = bd - 13);
  end if;
end $$;
reset role;

-- T10 grants and dropped overloads.
do $$ begin
  if to_regprocedure('public.owner_save_closing(uuid,date,uuid,jsonb,uuid,text,bigint)') is not null then
    raise exception 'T10 7-arg owner_save_closing still exists';
  end if;
  if to_regprocedure('private.current_closing(uuid,date)') is not null then raise exception 'T10 2-arg current_closing still exists'; end if;
  if has_function_privilege('authenticated', 'private.current_closing(uuid,date,int)', 'execute')
     or has_function_privilege('anon', 'private.current_closing(uuid,date,int)', 'execute') then
    raise exception 'T10 3-arg current_closing executable by a client';
  end if;
  if has_function_privilege('anon', 'public.owner_save_closing(uuid,date,uuid,jsonb,uuid,text,bigint,int)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_save_closing(uuid,date,uuid,jsonb,uuid,text,bigint,int)', 'execute')
     or has_function_privilege('anon', 'public.owner_list_closings(uuid,date,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_list_closings(uuid,date,date)', 'execute')
     or has_function_privilege('anon', 'public.owner_get_closing_day(uuid,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_get_closing_day(uuid,date)', 'execute')
     or has_function_privilege('anon', 'public.expense_suggestion_data(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.expense_suggestion_data(text)', 'execute') then
    raise exception 'T10 public history functions have wrong privileges';
  end if;
end $$;

rollback;
