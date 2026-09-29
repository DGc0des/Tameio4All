-- Submitting closings (raw inputs only — totals are recomputed by src/core) and suggestion data.

create function private.inputs_shape_ok(p_inputs jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_inputs) = 'object'
    and p_inputs ->> 'schema' = '1'
    and jsonb_typeof(p_inputs -> 'counts') = 'object'
    and jsonb_typeof(p_inputs -> 'channelCents') = 'object'
    and jsonb_typeof(p_inputs -> 'expenses') = 'array'
    and pg_column_size(p_inputs) <= 65536,
    false);
$$;
revoke all on function private.inputs_shape_ok(jsonb) from public, anon, authenticated;

create function public.submit_closing(
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
  if p_business_date is null or p_idempotency_key is null
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

create function public.expense_suggestion_data() returns table (description text, cents bigint, business_date date)
language sql stable security definer set search_path = '' as $$
  select e ->> 'description', (e ->> 'cents')::bigint, c.business_date
  from public.devices d
  join public.closings c
    on c.shop_id = d.shop_id and c.voided_at is null and c.business_date >= current_date - 180
  cross join lateral jsonb_array_elements(c.inputs -> 'expenses') e
  where d.user_id = (select auth.uid()) and d.revoked_at is null
    and jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'description') = 'string'
    and jsonb_typeof(e -> 'cents') = 'number'
    and (e ->> 'cents') ~ '^[0-9]{1,15}$';
$$;

revoke all on function public.submit_closing(uuid, text, uuid, date, jsonb, text), public.expense_suggestion_data() from public, anon;
grant execute on function public.submit_closing(uuid, text, uuid, date, jsonb, text), public.expense_suggestion_data() to authenticated;
