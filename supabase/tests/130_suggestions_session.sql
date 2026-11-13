-- 130 — expense_suggestion_data(p_token) needs a live staff session (H23). One transaction, ends in ROLLBACK.
-- Phone D1 joins and signs in; phone D2 joins but never signs in.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, one staff, join key.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.code', public.owner_get_join_key(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('t.bd', private.business_date(current_setting('t.shop_a')::uuid)::text, true);

-- Phone D2 joins shop A and never signs in.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code'), 'Δεύτερο');
reset role;

-- Phone D1 joins, signs in, and submits today's closing with one expense line.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.code'), 'Ταμείο');
select set_config('t.token', public.staff_sign_in(current_setting('t.maria')::uuid, '1234') ->> 'token', true);
select public.get_open_closing(current_setting('t.token'));
do $$
declare r jsonb;
begin
  r := public.submit_closing(current_setting('t.token'), current_setting('t.cfg_a')::uuid, current_setting('t.bd')::date,
        jsonb_build_object('schema', 2, 'counts', '{}'::jsonb, 'channelCents', '{}'::jsonb,
          'expenses', jsonb_build_array(jsonb_build_object('id', 'e1', 'description', 'Nice', 'cents', 1300,
            'addedBy', jsonb_build_object('kind', 'staff', 'id', current_setting('t.maria'))))), 0, 'h23-1');
  if (r ->> 'ok')::boolean is not true then raise exception 'setup submit failed: %', r; end if;
end $$;
reset role;

-- T1 D2 (joined, no session): null and a made-up token give no rows
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.expense_suggestion_data(null)) <> 0 then raise exception 'T1 null token returned rows'; end if;
  if (select count(*) from public.expense_suggestion_data('x')) <> 0 then raise exception 'T1 made-up token returned rows'; end if;
end $$;
reset role;

-- T4 D2 sending D1's live token: no rows (the token is bound to its phone)
set local role authenticated;
do $$ begin
  if (select count(*) from public.expense_suggestion_data(current_setting('t.token'))) <> 0 then
    raise exception 'T4 another phone read suggestions with D1''s token';
  end if;
end $$;
reset role;

-- T2 D1 with its live token gets the expense line
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select array_agg(description || ':' || cents) from public.expense_suggestion_data(current_setting('t.token'))) is distinct from array['Nice:1300'] then
    raise exception 'T2 wrong suggestions: %', (select array_agg(description) from public.expense_suggestion_data(current_setting('t.token')));
  end if;
  if (select business_date from public.expense_suggestion_data(current_setting('t.token'))) <> current_setting('t.bd')::date then
    raise exception 'T2 wrong date';
  end if;
end $$;

-- T3 after staff_sign_out the same token gives no rows
select public.staff_sign_out(current_setting('t.token'));
do $$ begin
  if (select count(*) from public.expense_suggestion_data(current_setting('t.token'))) <> 0 then
    raise exception 'T3 signed-out token still returned rows';
  end if;
end $$;
reset role;

-- T5 grants: anon cannot execute; the zero-argument form is gone
do $$ begin
  if has_function_privilege('anon', 'public.expense_suggestion_data(text)', 'execute') then
    raise exception 'T5 anon can execute expense_suggestion_data(text)';
  end if;
  if not has_function_privilege('authenticated', 'public.expense_suggestion_data(text)', 'execute') then
    raise exception 'T5 authenticated cannot execute expense_suggestion_data(text)';
  end if;
  if to_regprocedure('public.expense_suggestion_data()') is not null then
    raise exception 'T5 the zero-argument form still exists';
  end if;
end $$;

rollback;
