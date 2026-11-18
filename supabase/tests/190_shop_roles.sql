-- 190 — shop roles (20261117000003_shop_roles, stage 6 part 1): shop_members, invites (owner_invite_member,
-- invite_info, accept_shop_invite, owner_reissue_invite), owner_list_members / owner_set_member_role /
-- owner_remove_member, private.shop_role / require_role, my_shops, the role guards of every owner-side function and
-- table policy (manager: day, staff, phones, corrections; accountant: history only; members never the owner-only
-- ones), the realtime topic per role, removal cutting access at once, account deletion tombstones, grants.
-- One transaction, ends in ROLLBACK. Owner/member/phone calls run as `authenticated`; row checks, back-dating and
-- email confirmation changes run as postgres (the migration owner).
-- Users: owner A `…a1` (shops A1, A2), owner B `…b1` (shop B), member M `…c1` (m@test.local, confirmed),
-- member N `…c2` (n@test.local, not confirmed until T6), stranger `…51`, phones `…d1` (A1), `…d2` (A2).
-- T8 deletes M's account, so it runs after every other M call. T7b/T7c: removed member and stranger refused, a
-- withdrawn invite is invalid.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm@test.local', false, now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n@test.local', false, now(), now(), null),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now(), null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now(), null);

-- Owner A: shop A1 (ΜΑΡΙΑ, phone d1), shop A2 (ΕΛΕΝΗ, phone d2). Owner B: shop B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.a1', public.create_shop('Shop A1', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"}]}')::text, true);
select set_config('t.a2', public.create_shop('Shop A2', '{"schema":1,"maxExpenses":5,"denominations":[5000,10000],"channels":[{"id":"wolt"}]}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.a1')::uuid, 'ΜΑΡΙΑ', '123456')::text, true);
select set_config('t.eleni', public.create_staff(current_setting('t.a2')::uuid, 'ΕΛΕΝΗ', '654321')::text, true);
select set_config('t.key1', public.owner_get_join_key(current_setting('t.a1')::uuid), true);
select set_config('t.key2', public.owner_get_join_key(current_setting('t.a2')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key1'), 'Ταμείο 1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.join_shop(current_setting('t.key2'), 'Ταμείο 2');
reset role;
-- created in one transaction, the shops share now(): A1 is made the older one so the shop order is fixed
update public.shops set created_at = now() - interval '1 minute' where id = current_setting('t.a1')::uuid;
select set_config('t.cfg1', (select id::text from public.shop_configs where shop_id = current_setting('t.a1')::uuid), true);
select set_config('t.cfg2', (select id::text from public.shop_configs where shop_id = current_setting('t.a2')::uuid), true);
select set_config('t.bd1', private.business_date(current_setting('t.a1')::uuid)::text, true);
select set_config('t.bd2', private.business_date(current_setting('t.a2')::uuid)::text, true);
select set_config('t.fix', '{"schema":2,"counts":{"10000":2},"channelCents":{},"expenses":[]}', true);
-- A past staff closing in each shop (bd-5), written as the migration owner (like 180).
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
values (current_setting('t.a1')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1',
        current_setting('t.cfg1')::uuid, current_setting('t.bd1')::date - 5,
        '{"schema":2,"counts":{"10000":5},"channelCents":{"wolt":4560},"expenses":[]}', 's-a1-5'),
       (current_setting('t.a2')::uuid, current_setting('t.eleni')::uuid, '00000000-0000-0000-0000-0000000000d2',
        current_setting('t.cfg2')::uuid, current_setting('t.bd2')::date - 5,
        '{"schema":2,"counts":{"10000":5},"channelCents":{"wolt":4560},"expenses":[]}', 's-a2-5');
select set_config('t.s_a1', (select id::text from public.closings where idempotency_key = 's-a1-5'), true);
select set_config('t.s_a2', (select id::text from public.closings where idempotency_key = 's-a2-5'), true);
do $$ begin
  if (select count(*) from public.devices where shop_id = current_setting('t.a1')::uuid) <> 1
     or (select count(*) from public.devices where shop_id = current_setting('t.a2')::uuid) <> 1 then
    raise exception 'setup: phones not joined';
  end if;
end $$;

-- T1 invites
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
-- the duplicate A1 collapses; the email is trimmed and lower-cased
select set_config('t.tok_m', public.owner_invite_member(
  array[current_setting('t.a1')::uuid, current_setting('t.a2')::uuid, current_setting('t.a1')::uuid],
  'M@Test.local ', 'Μαρία Υπεύθυνη', 'manager'), true);
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
  a2 uuid := current_setting('t.a2')::uuid;
  b uuid := current_setting('t.b')::uuid;
  q text;
begin
  if current_setting('t.tok_m') !~ '^[A-HJ-NP-Z2-9]{32}$' then raise exception 'T1 token format: %', current_setting('t.tok_m'); end if;
  -- a foreign shop in the array: not_owner, nothing created
  begin
    perform public.owner_invite_member(array[a1, b], 'x@test.local', 'Χ', 'manager');
    raise exception 'T1 invite including shop B did not raise';
  exception when others then
    if sqlerrm like 'T1 %' then raise; end if;
    if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T1 shop B: expected not_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  -- bad role / name / email / no shops → bad_member
  foreach q in array array[
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'q@test.local', 'Q', 'owner'),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'q@test.local', 'Q', null),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'q@test.local', '   ', 'manager'),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'q@test.local', repeat('Α', 41), 'manager'),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'not-an-email', 'Q', 'manager'),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'q @test.local', 'Q', 'manager'),
    format('select public.owner_invite_member(%L::uuid[], %L, %L, %L)', '{}', 'q@test.local', 'Q', 'manager'),
    format('select public.owner_invite_member(null, %L, %L, %L)', 'q@test.local', 'Q', 'manager')
  ] loop
    begin
      execute q;
      raise exception 'T1 no error from: %', q;
    exception when others then
      if sqlerrm like 'T1 %' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'bad_member' then raise exception 'T1 %: expected bad_member, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  -- the same email again in A1 → already_member; the caller's own email → already_owner
  begin
    perform public.owner_invite_member(array[a1], 'm@test.local', 'Μαρία 2', 'accountant');
    raise exception 'T1 second invite of m@test.local did not raise';
  exception when others then
    if sqlerrm like 'T1 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'already_member' then raise exception 'T1 duplicate: expected already_member, got % %', sqlstate, sqlerrm; end if;
  end;
  begin
    perform public.owner_invite_member(array[a1], 'A1@Test.local', 'Εγώ', 'manager');
    raise exception 'T1 inviting the owner did not raise';
  exception when others then
    if sqlerrm like 'T1 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'already_owner' then raise exception 'T1 owner email: expected already_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  -- cap: M + 19 fillers = 20 live rows in A1; the 21st → too_many_members
  for i in 1..19 loop
    perform public.owner_invite_member(array[a1], 'f' || i || '@test.local', 'Filler ' || i, 'accountant');
  end loop;
  begin
    perform public.owner_invite_member(array[a1], 'f20@test.local', 'Filler 20', 'accountant');
    raise exception 'T1 21st live row did not raise';
  exception when others then
    if sqlerrm like 'T1 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'too_many_members' then raise exception 'T1 cap: expected too_many_members, got % %', sqlstate, sqlerrm; end if;
  end;
  -- A2 has room: the cap is per shop
  perform public.owner_invite_member(array[a2], 'f20@test.local', 'Filler 20', 'accountant');
