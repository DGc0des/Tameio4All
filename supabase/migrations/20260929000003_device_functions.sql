-- Phone (paired device) functions. A phone is an anonymous auth user with a live devices row.

create function private.device_shop() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_revoked timestamptz;
begin
  select d.shop_id, d.revoked_at into v_shop, v_revoked from public.devices d where d.user_id = auth.uid();
  if v_shop is null then return jsonb_build_object('ok', false, 'error', 'not_a_device'); end if;
  if v_revoked is not null then return jsonb_build_object('ok', false, 'error', 'device_revoked'); end if;
  return jsonb_build_object('ok', true, 'shop_id', v_shop);
end $$;

-- Returns a result instead of raising so the failed-attempt counter is never rolled back.
create function private.check_staff_pin(p_shop_id uuid, p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id and shop_id = p_shop_id and active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'staff_not_found'); end if;
  if v_staff.locked_until is not null and v_staff.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', v_staff.locked_until);
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    if v_staff.failed_attempts + 1 >= 5 then
      update public.staff set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = p_staff_id;
      return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', now() + interval '15 minutes');
    end if;
    update public.staff set failed_attempts = failed_attempts + 1 where id = p_staff_id;
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;
  if v_staff.failed_attempts <> 0 or v_staff.locked_until is not null then
    update public.staff set failed_attempts = 0, locked_until = null where id = p_staff_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.device_shop(), private.check_staff_pin(uuid, uuid, text) from public, anon, authenticated;

create function public.redeem_pairing_code(p_code text, p_label text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
  v_row public.pairing_codes;
begin
  if v_uid is null or not private.is_anonymous() then
    raise exception 'not_a_device_session' using errcode = '42501';
  end if;
  select * into v_row from public.pairing_codes where code_hash = v_hash for update;
  if not found or v_row.used_at is not null or v_row.expires_at < now() then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  update public.pairing_codes set used_at = now(), used_by = v_uid where code_hash = v_hash;
  insert into public.devices (user_id, shop_id, label)
  values (v_uid, v_row.shop_id, left(btrim(coalesce(p_label, '')), 60))
  on conflict (user_id) do update
    set shop_id = excluded.shop_id, label = excluded.label, revoked_at = null, created_at = now();
  return v_row.shop_id;
end $$;

create function public.device_context()
returns table (shop_id uuid, shop_name text, config_id uuid, version int, config jsonb)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, c.id, c.version, c.config
  from public.devices d
  join public.shops s on s.id = d.shop_id
  join lateral (
    select sc.id, sc.version, sc.config from public.shop_configs sc
    where sc.shop_id = s.id order by sc.version desc limit 1
  ) c on true
  where d.user_id = (select auth.uid()) and d.revoked_at is null;
$$;

create function public.list_staff() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select st.id, st.name
  from public.devices d
  join public.staff st on st.shop_id = d.shop_id and st.active
  where d.user_id = (select auth.uid()) and d.revoked_at is null
  order by lower(st.name);
$$;

create function public.verify_staff_pin(p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev jsonb := private.device_shop();
begin
  if not (v_dev ->> 'ok')::boolean then return v_dev; end if;
  return private.check_staff_pin((v_dev ->> 'shop_id')::uuid, p_staff_id, p_pin);
end $$;

revoke all on function public.redeem_pairing_code(text, text), public.device_context(), public.list_staff(),
  public.verify_staff_pin(uuid, text) from public, anon;
grant execute on function public.redeem_pairing_code(text, text), public.device_context(), public.list_staff(),
  public.verify_staff_pin(uuid, text) to authenticated;
