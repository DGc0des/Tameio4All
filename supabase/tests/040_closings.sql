-- 040 — submitting closings and suggestion data. One transaction, ends in ROLLBACK.
-- The business-date rule (only the session's day) is covered by 070.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, staff, code. Owner B: shop + staff (for cross-shop checks).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.code', public.create_pairing_code(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop_b')::uuid, 'ΝΙΚΟΣ', '1234')::text, true);
select set_config('t.cfg_b', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_b')::uuid), true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);

-- Phone D1 pairs with shop A; maria signs in.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.redeem_pairing_code(current_setting('t.code'), 'Ταμείο');
select set_config('t.token', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);

do $$
declare
  tok text := current_setting('t.token');
  cfg uuid := current_setting('t.cfg_a')::uuid;
  bd date := current_setting('t.bd')::date;
  author jsonb := jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'));
  good jsonb;
  r jsonb;
begin
  good := jsonb_build_object('schema', 2, 'counts', '{"10000":5}'::jsonb, 'channelCents', '{"wolt":4560}'::jsonb,
            'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300, 'addedBy', author)));

  -- T1 happy path
  r := public.submit_closing(tok, cfg, bd, good, 'key-1');
  if (r ->> 'ok')::boolean is not true then raise exception 'T1 submit failed: %', r; end if;
  perform set_config('t.closing', r ->> 'closing_id', true);

  -- T2 same key, same inputs (key order different) → harmless repeat, same id
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object(
        'expenses', jsonb_build_array(jsonb_build_object('addedBy', author, 'cents', 1300, 'description', 'Nice', 'id', 'e1')),
        'channelCents', '{"wolt":4560}'::jsonb, 'counts', '{"10000":5}'::jsonb, 'schema', 2), 'key-1');
  if (r ->> 'ok')::boolean is not true or r ->> 'closing_id' <> current_setting('t.closing') or (r ->> 'repeat')::boolean is not true then
    raise exception 'T2 repeat not recognised: %', r;
  end if;

  -- T3 same key, different inputs → idempotency_conflict
  r := public.submit_closing(tok, cfg, bd, '{"schema":2,"counts":{"10000":9},"channelCents":{},"expenses":[]}', 'key-1');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'idempotency_conflict') then raise exception 'T3 expected idempotency_conflict: %', r; end if;

  -- T4 another shop's config / staff are refused
  r := public.submit_closing(tok, current_setting('t.cfg_b')::uuid, bd, good, 'key-2');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'config_mismatch') then raise exception 'T4 expected config_mismatch: %', r; end if;
  r := public.staff_sign_in(current_setting('t.nikos')::uuid, '1234');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'staff_not_found') then raise exception 'T4b expected staff_not_found: %', r; end if;

  -- T5 malformed inputs are refused (checked against the full expected shape, so a silent success
  -- with a null 'error' key can't slip past an `<>` comparison that would itself evaluate to null)
  r := public.submit_closing(tok, cfg, bd, '{"schema":3,"counts":{},"channelCents":{},"expenses":[]}', 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T5 schema 3 accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, '{"schema":2,"counts":{},"channelCents":{}}', 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T5 missing expenses accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, '{"schema":"2","counts":{},"channelCents":{},"expenses":[]}', 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T5 string schema accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, '{"schema":2,"counts":{},"channelCents":{},"expenses":[{"description":7,"cents":"x"}]}', 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T5 malformed expense accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, null, good, 'key-3');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T5 null date accepted: %', r; end if;
  r := public.submit_closing(tok, cfg, bd, good, '');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'bad_inputs') then raise exception 'T5 empty key accepted: %', r; end if;

  -- T6 a missing or unknown session token stores nothing
  r := public.submit_closing(null, cfg, bd, good, 'key-4');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T6 null token accepted: %', r; end if;
  r := public.submit_closing(repeat('0', 64), cfg, bd, good, 'key-4');
  if r is distinct from jsonb_build_object('ok', false, 'error', 'session_invalid') then raise exception 'T6 unknown token accepted: %', r; end if;

  -- T7 a second real closing of the same day stores fine
  r := public.submit_closing(tok, cfg, bd, jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
        'expenses', jsonb_build_array(jsonb_build_object('id', 'e2', 'description', 'Μεβγάλ', 'cents', 2160, 'addedBy', author))), 'key-5');
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 second closing failed: %', r; end if;
  perform set_config('t.closing2', r ->> 'closing_id', true);