end $$;
reset role;
do $$
declare
  tok text := current_setting('t.tok_m');
  h text := encode(extensions.digest(current_setting('t.tok_m'), 'sha256'), 'hex');
begin
  if (select count(*) from public.shop_members where invite_token_hash = h) <> 2
     or (select count(distinct invite_id) from public.shop_members where invite_token_hash = h) <> 1
     or exists (select 1 from public.shop_members where invite_token_hash = h
                 and (email <> 'm@test.local' or display_name <> 'Μαρία Υπεύθυνη' or role <> 'manager'
                      or user_id is not null or member_uid is not null or accepted_at is not null or removed_at is not null
                      or invite_expires_at <> invited_at + interval '7 days'))
     or (select array_agg(shop_id order by shop_id) from public.shop_members where invite_token_hash = h)
        <> (select array_agg(x order by x) from unnest(array[current_setting('t.a1')::uuid, current_setting('t.a2')::uuid]) x) then
    raise exception 'T1 wrong invite rows';
  end if;
  if exists (select 1 from public.shop_members m where strpos(to_jsonb(m)::text, tok) > 0) then
    raise exception 'T1 raw token stored in a column';
  end if;
  if exists (select 1 from public.shop_members where email = 'x@test.local') then raise exception 'T1 refused invite created rows'; end if;
  if exists (select 1 from public.shop_members where email = 'q@test.local') then raise exception 'T1 bad_member created rows'; end if;
  if exists (select 1 from public.shop_members where email = 'f20@test.local' and shop_id = current_setting('t.a1')::uuid) then
    raise exception 'T1 capped invite created a row';
  end if;
end $$;
-- drop the fillers so the rest of the file has only M (and later N) in A1
delete from public.shop_members where email like 'f%@test.local';
select set_config('t.m_a1', (select id::text from public.shop_members where shop_id = current_setting('t.a1')::uuid and email = 'm@test.local'), true);
select set_config('t.m_a2', (select id::text from public.shop_members where shop_id = current_setting('t.a2')::uuid and email = 'm@test.local'), true);

-- T2 invite_info: as M (both shops, role), as a phone (not_owner), a random token (invite_invalid)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare r jsonb := public.invite_info(current_setting('t.tok_m'));
begin
  if jsonb_path_query_array(r, '$.shops[*].name') <> '["Shop A1","Shop A2"]'::jsonb
     or jsonb_path_query_array(r, '$.shops[*].id') <> jsonb_build_array(current_setting('t.a1'), current_setting('t.a2'))
     or r ->> 'role' is distinct from 'manager' or r ->> 'display_name' is distinct from 'Μαρία Υπεύθυνη'
     or r ->> 'email' is distinct from 'm@test.local' or (r ->> 'expires_at')::timestamptz <= now() then
    raise exception 'T2 wrong invite_info: %', r;
  end if;
  begin
    perform public.invite_info('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    raise exception 'T2 random token did not raise';
  exception when others then
    if sqlerrm like 'T2 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'invite_invalid' then raise exception 'T2 random token: expected invite_invalid, got % %', sqlstate, sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.invite_info(current_setting('t.tok_m'));
    raise exception 'T2 a phone read an invite';
  exception when others then
    if sqlerrm like 'T2 %' then raise; end if;
    if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T2 phone: expected not_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  begin
    perform public.accept_shop_invite(current_setting('t.tok_m'));
    raise exception 'T2 a phone accepted an invite';
  exception when others then
    if sqlerrm like 'T2 %' then raise; end if;
    if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T2 phone accept: expected not_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  if private.shop_role(current_setting('t.a1')::uuid) is not null then raise exception 'T2 a phone has a shop role'; end if;
end $$;
reset role;

-- T3 accepting. Before: M has no access. N (unconfirmed, then confirmed: other email), M unconfirmed, M accepts.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.owner_list_closings(current_setting('t.a1')::uuid, null, null);
    raise exception 'T3 a pending invitee read the history';
  exception when others then
    if sqlerrm like 'T3 %' then raise; end if;
    if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T3 pending: expected not_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  if private.shop_role(current_setting('t.a1')::uuid) is not null then raise exception 'T3 a pending invitee has a role'; end if;
  if exists (select 1 from public.my_shops()) then raise exception 'T3 a pending invitee lists shops'; end if;
  if exists (select 1 from public.shops) then raise exception 'T3 a pending invitee reads shops'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  -- N is not confirmed yet: the confirmation is checked before the email match
  begin
    perform public.accept_shop_invite(current_setting('t.tok_m'));
    raise exception 'T3 unconfirmed N accepted';
  exception when others then
    if sqlerrm like 'T3 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'invite_unconfirmed' then raise exception 'T3 N unconfirmed: expected invite_unconfirmed, got % %', sqlstate, sqlerrm; end if;
  end;
end $$;
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000c2';
set local role authenticated;
do $$ begin
  begin
    perform public.accept_shop_invite(current_setting('t.tok_m'));
    raise exception 'T3 N accepted M''s invite';
  exception when others then
    if sqlerrm like 'T3 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'invite_wrong_email' then raise exception 'T3 N: expected invite_wrong_email, got % %', sqlstate, sqlerrm; end if;
  end;
end $$;
reset role;
update auth.users set email_confirmed_at = null where id = '00000000-0000-0000-0000-0000000000c2';
update auth.users set email_confirmed_at = null where id = '00000000-0000-0000-0000-0000000000c1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.accept_shop_invite(current_setting('t.tok_m'));
    raise exception 'T3 unconfirmed M accepted';
  exception when others then
    if sqlerrm like 'T3 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'invite_unconfirmed' then raise exception 'T3 M unconfirmed: expected invite_unconfirmed, got % %', sqlstate, sqlerrm; end if;
  end;
end $$;
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000c1';
set local role authenticated;
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
  a2 uuid := current_setting('t.a2')::uuid;
  v uuid[] := public.accept_shop_invite(current_setting('t.tok_m'));
begin
  if cardinality(v) <> 2 or not (v @> array[a1, a2]) then raise exception 'T3 accept returned %', v; end if;
  begin
    perform public.accept_shop_invite(current_setting('t.tok_m'));
    raise exception 'T3 the token worked twice';
  exception when others then
    if sqlerrm like 'T3 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'invite_invalid' then raise exception 'T3 reuse: expected invite_invalid, got % %', sqlstate, sqlerrm; end if;
  end;
  if private.shop_role(a1) is distinct from 'manager' or private.shop_role(a2) is distinct from 'manager'
     or private.shop_role(current_setting('t.b')::uuid) is not null then
    raise exception 'T3 wrong roles: % % %', private.shop_role(a1), private.shop_role(a2), private.shop_role(current_setting('t.b')::uuid);
  end if;
  if (select jsonb_agg(jsonb_build_array(s.id, s.name, s.role, s.my_name) order by s.ord)
        from public.my_shops() with ordinality s(id, name, role, my_name, ord))
     <> jsonb_build_array(jsonb_build_array(a1, 'Shop A1', 'manager', 'Μαρία Υπεύθυνη'),
                          jsonb_build_array(a2, 'Shop A2', 'manager', 'Μαρία Υπεύθυνη')) then
    raise exception 'T3 wrong my_shops: %', (select jsonb_agg(s) from public.my_shops() s);
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.shop_members where email = 'm@test.local'
              and (user_id is distinct from '00000000-0000-0000-0000-0000000000c1'
                   or member_uid is distinct from '00000000-0000-0000-0000-0000000000c1'
                   or accepted_at is null or invite_token_hash is not null or removed_at is not null))
     or (select count(*) from public.shop_members where email = 'm@test.local') <> 2 then
    raise exception 'T3 wrong accepted rows';
  end if;
