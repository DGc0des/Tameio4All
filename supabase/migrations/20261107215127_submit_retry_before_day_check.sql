-- A retry of a submit whose response was lost (same idempotency key) is answered from the stored
-- row before the business-day check, so a retry that lands after the day change still gets
-- {ok:true, repeat:true} instead of wrong_day. A fresh key is still held to today's business date.
create or replace function public.submit_closing(
  p_token text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
  v_shop uuid;
  v_staff uuid;
  v_existing public.closings;
  v_id uuid;
begin
  if not (v_sess ->> 'ok')::boolean then return v_sess; end if;
  v_shop := (v_sess ->> 'shop_id')::uuid;
  v_staff := (v_sess ->> 'staff_id')::uuid;

  if not exists (select 1 from public.shop_configs where id = p_config_id and shop_id = v_shop) then
    return jsonb_build_object('ok', false, 'error', 'config_mismatch');
  end if;
  -- New submissions must be schema 2; every expense author is staff of this shop (owner-authored
  -- lines are never accepted from a phone).
  if p_business_date is null or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100
     or not private.inputs_shape_ok(p_inputs) or p_inputs -> 'schema' <> '2'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;
  -- Separate IF: the uuid cast below runs only on inputs that passed the shape check.
  if exists (
       select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
       where e -> 'addedBy' ->> 'kind' <> 'staff'
          or not exists (select 1 from public.staff st
                         where st.id = (e -> 'addedBy' ->> 'id')::uuid and st.shop_id = v_shop)) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

  -- Same key seen before: a harmless retry only if it is the same closing (jsonb = ignores key
  -- order). Checked before the day rule so a retry across the day change is still a repeat.
  select * into v_existing from public.closings where shop_id = v_shop and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.inputs = p_inputs and v_existing.staff_id = v_staff
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  if p_business_date <> private.business_date(v_shop) then
    return jsonb_build_object('ok', false, 'error', 'wrong_day');
  end if;

  insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
  values (v_shop, v_staff, auth.uid(), p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  -- Lost a race with a concurrent submit of the same key: compare against the row that won.
  select * into v_existing from public.closings where shop_id = v_shop and idempotency_key = p_idempotency_key;
  if v_existing.inputs = p_inputs and v_existing.staff_id = v_staff
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

revoke all on function public.submit_closing(text, uuid, date, jsonb, text) from public, anon;
grant execute on function public.submit_closing(text, uuid, date, jsonb, text) to authenticated;
