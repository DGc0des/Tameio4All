-- 080 — open closing per day: per-field writes (last-write-wins + optional stale check), server-side
-- expense authors, owner variants, realtime topic authorization, no direct table access.
-- One transaction, ends in ROLLBACK. Phone/owner calls run as `authenticated`; private.* and row
-- checks run as the postgres role.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop (maxExpenses 2) + ΜΑΡΙΑ + ΝΙΚΟΣ + two codes. Owner B: shop + code.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1,"maxExpenses":2,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}]}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop_a')::uuid, 'ΝΙΚΟΣ', '567890')::text, true);
select set_config('t.code1', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.code2', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}]}')::text, true);
select set_config('t.zoe', public.create_staff(current_setting('t.shop_b')::uuid, 'ΖΩΗ', '123456')::text, true);
select set_config('t.code3', public.owner_get_join_key(current_setting('t.shop_b')::uuid), true);
reset role;

-- Phones: d1 + d2 -> shop A (Μαρία / Νίκος signed in), d3 -> shop B (Ζωή signed in).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code1'), 'Ταμείο 1');
select set_config('t.tok1', public.staff_sign_in(current_setting('t.maria')::uuid, '123456') ->> 'token', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code2'), 'Ταμείο 2');
select set_config('t.tok2', public.staff_sign_in(current_setting('t.nikos')::uuid, '567890') ->> 'token', true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code3'), 'Ταμείο B');
select set_config('t.tok3', public.staff_sign_in(current_setting('t.zoe')::uuid, '123456') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);

-- T1 get_open_closing creates once; config pinned to the latest at creation, kept after a publish.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.get_open_closing(current_setting('t.tok1'));
  if (r ->> 'ok')::boolean is not true then raise exception 'T1 get failed: %', r; end if;
  if r -> 'closing' ->> 'config_id' is distinct from current_setting('t.cfg_a') then raise exception 'T1 wrong config: %', r; end if;
  if r -> 'closing' ->> 'business_date' is distinct from current_setting('t.bd') or (r -> 'closing' ->> 'revision')::bigint is distinct from 0
     or jsonb_array_length(r -> 'closing' -> 'fields') is distinct from 0 or r -> 'closing' -> 'config' ->> 'maxExpenses' is distinct from '2' then
    raise exception 'T1 bad snapshot: %', r;
  end if;
  perform set_config('t.oc', r -> 'closing' ->> 'id', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
  r2 := public.get_open_closing(current_setting('t.tok2'));
  if r2 -> 'closing' ->> 'id' is distinct from current_setting('t.oc') then raise exception 'T1 second call created another closing'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.publish_config(current_setting('t.shop_a')::uuid, 1, '{"schema":1,"maxExpenses":2,"denominations":[5000,10000],"channels":[{"id":"wolt"},{"id":"card"}],"note":"v2"}');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.get_open_closing(current_setting('t.tok1'));
  if r -> 'closing' ->> 'id' is distinct from current_setting('t.oc') or r -> 'closing' ->> 'config_id' is distinct from current_setting('t.cfg_a') then
    raise exception 'T1 config not pinned after publish: %', r;
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid) <> 2 then
    raise exception 'T1 setup: expected 2 configs';
  end if;
end $$;

-- T2..T5 phone writes
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare
  t1 text := current_setting('t.tok1'); t2 text := current_setting('t.tok2');
  bd date := current_setting('t.bd')::date; maria uuid := current_setting('t.maria')::uuid;
  r jsonb; s jsonb;
begin
  -- T2 first write = version 1 / revision 1; same key from the other phone = version 2 (LWW)
  r := public.set_closing_field(t1, bd, 'd:5000', '{"text":"300","mode":"amount"}', null);
  if r is distinct from '{"ok":true,"version":1,"revision":1,"value":{"text":"300","mode":"amount"}}'::jsonb then raise exception 'T2 first write: %', r; end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
  r := public.set_closing_field(t2, bd, 'd:5000', '{"text":"450","mode":"count"}', null);
  if r is distinct from '{"ok":true,"version":2,"revision":2,"value":{"text":"450","mode":"count"}}'::jsonb then raise exception 'T2 LWW write: %', r; end if;
  s := public.get_open_closing(t2) -> 'closing';
  if s -> 'fields' -> 0 ->> 'key' is distinct from 'd:5000' or s -> 'fields' -> 0 -> 'value' is distinct from '{"text":"450","mode":"count"}'::jsonb
     or s -> 'fields' -> 0 ->> 'updated_by_name' is distinct from 'ΝΙΚΟΣ' or (s ->> 'revision')::bigint is distinct from 2
     or (s -> 'fields' -> 0 ->> 'version')::int is distinct from 2 then
    raise exception 'T2 snapshot: %', s;
  end if;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
  -- T3 base version older than current -> stale with current; nothing changed
  r := public.set_closing_field(t1, bd, 'd:5000', '{"text":"1","mode":"amount"}', 1);
  if r ->> 'ok' is distinct from 'false' or r ->> 'error' is distinct from 'stale' or r -> 'current' -> 'value' is distinct from '{"text":"450","mode":"count"}'::jsonb
     or (r -> 'current' ->> 'version')::int is distinct from 2 or r -> 'current' ->> 'updated_by_name' is distinct from 'ΝΙΚΟΣ' then
    raise exception 'T3 expected stale: %', r;
  end if;
  s := public.get_open_closing(t1) -> 'closing';
  if (s ->> 'revision')::bigint is distinct from 2 or s -> 'fields' -> 0 -> 'value' ->> 'text' is distinct from '450' then raise exception 'T3 stale write changed data: %', s; end if;
  r := public.set_closing_field(t1, bd, 'd:5000', '{"text":"500","mode":"amount"}', 2);   -- matching base succeeds
  if r is distinct from '{"ok":true,"version":3,"revision":3,"value":{"text":"500","mode":"amount"}}'::jsonb then raise exception 'T3 matching base: %', r; end if;

  -- T4 validation
  r := public.set_closing_field(t1, bd - 1, 'd:5000', '{"text":"1","mode":"amount"}', null);
  if r is distinct from '{"ok":false,"error":"wrong_day"}'::jsonb then raise exception 'T4 wrong_day: %', r; end if;
  r := public.set_closing_field(t1, bd, 'x:1', '{"text":"1"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4 bad key: %', r; end if;
  r := public.set_closing_field(t1, bd, 'c:wolt', '{"text":5}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4 bad value: %', r; end if;
  r := public.set_closing_field(t1, bd, 'c:wolt', null, null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4 null value: %', r; end if;
  r := public.set_closing_field(t1, bd, 'c:wolt', jsonb_build_object('text', repeat('1', 201)), null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4 201 chars: %', r; end if;
  r := public.set_closing_field(t1, bd, 'c:wolt', jsonb_build_object('text', repeat('1', 200)), null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T4 200 chars refused: %', r; end if;
  r := public.set_closing_field(t1, bd, 'd:5000', '{"text":"1","mode":"weird"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4 bad mode: %', r; end if;
  -- T4b strict shape: missing properties and extra properties are refused (never NULL-accepted)
  r := public.set_closing_field(t1, bd, 'c:wolt', '{}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b empty channel value: %', r; end if;
  r := public.set_closing_field(t1, bd, 'd:5000', '{"text":"1"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b denomination without mode: %', r; end if;
  r := public.set_closing_field(t1, bd, 'd:5000', '{"mode":"amount"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b denomination without text: %', r; end if;
  r := public.set_closing_field(t1, bd, 'c:wolt', '{"text":"1","junk":"x"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b channel with extra property: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:zzz', '{"order":1,"addedBy":{"kind":"owner"}}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b expense line without removed: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:zzz', '{"order":1,"removed":false}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b expense line without addedBy: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:zzz', '{"order":1,"removed":false,"addedBy":{"kind":"owner"},"x":1}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b expense line with extra property: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:zzz', '{"order":1,"removed":"no","addedBy":{"kind":"owner"}}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T4b expense line with non-boolean removed: %', r; end if;
  s := public.get_open_closing(t1) -> 'closing';
  if (s ->> 'revision')::bigint is distinct from 4 then raise exception 'T4 rejected writes bumped revision: %', s ->> 'revision'; end if;

  -- T5 expenses: server-side author, unknown line, cap (maxExpenses = 2), removed frees a slot
  r := public.set_closing_field(t1, bd, 'e:aaa:a', '{"text":"5"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T5 unknown line: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:aaa', '{"addedBy":{"kind":"owner"},"removed":false,"order":1000}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 create e:aaa: %', r; end if;
  if r -> 'value' is distinct from jsonb_build_object('addedBy', jsonb_build_object('kind', 'staff', 'id', maria), 'removed', false, 'order', 1000) then
    raise exception 'T5 ack does not carry the stored value: %', r;
  end if;
  s := public.get_open_closing(t1) -> 'closing';
  if (select f -> 'value' -> 'addedBy' from jsonb_array_elements(s -> 'fields') f where f ->> 'key' = 'e:aaa')
       is distinct from jsonb_build_object('kind', 'staff', 'id', maria) then
    raise exception 'T5 author not server-set: %', s -> 'fields';
  end if;
  r := public.set_closing_field(t1, bd, 'e:aaa:a', '{"text":"5"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 amount for known line: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:bbb', '{"addedBy":{"kind":"owner"},"removed":false,"order":2000}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 create e:bbb: %', r; end if;
  r := public.set_closing_field(t1, bd, 'e:ccc', '{"addedBy":{"kind":"owner"},"removed":false,"order":3000}', null);
  if r is distinct from '{"ok":false,"error":"too_many_expenses"}'::jsonb then raise exception 'T5 cap: %', r; end if;
  -- a later write to an existing line keeps the stored author, even from another cashier
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
  r := public.set_closing_field(t2, bd, 'e:aaa', '{"addedBy":{"kind":"owner"},"removed":true,"order":1000}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 remove e:aaa: %', r; end if;
  if r -> 'value' -> 'addedBy' is distinct from jsonb_build_object('kind', 'staff', 'id', maria) then
    raise exception 'T5 ack of a later write does not carry the stored author: %', r;
  end if;
  s := public.get_open_closing(t2) -> 'closing';
  if (select f -> 'value' from jsonb_array_elements(s -> 'fields') f where f ->> 'key' = 'e:aaa')
       is distinct from jsonb_build_object('addedBy', jsonb_build_object('kind', 'staff', 'id', maria), 'removed', true, 'order', 1000) then
    raise exception 'T5 author changed on later write: %', s -> 'fields';
  end if;
  r := public.set_closing_field(t2, bd, 'e:ccc', '{"addedBy":{"kind":"owner"},"removed":false,"order":3000}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T5 removed line did not free a slot: %', r; end if;
  -- un-removing a line needs a free slot too (aaa removed, bbb + ccc visible, cap 2)
  r := public.set_closing_field(t2, bd, 'e:aaa', '{"addedBy":{"kind":"owner"},"removed":false,"order":1000}', null);
  if r is distinct from '{"ok":false,"error":"too_many_expenses"}'::jsonb then raise exception 'T5 un-remove past cap: %', r; end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
end $$;
reset role;

-- Every successful write sent one realtime message to shop:<A>.
do $$
declare n int; m record;
begin
  -- realtime.send swallows insert errors (a WARNING). The dev project has no realtime.messages
  -- partitions (the Realtime service creates them), so the broadcast can only be asserted where one exists.
  if not exists (select 1 from pg_inherits where inhparent = 'realtime.messages'::regclass) then
    raise notice 'T2 realtime broadcast assertions SKIPPED: realtime.messages has no partitions here';
    return;
  end if;
  select count(*) into n from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'field';
  if n <> 9 then raise exception 'T2 expected 9 realtime messages for shop A, got %', n; end if;
  select * into m from realtime.messages where topic = 'shop:' || current_setting('t.shop_a') and event = 'field'
    and payload ->> 'key' = 'd:5000' and (payload ->> 'version')::int = 2;
  if m.private is not true or m.payload ->> 'updated_by_name' is distinct from 'ΝΙΚΟΣ' or (m.payload ->> 'revision')::int is distinct from 2
     or m.payload ->> 'business_date' is distinct from current_setting('t.bd') then
    raise exception 'T2 bad realtime payload: %', m.payload;
  end if;
end $$;

-- T6 shop B's phone sees and writes only shop B; signed-out token is refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.get_open_closing(current_setting('t.tok3'));
  if (r ->> 'ok')::boolean is not true or r -> 'closing' ->> 'id' = current_setting('t.oc') or jsonb_array_length(r -> 'closing' -> 'fields') is distinct from 0 then
    raise exception 'T6 shop B phone sees shop A data: %', r;
  end if;
  -- shop A's token from shop B's phone: the session belongs to another phone
  r := public.get_open_closing(current_setting('t.tok1'));
  if r is distinct from '{"ok":false,"error":"session_invalid"}'::jsonb then raise exception 'T6 cross-phone read: %', r; end if;
  r := public.set_closing_field(current_setting('t.tok1'), current_setting('t.bd')::date, 'c:wolt', '{"text":"9"}', null);
  if r is distinct from '{"ok":false,"error":"session_invalid"}'::jsonb then raise exception 'T6 cross-phone write: %', r; end if;
  r := public.set_closing_field(current_setting('t.tok3'), current_setting('t.bd')::date, 'c:wolt', '{"text":"9"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T6 shop B own write: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.open_closing_fields where open_closing_id = current_setting('t.oc')::uuid) <> 6 then
    raise exception 'T6 shop A field rows changed by shop B (expected 6)';
  end if;
end $$;

-- T8 (before sign-out) topic helper positives; then sign d1 out and check negatives.
select set_config('t.topic_a', 'shop:' || current_setting('t.shop_a'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if not private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'T8 owner A refused on own topic'; end if;
  if private.can_use_shop_topic('shop:' || current_setting('t.shop_b')) then raise exception 'T8 owner A allowed on shop B topic'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if not private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'T8 d1 with session refused'; end if;
  if private.can_use_shop_topic('shop:' || current_setting('t.shop_b')) then raise exception 'T8 d1 allowed on shop B topic'; end if;
  if private.can_use_shop_topic('shop:not-a-uuid') or private.can_use_shop_topic(null) or private.can_use_shop_topic('')
     or private.can_use_shop_topic(current_setting('t.shop_a')) or private.can_use_shop_topic(current_setting('t.topic_a') || 'x') then
    raise exception 'T8 malformed topic allowed';
  end if;
  -- I2 an authorised phone may track presence on its shop topic but cannot forge a broadcast (`field`).
  -- Needs a realtime.messages partition to route the row; dev has none, so it is skipped there.
  if not exists (select 1 from pg_inherits where inhparent = 'realtime.messages'::regclass) then
    raise notice 'I2 client insert policy assertions SKIPPED: realtime.messages has no partitions here';
  else
    perform set_config('realtime.topic', current_setting('t.topic_a'), true);
    begin
      insert into realtime.messages (topic, extension, event, payload, private)
      values (current_setting('t.topic_a'), 'broadcast', 'field', '{"key":"c:wolt"}', true);
      raise exception 'I2 phone forged a broadcast message';
    exception when insufficient_privilege then null; end;
    insert into realtime.messages (topic, extension, event, payload, private)
    values (current_setting('t.topic_a'), 'presence', 'presence', '{}', true);
  end if;
  perform public.staff_sign_out(current_setting('t.tok1'));
  if private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'T8 d1 allowed after sign-out'; end if;
  -- T6b signed-out token
  if public.get_open_closing(current_setting('t.tok1')) is distinct from '{"ok":false,"error":"session_invalid"}'::jsonb
     or public.set_closing_field(current_setting('t.tok1'), current_setting('t.bd')::date, 'c:wolt', '{"text":"9"}', null)
        is distinct from '{"ok":false,"error":"session_invalid"}'::jsonb then
    raise exception 'T6b signed-out token not refused';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'T8 d3 allowed on shop A topic'; end if;
  if not private.can_use_shop_topic('shop:' || current_setting('t.shop_b')) then raise exception 'T8 d3 refused on shop B topic'; end if;
end $$;
reset role;
-- anon has no usage on schema private (so it cannot call the helper at all); as the postgres role
-- with an anon JWT (no sub) the helper must still say no.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  if private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'T8 anon allowed'; end if;
end $$;

-- I3 a revoked phone and a deactivated cashier lose realtime authorization and writes (d2 / ΝΙΚΟΣ, tok2).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if not private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'I3 setup: d2 should be authorised'; end if;
end $$;
reset role;
update public.devices set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000d2';
set local role authenticated;
do $$ begin
  if private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'I3 revoked phone allowed on topic'; end if;
  if public.set_closing_field(current_setting('t.tok2'), current_setting('t.bd')::date, 'c:wolt', '{"text":"9"}', null)
       is distinct from '{"ok":false,"error":"device_revoked"}'::jsonb then
    raise exception 'I3 revoked phone write not device_revoked';
  end if;
  if public.get_open_closing(current_setting('t.tok2')) is distinct from '{"ok":false,"error":"device_revoked"}'::jsonb then
    raise exception 'I3 revoked phone read not device_revoked';
  end if;
end $$;
reset role;
update public.devices set revoked_at = null where user_id = '00000000-0000-0000-0000-0000000000d2';
update public.staff set active = false where id = current_setting('t.nikos')::uuid;
set local role authenticated;
do $$ begin
  if private.can_use_shop_topic(current_setting('t.topic_a')) then raise exception 'I3 deactivated cashier allowed on topic'; end if;
  if public.set_closing_field(current_setting('t.tok2'), current_setting('t.bd')::date, 'c:wolt', '{"text":"9"}', null)
       is distinct from '{"ok":false,"error":"session_invalid"}'::jsonb then
    raise exception 'I3 deactivated cashier write not session_invalid';
  end if;
end $$;
reset role;
update public.staff set active = true where id = current_setting('t.nikos')::uuid;

-- T7 owner A: write works, name «Ιδιοκτήτης», owner author on a new line; owner B: not_owner.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare s uuid := current_setting('t.shop_a')::uuid; bd date := current_setting('t.bd')::date; r jsonb; c jsonb;
begin
  r := public.owner_set_closing_field(s, bd, 'c:wolt', '{"text":"77"}', null);
  if (r ->> 'ok')::boolean is not true or (r ->> 'version')::int is distinct from 2 then raise exception 'T7 owner write: %', r; end if;   -- d3/shop B wrote a different closing; shop A's c:wolt was version 1
  r := public.owner_set_closing_field(s, bd, 'c:wolt', '{"text":"1"}', 1);
  if r ->> 'error' is distinct from 'stale' or r -> 'current' ->> 'updated_by_name' is distinct from 'Ιδιοκτήτης' then raise exception 'T7 owner stale: %', r; end if;
  r := public.owner_set_closing_field(s, bd, 'e:own', '{"addedBy":{"kind":"staff","id":"x"},"removed":true,"order":5}', null);   -- removed: no slot needed
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 owner expense: %', r; end if;
  -- the ok result carries the STORED value (server-decided author), not what the client sent
  if r -> 'value' is distinct from '{"addedBy":{"kind":"owner"},"removed":true,"order":5}'::jsonb then raise exception 'T7 owner ack value: %', r; end if;
  -- an owner write for a day other than the shop's business date is refused, nothing written
  r := public.owner_set_closing_field(s, bd - 1, 'c:wolt', '{"text":"5"}', null);
  if r is distinct from '{"ok":false,"error":"wrong_day"}'::jsonb then raise exception 'T7 owner wrong_day (yesterday): %', r; end if;
  r := public.owner_set_closing_field(s, bd + 1, 'c:wolt', '{"text":"5"}', null);
  if r is distinct from '{"ok":false,"error":"wrong_day"}'::jsonb then raise exception 'T7 owner wrong_day (tomorrow): %', r; end if;
  r := public.owner_set_closing_field(s, null, 'c:wolt', '{"text":"5"}', null);
  if r is distinct from '{"ok":false,"error":"wrong_day"}'::jsonb then raise exception 'T7 owner wrong_day (null): %', r; end if;
  c := public.owner_get_open_closing(s) -> 'closing';
  if (select f -> 'value' from jsonb_array_elements(c -> 'fields') f where f ->> 'key' = 'c:wolt') is distinct from '{"text":"77"}'::jsonb then
    raise exception 'T7 wrong_day write landed: %', c -> 'fields';
  end if;
  r := public.owner_set_closing_field(s, bd, 'e:own', '{"addedBy":{"kind":"staff","id":"x"},"removed":false,"order":5}', null);
  if r ->> 'error' is distinct from 'too_many_expenses' then raise exception 'T7 owner un-remove past cap: %', r; end if;
  c := public.owner_get_open_closing(s) -> 'closing';
  if (select f -> 'value' -> 'addedBy' from jsonb_array_elements(c -> 'fields') f where f ->> 'key' = 'e:own') is distinct from '{"kind":"owner"}'::jsonb
     or (select f ->> 'updated_by_name' from jsonb_array_elements(c -> 'fields') f where f ->> 'key' = 'e:own') is distinct from 'Ιδιοκτήτης'
     or c ->> 'id' is distinct from current_setting('t.oc') then
    raise exception 'T7 owner snapshot: %', c;
  end if;
  r := public.owner_set_closing_field(s, bd, 'x:1', '{"text":"1"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T7 owner bad key: %', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare s uuid := current_setting('t.shop_a')::uuid; bd date := current_setting('t.bd')::date; ok1 boolean := false; ok2 boolean := false;
begin
  begin perform public.owner_get_open_closing(s); exception when others then ok1 := sqlerrm = 'not_owner'; end;
  begin perform public.owner_set_closing_field(s, bd, 'c:wolt', '{"text":"1"}', null); exception when others then ok2 := sqlerrm = 'not_owner'; end;
  if not (ok1 and ok2) then raise exception 'T7 owner B not refused with not_owner'; end if;
end $$;
reset role;

-- T9 nobody has direct table access.
do $$
declare who text; tbl text; ok boolean;
begin
  foreach who in array array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1'] loop
    foreach tbl in array array['open_closings', 'open_closing_fields'] loop
      perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
      execute 'set local role authenticated';
      ok := false;
      begin execute format('select * from public.%I', tbl);
      exception when insufficient_privilege then ok := true; end;
      if not ok then raise exception 'T9 % could select %', who, tbl; end if;
      ok := false;
      begin
        if tbl = 'open_closings' then
          execute format('insert into public.open_closings (shop_id, business_date, config_id) values (%L, current_date, %L)', current_setting('t.shop_a'), current_setting('t.cfg_a'));
        else
          execute format('insert into public.open_closing_fields (open_closing_id, key, value, version) values (%L, ''c:z'', ''{}'', 1)', current_setting('t.oc'));
        end if;
      exception when insufficient_privilege then ok := true; end;
      if not ok then raise exception 'T9 % could insert into %', who, tbl; end if;
      execute 'reset role';
    end loop;
  end loop;
  -- anon too
  execute 'set local role anon';
  ok := false;
  begin perform 1 from public.open_closings; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'T9 anon could select open_closings'; end if;
  execute 'reset role';
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('open_closings', 'open_closing_fields') and c.relrowsecurity) <> 2 then
    raise exception 'T9 RLS not enabled on both tables';
  end if;
end $$;

-- T-M42 (M42): d:/c: keys must exist in the pinned config; total e:<id> rows (removed included) capped at maxExpenses * 5.
-- A fresh shop keeps these writes away from shop A's counted rows above (owner writes, no phone needed).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_m', public.create_shop('Shop M42', '{"schema":1,"maxExpenses":2,"denominations":[100,5000],"channels":[{"id":"card"}]}')::text, true);
reset role;
select set_config('t.bd_m', private.business_date(current_setting('t.shop_m')::uuid)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_m')::uuid; bd date := current_setting('t.bd_m')::date;
  r jsonb; rev0 bigint; rev1 bigint; i int;
begin
  -- T-M42-1 denominations
  r := public.owner_set_closing_field(shop, bd, 'd:200', '{"text":"1","mode":"amount"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T-M42-1 d:200 not in config accepted: %', r; end if;
  r := public.owner_set_closing_field(shop, bd, 'd:0100', '{"text":"1","mode":"amount"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T-M42-1 non-canonical d:0100 accepted: %', r; end if;
  r := public.owner_set_closing_field(shop, bd, 'd:100', '{"text":"1","mode":"amount"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-1 d:100 in config refused: %', r; end if;
  rev0 := (r ->> 'revision')::bigint;
  -- T-M42-2 channels (and: the rejected writes above/below did not bump the revision)
  r := public.owner_set_closing_field(shop, bd, 'c:wolt', '{"text":"1"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T-M42-2 c:wolt not in config accepted: %', r; end if;
  r := public.owner_set_closing_field(shop, bd, 'c:card', '{"text":"1"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-2 c:card in config refused: %', r; end if;
  rev1 := (r ->> 'revision')::bigint;
  if rev1 <> rev0 + 1 then raise exception 'T-M42-2 rejected write bumped revision: % -> %', rev0, rev1; end if;
  -- T-M42-3 total e:<id> rows capped at maxExpenses * 5 = 10, removed included
  for i in 1..10 loop
    r := public.owner_set_closing_field(shop, bd, 'e:m' || i, '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', null);
    if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-3 create e:m% failed: %', i, r; end if;
    r := public.owner_set_closing_field(shop, bd, 'e:m' || i, '{"addedBy":{"kind":"owner"},"order":1,"removed":true}', null);
    if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-3 remove e:m% failed: %', i, r; end if;
  end loop;
  r := public.owner_set_closing_field(shop, bd, 'e:m11', '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', null);
  if r is distinct from '{"ok":false,"error":"too_many_expenses"}'::jsonb then raise exception 'T-M42-3 11th line accepted: %', r; end if;
  r := public.owner_set_closing_field(shop, bd, 'e:m1', '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-3 un-remove of an existing line refused: %', r; end if;
end $$;
reset role;
-- T-M42-4 junk denominations/channels in the pinned config: bad_field, never an exception
update public.shop_configs set config = config || '{"denominations":"x","channels":7}'::jsonb where shop_id = current_setting('t.shop_m')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_m')::uuid; bd date := current_setting('t.bd_m')::date; r jsonb;
begin
  r := public.owner_set_closing_field(shop, bd, 'd:100', '{"text":"1","mode":"amount"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T-M42-4 d: with junk denominations: %', r; end if;
  r := public.owner_set_closing_field(shop, bd, 'c:card', '{"text":"1"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T-M42-4 c: with junk channels: %', r; end if;
end $$;
reset role;
update public.shop_configs set config = config || '{"denominations":[100,"x",null],"channels":[7,null,{"id":5},"card"]}'::jsonb where shop_id = current_setting('t.shop_m')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_m')::uuid; bd date := current_setting('t.bd_m')::date; r jsonb;
begin
  r := public.owner_set_closing_field(shop, bd, 'c:card', '{"text":"1"}', null);
  if r is distinct from '{"ok":false,"error":"bad_field"}'::jsonb then raise exception 'T-M42-4 c: with junk channel elements: %', r; end if;
  r := public.owner_set_closing_field(shop, bd, 'd:100', '{"text":"2","mode":"amount"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-4 d:100 with mixed-junk array refused: %', r; end if;
end $$;
reset role;

-- T-M42-5 (final review I1): a junk/huge `maxExpenses` in the pinned config (written as the migration owner, which
-- check_config cannot stop) means cap 0: a new line answers too_many_expenses, never an exception.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
do $$
declare
  shop uuid := current_setting('t.shop_m')::uuid; bd date := current_setting('t.bd_m')::date; r jsonb; v jsonb;
begin
  foreach v in array array['"abc"', '2.5', '1e12', '-3', 'null', '2147483648']::jsonb[] loop
    update public.shop_configs set config = jsonb_set(config, '{maxExpenses}', v) where shop_id = shop;
    execute 'set local role authenticated';
    begin
      r := public.owner_set_closing_field(shop, bd, 'e:j1', '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', null);
    exception when others then
      raise exception 'T-M42-5 maxExpenses % raised: % %', v, sqlstate, sqlerrm;
    end;
    execute 'reset role';
    if r is distinct from '{"ok":false,"error":"too_many_expenses"}'::jsonb then
      raise exception 'T-M42-5 maxExpenses %: %', v, r;
    end if;
  end loop;
end $$;
reset role;

-- T-M42-6 a stored maxExpenses above 30 behaves as 30 for the visible-line cap. Shop M has 1 visible line (e:m1)
-- and 10 e:<id> rows; 29 more make 30 visible (39 rows < 30 * 5), the next one is refused.
update public.shop_configs set config = jsonb_set(config, '{maxExpenses}', '100') where shop_id = current_setting('t.shop_m')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  shop uuid := current_setting('t.shop_m')::uuid; bd date := current_setting('t.bd_m')::date; r jsonb; i int;
begin
  for i in 1..29 loop
    r := public.owner_set_closing_field(shop, bd, 'e:n' || i, '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', null);
    if (r ->> 'ok')::boolean is not true then raise exception 'T-M42-6 line % refused under the cap: %', i, r; end if;
  end loop;
  r := public.owner_set_closing_field(shop, bd, 'e:n30', '{"addedBy":{"kind":"owner"},"order":1,"removed":false}', null);
  if r is distinct from '{"ok":false,"error":"too_many_expenses"}'::jsonb then raise exception 'T-M42-6 31st visible line accepted: %', r; end if;
end $$;
reset role;

-- T-M42-7 private.max_expenses: values (as the migration owner) and grants.
do $$
declare c record;
begin
  for c in select * from (values
      ('{"maxExpenses":0}'::jsonb, 0), ('{"maxExpenses":5}', 5), ('{"maxExpenses":30}', 30), ('{"maxExpenses":31}', 30),
      ('{"maxExpenses":999999999}', 30), ('{"maxExpenses":1e12}', 0), ('{"maxExpenses":-3}', 0),
      ('{"maxExpenses":2.5}', 0), ('{"maxExpenses":"5"}', 0), ('{"maxExpenses":null}', 0), ('{"schema":1}', 0),
      ('[1,2]', 0), ('"x"', 0)) t(cfg, want) loop
    if private.max_expenses(c.cfg) is distinct from c.want then
      raise exception 'T-M42-7 max_expenses(%) = %, want %', c.cfg, private.max_expenses(c.cfg), c.want;
    end if;
  end loop;
  if private.max_expenses(null) is distinct from 0 then raise exception 'T-M42-7 max_expenses(null) not 0'; end if;
  if has_function_privilege('authenticated', 'private.max_expenses(jsonb)', 'execute')
     or has_function_privilege('anon', 'private.max_expenses(jsonb)', 'execute')
     or has_function_privilege('public', 'private.max_expenses(jsonb)', 'execute') then
    raise exception 'T-M42-7 private.max_expenses is executable by a client role';
  end if;
end $$;

rollback;
