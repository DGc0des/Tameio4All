-- Owner functions. Reject anonymous sessions and non-owners; identity only from auth.uid().

create function private.is_anonymous() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
$$;

create function private.require_owner(p_shop_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_shop_owner(p_shop_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
end $$;

create function private.check_config(p_config jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' or p_config ->> 'schema' is distinct from '1'
     or pg_column_size(p_config) > 65536 then
    raise exception 'bad_config' using errcode = '22023';
  end if;
end $$;

create function private.check_pin(p_pin text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'bad_pin_format' using errcode = '22023';
  end if;
end $$;

revoke all on function private.is_anonymous(), private.require_owner(uuid), private.check_config(jsonb), private.check_pin(text) from public, anon;
grant execute on function private.is_anonymous(), private.require_owner(uuid), private.check_config(jsonb), private.check_pin(text) to authenticated;

create function public.create_shop(p_name text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_shop uuid;
begin
  if v_uid is null or private.is_anonymous() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.check_config(p_config);
  insert into public.shops (owner_id, name) values (v_uid, btrim(p_name)) returning id into v_shop;
  insert into public.shop_configs (shop_id, version, config, created_by) values (v_shop, 1, p_config, v_uid);
  return v_shop;
end $$;

create function public.publish_config(p_shop_id uuid, p_expected_version int, p_config jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
begin
  perform private.require_owner(p_shop_id);
  perform private.check_config(p_config);
  perform 1 from public.shops where id = p_shop_id for update;  -- one publisher per shop at a time
  select coalesce(max(version), 0) into v_current from public.shop_configs where shop_id = p_shop_id;
  if v_current <> p_expected_version then
    raise exception 'version_conflict' using detail = format('current version is %s', v_current);
  end if;
  insert into public.shop_configs (shop_id, version, config, created_by)
  values (p_shop_id, v_current + 1, p_config, auth.uid());
  return v_current + 1;
end $$;

create function public.create_staff(p_shop_id uuid, p_name text, p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_owner(p_shop_id);
  perform private.check_pin(p_pin);
  insert into public.staff (shop_id, name, pin_hash)
  values (p_shop_id, btrim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'staff_name_taken' using errcode = '23505';
end $$;

create function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';  -- don't reveal whether the staff id exists
  end if;
  perform private.require_owner(v_shop);
  perform private.check_pin(p_pin);
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null
   where id = p_staff_id;
end $$;

-- 8 characters from 32 unambiguous symbols (no 0/O/1/I): 32^8 ≈ 10^12 codes, 10-minute life.
create function public.create_pairing_code(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  perform private.require_owner(p_shop_id);
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.pairing_codes (code_hash, shop_id, created_by, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), p_shop_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end $$;

revoke all on function public.create_shop(text, jsonb), public.publish_config(uuid, int, jsonb),
  public.create_staff(uuid, text, text), public.set_staff_pin(uuid, text), public.create_pairing_code(uuid)
  from public, anon;
grant execute on function public.create_shop(text, jsonb), public.publish_config(uuid, int, jsonb),
  public.create_staff(uuid, text, text), public.set_staff_pin(uuid, text), public.create_pairing_code(uuid)
  to authenticated;
