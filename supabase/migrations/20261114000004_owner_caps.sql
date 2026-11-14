-- M41: caps on shops per owner (20), staff rows per shop (100, active or not) and config versions per shop
-- created in the last 24 hours (50). Each raises its own message (errcode 22023), mapped in errors.ts.
-- create_shop, create_staff and publish_config are re-created in full from their latest bodies
-- (20260929000002_owner_functions.sql; publish_config: 20260929000005_hardening.sql) with only the caps added.
-- Counts run under a lock so two parallel calls cannot both pass.

create or replace function public.create_shop(p_name text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_shop uuid;
begin
  if v_uid is null or private.is_anonymous() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.check_config(p_config);
  perform pg_advisory_xact_lock(hashtextextended('create-shop:' || v_uid, 0));
  if (select count(*) from public.shops where owner_id = v_uid) >= 20 then
    raise exception 'too_many_shops' using errcode = '22023';
  end if;
  insert into public.shops (owner_id, name) values (v_uid, btrim(p_name)) returning id into v_shop;
  insert into public.shop_configs (shop_id, version, config, created_by) values (v_shop, 1, p_config, v_uid);
  return v_shop;
end $$;

create or replace function public.create_staff(p_shop_id uuid, p_name text, p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_owner(p_shop_id);
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

create or replace function public.publish_config(p_shop_id uuid, p_expected_version int, p_config jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
begin
  perform private.require_owner(p_shop_id);
  perform private.check_config(p_config);
  perform 1 from public.shops where id = p_shop_id for update;  -- one publisher per shop at a time
  if (select count(*) from public.shop_configs
      where shop_id = p_shop_id and created_at > now() - interval '24 hours') >= 50 then
    raise exception 'too_many_versions' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) into v_current from public.shop_configs where shop_id = p_shop_id;
  if p_expected_version is null or v_current <> p_expected_version then
    raise exception 'version_conflict' using detail = format('current version is %s', v_current);
  end if;
  insert into public.shop_configs (shop_id, version, config, created_by)
  values (p_shop_id, v_current + 1, p_config, auth.uid());
  return v_current + 1;
end $$;

revoke all on function public.create_shop(text, jsonb), public.create_staff(uuid, text, text),
  public.publish_config(uuid, int, jsonb) from public, anon;
grant execute on function public.create_shop(text, jsonb), public.create_staff(uuid, text, text),
  public.publish_config(uuid, int, jsonb) to authenticated;
