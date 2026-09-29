-- Final-review fix wave: version-guard bypass, schema type check, business-date bounds.
-- Every function here is re-created in full from its current definition (see the earlier
-- migration files) with only the described change, so nothing else about it moves.

-- 1. publish_config: a null expected version must never bypass the optimistic-concurrency check.
--    (Previously `v_current <> p_expected_version` was NULL when p_expected_version was null,
--    and `if null then ...` is never true in plpgsql — so a null expected version always
--    "succeeded", silently overwriting whatever version was actually current.)
create or replace function public.publish_config(p_shop_id uuid, p_expected_version int, p_config jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
begin
  perform private.require_owner(p_shop_id);
  perform private.check_config(p_config);
  perform 1 from public.shops where id = p_shop_id for update;  -- one publisher per shop at a time
  select coalesce(max(version), 0) into v_current from public.shop_configs where shop_id = p_shop_id;
  if p_expected_version is null or v_current <> p_expected_version then
    raise exception 'version_conflict' using detail = format('current version is %s', v_current);
  end if;
  insert into public.shop_configs (shop_id, version, config, created_by)
  values (p_shop_id, v_current + 1, p_config, auth.uid());
  return v_current + 1;
end $$;

revoke all on function public.publish_config(uuid, int, jsonb) from public, anon;
grant execute on function public.publish_config(uuid, int, jsonb) to authenticated;

-- 2. "schema" must be the JSON number 1, not the string "1". `->>'schema'` extracts both as the
--    text '1', so it could never tell them apart; `->'schema'` compared to '1'::jsonb can.
create or replace function private.check_config(p_config jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' or p_config -> 'schema' is distinct from '1'::jsonb
     or pg_column_size(p_config) > 65536 then
    raise exception 'bad_config' using errcode = '22023';
  end if;
end $$;

revoke all on function private.check_config(jsonb) from public, anon, authenticated;

create or replace function private.inputs_shape_ok(p_inputs jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_inputs) = 'object'
    and p_inputs -> 'schema' = '1'::jsonb
    and jsonb_typeof(p_inputs -> 'counts') = 'object'
    and jsonb_typeof(p_inputs -> 'channelCents') = 'object'
    and jsonb_typeof(p_inputs -> 'expenses') = 'array'
    and pg_column_size(p_inputs) <= 65536,
    false);
$$;

revoke all on function private.inputs_shape_ok(jsonb) from public, anon, authenticated;

-- Same fix at the table boundary: shop_configs.config must carry the JSON number 1, not a string.
alter table public.shop_configs drop constraint shop_configs_config_check;
alter table public.shop_configs add constraint shop_configs_config_check
  check (jsonb_typeof(config) = 'object' and config -> 'schema' = '1'::jsonb and pg_column_size(config) <= 65536);

-- 3. A closing's business_date must be within a week in the past or a day in the future; and
--    suggestion data must never include a future-dated closing.
create or replace function public.submit_closing(
  p_staff_id uuid, p_pin text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev jsonb := private.device_shop();
  v_shop uuid;
  v_pin jsonb;
  v_existing public.closings;
  v_id uuid;
begin
  if not (v_dev ->> 'ok')::boolean then return v_dev; end if;
  v_shop := (v_dev ->> 'shop_id')::uuid;

  v_pin := private.check_staff_pin(v_shop, p_staff_id, p_pin);
  if not (v_pin ->> 'ok')::boolean then return v_pin; end if;

  if not exists (select 1 from public.shop_configs where id = p_config_id and shop_id = v_shop) then
    return jsonb_build_object('ok', false, 'error', 'config_mismatch');
  end if;
  if p_business_date is null or p_business_date < current_date - 7 or p_business_date > current_date + 1
     or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100 or not private.inputs_shape_ok(p_inputs) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

  insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
  values (v_shop, p_staff_id, auth.uid(), p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  -- Same key seen before: a harmless retry only if it is the same closing (jsonb = ignores key order).
  select * into v_existing from public.closings where shop_id = v_shop and idempotency_key = p_idempotency_key;
  if v_existing.inputs = p_inputs and v_existing.staff_id = p_staff_id
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

create or replace function public.expense_suggestion_data() returns table (description text, cents bigint, business_date date)
language sql stable security definer set search_path = '' as $$
  select e ->> 'description', (e ->> 'cents')::bigint, c.business_date
  from public.devices d
  join public.closings c
    on c.shop_id = d.shop_id and c.voided_at is null
   and c.business_date >= current_date - 180 and c.business_date <= current_date + 1
  cross join lateral jsonb_array_elements(c.inputs -> 'expenses') e
  where d.user_id = (select auth.uid()) and d.revoked_at is null
    and jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'description') = 'string'
    and jsonb_typeof(e -> 'cents') = 'number'
    and (e ->> 'cents') ~ '^[0-9]{1,15}$';
$$;

revoke all on function public.submit_closing(uuid, text, uuid, date, jsonb, text), public.expense_suggestion_data() from public, anon;
grant execute on function public.submit_closing(uuid, text, uuid, date, jsonb, text), public.expense_suggestion_data() to authenticated;

-- 4. check_staff_pin unchanged except documenting why FOR UPDATE must stay.
create or replace function private.check_staff_pin(p_shop_id uuid, p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff public.staff;
begin
  -- FOR UPDATE also makes this fail inside a read-only transaction (e.g. a GET RPC call) before
  -- the PIN is compared, so a read-only call can't be used to guess PINs without the counter.
  -- Do not remove.
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

revoke all on function private.check_staff_pin(uuid, uuid, text) from public, anon, authenticated;