end $$;
-- the owner's view: my_shops says «Ιδιοκτήτης»; the stranger has no role and no shop
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if (select jsonb_agg(jsonb_build_array(s.id, s.role, s.my_name) order by s.ord)
        from public.my_shops() with ordinality s(id, name, role, my_name, ord))
     <> jsonb_build_array(jsonb_build_array(current_setting('t.a1')::uuid, 'owner', 'Ιδιοκτήτης'),
                          jsonb_build_array(current_setting('t.a2')::uuid, 'owner', 'Ιδιοκτήτης')) then
    raise exception 'T3 wrong owner my_shops: %', (select jsonb_agg(s) from public.my_shops() s);
  end if;
  if private.shop_role(current_setting('t.a1')::uuid) is distinct from 'owner' then raise exception 'T3 owner role missing'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if private.shop_role(current_setting('t.a1')::uuid) is not null or exists (select 1 from public.my_shops()) then
    raise exception 'T3 the stranger has a role';
  end if;
end $$;
reset role;

-- T4 manager M on A1: every manager action works; every owner-only one is refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
  bd date := current_setting('t.bd1')::date;
  nikos uuid;
  n int;
  r jsonb;
begin
  -- table reads
  if (select count(*) from public.staff where shop_id = a1) <> 1 then raise exception 'T4 manager cannot read staff'; end if;
  if (select count(*) from public.devices where shop_id = a1) <> 1 then raise exception 'T4 manager cannot read devices'; end if;
  if (select count(*) from public.shop_configs where shop_id = a1) <> 1 then raise exception 'T4 manager cannot read configs'; end if;
  if (select count(*) from public.shops where id = a1) <> 1 then raise exception 'T4 manager cannot read the shop'; end if;
  if not private.can_use_shop_topic('shop:' || a1) then raise exception 'T4 manager refused on the shop topic'; end if;
  -- staff
  nikos := public.create_staff(a1, 'ΝΙΚΟΣ', '222222');
  perform public.set_staff_pin(nikos, '333333');
  perform public.unlock_staff(nikos);
  update public.staff set name = 'ΝΙΚΟΣ Β', active = false where id = nikos;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'T4 manager staff update changed % rows', n; end if;
  -- store link and phones
  if public.owner_get_join_key(a1) is distinct from current_setting('t.key1') then raise exception 'T4 manager got another key'; end if;
  if not exists (select 1 from public.owner_list_devices(a1) d where d.user_id = '00000000-0000-0000-0000-0000000000d1') then
    raise exception 'T4 manager device list misses d1';
  end if;
  update public.devices set label = 'Μετρητής' where user_id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'T4 manager device label update changed % rows', n; end if;
  perform public.owner_remove_device('00000000-0000-0000-0000-0000000000d1');
  if public.owner_rotate_join_key(a1) !~ '^[A-HJ-NP-Z2-9]{16}$' then raise exception 'T4 manager rotate gave no key'; end if;
  -- today's live closing
  r := public.owner_get_open_closing(a1);
  if (r ->> 'ok')::boolean is not true then raise exception 'T4 manager open closing: %', r; end if;
  r := public.owner_set_closing_field(a1, bd, 'c:wolt', '{"text":"12"}', null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T4 manager field write: %', r; end if;
  -- history and a past-day correction
  r := public.owner_list_closings(a1, null, null);
  if (r ->> 'ok')::boolean is not true then raise exception 'T4 manager list: %', r; end if;
  r := public.owner_get_closing_day(a1, bd - 5);
  if (r ->> 'ok')::boolean is not true or r #>> '{closings,0,versions,0,id}' is distinct from current_setting('t.s_a1') then
    raise exception 'T4 manager day: %', r - 'configs';
  end if;
  r := public.owner_save_closing(a1, bd - 5, current_setting('t.cfg1')::uuid, current_setting('t.fix')::jsonb,
                                 current_setting('t.s_a1')::uuid, 'm-fix-1');
  if (r ->> 'ok')::boolean is not true then raise exception 'T4 manager correction: %', r; end if;
  perform set_config('t.m_fix', r ->> 'closing_id', true);
end $$;
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
  q text;
  n int;
begin
  foreach q in array array[
    format('select public.publish_config(%L, 1, %L::jsonb)', a1, '{"schema":1}'),
    format('select public.set_closing_plan(%L, 2, %L)', a1, 'separate'),
    format('select public.set_day_change_time(%L, %L::time)', a1, '05:00'),
    format('select public.owner_delete_shop(%L, %L)', a1, 'Shop A1'),
    format('select public.owner_erase_staff(%L)', current_setting('t.maria')),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'x@test.local', 'Χ', 'manager'),
    format('select * from public.owner_list_members(%L)', a1),
    format('select public.owner_set_member_role(%L, %L)', current_setting('t.m_a1'), 'accountant'),
    format('select public.owner_remove_member(%L)', current_setting('t.m_a1')),
    format('select public.owner_reissue_invite(%L)', current_setting('t.m_a1'))
  ] loop
    begin
      execute q;
      raise exception 'T4 manager ran an owner-only call: %', q;
    exception when others then
      if sqlerrm like 'T4 %' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T4 %: expected not_owner, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  update public.shops set name = 'Hack' where id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T4 manager renamed the shop'; end if;
  update public.closings set voided_at = now() where shop_id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T4 manager voided closings'; end if;
  if exists (select 1 from public.closings where shop_id = a1) then raise exception 'T4 manager reads closings'; end if;
