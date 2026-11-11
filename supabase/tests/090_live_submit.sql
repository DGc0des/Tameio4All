-- 090 — submit against the live closing: pinned config, revision check, last_submit, realtime 'submitted'.
-- One transaction, ends in ROLLBACK. Phone calls run as `authenticated`; row checks and private.*
-- calls run as the postgres role (private.* is not callable by clients).
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, staff ΜΑΡΙΑ + ΕΛΕΝΗ, code. Owner B: shop + staff ΝΙΚΟΣ (cross-shop checks).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.eleni', public.create_staff(current_setting('t.shop_a')::uuid, 'ΕΛΕΝΗ', '5678')::text, true);
select set_config('t.code', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop_b')::uuid, 'ΝΙΚΟΣ', '1234')::text, true);
select set_config('t.cfg_b', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_b')::uuid), true);
reset role;

-- Phone D1 pairs with shop A; maria signs in.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code'), 'Ταμείο');
select set_config('t.token', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);
select set_config('t.good', jsonb_build_object(
  'schema', 2, 'counts', jsonb_build_object('10000', 5), 'channelCents', jsonb_build_object('wolt', 4560),
  'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300,
    'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'))))
)::text, true);


-- T0 the stage-1 5-arg signature is gone; the 6-arg one is executable by authenticated only.
do $$ begin
  if to_regprocedure('public.submit_closing(text,uuid,date,jsonb,text)') is not null then raise exception 'T0 5-arg submit_closing still exists'; end if;
  if not has_function_privilege('authenticated', 'public.submit_closing(text,uuid,date,jsonb,bigint,text)', 'execute')
     or has_function_privilege('anon', 'public.submit_closing(text,uuid,date,jsonb,bigint,text)', 'execute') then
    raise exception 'T0 wrong execute privileges on 6-arg submit_closing';
  end if;
end $$;

set local role authenticated;
do $$
declare
  tok text := current_setting('t.token');
  cfg uuid := current_setting('t.cfg_a')::uuid;
  bd date := current_setting('t.bd')::date;
  good jsonb := current_setting('t.good')::jsonb;
  r jsonb;
