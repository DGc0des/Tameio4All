-- Stage 6, part 1: shop roles. Next to the owner (shops.owner_id, never a shop_members row) a shop can have
-- members with the role 'manager' (runs the day: «Σήμερα», corrections, staff, phones) or 'accountant' (reads the
-- history). The owner invites a person by email; the person accepts with their own account. The database enforces
-- every role: each owner-side function guards with private.require_role, each table policy with private.shop_role.
-- Unauthorized answers not_owner (42501), the same as "doesn't exist", so a probe cannot tell them apart.
-- Function → role map (design 2026-11-17-shop-roles-design.md):
--   owner only: publish_config, set_closing_plan, set_day_change_time, owner_delete_shop, owner_erase_staff, the
--     shops update policy, the closings read/update policies, and the member functions below (unchanged / new);
--   owner + manager: create_staff, set_staff_pin, unlock_staff, staff/devices policies, store link and devices,
--     owner_get_open_closing, owner_set_closing_field, owner_save_closing, the shop:<id> realtime topic;
--   owner + manager + accountant: owner_list_closings, owner_get_closing_day, the shops read policy.
-- Names in history/broadcasts are not changed here (part 2).

-- 1. Members. One row per (shop, invited person). A multi-shop invite is several rows sharing invite_id and one
--    token hash. member_uid is the permanent attribution key (no foreign key, never cleared); user_id is the access
--    link (null until accepted, null again when the auth user is deleted). Removal sets removed_at; the row stays.
create table public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  invite_id uuid not null,
  email text,
  display_name text not null check (char_length(display_name) between 1 and 40 and display_name = btrim(display_name)),
  role text not null check (role in ('manager', 'accountant')),
  invite_token_hash text,
  invited_at timestamptz not null default now(),
  invite_expires_at timestamptz not null,
  user_id uuid references auth.users (id) on delete set null,
  member_uid uuid,
  accepted_at timestamptz,
  removed_at timestamptz
);
create unique index shop_members_shop_email_uidx on public.shop_members (shop_id, email) where removed_at is null;
create unique index shop_members_shop_user_uidx on public.shop_members (shop_id, user_id)
  where removed_at is null and user_id is not null;
create index shop_members_token_idx on public.shop_members (invite_token_hash);
create index shop_members_member_uid_idx on public.shop_members (member_uid);

alter table public.shop_members enable row level security;
revoke all on public.shop_members from public, anon, authenticated;