end $$;
reset role;
do $$ begin
  if (select corrected_by from public.closings where id = current_setting('t.m_fix')::uuid) is distinct from '00000000-0000-0000-0000-0000000000c1'
     or (select corrects_closing_id from public.closings where id = current_setting('t.m_fix')::uuid) is distinct from current_setting('t.s_a1')::uuid then
    raise exception 'T4 correction not recorded as M''s';
  end if;
  if (select name from public.shops where id = current_setting('t.a1')::uuid) <> 'Shop A1'
     or exists (select 1 from public.closings where shop_id = current_setting('t.a1')::uuid and voided_at is not null)
     or (select erased_at from public.staff where id = current_setting('t.maria')::uuid) is not null
     or (select count(*) from public.shop_configs where shop_id = current_setting('t.a1')::uuid) <> 1
     or (select closings_per_day from public.shops where id = current_setting('t.a1')::uuid) <> 1
     or (select role from public.shop_members where id = current_setting('t.m_a1')::uuid) <> 'manager'
     or (select removed_at from public.shop_members where id = current_setting('t.m_a1')::uuid) is not null then
    raise exception 'T4 a refused call changed something';
  end if;
  if exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'T4 d1 not removed'; end if;
  if (select key from public.shop_join_keys where shop_id = current_setting('t.a1')::uuid) = current_setting('t.key1') then
    raise exception 'T4 key not rotated';
  end if;
end $$;

-- T5 accountant: A makes M an accountant on A2. On A2 M only reads the history and the shop row.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_set_member_role(current_setting('t.m_a2')::uuid, 'accountant');
do $$ begin
  begin
    perform public.owner_set_member_role(current_setting('t.m_a2')::uuid, 'owner');
    raise exception 'T5 role owner accepted';
  exception when others then
    if sqlerrm like 'T5 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'bad_member' then raise exception 'T5 bad role: expected bad_member, got % %', sqlstate, sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  a2 uuid := current_setting('t.a2')::uuid;
  bd date := current_setting('t.bd2')::date;
  r jsonb;
begin
  if private.shop_role(a2) is distinct from 'accountant' or private.shop_role(current_setting('t.a1')::uuid) is distinct from 'manager' then
    raise exception 'T5 wrong roles';
  end if;
  r := public.owner_list_closings(a2, null, null);
  if (r ->> 'ok')::boolean is not true or jsonb_array_length(r -> 'days') <> 1 then raise exception 'T5 accountant list: %', r; end if;
  r := public.owner_get_closing_day(a2, bd - 5);
  if (r ->> 'ok')::boolean is not true or r #>> '{closings,0,versions,0,id}' is distinct from current_setting('t.s_a2') then
    raise exception 'T5 accountant day: %', r - 'configs';
  end if;
  if (select count(*) from public.shops where id = a2) <> 1 then raise exception 'T5 accountant cannot read the shop'; end if;
  if private.can_use_shop_topic('shop:' || a2) then raise exception 'T5 accountant allowed on the shop topic'; end if;
end $$;
do $$
declare
  a2 uuid := current_setting('t.a2')::uuid;
  bd date := current_setting('t.bd2')::date;
  q text;
  n int;