begin
  -- A cashier types something: revision 1 (this also creates today's open closing, pinning cfg).
  r := public.set_closing_field(tok, bd, 'c:wolt', '{"text":"45,60"}', 0);
  if r is distinct from jsonb_build_object('ok', true, 'version', 1, 'revision', 1, 'value', '{"text":"45,60"}'::jsonb) then raise exception 'setup write failed: %', r; end if;

  -- T1 submit with the current revision -> ok, last_submit recorded, open closing kept
  r := public.submit_closing(tok, cfg, bd, good, 1, 'key-1');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', r -> 'closing_id', 'repeat', false) or r ->> 'closing_id' is null then
    raise exception 'T1 submit failed: %', r;
  end if;
  perform set_config('t.closing', r ->> 'closing_id', true);
  r := public.get_open_closing(tok);
  if r #>> '{closing,last_submit,closing_id}' is distinct from current_setting('t.closing')
     or r #>> '{closing,last_submit,staff_name}' is distinct from 'ΜΑΡΙΑ'
     or r #>> '{closing,last_submit,at}' is null
     or r #>> '{closing,last_submit,revision}' is distinct from '1'
     or (select count(*) from jsonb_object_keys(r #> '{closing,last_submit}')) <> 4 then
    raise exception 'T1 last_submit wrong: %', r #> '{closing,last_submit}';
  end if;
  if (r #>> '{closing,revision}')::bigint is distinct from 1::bigint then raise exception 'T1 revision changed by submit: %', r #>> '{closing,revision}'; end if;
  if jsonb_array_length(r #> '{closing,fields}') <> 1 then raise exception 'T1 open closing fields were not kept: %', r #> '{closing,fields}'; end if;

  -- T2 another write, then a submit with the old revision -> draft_changed carrying the new revision
  r := public.set_closing_field(tok, bd, 'c:card', '{"text":"10"}', 0);
  if r ->> 'revision' is distinct from '2' then raise exception 'T2 setup write failed: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, good, 1, 'key-2');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', 2) then
    raise exception 'T2 expected draft_changed with revision 2: %', r;
  end if;
  r := public.submit_closing(tok, cfg, bd, good, 3, 'key-2');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', 2) then
    raise exception 'T2 a revision from the future was accepted: %', r;
  end if;
  if exists (select 1 from public.closings where idempotency_key = 'key-2') then raise exception 'T2 a refused submit stored a closing'; end if;
end $$;
reset role;

-- T3 a later config version exists for the shop; the open closing stays pinned to the old one.
insert into public.shop_configs (shop_id, version, config) values (current_setting('t.shop_a')::uuid, 2, '{"schema":1}');
select set_config('t.cfg_a2', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid and version = 2), true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a2')::uuid, current_setting('t.bd')::date, current_setting('t.good')::jsonb, 2, 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'config_mismatch') then raise exception 'T3 unpinned config accepted: %', r; end if;
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_b')::uuid, current_setting('t.bd')::date, current_setting('t.good')::jsonb, 2, 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'config_mismatch') then raise exception 'T3 other shop config accepted: %', r; end if;
  -- Staying pinned: the open closing still reports the old config.
  if public.get_open_closing(current_setting('t.token')) #>> '{closing,config_id}' is distinct from current_setting('t.cfg_a') then
    raise exception 'T3 open closing config changed';
  end if;
end $$;
reset role;

-- T4 same key + same inputs after a later field write -> repeat (key lookup runs before the revision check)
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.set_closing_field(current_setting('t.token'), current_setting('t.bd')::date, 'c:wolt', '{"text":"50"}', 1);
  if r ->> 'revision' is distinct from '3' then raise exception 'T4 setup write failed: %', r; end if;
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date, current_setting('t.good')::jsonb, 1, 'key-1');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', current_setting('t.closing')::uuid, 'repeat', true) then
    raise exception 'T4 lost-answer retry not a repeat: %', r;
  end if;
  -- same key, different inputs is still a conflict, not draft_changed
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
        '{"schema":2,"counts":{},"channelCents":{},"expenses":[]}', 1, 'key-1');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'idempotency_conflict') then raise exception 'T4b expected idempotency_conflict: %', r; end if;

  -- T5 resubmit with a new key and the current revision -> a second closing row, last_submit moves on
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date, current_setting('t.good')::jsonb, 3, 'key-5');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', r -> 'closing_id', 'repeat', false)
     or r ->> 'closing_id' is null or r ->> 'closing_id' = current_setting('t.closing') then
    raise exception 'T5 resubmit failed: %', r;
  end if;
  perform set_config('t.closing2', r ->> 'closing_id', true);
  if public.get_open_closing(current_setting('t.token')) #>> '{closing,last_submit,closing_id}' is distinct from current_setting('t.closing2') then
    raise exception 'T5 last_submit not updated';
  end if;

  -- T6 stage-1 checks keep their order: wrong day / bad inputs / session still answer first
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date - 1, current_setting('t.good')::jsonb, 99, 'key-6a');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_day') then raise exception 'T6 expected wrong_day: %', r; end if;
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date, '{"schema":1}', 99, 'key-6b');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T6 expected bad_inputs: %', r; end if;
  r := public.submit_closing(null, current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date, current_setting('t.good')::jsonb, 99, 'key-6c');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T6 expected session_invalid: %', r; end if;
  -- a null revision never matches
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date, current_setting('t.good')::jsonb, null, 'key-6d');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', 3) then raise exception 'T6 null revision accepted: %', r; end if;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.closings where shop_id = current_setting('t.shop_a')::uuid) <> 2 then raise exception 'T5 expected exactly 2 stored closings'; end if;
  if (select count(*) from public.open_closings where shop_id = current_setting('t.shop_a')::uuid) <> 1 then raise exception 'T5 open closing not kept (or duplicated)'; end if;
end $$;

-- T7 a submit when no field was ever written works with revision 0 (shop B: owner-side nothing written).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.code_b', public.owner_get_join_key(current_setting('t.shop_b')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());
set local role authenticated;
select public.join_shop(current_setting('t.code_b'), 'Ταμείο B');
select set_config('t.token_b', public.staff_sign_in(current_setting('t.nikos')::uuid, '1234') ->> 'token', true);
do $$
declare r jsonb;
begin
  r := public.submit_closing(current_setting('t.token_b'), current_setting('t.cfg_b')::uuid, current_setting('t.bd')::date,
        jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb, 'expenses', '[]'::jsonb), 0, 'key-b');
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 revision-0 submit failed: %', r; end if;
end $$;
reset role;