end $$;
reset role;

do $$ begin
  if (select count(*) from public.closings where shop_id = current_setting('t.shop_a')::uuid) <> 2 then raise exception 'T8 expected exactly 2 stored closings'; end if;
  if (select device_user_id from public.closings where id = current_setting('t.closing')::uuid) <> '00000000-0000-0000-0000-0000000000d1' then raise exception 'T8 device not recorded'; end if;
end $$;
-- Rows of one transaction share now(): make T1's closing the older one of the day.
update public.closings set created_at = now() - interval '1 hour' where id = current_setting('t.closing')::uuid;

-- Directly inserted rows (bypassing the RPC): an old one, a voided one that is the newest of today,
-- a future-dated one, yesterday's (stored schema 1, with a malformed line), and shop B's.
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key, voided_at, created_at) values
  (current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg_a')::uuid,
   current_setting('t.bd')::date - 200, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Old","cents":100}]}', 'old', null, now()),
  (current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg_a')::uuid,
   current_setting('t.bd')::date, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Voided","cents":100}]}', 'void', now(), now() + interval '1 hour'),
  (current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg_a')::uuid,
   current_setting('t.bd')::date + 30, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Future","cents":100}]}', 'future', null, now()),
  (current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg_a')::uuid,
   current_setting('t.bd')::date - 1, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Νερό","cents":450},{"description":7,"cents":"x"}]}', 'yday', null, now()),
  (current_setting('t.shop_b')::uuid, current_setting('t.nikos')::uuid, '00000000-0000-0000-0000-0000000000d2', current_setting('t.cfg_b')::uuid,
   current_setting('t.bd')::date, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Shop B supplier","cents":100}]}', 'b-1', null, now());

-- T9 suggestion data: own shop, last 180 days, not in the future, latest non-voided closing per
-- day only (T1's "Nice" is superseded by T7), malformed lines skipped
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select array_agg(description order by description) from public.expense_suggestion_data()) is distinct from array['Μεβγάλ', 'Νερό'] then
    raise exception 'T9 wrong suggestion data: %', (select array_agg(description) from public.expense_suggestion_data());
  end if;
  if (select cents from public.expense_suggestion_data() where description = 'Μεβγάλ') <> 2160 then raise exception 'T9 wrong cents'; end if;
  if (select business_date from public.expense_suggestion_data() where description = 'Νερό') <> current_setting('t.bd')::date - 1 then raise exception 'T9 wrong date'; end if;
end $$;
reset role;

-- T10 an owner session (not a phone) cannot submit
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
       '{"schema":2,"counts":{},"channelCents":{},"expenses":[]}', 'owner-key') is distinct from jsonb_build_object('ok', false, 'error', 'not_a_device') then
    raise exception 'T10 owner submitted a closing';
  end if;
  if (select count(*) from public.expense_suggestion_data()) <> 0 then raise exception 'T10 owner got phone suggestion data'; end if;
end $$;
reset role;

-- T11 a revoked phone cannot submit a closing or read suggestion data
update public.devices set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
       '{"schema":2,"counts":{},"channelCents":{},"expenses":[]}', 'revoked-key') is distinct from jsonb_build_object('ok', false, 'error', 'device_revoked') then
    raise exception 'T11 revoked phone submitted';
  end if;
  if (select count(*) from public.expense_suggestion_data()) <> 0 then raise exception 'T11 revoked phone got suggestion data'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.closings where idempotency_key in ('revoked-key', 'owner-key', 'key-4')) then raise exception 'T11 a refused submit stored a closing'; end if;
end $$;

rollback;