begin
  foreach q in array array[
    format('select public.create_staff(%L, %L, %L)', a2, 'ΚΩΣΤΑΣ', '444444'),
    format('select public.set_staff_pin(%L, %L)', current_setting('t.eleni'), '555555'),
    format('select public.unlock_staff(%L)', current_setting('t.eleni')),
    format('select public.owner_get_join_key(%L)', a2),
    format('select public.owner_rotate_join_key(%L)', a2),
    format('select * from public.owner_list_devices(%L)', a2),
    format('select public.owner_remove_device(%L)', '00000000-0000-0000-0000-0000000000d2'),
    format('select public.owner_get_open_closing(%L)', a2),
    format('select public.owner_set_closing_field(%L, %L::date, %L, %L::jsonb, null)', a2, bd, 'c:wolt', '{"text":"1"}'),
    format('select public.owner_save_closing(%L, %L::date, %L::uuid, %L::jsonb, %L::uuid, %L)', a2, bd - 5,
           current_setting('t.cfg2'), current_setting('t.fix'), current_setting('t.s_a2'), 'acc-fix-1'),
    format('select public.publish_config(%L, 1, %L::jsonb)', a2, '{"schema":1}'),
    format('select public.set_closing_plan(%L, 2, %L)', a2, 'separate'),
    format('select public.set_day_change_time(%L, %L::time)', a2, '05:00'),
    format('select public.owner_delete_shop(%L, %L)', a2, 'Shop A2'),
    format('select public.owner_erase_staff(%L)', current_setting('t.eleni')),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a2, 'x@test.local', 'Χ', 'manager'),
    format('select * from public.owner_list_members(%L)', a2),
    format('select public.owner_set_member_role(%L, %L)', current_setting('t.m_a2'), 'manager'),
    format('select public.owner_remove_member(%L)', current_setting('t.m_a2')),
    format('select public.owner_reissue_invite(%L)', current_setting('t.m_a2'))
  ] loop
    begin
      execute q;
      raise exception 'T5 accountant ran: %', q;
    exception when others then
      if sqlerrm like 'T5 %' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T5 %: expected not_owner, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  update public.staff set name = 'Hack', active = false where shop_id = a2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T5 accountant updated staff'; end if;
  update public.devices set label = 'Hack' where shop_id = a2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T5 accountant updated devices'; end if;
  update public.shops set name = 'Hack' where id = a2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T5 accountant renamed the shop'; end if;
  update public.closings set voided_at = now() where shop_id = a2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T5 accountant voided closings'; end if;
  if exists (select 1 from public.staff where shop_id = a2) then raise exception 'T5 accountant reads staff'; end if;
  if exists (select 1 from public.devices where shop_id = a2) then raise exception 'T5 accountant reads devices'; end if;
  if exists (select 1 from public.shop_configs where shop_id = a2) then raise exception 'T5 accountant reads configs'; end if;
  if exists (select 1 from public.closings where shop_id = a2) then raise exception 'T5 accountant reads closings'; end if;
end $$;
reset role;
do $$ begin
  if (select name from public.staff where id = current_setting('t.eleni')::uuid) <> 'ΕΛΕΝΗ'
     or (select count(*) from public.staff where shop_id = current_setting('t.a2')::uuid) <> 1
     or (select key from public.shop_join_keys where shop_id = current_setting('t.a2')::uuid) <> current_setting('t.key2')
     or (select label from public.devices where user_id = '00000000-0000-0000-0000-0000000000d2') <> 'Ταμείο 2'
     or (select name from public.shops where id = current_setting('t.a2')::uuid) <> 'Shop A2'
     or (select count(*) from public.closings where shop_id = current_setting('t.a2')::uuid) <> 1
     or exists (select 1 from public.open_closings where shop_id = current_setting('t.a2')::uuid)
     or (select role from public.shop_members where id = current_setting('t.m_a2')::uuid) <> 'accountant' then
    raise exception 'T5 a refused accountant call changed something';
  end if;
end $$;

-- T6 expiry and reissue: an invite for N, back-dated past its expiry.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.tok_n', public.owner_invite_member(array[current_setting('t.a1')::uuid], 'n@test.local', 'Νίκη Λογίστρια', 'accountant'), true);
do $$ begin
  if (select m.status from public.owner_list_members(current_setting('t.a1')::uuid) m where m.email = 'n@test.local') is distinct from 'pending' then
    raise exception 'T6 new invite not pending';
  end if;
end $$;
reset role;
update public.shop_members set invited_at = now() - interval '8 days', invite_expires_at = now() - interval '1 day'
 where email = 'n@test.local';
select set_config('t.n_a1', (select id::text from public.shop_members where email = 'n@test.local'), true);
select set_config('t.n_inv', (select invite_id::text from public.shop_members where email = 'n@test.local'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare q text;
begin
  foreach q in array array[
    format('select public.invite_info(%L)', current_setting('t.tok_n')),
    format('select public.accept_shop_invite(%L)', current_setting('t.tok_n'))
  ] loop
    begin
      execute q;
      raise exception 'T6 expired invite used: %', q;
    exception when others then
      if sqlerrm like 'T6 %' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'invite_expired' then raise exception 'T6 %: expected invite_expired, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  l jsonb := (select jsonb_agg(jsonb_build_array(m.id, m.email, m.display_name, m.role, m.status) order by m.email)
                from public.owner_list_members(current_setting('t.a1')::uuid) m);
begin
  if l <> jsonb_build_array(
            jsonb_build_array(current_setting('t.m_a1')::uuid, 'm@test.local', 'Μαρία Υπεύθυνη', 'manager', 'active'),
            jsonb_build_array(current_setting('t.n_a1')::uuid, 'n@test.local', 'Νίκη Λογίστρια', 'accountant', 'expired')) then
    raise exception 'T6 wrong member list: %', l;
  end if;
  -- not yet accepted rows come first
  if (select m.email from public.owner_list_members(current_setting('t.a1')::uuid) m limit 1) <> 'n@test.local' then
    raise exception 'T6 pending/expired rows not listed first';
  end if;
  -- an accepted row has no link to reissue
  begin
    perform public.owner_reissue_invite(current_setting('t.m_a1')::uuid);
    raise exception 'T6 reissued an accepted row';
  exception when others then
    if sqlerrm like 'T6 %' then raise; end if;
    if sqlstate <> '22023' or sqlerrm <> 'invite_invalid' then raise exception 'T6 accepted reissue: expected invite_invalid, got % %', sqlstate, sqlerrm; end if;
  end;
  perform set_config('t.tok_n2', public.owner_reissue_invite(current_setting('t.n_a1')::uuid), true);
  if current_setting('t.tok_n2') !~ '^[A-HJ-NP-Z2-9]{32}$' or current_setting('t.tok_n2') = current_setting('t.tok_n') then
    raise exception 'T6 bad reissued token';
  end if;
  if (select m.status from public.owner_list_members(current_setting('t.a1')::uuid) m where m.email = 'n@test.local') is distinct from 'pending' then
    raise exception 'T6 reissued invite not pending';
  end if;
end $$;
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000c2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  q text;
  v uuid[];
begin
  foreach q in array array[
    format('select public.invite_info(%L)', current_setting('t.tok_n')),
    format('select public.accept_shop_invite(%L)', current_setting('t.tok_n'))
  ] loop
    begin
      execute q;
      raise exception 'T6 old token used: %', q;
    exception when others then
      if sqlerrm like 'T6 %' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'invite_invalid' then raise exception 'T6 %: expected invite_invalid, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  v := public.accept_shop_invite(current_setting('t.tok_n2'));
  if v <> array[current_setting('t.a1')::uuid] then raise exception 'T6 N accept returned %', v; end if;
  if private.shop_role(current_setting('t.a1')::uuid) is distinct from 'accountant' then raise exception 'T6 N is not an accountant'; end if;
end $$;
reset role;
do $$ begin
  if (select invite_id from public.shop_members where id = current_setting('t.n_a1')::uuid) = current_setting('t.n_inv')::uuid
     or (select invite_expires_at from public.shop_members where id = current_setting('t.n_a1')::uuid) <= now() then
    raise exception 'T6 reissue did not reset the invite';
  end if;
end $$;

-- T7 removal: A removes M from A1. Access ends at once; the row keeps the name and member_uid; M can come back.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_remove_member(current_setting('t.m_a1')::uuid);
do $$ begin
  begin
    perform public.owner_remove_member(current_setting('t.m_a1')::uuid);
    raise exception 'T7 removed a removed row';
  exception when others then
    if sqlerrm like 'T7 %' then raise; end if;
    if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T7 second removal: expected not_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  if exists (select 1 from public.owner_list_members(current_setting('t.a1')::uuid) m where m.id = current_setting('t.m_a1')::uuid) then
    raise exception 'T7 removed row still listed';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
begin
  begin
    perform public.owner_set_closing_field(a1, current_setting('t.bd1')::date, 'c:wolt', '{"text":"99"}', null);
    raise exception 'T7 removed member wrote a field';
  exception when others then
    if sqlerrm like 'T7 %' then raise; end if;
    if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T7 field write: expected not_owner, got % %', sqlstate, sqlerrm; end if;
  end;
  if private.can_use_shop_topic('shop:' || a1) then raise exception 'T7 removed member allowed on the shop topic'; end if;
  if private.shop_role(a1) is not null then raise exception 'T7 removed member keeps a role'; end if;
  if exists (select 1 from public.staff where shop_id = a1) then raise exception 'T7 removed member reads staff'; end if;
  if (select jsonb_agg(jsonb_build_array(s.id, s.role)) from public.my_shops() s)
     <> jsonb_build_array(jsonb_build_array(current_setting('t.a2')::uuid, 'accountant')) then
    raise exception 'T7 wrong my_shops after removal: %', (select jsonb_agg(s) from public.my_shops() s);
  end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.shop_members where id = current_setting('t.m_a1')::uuid
                  and removed_at is not null and member_uid = '00000000-0000-0000-0000-0000000000c1'
                  and display_name = 'Μαρία Υπεύθυνη') then
    raise exception 'T7 removed row lost its name or member_uid';
  end if;
