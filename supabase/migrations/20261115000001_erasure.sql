-- LG2 (GDPR Art. 5(1)(e), Art. 17) + L81: erase a cashier, delete a shop, delete an owner account, and a daily
-- purge of old staff sessions and unused anonymous phone identities.
--
-- Erasing a cashier keeps the staff row (closings reference it and `closings` is append-only) as a permanent
-- tombstone: the name becomes «Διαγραμμένος υπάλληλος <8 hex>», the PIN and lock state go, the row can never be
-- renamed or re-activated. The placeholder text is produced only here; the client never builds it.
-- Closings rows leave the database only together with their whole shop.

-- 1. The tombstone marker. Owners read it like the other staff columns (column grant; rows limited by
--    staff_owner_read).
alter table public.staff add column erased_at timestamptz;
grant select (erased_at) on public.staff to authenticated;

-- 2. An erased row is never updated by the owner directly (staff_owner_update from 20260929000001_schema.sql,
--    plus erased_at is null on both sides).
drop policy staff_owner_update on public.staff;
create policy staff_owner_update on public.staff for update to authenticated
  using (erased_at is null and private.is_shop_owner(shop_id))
  with check (erased_at is null and private.is_shop_owner(shop_id));

-- 3. unlock_staff and set_staff_pin (bodies of 20261114000003_pin_lockout.sql): an erased row answers not_owner,
--    like a missing one.
create or replace function public.unlock_staff(p_staff_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id and erased_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  update public.staff set failed_attempts = 0, locked_until = null, lock_level = 0 where id = p_staff_id;
end $$;
revoke all on function public.unlock_staff(uuid) from public, anon;
grant execute on function public.unlock_staff(uuid) to authenticated;

create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id and erased_at is null;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';  -- don't reveal whether the staff id exists
  end if;
  perform private.require_owner(v_shop);
  perform private.check_pin(p_pin);
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null,
         lock_level = 0
   where id = p_staff_id;
end $$;
revoke all on function public.set_staff_pin(uuid, text) from public, anon;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;

-- 4. Owner: erase a cashier. Idempotent (an erased row is left as it is). Lock order: shop, the devices that
--    name this cashier as last user, then the staff row (device → staff, as in private.check_staff_pin).
create function public.owner_erase_staff(p_staff_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_erased timestamptz;
  v_name text;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  -- no key update: a staff_sign_in holding the device and staff rows only needs a key-share lock on the shop
  perform 1 from public.shops where id = v_shop for no key update;
  perform 1 from public.devices where shop_id = v_shop and last_staff_id = p_staff_id for update;
  select erased_at into v_erased from public.staff where id = p_staff_id for update;
  if v_erased is not null then return; end if;

  v_name := 'Διαγραμμένος υπάλληλος ' || left(p_staff_id::text, 8);
  if exists (select 1 from public.staff
              where shop_id = v_shop and id <> p_staff_id and lower(btrim(name)) = lower(v_name)) then
    v_name := 'Διαγραμμένος υπάλληλος ' || left(replace(p_staff_id::text, '-', ''), 16);  -- 40 chars, the name cap
  end if;

  update public.devices set last_staff_id = null where shop_id = v_shop and last_staff_id = p_staff_id;
  delete from public.staff_sessions where staff_id = p_staff_id;
  delete from public.device_staff_trust where staff_id = p_staff_id;
  update public.staff
     set name = v_name, pin_hash = null, active = false, failed_attempts = 0, locked_until = null, lock_level = 0,
         erased_at = now()
   where id = p_staff_id;

  -- The only stored copy of a cashier's name outside `staff`: last_submit.staff_name of a submit they made.
  update public.open_closings oc
     set last_submit = jsonb_set(oc.last_submit, '{staff_name}', to_jsonb(v_name))
   where oc.shop_id = v_shop
     and oc.last_submit ? 'staff_name'
     and exists (select 1 from public.closings c
                  where c.shop_id = v_shop and c.staff_id = p_staff_id and c.id::text = oc.last_submit ->> 'closing_id');
end $$;

-- 5. Delete one shop and everything in it. The phones' anonymous identities stay: a phone keeps using its stored
--    access token, so deleting the user would make its next join_shop fail on devices.user_id; purge_stale removes
--    them once they have no store and no use for 30 days.
--    Explicit order (closings → open closings → devices → staff sessions → staff → the rest via the shop row), so
--    no FK without a cascade (closings.staff_id/config_id/corrects_closing_id, open_closings.config_id,
--    open_closing_fields.updated_by_staff) is ever checked against a row deleted out of order.
create function private.delete_shop(p_shop_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.closings where shop_id = p_shop_id;
  delete from public.open_closings where shop_id = p_shop_id;
  delete from public.devices where shop_id = p_shop_id;
  delete from public.staff_sessions where shop_id = p_shop_id;
  delete from public.staff where shop_id = p_shop_id;
  delete from public.shops where id = p_shop_id;
end $$;
revoke all on function private.delete_shop(uuid) from public, anon, authenticated;

-- 6. Owner: delete a shop. The typed name must match the shop's name exactly (after trimming).
create function public.owner_delete_shop(p_shop_id uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  perform private.require_owner(p_shop_id);
  select name into v_name from public.shops where id = p_shop_id for update;
  if btrim(coalesce(p_confirm_name, '')) is distinct from v_name then
    raise exception 'confirm_mismatch' using errcode = '22023';
  end if;
  perform private.delete_shop(p_shop_id);
end $$;

-- 7. Owner: delete the account, every shop of it first. The create-shop lock keeps a parallel create_shop out.
create function public.owner_delete_account() returns void
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
  delete from auth.users where id = v_uid;
end $$;

revoke all on function public.owner_erase_staff(uuid), public.owner_delete_shop(uuid, text),
  public.owner_delete_account() from public, anon;
grant execute on function public.owner_erase_staff(uuid), public.owner_delete_shop(uuid, text),
  public.owner_delete_account() to authenticated;

-- 8. Daily purge: staff sessions older than 90 days (a session is valid for one business date only), and
--    anonymous users older than 30 days with no devices row and no auth session used in the last 30 days.
--    language sql: the body (incl. the auth.sessions columns) is checked when this migration runs.
create function private.purge_stale() returns void
language sql security definer set search_path = '' as $$
  delete from public.staff_sessions where created_at < now() - interval '90 days';
  delete from auth.users u
   where coalesce(u.is_anonymous, false)
     and u.created_at < now() - interval '30 days'
     and not exists (select 1 from public.devices d where d.user_id = u.id)
     and not exists (select 1 from auth.sessions s
                      where s.user_id = u.id and coalesce(s.updated_at, s.created_at) > now() - interval '30 days');
$$;
revoke all on function private.purge_stale() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('purge_stale', '30 3 * * *', 'select private.purge_stale()');
