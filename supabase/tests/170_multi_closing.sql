-- 170 — several closings per business day (20261117000001_multi_closing): the plan and its pinning, the live
-- closing, start_next_closing (refusals, separate / running modes, repeats, the last closing), wrong_closing on
-- writes and submits, the config pin across closings, a new day, grants.
-- One transaction, ends in ROLLBACK. Phone/owner calls run as `authenticated`; row checks, private.* and the
-- "write as the migration owner" steps run as the postgres role.
-- Shop A (owner A): ΜΑΡΙΑ on phone d1, ΕΛΕΝΗ on phone d2. Shop C (owner A, plan 2 'running'): its own ΜΑΡΙΑ on
-- phone d3 and ΕΛΕΝΗ on phone d4. Shop B (owner B) is only used for the not_owner check.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop A (ΜΑΡΙΑ, ΕΛΕΝΗ) and shop C (ΜΑΡΙΑ, ΕΛΕΝΗ, plan 2 'running' set before any closing exists).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}]}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.eleni', public.create_staff(current_setting('t.shop_a')::uuid, 'ΕΛΕΝΗ', '567890')::text, true);
select set_config('t.key_a', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
select set_config('t.shop_c', public.create_shop('Shop C', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}]}')::text, true);
select set_config('t.c_maria', public.create_staff(current_setting('t.shop_c')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.c_eleni', public.create_staff(current_setting('t.shop_c')::uuid, 'ΕΛΕΝΗ', '567890')::text, true);
select set_config('t.key_c', public.owner_get_join_key(current_setting('t.shop_c')::uuid), true);
select set_config('t.cfg_c', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_c')::uuid), true);
select public.set_closing_plan(current_setting('t.shop_c')::uuid, 2, 'running');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;

-- Phones: d1 (ΜΑΡΙΑ) and d2 (ΕΛΕΝΗ) in shop A; d3 (ΜΑΡΙΑ) and d4 (ΕΛΕΝΗ) in shop C.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'Ταμείο 1');
select set_config('t.tok1', public.staff_sign_in(current_setting('t.maria')::uuid, '123456') ->> 'token', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_a'), 'Ταμείο 2');
select set_config('t.tok2', public.staff_sign_in(current_setting('t.eleni')::uuid, '567890') ->> 'token', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_c'), 'Ταμείο C1');
select set_config('t.tok3', public.staff_sign_in(current_setting('t.c_maria')::uuid, '123456') ->> 'token', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key_c'), 'Ταμείο C2');
select set_config('t.tok4', public.staff_sign_in(current_setting('t.c_eleni')::uuid, '567890') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);
select set_config('t.good', '{"schema":2,"counts":{"10000":5},"channelCents":{"wolt":4560},"expenses":[]}', true);

do $$ begin
  if current_setting('t.tok1') !~ '^[0-9a-f]{64}$' or current_setting('t.tok2') !~ '^[0-9a-f]{64}$'
     or current_setting('t.tok3') !~ '^[0-9a-f]{64}$' or current_setting('t.tok4') !~ '^[0-9a-f]{64}$' then
    raise exception 'setup: a sign-in failed';
  end if;
end $$;

-- T1 defaults: a new shop is 1 closing per day, 'separate'; the first snapshot is closing 1 of 1.
do $$
declare s public.shops;
begin
  select * into s from public.shops where id = current_setting('t.shop_a')::uuid;
  if s.closings_per_day is distinct from 1 or s.cash_mode is distinct from 'separate' then
    raise exception 'T1 shop defaults wrong: % %', s.closings_per_day, s.cash_mode;
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb := public.get_open_closing(current_setting('t.tok1'));
begin
  if (r ->> 'ok')::boolean is not true or r #> '{closing,closing_no}' is distinct from '1'::jsonb
     or r #> '{closing,closings_planned}' is distinct from '1'::jsonb
     or r #> '{closing,cash_mode}' is distinct from '"separate"'::jsonb then
    raise exception 'T1 snapshot defaults wrong: %', r;
  end if;
end $$;
reset role;

-- T2 plan validation, ownership, and pinning.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  v_shop uuid := current_setting('t.shop_a')::uuid;
  c record;
begin
  for c in select * from (values (0, 'separate'), (7, 'separate'), (3, 'x'), (null::int, 'separate'), (2, null::text)) v(n, m) loop
    begin
      perform public.set_closing_plan(v_shop, c.n, c.m);
      raise exception 'T2 set_closing_plan(%, %) accepted', c.n, c.m;
    exception when others then
      if sqlerrm <> 'bad_closing_plan' then raise exception 'T2 set_closing_plan(%, %) wrong error: %', c.n, c.m, sqlerrm; end if;
    end;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.set_closing_plan(current_setting('t.shop_a')::uuid, 3, 'separate');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T2 owner B wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T2 owner B changed shop A''s plan';
end $$;
reset role;
-- Today's closing already exists (T1) at plan 1: a new plan does not change it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.set_closing_plan(current_setting('t.shop_a')::uuid, 3, 'separate');
do $$
declare r jsonb := public.owner_get_open_closing(current_setting('t.shop_a')::uuid);
begin
  if r #> '{closing,closings_planned}' is distinct from '1'::jsonb or r #> '{closing,closing_no}' is distinct from '1'::jsonb then
    raise exception 'T2 today''s pinned plan changed: %', r;
  end if;
end $$;
reset role;
do $$
declare s public.shops;
begin
  select * into s from public.shops where id = current_setting('t.shop_a')::uuid;
  if s.closings_per_day is distinct from 3 or s.cash_mode is distinct from 'separate' then raise exception 'T2 plan not stored: % %', s.closings_per_day, s.cash_mode; end if;
end $$;
-- As the migration owner: drop today's open closing; the next one is created with the new plan.
delete from public.open_closings where shop_id = current_setting('t.shop_a')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb := public.get_open_closing(current_setting('t.tok1'));
begin
  if r #> '{closing,closings_planned}' is distinct from '3'::jsonb or r #> '{closing,cash_mode}' is distinct from '"separate"'::jsonb
     or r #> '{closing,closing_no}' is distinct from '1'::jsonb or r #>> '{closing,config_id}' is distinct from current_setting('t.cfg_a') then
    raise exception 'T2 re-created closing does not carry the new plan: %', r;
  end if;
  perform set_config('t.oc1', r #>> '{closing,id}', true);
end $$;
reset role;
-- A later plan change does not touch that row either.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.set_closing_plan(current_setting('t.shop_a')::uuid, 2, 'running');
reset role;
do $$
declare o public.open_closings;
begin
  select * into o from public.open_closings where id = current_setting('t.oc1')::uuid;
  if o.closings_planned is distinct from 3 or o.cash_mode is distinct from 'separate' then
    raise exception 'T2 pinned row changed by a later plan: % %', o.closings_planned, o.cash_mode;
  end if;
end $$;

-- T3 start refused: not submitted, changed since the submit, wrong day, not the live closing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok1');
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  r jsonb;
begin
  r := public.start_next_closing(tok, bd, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'not_submitted') then raise exception 'T3 start before any submit: %', r; end if;

  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"45,60"}', 0, 1);
  if r is distinct from jsonb_build_object('ok', true, 'version', 1, 'revision', 1, 'value', '{"text":"45,60"}'::jsonb) then raise exception 'T3 setup write: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, current_setting('t.good')::jsonb, 1, 'k-1a', 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T3 setup submit: %', r; end if;
  r := public.set_closing_field(tok, bd, 'c:card', '{"text":"10"}', 0, 1);
  if r ->> 'revision' is distinct from '2' then raise exception 'T3 setup second write: %', r; end if;
  r := public.start_next_closing(tok, bd, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'not_submitted') then raise exception 'T3 start after a change since the submit: %', r; end if;

  r := public.start_next_closing(tok, bd - 1, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_day') then raise exception 'T3 yesterday: %', r; end if;
  r := public.start_next_closing(tok, null, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_day') then raise exception 'T3 null date: %', r; end if;
  r := public.start_next_closing(tok, bd, 2);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T3 closing 2 while 1 is live: %', r; end if;
  r := public.start_next_closing(tok, bd, 0);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T3 closing 0: %', r; end if;
  r := public.start_next_closing(tok, bd, null);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T3 null closing: %', r; end if;
  r := public.start_next_closing(null, bd, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T3 no session: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.open_closings where shop_id = current_setting('t.shop_a')::uuid) <> 1 then
    raise exception 'T3 a refused start created a closing';
  end if;
end $$;

-- T4 start in 'separate' mode; writes and submits to closing 1 are refused afterwards.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok1');
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  r jsonb;
begin
  r := public.submit_closing(tok, cfg, bd, current_setting('t.good')::jsonb, 2, 'k-1b', 1);
  if (r ->> 'ok')::boolean is not true or (r ->> 'repeat')::boolean then raise exception 'T4 submit of closing 1: %', r; end if;
  perform set_config('t.c1', r ->> 'closing_id', true);
  -- the stored last_submit names its closing
  r := public.get_open_closing(tok);
  if r #> '{closing,last_submit,closing_no}' is distinct from '1'::jsonb then raise exception 'T4 last_submit without closing_no: %', r #> '{closing,last_submit}'; end if;

  r := public.start_next_closing(tok, bd, 1);
  if (r ->> 'ok')::boolean is not true
     or r #> '{closing,closing_no}' is distinct from '2'::jsonb
     or r #> '{closing,revision}' is distinct from '0'::jsonb
     or r #> '{closing,fields}' is distinct from '[]'::jsonb
     or r #>> '{closing,config_id}' is distinct from current_setting('t.cfg_a')
     or r #> '{closing,closings_planned}' is distinct from '3'::jsonb
     or r #> '{closing,cash_mode}' is distinct from '"separate"'::jsonb
     or r #> '{closing,last_submit}' is distinct from 'null'::jsonb
     or r #>> '{closing,business_date}' is distinct from bd::text
     or r #>> '{closing,id}' = current_setting('t.oc1') then
    raise exception 'T4 start failed or wrong snapshot: %', r;
  end if;
  perform set_config('t.oc2', r #>> '{closing,id}', true);
end $$;
reset role;

-- T6 repeat: the second cashier on the other phone starts "closing 1 -> 2" again -> ok, closing 2, no new row.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok2');
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  r jsonb;
begin
  -- T4 the other phone now sees closing 2
  r := public.get_open_closing(tok);
  if r #> '{closing,closing_no}' is distinct from '2'::jsonb or r #>> '{closing,id}' is distinct from current_setting('t.oc2') then
    raise exception 'T4 other phone does not see closing 2: %', r;
  end if;

  r := public.start_next_closing(tok, bd, 1);
  if (r ->> 'ok')::boolean is not true or r #> '{closing,closing_no}' is distinct from '2'::jsonb
     or r #>> '{closing,id}' is distinct from current_setting('t.oc2') then
    raise exception 'T6 repeat start did not answer closing 2: %', r;
  end if;

  -- T4 writes / submits naming closing 1 are wrong_closing; naming closing 2 they land.
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"99"}', null, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T4 write to closing 1: %', r; end if;
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"99"}', null);   -- the 5-argument call defaults to closing 1
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T4 default-closing write: %', r; end if;
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"99"}', null, 2);
  if r is distinct from jsonb_build_object('ok', true, 'version', 1, 'revision', 1, 'value', '{"text":"99"}'::jsonb) then raise exception 'T4 write to closing 2: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, current_setting('t.good')::jsonb, 1, 'k-2x', 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T4 submit naming closing 1: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, current_setting('t.good')::jsonb, 1, 'k-2a', 2);
  if (r ->> 'ok')::boolean is not true or (r ->> 'repeat')::boolean then raise exception 'T4 submit of closing 2: %', r; end if;
  perform set_config('t.c2', r ->> 'closing_id', true);
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.owner_set_closing_field(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date, 'c:card', '{"text":"1"}', null, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T4 owner write to closing 1: %', r; end if;
end $$;
reset role;
do $$
declare o1 public.open_closings;
begin
  if (select count(*) from public.open_closings where shop_id = current_setting('t.shop_a')::uuid and closing_no = 2) <> 1 then
    raise exception 'T6 expected exactly one closing 2';
  end if;
  select * into o1 from public.open_closings where id = current_setting('t.oc1')::uuid;
  if o1.revision <> 2 or o1.closing_no <> 1 then raise exception 'T4 closing 1 revision changed: %', o1.revision; end if;
  if (select value from public.open_closing_fields where open_closing_id = o1.id and key = 'c:wolt') is distinct from '{"text":"45,60"}'::jsonb
     or (select value from public.open_closing_fields where open_closing_id = o1.id and key = 'c:card') is distinct from '{"text":"10"}'::jsonb
     or (select count(*) from public.open_closing_fields where open_closing_id = o1.id) <> 2 then
    raise exception 'T4 closing 1 fields changed';
  end if;
  if exists (select 1 from public.closings where idempotency_key = 'k-2x') then raise exception 'T4 a wrong_closing submit stored a row'; end if;
  if (select closing_no from public.closings where id = current_setting('t.c2')::uuid) is distinct from 2 then raise exception 'T4 closing 2 row not numbered 2'; end if;
  if (select closing_no from public.closings where id = current_setting('t.c1')::uuid) is distinct from 1 then raise exception 'T4 closing 1 row not numbered 1'; end if;
  if (select closing_no from public.closings where idempotency_key = 'k-1a' and shop_id = current_setting('t.shop_a')::uuid) is distinct from 1 then
    raise exception 'T4 first closing 1 row not numbered 1';
  end if;
end $$;

-- T5 the last planned closing: 2 -> 3 starts, 3 -> 4 is no_more_closings (plan 3).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok2');
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_a')::uuid;
  r jsonb;
begin
  r := public.start_next_closing(tok, bd, 2);
  if (r ->> 'ok')::boolean is not true or r #> '{closing,closing_no}' is distinct from '3'::jsonb then raise exception 'T5 start of closing 3: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, current_setting('t.good')::jsonb, 0, 'k-3a', 3);
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 submit of closing 3: %', r; end if;
  r := public.start_next_closing(tok, bd, 3);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'no_more_closings') then raise exception 'T5 start past the plan: %', r; end if;
  -- an old "1 -> 2" request is no longer a repeat once closing 3 is live
  r := public.start_next_closing(tok, bd, 1);
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_closing') then raise exception 'T5 stale 1 -> 2 request: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.open_closings where shop_id = current_setting('t.shop_a')::uuid) <> 3 then raise exception 'T5 expected 3 open closings'; end if;
  if (select closing_no from public.closings where idempotency_key = 'k-3a' and shop_id = current_setting('t.shop_a')::uuid) is distinct from 3 then
    raise exception 'T5 closing 3 row not numbered 3';
  end if;
end $$;

-- T7 'running' (shop C, plan 2): closing 1 has two visible lines (ΜΑΡΙΑ's and the owner's), one removed line,
-- a count box and a channel box. T8: a config published after closing 1 exists.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok3');
  bd date := current_setting('t.bd')::date;
  r jsonb;
begin
  r := public.get_open_closing(tok);
  if r #> '{closing,closings_planned}' is distinct from '2'::jsonb or r #> '{closing,cash_mode}' is distinct from '"running"'::jsonb
     or r #>> '{closing,config_id}' is distinct from current_setting('t.cfg_c') then
    raise exception 'T7 shop C plan not pinned: %', r;
  end if;
  perform set_config('t.oc_c1', r #>> '{closing,id}', true);
  r := public.set_closing_field(tok, bd, 'e:m1', '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:m1: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:m1:d', '{"text":"Γάλα"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:m1:d: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:m1:a', '{"text":"3,50"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:m1:a: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:r1', '{"addedBy":{"kind":"owner"},"order":3,"removed":false}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:r1: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:r1:d', '{"text":"Λάθος"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:r1:d: %', r; end if;
  r := public.set_closing_field(tok, bd, 'e:r1', '{"addedBy":{"kind":"owner"},"order":3,"removed":true}', 1, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup remove e:r1: %', r; end if;
  r := public.set_closing_field(tok, bd, 'd:5000', '{"text":"3","mode":"count"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup d:5000: %', r; end if;
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"20"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup c:wolt: %', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  v_shop uuid := current_setting('t.shop_c')::uuid;
  bd date := current_setting('t.bd')::date;
  r jsonb;
begin
  r := public.owner_set_closing_field(v_shop, bd, 'e:o1', '{"addedBy":{"kind":"owner"},"order":2,"removed":false}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:o1: %', r; end if;
  r := public.owner_set_closing_field(v_shop, bd, 'e:o1:d', '{"text":"Υδραυλικός"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:o1:d: %', r; end if;
  r := public.owner_set_closing_field(v_shop, bd, 'e:o1:a', '{"text":"12"}', 0, 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 setup e:o1:a: %', r; end if;
  -- T8 a new config version is published while closing 1 is open
  if public.publish_config(v_shop, 1, '{"schema":1,"maxExpenses":5,"denominations":[5000],"channels":[{"id":"wolt"}]}') <> 2 then
    raise exception 'T8 publish did not create version 2';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.tok3');
  bd date := current_setting('t.bd')::date;
  cfg uuid := current_setting('t.cfg_c')::uuid;
  maria jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.c_maria'));
  owner_a jsonb := jsonb_build_object('kind', 'owner');
  rev bigint;
  r jsonb;
begin
  rev := (public.get_open_closing(tok) #>> '{closing,revision}')::bigint;
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{"5000":3}'::jsonb, 'channelCents', '{"wolt":2000}'::jsonb,
        'expenses', jsonb_build_array(
          jsonb_build_object('id', 'm1', 'description', 'Γάλα', 'cents', 350, 'addedBy', maria),
          jsonb_build_object('id', 'o1', 'description', 'Υδραυλικός', 'cents', 1200, 'addedBy', owner_a))), rev, 'k-c1', 1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 submit of closing 1: %', r; end if;
  r := public.start_next_closing(tok, bd, 1);
  if (r ->> 'ok')::boolean is not true or r #> '{closing,closing_no}' is distinct from '2'::jsonb
     or r #> '{closing,cash_mode}' is distinct from '"running"'::jsonb or r #> '{closing,revision}' is distinct from '0'::jsonb then
    raise exception 'T7 start in running mode: %', r;
  end if;
  -- T8 the config stays pinned across the day's closings
  if r #>> '{closing,config_id}' is distinct from current_setting('t.cfg_c') then raise exception 'T8 closing 2 config changed: %', r #>> '{closing,config_id}'; end if;
  perform set_config('t.oc_c2', r #>> '{closing,id}', true);
end $$;
reset role;
do $$
declare
  n int;
  bad int;
begin
  -- exactly the two visible lines with their :d/:a fields
  if (select array_agg(key order by key collate "C") from public.open_closing_fields where open_closing_id = current_setting('t.oc_c2')::uuid)
     is distinct from array['e:m1', 'e:m1:a', 'e:m1:d', 'e:o1', 'e:o1:a', 'e:o1:d'] then
    raise exception 'T7 copied keys wrong: %', (select array_agg(key order by key collate "C") from public.open_closing_fields where open_closing_id = current_setting('t.oc_c2')::uuid);
  end if;
  -- same value / authors as closing 1, version 1
  select count(*) into bad
    from public.open_closing_fields n2
    left join public.open_closing_fields n1 on n1.open_closing_id = current_setting('t.oc_c1')::uuid and n1.key = n2.key
   where n2.open_closing_id = current_setting('t.oc_c2')::uuid
     and (n1.key is null or n2.value is distinct from n1.value or n2.version <> 1
          or n2.updated_by_staff is distinct from n1.updated_by_staff or n2.updated_by_owner is distinct from n1.updated_by_owner);
  if bad <> 0 then raise exception 'T7 % copied fields differ from closing 1 or are not version 1', bad; end if;
  if (select value -> 'addedBy' from public.open_closing_fields where open_closing_id = current_setting('t.oc_c2')::uuid and key = 'e:m1')
       is distinct from jsonb_build_object('kind', 'staff', 'id', current_setting('t.c_maria'))
     or (select value -> 'addedBy' from public.open_closing_fields where open_closing_id = current_setting('t.oc_c2')::uuid and key = 'e:o1')
       is distinct from '{"kind":"owner"}'::jsonb then
    raise exception 'T7 copied authors wrong';
  end if;
  select count(*) into n from public.open_closing_fields where open_closing_id = current_setting('t.oc_c1')::uuid;
  if n <> 10 then raise exception 'T7 closing 1 lost or gained fields: %', n; end if;
end $$;
-- ΕΛΕΝΗ submits closing 2 with the two copied lines, authors unchanged.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  r jsonb;
  maria jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.c_maria'));
begin
  r := public.submit_closing(current_setting('t.tok4'), current_setting('t.cfg_c')::uuid, current_setting('t.bd')::date,
        jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
          'expenses', jsonb_build_array(
            jsonb_build_object('id', 'm1', 'description', 'Γάλα', 'cents', 350, 'addedBy', maria),
            jsonb_build_object('id', 'o1', 'description', 'Υδραυλικός', 'cents', 1200, 'addedBy', '{"kind":"owner"}'::jsonb))),
        0, 'k-c2', 2);
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 ΕΛΕΝΗ submit of closing 2: %', r; end if;
  perform set_config('t.c_c2', r ->> 'closing_id', true);
end $$;
reset role;
do $$ begin
  if (select closing_no from public.closings where id = current_setting('t.c_c2')::uuid) is distinct from 2
     or (select staff_id from public.closings where id = current_setting('t.c_c2')::uuid) is distinct from current_setting('t.c_eleni')::uuid then
    raise exception 'T7 closing 2 row wrong';
  end if;
end $$;

-- T9 a new business day starts at closing 1. Like 060 T8, the day is moved by shifting the stored date: as the
-- migration owner, shop A's open closings become yesterday's, so for the shop "today" has none yet.
update public.open_closings set business_date = business_date - 1 where shop_id = current_setting('t.shop_a')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb := public.get_open_closing(current_setting('t.tok1'));
begin
  if (r ->> 'ok')::boolean is not true or r #> '{closing,closing_no}' is distinct from '1'::jsonb
     or r #>> '{closing,business_date}' is distinct from current_setting('t.bd')
     or r #> '{closing,revision}' is distinct from '0'::jsonb or r #> '{closing,fields}' is distinct from '[]'::jsonb then
    raise exception 'T9 new day does not start at closing 1: %', r;
  end if;
  -- the new day pins the shop's current plan (T2 set 2 'running')
  if r #> '{closing,closings_planned}' is distinct from '2'::jsonb or r #> '{closing,cash_mode}' is distinct from '"running"'::jsonb then
    raise exception 'T9 new day did not pin the current plan: %', r;
  end if;
end $$;
reset role;

-- T10 grants and dropped overloads.
do $$ begin
  if has_function_privilege('anon', 'public.set_closing_plan(uuid,int,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_closing_plan(uuid,int,text)', 'execute') then
    raise exception 'T10 set_closing_plan privileges wrong';
  end if;
  if has_function_privilege('anon', 'public.start_next_closing(text,date,int)', 'execute')
     or not has_function_privilege('authenticated', 'public.start_next_closing(text,date,int)', 'execute') then
    raise exception 'T10 start_next_closing privileges wrong';
  end if;
  if has_function_privilege('authenticated', 'private.write_closing_field(uuid,uuid,uuid,int,text,jsonb,int)', 'execute')
     or has_function_privilege('anon', 'private.write_closing_field(uuid,uuid,uuid,int,text,jsonb,int)', 'execute') then
    raise exception 'T10 write_closing_field callable by a client';
  end if;
  if has_function_privilege('authenticated', 'private.open_closing_for(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.closing_snapshot(uuid)', 'execute') then
    raise exception 'T10 open_closing_for / closing_snapshot callable by a client';
  end if;
  if has_function_privilege('anon', 'public.set_closing_field(text,date,text,jsonb,int,int)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_closing_field(text,date,text,jsonb,int,int)', 'execute')
     or has_function_privilege('anon', 'public.owner_set_closing_field(uuid,date,text,jsonb,int,int)', 'execute')
     or not has_function_privilege('authenticated', 'public.owner_set_closing_field(uuid,date,text,jsonb,int,int)', 'execute')
     or has_function_privilege('anon', 'public.submit_closing(text,uuid,date,jsonb,bigint,text,int)', 'execute')
     or not has_function_privilege('authenticated', 'public.submit_closing(text,uuid,date,jsonb,bigint,text,int)', 'execute') then
    raise exception 'T10 new write/submit signatures have wrong privileges';
  end if;
  if to_regprocedure('public.set_closing_field(text,date,text,jsonb,int)') is not null then raise exception 'T10 5-arg set_closing_field still exists'; end if;
  if to_regprocedure('public.owner_set_closing_field(uuid,date,text,jsonb,int)') is not null then raise exception 'T10 5-arg owner_set_closing_field still exists'; end if;
  if to_regprocedure('public.submit_closing(text,uuid,date,jsonb,bigint,text)') is not null then raise exception 'T10 6-arg submit_closing still exists'; end if;
  if to_regprocedure('private.write_closing_field(uuid,uuid,uuid,text,jsonb,int)') is not null then raise exception 'T10 6-arg write_closing_field still exists'; end if;
end $$;

-- T11 realtime payloads (skipped where realtime.messages has no partitions, like 080/090).
do $$
declare m record;
begin
  if not exists (select 1 from pg_inherits where inhparent = 'realtime.messages'::regclass) then
    raise notice 'T11 realtime broadcast assertions SKIPPED: realtime.messages has no partitions here';
    return;
  end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'field'
     and payload ->> 'key' = 'c:wolt' and payload ->> 'closing_no' = '2';
  if m.id is null then raise exception 'T11 field broadcast without closing_no 2'; end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'submitted'
     and payload ->> 'closing_id' = current_setting('t.c2');
  if m.id is null or m.payload ->> 'closing_no' is distinct from '2' then raise exception 'T11 submitted payload: %', m.payload; end if;
  if (select count(*) from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'closing_started') <> 2 then
    raise exception 'T11 expected 2 closing_started messages for shop A (a repeat start sends none)';
  end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'closing_started'
     and payload ->> 'closing_no' = '2';
  if m.id is null or m.private is not true or m.payload ->> 'business_date' is distinct from current_setting('t.bd')
     or m.payload -> 'closing_no' is distinct from '2'::jsonb then
    raise exception 'T11 closing_started payload: %', m.payload;
  end if;
end $$;

rollback;