end $$;
-- T7b every call of T4 (allowed and owner-only) and T5 on A1 is refused for the removed M and for the stranger …51;
-- nothing changes. (A1 has no phone left after T4: owner_remove_device uses d2 of A2, where M is only an accountant.)
select set_config('t.key1b', (select key from public.shop_join_keys where shop_id = current_setting('t.a1')::uuid), true);
select set_config('t.cl_a1', (select count(*)::text from public.closings where shop_id = current_setting('t.a1')::uuid), true);
select set_config('t.st_a1', (select count(*)::text from public.staff where shop_id = current_setting('t.a1')::uuid), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
  bd date := current_setting('t.bd1')::date;
  q text;
  n int;
begin
  foreach q in array array[
    format('select public.create_staff(%L, %L, %L)', a1, 'ΚΩΣΤΑΣ', '444444'),
    format('select public.set_staff_pin(%L, %L)', current_setting('t.maria'), '555555'),
    format('select public.unlock_staff(%L)', current_setting('t.maria')),
    format('select public.owner_get_join_key(%L)', a1),
    format('select public.owner_rotate_join_key(%L)', a1),
    format('select * from public.owner_list_devices(%L)', a1),
    format('select public.owner_remove_device(%L)', '00000000-0000-0000-0000-0000000000d2'),
    format('select public.owner_get_open_closing(%L)', a1),
    format('select public.owner_set_closing_field(%L, %L::date, %L, %L::jsonb, null)', a1, bd, 'c:wolt', '{"text":"99"}'),
    format('select public.owner_list_closings(%L, null, null)', a1),
    format('select public.owner_get_closing_day(%L, %L::date)', a1, bd - 5),
    format('select public.owner_save_closing(%L, %L::date, %L::uuid, %L::jsonb, %L::uuid, %L)', a1, bd - 5,
           current_setting('t.cfg1'), current_setting('t.fix'), current_setting('t.m_fix'), 'rm-fix-1'),
    format('select public.publish_config(%L, 1, %L::jsonb)', a1, '{"schema":1}'),
    format('select public.set_closing_plan(%L, 2, %L)', a1, 'separate'),
    format('select public.set_day_change_time(%L, %L::time)', a1, '05:00'),
    format('select public.owner_delete_shop(%L, %L)', a1, 'Shop A1'),
    format('select public.owner_erase_staff(%L)', current_setting('t.maria')),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'x@test.local', 'Χ', 'manager'),
    format('select * from public.owner_list_members(%L)', a1),
    format('select public.owner_set_member_role(%L, %L)', current_setting('t.n_a1'), 'manager'),
    format('select public.owner_remove_member(%L)', current_setting('t.n_a1')),
    format('select public.owner_reissue_invite(%L)', current_setting('t.n_a1'))
  ] loop
    begin
      execute q;
      raise exception 'T7 removed M ran: %', q;
    exception when others then
      if sqlerrm like 'T7 %' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T7 removed M %: expected not_owner, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  if private.can_use_shop_topic('shop:' || a1) then raise exception 'T7 removed M allowed on the shop topic'; end if;
  update public.staff set name = 'Hack', active = false where shop_id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T7 removed M updated staff'; end if;
  update public.devices set label = 'Hack' where shop_id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T7 removed M updated devices'; end if;
  update public.shops set name = 'Hack' where id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T7 removed M renamed the shop'; end if;
  if exists (select 1 from public.staff where shop_id = a1) or exists (select 1 from public.devices where shop_id = a1)
     or exists (select 1 from public.shop_configs where shop_id = a1) or exists (select 1 from public.closings where shop_id = a1)
     or exists (select 1 from public.shops where id = a1) then
    raise exception 'T7 removed M reads a table row of A1';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare
  a1 uuid := current_setting('t.a1')::uuid;
  bd date := current_setting('t.bd1')::date;
  q text;
  n int;