-- T8 realtime 'submitted' broadcast (skipped where realtime.messages has no partitions, like 080)
do $$
declare m record; n int;
begin
  if not exists (select 1 from pg_inherits where inhparent = 'realtime.messages'::regclass) then
    raise notice 'T8 realtime broadcast assertions SKIPPED: realtime.messages has no partitions here';
    return;
  end if;
  select count(*) into n from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'submitted';
  if n <> 2 then raise exception 'T8 expected 2 submitted messages for shop A, got %', n; end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'submitted'
    and payload ->> 'closing_id' = current_setting('t.closing');
  if m.id is null or m.private is not true or m.payload ->> 'staff_name' is distinct from 'ΜΑΡΙΑ' or m.payload ->> 'at' is null
     or m.payload ->> 'revision' is distinct from '1' then
    raise exception 'T8 bad submitted payload: %', m.payload;
  end if;
end $$;

-- T9 owner-added lines: a phone must submit the stored author of an e:<id> line (owner or staff).
-- The pinned config of shop A gets maxExpenses so lines can exist.
update public.shop_configs set config = '{"schema":1,"maxExpenses":5}' where id = current_setting('t.cfg_a')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.owner_set_closing_field(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date, 'e:o1', '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', 0);
  if (r ->> 'ok')::boolean is not true then raise exception 'T9 owner line failed: %', r; end if;
  r := public.owner_set_closing_field(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date, 'e:o1:d', '{"text":"Υδραυλικός"}', 0);
  if (r ->> 'ok')::boolean is not true then raise exception 'T9 owner line :d failed: %', r; end if;
  r := public.owner_set_closing_field(current_setting('t.shop_a')::uuid, current_setting('t.bd')::date, 'e:o1:a', '{"text":"12"}', 0);
  if (r ->> 'ok')::boolean is not true then raise exception 'T9 owner line :a failed: %', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  tok text := current_setting('t.token');
  cfg uuid := current_setting('t.cfg_a')::uuid;
  bd date := current_setting('t.bd')::date;
  maria jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'));
  nikos_a jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.eleni'));
  owner_a jsonb := jsonb_build_object('kind', 'owner');
  rev bigint;
  r jsonb;
begin
  r := public.set_closing_field(tok, bd, 'e:m1', '{"addedBy":{"kind":"owner"},"order":2,"removed":false}', 0);
  if (r ->> 'ok')::boolean is not true then raise exception 'T9 staff line failed: %', r; end if;
  rev := (public.get_open_closing(tok) #>> '{closing,revision}')::bigint;

  -- owner line sent as owner -> ok
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'o1', 'description', 'Υδραυλικός', 'cents', 1200, 'addedBy', owner_a))), rev, 'key-9a');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', r -> 'closing_id', 'repeat', false) or r ->> 'closing_id' is null then
    raise exception 'T9 owner line with owner author refused: %', r;
  end if;
  -- owner line sent as a staff author -> bad_inputs
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'o1', 'description', 'Υδραυλικός', 'cents', 1200, 'addedBy', maria))), rev, 'key-9b');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T9 owner line with staff author accepted: %', r; end if;
  -- staff line (created by Μαρία) sent with another cashier as author -> bad_inputs; with Μαρία -> ok
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'm1', 'description', 'X', 'cents', 100, 'addedBy', nikos_a))), rev, 'key-9c');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T9 staff line with other author accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'm1', 'description', 'X', 'cents', 100, 'addedBy', maria))), rev, 'key-9d');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', r -> 'closing_id', 'repeat', false) or r ->> 'closing_id' is null then
    raise exception 'T9 staff line with its author refused: %', r;
  end if;
  -- a line with no e: field and an owner author keeps the stage-1 rule
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'zz9', 'description', 'X', 'cents', 100, 'addedBy', owner_a))), rev, 'key-9e');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T9 owner line without a field accepted: %', r; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.closings where idempotency_key in ('key-9b', 'key-9c', 'key-9e')) then raise exception 'T9 a refused submit stored a closing'; end if;
end $$;

rollback;
