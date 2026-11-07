-- 070 — session-based submit_closing, inputs schema 2, suggestions = latest closing per day.
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
select set_config('t.code', public.create_pairing_code(current_setting('t.shop_a')::uuid), true);
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
select public.redeem_pairing_code(current_setting('t.code'), 'Ταμείο');
select set_config('t.token', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);
select set_config('t.good', jsonb_build_object(
  'schema', 2, 'counts', jsonb_build_object('10000', 5), 'channelCents', jsonb_build_object('wolt', 4560),
  'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300,
    'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'))))
)::text, true);

set local role authenticated;
do $$
declare
  tok text := current_setting('t.token');
  cfg uuid := current_setting('t.cfg_a')::uuid;
  bd date := current_setting('t.bd')::date;
  good jsonb := current_setting('t.good')::jsonb;
  r jsonb;
begin
  -- T1 happy path, schema 2
  r := public.submit_closing(tok, cfg, bd, good, 'key-1');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', r -> 'closing_id', 'repeat', false) or r ->> 'closing_id' is null then
    raise exception 'T1 submit failed: %', r;
  end if;
  perform set_config('t.closing', r ->> 'closing_id', true);

  -- T2 same key, same inputs with keys reordered → repeat, same id; other inputs → conflict
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object(
        'expenses', jsonb_build_array(jsonb_build_object('addedBy', jsonb_build_object('id', current_setting('t.maria'), 'kind', 'staff'),
                                                         'cents', 1300, 'description', 'Nice', 'id', 'e1')),
        'channelCents', jsonb_build_object('wolt', 4560), 'counts', jsonb_build_object('10000', 5), 'schema', 2), 'key-1');
  if r is distinct from jsonb_build_object('ok', true, 'closing_id', current_setting('t.closing')::uuid, 'repeat', true) then
    raise exception 'T2 repeat not recognised: %', r;
  end if;
  r := public.submit_closing(tok, cfg, bd, '{"schema":2,"counts":{"10000":9},"channelCents":{},"expenses":[]}', 'key-1');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'idempotency_conflict') then raise exception 'T2b expected idempotency_conflict: %', r; end if;

  -- T3 only the session's business date is accepted
  r := public.submit_closing(tok, cfg, bd - 1, good, 'key-3a');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_day') then raise exception 'T3 yesterday accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd + 1, good, 'key-3b');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'wrong_day') then raise exception 'T3 tomorrow accepted: %', r; end if;

  -- T4 new submissions must be schema 2
  r := public.submit_closing(tok, cfg, bd, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Nice","cents":1300}]}', 'key-4');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T4 schema 1 accepted: %', r; end if;

  -- T5 another shop's config is refused
  r := public.submit_closing(tok, current_setting('t.cfg_b')::uuid, bd, good, 'key-5');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'config_mismatch') then raise exception 'T5 expected config_mismatch: %', r; end if;

  -- T6 expense authors: owner kind refused from phones, other shop's staff refused, id required
  r := public.submit_closing(tok, cfg, bd, '{"schema":2,"counts":{},"channelCents":{},"expenses":[{"id":"e1","description":"X","cents":1,"addedBy":{"kind":"owner"}}]}', 'key-6a');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T6 owner author accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'X', 'cents', 1,
          'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.nikos'))))), 'key-6b');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T6 other shop author accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('description', 'X', 'cents', 1,
          'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'))))), 'key-6c');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T6 expense without id accepted: %', r; end if;
end $$;
reset role;

do $$ begin
  if not exists (select 1 from public.closings where id = current_setting('t.closing')::uuid
                 and staff_id = current_setting('t.maria')::uuid and business_date = current_setting('t.bd')::date
                 and device_user_id = '00000000-0000-0000-0000-0000000000d1') then
    raise exception 'T1 stored row has wrong staff/date/device';
  end if;
  if (select count(*) from public.closings where shop_id = current_setting('t.shop_a')::uuid) <> 1 then
    raise exception 'T1-T6 expected exactly 1 stored closing';
  end if;
end $$;
-- Rows inserted in one transaction share now(); make the first closing older so "latest" is defined.
update public.closings set created_at = now() - interval '1 hour' where id = current_setting('t.closing')::uuid;

-- T7 resubmit the same day with a new key (an expense by another cashier of the shop) → a second
-- row; suggestions come only from the latest closing of the day.
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
        jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
          'expenses', jsonb_build_array(jsonb_build_object('id', 'e2', 'description', 'Μεβγάλ', 'cents', 2160,
            'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.eleni'))))), 'key-7');
  if (r ->> 'ok')::boolean is not true or (r ->> 'repeat')::boolean or r ->> 'closing_id' = current_setting('t.closing') then
    raise exception 'T7 resubmit failed: %', r;
  end if;
  if (select array_agg(description || ':' || cents) from public.expense_suggestion_data()) is distinct from array['Μεβγάλ:2160'] then
    raise exception 'T7 wrong suggestion data: %', (select array_agg(description) from public.expense_suggestion_data());
  end if;

  -- T5b a signed-out token is refused
  perform public.staff_sign_out(current_setting('t.token'));
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
        current_setting('t.good')::jsonb, 'key-5b');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T5b expected session_invalid: %', r; end if;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.closings where shop_id = current_setting('t.shop_a')::uuid) <> 2 then
    raise exception 'T7 expected exactly 2 stored closings';
  end if;
  -- T8 a stored schema-1 shape is still valid; schema 2 rules hold in the shape check itself
  if not private.inputs_shape_ok('{"schema":1,"counts":{"10000":5},"channelCents":{"wolt":4560},"expenses":[{"description":"Nice","cents":1300}]}') then
    raise exception 'T8 schema 1 shape rejected';
  end if;
  if not private.inputs_shape_ok('{"schema":2,"counts":{},"channelCents":{},"expenses":[{"id":"e1","description":"X","cents":1,"addedBy":{"kind":"owner"}}]}') then
    raise exception 'T8 schema 2 owner-authored shape rejected';
  end if;
  if private.inputs_shape_ok('{"schema":2,"counts":{},"channelCents":{},"expenses":[{"id":"e1","description":"X","cents":1,"addedBy":{"kind":"staff","id":"nope"}}]}')
     or private.inputs_shape_ok('{"schema":2,"counts":{},"channelCents":{},"expenses":[{"id":"","description":"X","cents":1,"addedBy":{"kind":"owner"}}]}')
     or private.inputs_shape_ok('{"schema":2,"counts":{},"channelCents":{},"expenses":[{"id":"e1","description":"X","cents":1}]}')
     or private.inputs_shape_ok('{"schema":2,"counts":{},"channelCents":{},"expenses":["x"]}')
     or private.inputs_shape_ok('{"schema":3,"counts":{},"channelCents":{},"expenses":[]}')
     or private.inputs_shape_ok('{"schema":2,"counts":{},"channelCents":{}}')
     or private.inputs_shape_ok('{"schema":1,"counts":{},"channelCents":{}}') then
    raise exception 'T8 malformed schema 2 shape accepted';
  end if;
end $$;

rollback;