begin
  foreach q in array array[
    format('select public.create_staff(%L, %L, %L)', a1, 'ΚΩΣΤΑΣ', '444444'),
    format('select public.set_staff_pin(%L, %L)', current_setting('t.maria'), '555555'),
    format('select public.unlock_staff(%L)', current_setting('t.maria')),
    format('select public.owner_get_join_key(%L)', a1),
    format('select public.owner_rotate_join_key(%L)', a1),
    format('select * from public.owner_list_devices(%L)', a1),
    format('select public.owner_remove_device(%L)', '00000000-0000-0000-0000-0000000000d2'),
    format('select public.owner_get_open_closing(%L)', a1),
    format('select public.owner_set_closing_field(%L, %L::date, %L, %L::jsonb, null)', a1, bd, 'c:wolt', '{"text":"99"}'),
    format('select public.owner_list_closings(%L, null, null)', a1),
    format('select public.owner_get_closing_day(%L, %L::date)', a1, bd - 5),
    format('select public.owner_save_closing(%L, %L::date, %L::uuid, %L::jsonb, %L::uuid, %L)', a1, bd - 5,
           current_setting('t.cfg1'), current_setting('t.fix'), current_setting('t.m_fix'), 'st-fix-1'),
    format('select public.publish_config(%L, 1, %L::jsonb)', a1, '{"schema":1}'),
    format('select public.set_closing_plan(%L, 2, %L)', a1, 'separate'),
    format('select public.set_day_change_time(%L, %L::time)', a1, '05:00'),
    format('select public.owner_delete_shop(%L, %L)', a1, 'Shop A1'),
    format('select public.owner_erase_staff(%L)', current_setting('t.maria')),
    format('select public.owner_invite_member(array[%L]::uuid[], %L, %L, %L)', a1, 'x@test.local', 'Χ', 'manager'),
    format('select * from public.owner_list_members(%L)', a1),
    format('select public.owner_set_member_role(%L, %L)', current_setting('t.n_a1'), 'manager'),
    format('select public.owner_remove_member(%L)', current_setting('t.n_a1')),
    format('select public.owner_reissue_invite(%L)', current_setting('t.n_a1'))
  ] loop
    begin
      execute q;
      raise exception 'T7 stranger ran: %', q;
    exception when others then
      if sqlerrm like 'T7 %' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_owner' then raise exception 'T7 stranger %: expected not_owner, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  if private.can_use_shop_topic('shop:' || a1) then raise exception 'T7 stranger allowed on the shop topic'; end if;
  update public.staff set name = 'Hack', active = false where shop_id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T7 stranger updated staff'; end if;
  update public.devices set label = 'Hack' where shop_id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T7 stranger updated devices'; end if;
  update public.shops set name = 'Hack' where id = a1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T7 stranger renamed the shop'; end if;
  if exists (select 1 from public.staff where shop_id = a1) or exists (select 1 from public.devices where shop_id = a1)
     or exists (select 1 from public.shop_configs where shop_id = a1) or exists (select 1 from public.closings where shop_id = a1)
     or exists (select 1 from public.shops where id = a1) then
    raise exception 'T7 stranger reads a table row of A1';
  end if;
end $$;
reset role;
do $$ begin
  if (select key from public.shop_join_keys where shop_id = current_setting('t.a1')::uuid) <> current_setting('t.key1b')
     or (select count(*) from public.closings where shop_id = current_setting('t.a1')::uuid) <> current_setting('t.cl_a1')::bigint
     or (select count(*) from public.staff where shop_id = current_setting('t.a1')::uuid) <> current_setting('t.st_a1')::bigint
     or exists (select 1 from public.staff where shop_id = current_setting('t.a1')::uuid and (name = 'Hack' or erased_at is not null))
     or (select name from public.shops where id = current_setting('t.a1')::uuid) <> 'Shop A1'
     or (select count(*) from public.shop_configs where shop_id = current_setting('t.a1')::uuid) <> 1
     or (select closings_per_day from public.shops where id = current_setting('t.a1')::uuid) <> 1
     or not exists (select 1 from public.devices where user_id = '00000000-0000-0000-0000-0000000000d2')
     or (select role from public.shop_members where id = current_setting('t.n_a1')::uuid) <> 'accountant'
     or (select removed_at from public.shop_members where id = current_setting('t.n_a1')::uuid) is not null
     or exists (select 1 from public.shop_members where shop_id = current_setting('t.a1')::uuid and email = 'x@test.local')
     or exists (select 1 from public.open_closing_fields f join public.open_closings o on o.id = f.open_closing_id
                 where o.shop_id = current_setting('t.a1')::uuid and f.key = 'c:wolt' and f.value ->> 'text' = '99') then
    raise exception 'T7b a refused call changed something';
  end if;
end $$;

-- T7c a withdrawn invite (removed while pending): invite_info and accept_shop_invite answer invite_invalid.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.tok_w', public.owner_invite_member(array[current_setting('t.a1')::uuid], 's1@test.local', 'Βασίλης', 'accountant'), true);
reset role;
select set_config('t.w_a1', (select id::text from public.shop_members where shop_id = current_setting('t.a1')::uuid and email = 's1@test.local' and removed_at is null), true);
set local role authenticated;
select public.owner_remove_member(current_setting('t.w_a1')::uuid);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare q text;
begin
  foreach q in array array[
    format('select public.invite_info(%L)', current_setting('t.tok_w')),
    format('select public.accept_shop_invite(%L)', current_setting('t.tok_w'))
  ] loop
    begin
      execute q;
      raise exception 'T7c withdrawn invite used: %', q;
    exception when others then
      if sqlerrm like 'T7c %' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'invite_invalid' then raise exception 'T7c %: expected invite_invalid, got % %', q, sqlstate, sqlerrm; end if;
    end;
  end loop;
  if private.shop_role(current_setting('t.a1')::uuid) is not null then raise exception 'T7c the withdrawn invitee has a role'; end if;