-- 2. Role helpers.
-- The caller's role in a shop: 'owner' | 'manager' | 'accountant' | null (no caller, anonymous, or none).
-- Executable by `authenticated`: the table policies call it (like private.is_shop_owner); it only answers about the
-- caller's own access.
create function private.shop_role(p_shop uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then null
    when exists (select 1 from public.shops s where s.id = p_shop and s.owner_id = (select auth.uid())) then 'owner'
    else (select m.role from public.shop_members m
           where m.shop_id = p_shop and m.user_id = (select auth.uid())
             and m.removed_at is null and m.accepted_at is not null)
  end;
$$;
revoke all on function private.shop_role(uuid) from public, anon;
grant execute on function private.shop_role(uuid) to authenticated;

-- Raises not_owner unless the caller's role in the shop is one of p_roles.
create function private.require_role(p_shop uuid, p_roles text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(private.shop_role(p_shop) = any(p_roles), false) is not true then
    raise exception 'not_owner' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_role(uuid, text[]) from public, anon, authenticated;

-- 32 characters of the join-key alphabet (32 symbols: byte % 32 is unbiased) from 32 random bytes.
-- Cross-file invariant: the format ^[A-HJ-NP-Z2-9]{32}$ is checked by the client's invite route parser.
create function private.new_invite_token() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(32);
  v_token text := '';
begin
  for i in 0..31 loop
    v_token := v_token || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_token;
end $$;
revoke all on function private.new_invite_token() from public, anon, authenticated;

-- 3. Member functions (owner only).
-- Invite one person to one or more of the caller's shops. Returns the raw token once; only its sha256 is stored.
-- Every shop must be the caller's (not_owner, nothing created). Shops are locked in id order, then each shop's cap
-- (20 live rows: pending + accepted) and email uniqueness are checked.
create function public.owner_invite_member(p_shops uuid[], p_email text, p_name text, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_shops uuid[];
  v_shop uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_token text;
  v_hash text;
  v_invite uuid := gen_random_uuid();
  v_at timestamptz := now();
begin
  select array_agg(distinct s order by s) into v_shops from unnest(p_shops) s;
  if v_shops is null then
    raise exception 'bad_member' using errcode = '22023';
  end if;
  foreach v_shop in array v_shops loop
    perform private.require_owner(v_shop);
  end loop;
  if p_role is null or p_role not in ('manager', 'accountant')
     or char_length(v_name) not between 1 and 40
     or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_member' using errcode = '22023';
  end if;
  if v_email = lower(btrim((select u.email from auth.users u where u.id = v_uid))) then
    raise exception 'already_owner' using errcode = '22023';
  end if;

  -- no key update (like set_closing_plan): only shop_members rows change
  perform 1 from public.shops where id = any(v_shops) order by id for no key update;
  foreach v_shop in array v_shops loop
    if (select count(*) from public.shop_members m where m.shop_id = v_shop and m.removed_at is null) >= 20 then
      raise exception 'too_many_members' using errcode = '22023';
    end if;
    if exists (select 1 from public.shop_members m
                where m.shop_id = v_shop and m.removed_at is null and m.email = v_email) then
      raise exception 'already_member' using errcode = '22023';
    end if;
  end loop;

  v_token := private.new_invite_token();
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  insert into public.shop_members (shop_id, invite_id, email, display_name, role, invite_token_hash, invited_at,
                                   invite_expires_at)
  select s, v_invite, v_email, v_name, p_role, v_hash, v_at, v_at + interval '7 days'
    from unnest(v_shops) s;
  return v_token;
end $$;

-- The shop's live member rows (not removed). status: 'active' (accepted), 'expired' (pending past its expiry) or
-- 'pending'. Not yet accepted rows first, then by name.
create function public.owner_list_members(p_shop uuid)
returns table (id uuid, email text, display_name text, role text, status text, invite_expires_at timestamptz,
               accepted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_owner(p_shop);
  return query
    select m.id, m.email, m.display_name, m.role,
           case when m.accepted_at is not null then 'active'
                when m.invite_expires_at <= now() then 'expired'
                else 'pending' end,
           m.invite_expires_at, m.accepted_at
      from public.shop_members m
     where m.shop_id = p_shop and m.removed_at is null
     order by (m.accepted_at is not null), m.display_name, m.id;
end $$;

-- Change a member's role in that row's shop. Missing, removed and foreign rows all answer not_owner.
create function public.owner_set_member_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select m.shop_id into v_shop from public.shop_members m where m.id = p_member and m.removed_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  if p_role is null or p_role not in ('manager', 'accountant') then
    raise exception 'bad_member' using errcode = '22023';
  end if;
  update public.shop_members set role = p_role where id = p_member;
end $$;

-- Remove a member (or withdraw a pending invite) from that row's shop. Access ends at once: every function and
-- policy re-checks for a live row. The row keeps member_uid and display_name for history.
create function public.owner_remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select m.shop_id into v_shop from public.shop_members m where m.id = p_member and m.removed_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  update public.shop_members set removed_at = now(), invite_token_hash = null where id = p_member;
end $$;

-- A new link for a pending or expired invite row: new token, new invite_id (the row leaves its old multi-shop
-- invite), expiry now + 7 days. An accepted row answers invite_invalid.
create function public.owner_reissue_invite(p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_row public.shop_members;
  v_token text;
begin
  select m.shop_id into v_shop from public.shop_members m where m.id = p_member and m.removed_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  select * into v_row from public.shop_members m where m.id = p_member and m.removed_at is null for update;
  if v_row.id is null or v_row.accepted_at is not null then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  v_token := private.new_invite_token();
  update public.shop_members
     set invite_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'), invite_id = gen_random_uuid(),
         invite_expires_at = now() + interval '7 days'
   where id = p_member;
  return v_token;
end $$;

-- 4. Invitee functions (any signed-in, non-anonymous user).
-- What an invite link is for: {shops:[{id,name}], role, display_name, email, expires_at}. No email check here (the
-- screen shows whom it is for). Unknown, used or removed → invite_invalid; expired → invite_expired.
create function public.invite_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_first public.shop_members;
  v_shops jsonb;
begin
  if auth.uid() is null or private.is_anonymous() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select m.* into v_first
    from public.shop_members m join public.shops s on s.id = m.shop_id
   where m.invite_token_hash = v_hash and m.removed_at is null
   order by s.created_at, s.id limit 1;
  if v_first.id is null then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  if v_first.invite_expires_at <= now() then
    raise exception 'invite_expired' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.created_at, s.id) into v_shops
    from public.shop_members m join public.shops s on s.id = m.shop_id
   where m.invite_token_hash = v_hash and m.removed_at is null;
  return jsonb_build_object('shops', v_shops, 'role', v_first.role, 'display_name', v_first.display_name,
                            'email', v_first.email, 'expires_at', v_first.invite_expires_at);
end $$;

-- Accept an invite: every live row of the token. The email and its confirmation come from auth.users (never the
-- JWT). Check order: non-anonymous → token among live rows (invite_invalid) → not expired (invite_expired) → email
-- confirmed (invite_unconfirmed) → email matches (invite_wrong_email). A row of a shop the caller owns, or where the
-- caller already is a live member, is marked removed instead. Returns the accepted shop ids (already_member if none).
create function public.accept_shop_invite(p_token text) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_email text;
  v_confirmed timestamptz;
  v_row public.shop_members;
  v_rows int;
  v_expired boolean;
  v_same_email boolean;
  v_accepted uuid[] := '{}';
  v_at timestamptz := now();
begin
  if v_uid is null or private.is_anonymous() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select lower(btrim(u.email)), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;

  perform 1 from public.shop_members m
   where m.invite_token_hash = v_hash and m.removed_at is null order by m.id for update;
  select count(*), bool_or(m.invite_expires_at <= v_at), bool_and(m.email = v_email)
    into v_rows, v_expired, v_same_email
    from public.shop_members m
   where m.invite_token_hash = v_hash and m.removed_at is null;
  if v_rows = 0 then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  if v_expired then
    raise exception 'invite_expired' using errcode = '22023';
  end if;
  if v_confirmed is null then
    raise exception 'invite_unconfirmed' using errcode = '22023';
  end if;
  if v_same_email is not true then
    raise exception 'invite_wrong_email' using errcode = '22023';
  end if;

  for v_row in
    select * from public.shop_members m
     where m.invite_token_hash = v_hash and m.removed_at is null
     order by m.shop_id
  loop
    if exists (select 1 from public.shops s where s.id = v_row.shop_id and s.owner_id = v_uid)
       or exists (select 1 from public.shop_members o
                   where o.shop_id = v_row.shop_id and o.user_id = v_uid and o.removed_at is null
                     and o.accepted_at is not null) then
      update public.shop_members set removed_at = v_at, invite_token_hash = null where id = v_row.id;
    else
      update public.shop_members
         set user_id = v_uid, member_uid = v_uid, accepted_at = v_at, invite_token_hash = null
       where id = v_row.id;
      v_accepted := v_accepted || v_row.shop_id;
    end if;
  end loop;
  if cardinality(v_accepted) = 0 then
    raise exception 'already_member' using errcode = '22023';
  end if;
  return v_accepted;
end $$;

revoke all on function public.owner_invite_member(uuid[], text, text, text), public.owner_list_members(uuid),
  public.owner_set_member_role(uuid, text), public.owner_remove_member(uuid), public.owner_reissue_invite(uuid),
  public.invite_info(text), public.accept_shop_invite(text) from public, anon;
grant execute on function public.owner_invite_member(uuid[], text, text, text), public.owner_list_members(uuid),
  public.owner_set_member_role(uuid, text), public.owner_remove_member(uuid), public.owner_reissue_invite(uuid),
  public.invite_info(text), public.accept_shop_invite(text) to authenticated;

-- 5. Every shop where the caller has a role, oldest first. my_name: «Ιδιοκτήτης» for the owner, the member's
--    display_name otherwise (the client never builds either).
create function public.my_shops() returns table (id uuid, name text, role text, my_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or private.is_anonymous() then return; end if;
  return query
    select x.id, x.name, x.role, x.my_name
      from (select s.id, s.name, 'owner'::text as role, 'Ιδιοκτήτης'::text as my_name, s.created_at
              from public.shops s where s.owner_id = v_uid
            union all
            select s.id, s.name, m.role, m.display_name, s.created_at
              from public.shop_members m join public.shops s on s.id = m.shop_id
             where m.user_id = v_uid and m.removed_at is null and m.accepted_at is not null) x
     order by x.created_at, x.id;
end $$;
revoke all on function public.my_shops() from public, anon;
grant execute on function public.my_shops() to authenticated;

-- 6. Table policies by role. shops_owner_update, closings_owner_read and closings_owner_update stay owner only.
drop policy shops_owner_read on public.shops;
create policy shops_owner_read on public.shops for select to authenticated using (private.shop_role(id) is not null);
drop policy configs_owner_read on public.shop_configs;
create policy configs_owner_read on public.shop_configs for select to authenticated
  using (private.shop_role(shop_id) in ('owner', 'manager'));
drop policy staff_owner_read on public.staff;
create policy staff_owner_read on public.staff for select to authenticated
  using (private.shop_role(shop_id) in ('owner', 'manager'));
drop policy devices_owner_read on public.devices;
create policy devices_owner_read on public.devices for select to authenticated
  using (private.shop_role(shop_id) in ('owner', 'manager'));
drop policy devices_owner_update on public.devices;
create policy devices_owner_update on public.devices for update to authenticated
  using (private.shop_role(shop_id) in ('owner', 'manager')) with check (private.shop_role(shop_id) in ('owner', 'manager'));
drop policy staff_owner_update on public.staff;
create policy staff_owner_update on public.staff for update to authenticated
  using (erased_at is null and private.shop_role(shop_id) in ('owner', 'manager'))
  with check (erased_at is null and private.shop_role(shop_id) in ('owner', 'manager'));

-- 7. Owner-side functions re-created from their latest bodies; only the guard line changes (the owner-only guard
--    becomes perform private.require_role(x, array[…])). Signatures are unchanged, so the existing grants stand.

-- create_staff (body of 20261114000004_owner_caps.sql; guard: owner, manager)
create or replace function public.create_staff(p_shop_id uuid, p_name text, p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);
  perform private.check_pin(p_pin);
  perform 1 from public.shops where id = p_shop_id for update;  -- serialize the count below per shop
  if (select count(*) from public.staff where shop_id = p_shop_id) >= 100 then
    raise exception 'too_many_staff' using errcode = '22023';
  end if;
  insert into public.staff (shop_id, name, pin_hash)
  values (p_shop_id, btrim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'staff_name_taken' using errcode = '23505';
end $$;

-- set_staff_pin (body of 20261115000001_erasure.sql; guard: owner, manager)
create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id and erased_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';  -- don't reveal whether the staff id exists
  end if;
  perform private.require_role(v_shop, array['owner', 'manager']);
  perform private.check_pin(p_pin);
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null,
         lock_level = 0
   where id = p_staff_id;
end $$;

-- unlock_staff (body of 20261115000001_erasure.sql; guard: owner, manager)
create or replace function public.unlock_staff(p_staff_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id and erased_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_role(v_shop, array['owner', 'manager']);
  update public.staff set failed_attempts = 0, locked_until = null, lock_level = 0 where id = p_staff_id;
end $$;

-- owner_get_join_key (body of 20261112000001_store_join_keys.sql; guard: owner, manager)
create or replace function public.owner_get_join_key(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);
  insert into public.shop_join_keys (shop_id, key) values (p_shop_id, private.new_join_key())
  on conflict (shop_id) do nothing;
  select k.key into v_key from public.shop_join_keys k where k.shop_id = p_shop_id;
  return v_key;
end $$;

-- owner_rotate_join_key (body of 20261112000001_store_join_keys.sql; guard: owner, manager)
create or replace function public.owner_rotate_join_key(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);
  v_key := private.new_join_key();
  update public.staff_sessions set revoked_at = now() where shop_id = p_shop_id and revoked_at is null;
  delete from public.devices where shop_id = p_shop_id;
  insert into public.shop_join_keys (shop_id, key) values (p_shop_id, v_key)
  on conflict (shop_id) do update set key = excluded.key, created_at = now();
  return v_key;
end $$;

-- owner_list_devices (body of 20261112000001_store_join_keys.sql; guard: owner, manager)
create or replace function public.owner_list_devices(p_shop_id uuid)
returns table (user_id uuid, label text, created_at timestamptz, last_seen_at timestamptz, last_staff_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);
  return query
    select d.user_id, d.label, d.created_at, d.last_seen_at, st.name
      from public.devices d
      left join public.staff st on st.id = d.last_staff_id
     where d.shop_id = p_shop_id and d.revoked_at is null
     order by coalesce(d.last_seen_at, d.created_at) desc, d.user_id;
end $$;

-- owner_remove_device (body of 20261112000001_store_join_keys.sql; guard: owner, manager)
create or replace function public.owner_remove_device(p_device_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select d.shop_id into v_shop from public.devices d where d.user_id = p_device_user_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_role(v_shop, array['owner', 'manager']);
  update public.staff_sessions set revoked_at = now() where device_user_id = p_device_user_id and revoked_at is null;
  delete from public.devices where user_id = p_device_user_id;
end $$;

-- owner_get_open_closing (body of 20261108000001_open_closings.sql; guard: owner, manager)
create or replace function public.owner_get_open_closing(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_oc public.open_closings;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);
  v_oc := private.open_closing_for(p_shop_id);
  return jsonb_build_object('ok', true, 'closing', private.closing_snapshot(v_oc.id));
end $$;

-- owner_set_closing_field (body of 20261117000001_multi_closing.sql; guard: owner, manager)
create or replace function public.owner_set_closing_field(
  p_shop_id uuid, p_business_date date, p_key text, p_value jsonb, p_base_version int, p_closing_no int default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);
  if p_business_date is distinct from private.business_date(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'wrong_day');
  end if;
  return private.write_closing_field(p_shop_id, null, auth.uid(), p_closing_no, p_key, p_value, p_base_version);
end $$;

-- owner_save_closing (body of 20261117000002_multi_closing_history.sql; guard: owner, manager)
create or replace function public.owner_save_closing(
  p_shop_id uuid, p_business_date date, p_config_id uuid, p_inputs jsonb,
  p_expected_current_id uuid, p_idempotency_key text, p_revision bigint default null, p_closing_no int default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.closings;
  v_cur public.closings;
  v_oc public.open_closings;
  v_id uuid;
  v_today date;
  v_live boolean := false;
  v_at timestamptz := now();
  v_last jsonb;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager']);

  if p_business_date is null or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100
     or p_closing_no is null or p_closing_no not between 1 and 6
     or not private.inputs_shape_ok(p_inputs) or p_inputs -> 'schema' <> '2'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
       where e -> 'addedBy' ->> 'kind' = 'staff'
         and not exists (select 1 from public.staff st
                          where st.id = (e -> 'addedBy' ->> 'id')::uuid and st.shop_id = p_shop_id)) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date
       and v_existing.closing_no = p_closing_no then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('closing-day:' || p_shop_id || ':' || p_business_date
                                                 || ':' || p_closing_no, 0));
  select * into v_oc from public.open_closings
   where shop_id = p_shop_id and business_date = p_business_date and closing_no = p_closing_no for update;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date
       and v_existing.closing_no = p_closing_no then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  v_today := private.business_date(p_shop_id);
  if p_business_date > v_today then
    return jsonb_build_object('ok', false, 'error', 'no_closing_day');
  end if;
  -- The live closing: under our lock on v_oc a start_next_closing (which locks the live row) cannot commit a
  -- higher row; one that committed before is visible here, so v_oc is then not live.
  if p_business_date = v_today and v_oc.id is not null then
    v_live := v_oc.id = (private.open_closing_for(p_shop_id)).id;
  end if;
  -- Today with no open closing row but a current version would fall through the past-day path below: unreachable in
  -- practice, since a version of (shop, date, closing_no) is only stored by submit_closing (on the live open closing)
  -- or by this function (a first filing needs v_oc), and open closings are deleted only with their whole shop.

  v_cur := private.current_closing(p_shop_id, p_business_date, p_closing_no);
  if v_cur.id is not null then
    if p_expected_current_id is distinct from v_cur.id then
      return jsonb_build_object('ok', false, 'error', 'closing_changed', 'current_id', v_cur.id);
    end if;
    if p_config_id is distinct from v_cur.config_id then
      return jsonb_build_object('ok', false, 'error', 'config_mismatch');
    end if;
  else
    if p_expected_current_id is not null then
      return jsonb_build_object('ok', false, 'error', 'closing_changed', 'current_id', null);
    end if;
    -- The live closing with nothing submitted yet is the cashiers' (the owner has no Υποβολή); any other closing
    -- must be unsubmitted (an open closing with at least one field).
    if v_live or v_oc.id is null
       or not exists (select 1 from public.open_closing_fields f where f.open_closing_id = v_oc.id) then
      return jsonb_build_object('ok', false, 'error', 'no_closing_day');
    end if;
    if p_config_id is distinct from v_oc.config_id then
      return jsonb_build_object('ok', false, 'error', 'config_mismatch');
    end if;
  end if;

  if v_live then
    -- The live closing is the source of its numbers: same proof as a cashier's submit.
    if p_config_id is distinct from v_oc.config_id then
      return jsonb_build_object('ok', false, 'error', 'config_mismatch');
    end if;
    if p_revision is distinct from v_oc.revision then
      return jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', v_oc.revision);
    end if;
    if exists (
         select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
           join public.open_closing_fields f on f.open_closing_id = v_oc.id and f.key = 'e:' || (e ->> 'id')
         where (f.value -> 'addedBy') is distinct from (e -> 'addedBy')) then
      return jsonb_build_object('ok', false, 'error', 'bad_inputs');
    end if;
  end if;

  insert into public.closings (shop_id, kind, corrected_by, corrects_closing_id, config_id, business_date, inputs,
                               idempotency_key, closing_no)
  values (p_shop_id, 'owner_correction', auth.uid(), v_cur.id, p_config_id, p_business_date, p_inputs,
          p_idempotency_key, p_closing_no)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    if v_live then
      v_last := jsonb_build_object('closing_id', v_id, 'staff_name', 'Ιδιοκτήτης', 'at', v_at, 'revision', v_oc.revision,
                                   'closing_no', v_oc.closing_no);
      update public.open_closings set last_submit = v_last where id = v_oc.id;
      perform realtime.send(v_last, 'submitted', 'shop:' || p_shop_id, true);
    end if;
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date
     and v_existing.closing_no = p_closing_no then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

-- owner_list_closings (body of 20261117000002_multi_closing_history.sql; guard: owner, manager, accountant)
create or replace function public.owner_list_closings(p_shop_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_to date;
  v_from date;
  v_days jsonb;
  v_cfgs jsonb;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager', 'accountant']);
  v_today := private.business_date(p_shop_id);
  v_to := coalesce(p_to, v_today);
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to or v_to - v_from > 366 then
    return jsonb_build_object('ok', false, 'error', 'bad_range');
  end if;

  with sub as (
    select d.business_date, d.closing_no, d.cnt, private.closing_version_json(cc) as ver, cc.config_id
    from (select c.business_date, c.closing_no, count(*) as cnt
            from public.closings c
           where c.shop_id = p_shop_id and c.voided_at is null and c.business_date between v_from and v_to
           group by c.business_date, c.closing_no) d
    cross join lateral private.current_closing(p_shop_id, d.business_date, d.closing_no) cc
  ), unsub as (
    select oc.business_date, oc.closing_no, private.closing_snapshot(oc.id) as snap
      from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date between v_from and v_to and oc.business_date < v_today
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = oc.id)
       and not exists (select 1 from public.closings c
                        where c.shop_id = p_shop_id and c.business_date = oc.business_date
                          and c.closing_no = oc.closing_no and c.voided_at is null)
  ), entries as (
    select business_date, closing_no, jsonb_build_object('closing_no', closing_no, 'status', 'submitted',
             'version_count', cnt, 'current', ver) as j from sub
    union all
    select business_date, closing_no, jsonb_build_object('closing_no', closing_no, 'status', 'unsubmitted',
             'open', snap) from unsub
  ), days as (
    select e.business_date,
           jsonb_build_object('business_date', e.business_date,
             'cash_mode', coalesce(p.cash_mode, 'separate'),
             'closings_planned', coalesce(p.closings_planned, count(distinct e.closing_no)),
             'closings', jsonb_agg(e.j order by e.closing_no)) as j
      from entries e
      left join public.open_closings p
        on p.shop_id = p_shop_id and p.business_date = e.business_date and p.closing_no = 1
     group by e.business_date, p.cash_mode, p.closings_planned
  )
  select coalesce((select jsonb_agg(j order by business_date desc) from days), '[]'::jsonb),
         coalesce((select jsonb_object_agg(sc.id::text, sc.config)
                     from public.shop_configs sc where sc.id in (select config_id from sub)), '{}'::jsonb)
    into v_days, v_cfgs;

  return jsonb_build_object('ok', true, 'today', v_today, 'from', v_from, 'to', v_to,
                            'configs', v_cfgs, 'days', v_days);
end $$;

-- owner_get_closing_day (body of 20261117000002_multi_closing_history.sql; guard: owner, manager, accountant)
create or replace function public.owner_get_closing_day(p_shop_id uuid, p_business_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_closings jsonb;
  v_cfgs jsonb;
  v_names jsonb;
  v_plan public.open_closings;
  v_cash_mode text;
  v_planned int;
  v_live int := null;
begin
  perform private.require_role(p_shop_id, array['owner', 'manager', 'accountant']);
  v_today := private.business_date(p_shop_id);

  with nums as (
    select c.closing_no from public.closings c
     where c.shop_id = p_shop_id and c.business_date = p_business_date and c.voided_at is null
    union
    select oc.closing_no from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date = p_business_date and p_business_date < v_today
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = oc.id)
  ), items as (
    select u.closing_no,
           coalesce((select jsonb_agg(private.closing_version_json(c) order by c.seq desc)
                       from public.closings c
                      where c.shop_id = p_shop_id and c.business_date = p_business_date
                        and c.closing_no = u.closing_no and c.voided_at is null), '[]'::jsonb) as versions
      from nums u
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'closing_no', i.closing_no,
           'versions', i.versions,
           'open', case when i.versions = '[]'::jsonb then
                     (select private.closing_snapshot(oc.id) from public.open_closings oc
                       where oc.shop_id = p_shop_id and oc.business_date = p_business_date
                         and oc.closing_no = i.closing_no) end)
           order by i.closing_no), '[]'::jsonb)
    into v_closings
    from items i;

  select coalesce(jsonb_object_agg(sc.id::text, sc.config), '{}'::jsonb) into v_cfgs
    from public.shop_configs sc
   where sc.id in (select c.config_id from public.closings c
                    where c.shop_id = p_shop_id and c.business_date = p_business_date and c.voided_at is null);
  select coalesce(jsonb_object_agg(s.id::text, s.name), '{}'::jsonb) into v_names
    from public.staff s where s.shop_id = p_shop_id;

  select * into v_plan from public.open_closings
   where shop_id = p_shop_id and business_date = p_business_date and closing_no = 1;
  if found then
    v_cash_mode := v_plan.cash_mode;
    v_planned := v_plan.closings_planned;
  else
    -- Rows from before stage 2 (or an empty day): 'separate', as many closings as it has (at least 1).
    v_cash_mode := 'separate';
    v_planned := greatest(1, jsonb_array_length(v_closings));
  end if;

  if p_business_date = v_today then
    select max(oc.closing_no) into v_live from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date = v_today;
  end if;

  return jsonb_build_object('ok', true, 'today', v_today, 'business_date', p_business_date,
                            'cash_mode', v_cash_mode, 'closings_planned', v_planned, 'live_closing_no', v_live,
                            'closings', v_closings, 'configs', v_cfgs, 'staff_names', v_names);
end $$;

-- 8. Realtime topic shop:<id> (body of 20261108000001_open_closings.sql): the owner or a manager, or a phone with a
--    live staff session. Accountants have no live view. Grants unchanged.
create or replace function private.can_use_shop_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_shop uuid;
begin
  if p_topic is null or p_topic !~ '^shop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_shop := substring(p_topic from 6)::uuid;
  if auth.uid() is null then return false; end if;
  if private.shop_role(v_shop) in ('owner', 'manager') then return true; end if;
  return exists (
    select 1
      from public.devices d
      join public.staff_sessions ss on ss.device_user_id = d.user_id and ss.shop_id = d.shop_id
      join public.staff st on st.id = ss.staff_id and st.shop_id = d.shop_id and st.active
     where d.user_id = auth.uid() and d.shop_id = v_shop and d.revoked_at is null
       and ss.revoked_at is null and ss.business_date = private.business_date(v_shop));
end $$;

-- 9. owner_delete_account (body of 20261115000001_erasure.sql): before the auth user goes, each of the caller's
--    member rows (any shop, by member_uid) becomes a tombstone like staff erasure: the name «Διαγραμμένος
--    συνεργάτης <first 8 hex of member_uid>» (produced only here), no email, removed, no access link. Grants unchanged.
create or replace function public.owner_delete_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_shops uuid[];
  v_shop uuid;
begin
  if v_uid is null or private.is_anonymous() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('create-shop:' || v_uid, 0));
  perform 1 from public.shops where owner_id = v_uid order by id for update;
  select coalesce(array_agg(id order by id), '{}') into v_shops from public.shops where owner_id = v_uid;
  foreach v_shop in array v_shops loop
    perform private.delete_shop(v_shop);
  end loop;
  update public.shop_members
     set display_name = 'Διαγραμμένος συνεργάτης ' || left(replace(v_uid::text, '-', ''), 8),
         email = null, removed_at = coalesce(removed_at, now()), user_id = null, invite_token_hash = null
   where member_uid = v_uid;
  delete from auth.users where id = v_uid;
end $$;