end $$;
reset role;
do $$ begin
  if (select user_id from public.shop_members where id = current_setting('t.w_a1')::uuid) is not null
     or (select accepted_at from public.shop_members where id = current_setting('t.w_a1')::uuid) is not null then
    raise exception 'T7c withdrawn row was accepted';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.tok_m2', public.owner_invite_member(array[current_setting('t.a1')::uuid], 'm@test.local', 'Μαρία Ξανά', 'manager'), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$
declare v uuid[] := public.accept_shop_invite(current_setting('t.tok_m2'));
begin
  if v <> array[current_setting('t.a1')::uuid] then raise exception 'T7 re-invite accept returned %', v; end if;
  if private.shop_role(current_setting('t.a1')::uuid) is distinct from 'manager' then raise exception 'T7 re-invited M is not a manager'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.shop_members
       where shop_id = current_setting('t.a1')::uuid and member_uid = '00000000-0000-0000-0000-0000000000c1') <> 2 then
    raise exception 'T7 re-invite did not make a new row';
  end if;
end $$;

-- T9 grants (before T8, which deletes M)
do $$
declare f text;
begin
  foreach f in array array['public.owner_invite_member(uuid[],text,text,text)', 'public.owner_list_members(uuid)',
                           'public.owner_set_member_role(uuid,text)', 'public.owner_remove_member(uuid)',
                           'public.owner_reissue_invite(uuid)', 'public.invite_info(text)',
                           'public.accept_shop_invite(text)', 'public.my_shops()'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'T9 anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'T9 authenticated cannot execute %', f; end if;
  end loop;
  foreach f in array array['private.shop_role(uuid)', 'private.require_role(uuid,text[])', 'private.new_invite_token()'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'T9 anon can execute %', f; end if;
  end loop;
  if not has_function_privilege('authenticated', 'private.shop_role(uuid)', 'execute') then
    raise exception 'T9 authenticated cannot execute private.shop_role (policies need it)';
  end if;
  if has_function_privilege('authenticated', 'private.require_role(uuid,text[])', 'execute')
     or has_function_privilege('authenticated', 'private.new_invite_token()', 'execute') then
    raise exception 'T9 authenticated can execute a private role helper';
  end if;
  if has_table_privilege('anon', 'public.shop_members', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.shop_members', 'select, insert, update, delete')
     or has_any_column_privilege('authenticated', 'public.shop_members', 'select, insert, update') then
    raise exception 'T9 a client role has a privilege on shop_members';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.shop_members'::regclass) then
    raise exception 'T9 RLS off on shop_members';
  end if;
  -- every new function is security definer (except the token generator, which reads nothing) and pins search_path
  foreach f in array array['public.owner_invite_member(uuid[],text,text,text)', 'public.owner_list_members(uuid)',
                           'public.owner_set_member_role(uuid,text)', 'public.owner_remove_member(uuid)',
                           'public.owner_reissue_invite(uuid)', 'public.invite_info(text)',
                           'public.accept_shop_invite(text)', 'public.my_shops()',
                           'private.shop_role(uuid)', 'private.require_role(uuid,text[])'] loop
    if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'T9 % is not security definer', f;
    end if;
  end loop;
  foreach f in array array['public.owner_invite_member(uuid[],text,text,text)', 'public.owner_list_members(uuid)',
                           'public.owner_set_member_role(uuid,text)', 'public.owner_remove_member(uuid)',
                           'public.owner_reissue_invite(uuid)', 'public.invite_info(text)',
                           'public.accept_shop_invite(text)', 'public.my_shops()',
                           'private.shop_role(uuid)', 'private.require_role(uuid,text[])', 'private.new_invite_token()'] loop
    if not exists (select 1 from pg_proc p, unnest(p.proconfig) c where p.oid = f::regprocedure and c like 'search_path=%') then
      raise exception 'T9 % has no search_path in proconfig', f;
    end if;
  end loop;
  -- the re-created owner-side functions keep their grants
  foreach f in array array['public.create_staff(uuid,text,text)', 'public.owner_save_closing(uuid,date,uuid,jsonb,uuid,text,bigint,int)',
                           'public.owner_list_closings(uuid,date,date)', 'public.owner_get_closing_day(uuid,date)',
                           'public.owner_set_closing_field(uuid,date,text,jsonb,int,int)', 'public.owner_delete_account()'] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'T9 wrong grants on %', f;
    end if;
  end loop;
end $$;

-- T8 (last M call) M deletes the account: every row of M becomes a tombstone; the shops stay.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.owner_delete_account();
reset role;
do $$
declare
  ph text := 'Διαγραμμένος συνεργάτης ' || left(replace('00000000-0000-0000-0000-0000000000c1', '-', ''), 8);
begin
  if (select count(*) from public.shop_members where member_uid = '00000000-0000-0000-0000-0000000000c1') <> 3 then
    raise exception 'T8 M rows missing';
  end if;
  if exists (select 1 from public.shop_members where member_uid = '00000000-0000-0000-0000-0000000000c1'
              and (display_name <> ph or email is not null or removed_at is null or user_id is not null)) then
    raise exception 'T8 M rows not tombstoned';
  end if;
  if exists (select 1 from public.shop_members where email = 'm@test.local' or display_name like 'Μαρία%') then
    raise exception 'T8 M''s email or name left in a row';
  end if;
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000c1') then raise exception 'T8 M auth user left'; end if;
  if (select count(*) from public.shops where id in (current_setting('t.a1')::uuid, current_setting('t.a2')::uuid)) <> 2 then
    raise exception 'T8 a shop was deleted';
  end if;
  if (select display_name from public.shop_members where id = current_setting('t.n_a1')::uuid) <> 'Νίκη Λογίστρια'
     or (select user_id from public.shop_members where id = current_setting('t.n_a1')::uuid) is distinct from '00000000-0000-0000-0000-0000000000c2' then
    raise exception 'T8 N''s row changed';
  end if;
  -- M's correction stays in history (closings rows are never deleted by an account deletion of a member)
  if not exists (select 1 from public.closings where id = current_setting('t.m_fix')::uuid) then raise exception 'T8 M''s correction deleted'; end if;
end $$;

rollback;
