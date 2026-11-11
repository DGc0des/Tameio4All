-- Stage 3: owner corrections. A correction is a NEW closings row (kind 'owner_correction'); existing
-- rows, open_closings.revision and last_submit are never touched and nothing is broadcast. The save is
-- guarded on the day's current version (private.current_closing): a stale expectation returns
-- closing_changed + the real current id. An unsubmitted past day (open closing with at least one field,
-- no non-voided closing) can get its first version with p_expected_current_id = null.
create function public.owner_save_closing(
  p_shop_id uuid, p_business_date date, p_config_id uuid, p_inputs jsonb,
  p_expected_current_id uuid, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.closings;
  v_cur public.closings;
  v_oc public.open_closings;
  v_id uuid;
begin
  perform private.require_owner(p_shop_id);

  if p_business_date is null or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100
     or not private.inputs_shape_ok(p_inputs) or p_inputs -> 'schema' <> '2'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;
  -- Separate IF: the uuid cast runs only on inputs that passed the shape check (staff ids are uuid-shaped).
  -- Owner-added lines are fine; a staff line must belong to a staff row of this shop (active or not).
  if exists (
       select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
       where e -> 'addedBy' ->> 'kind' = 'staff'
         and not exists (select 1 from public.staff st
                          where st.id = (e -> 'addedBy' ->> 'id')::uuid and st.shop_id = p_shop_id)) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

  -- Same key seen before: a retry only if it is the same correction (jsonb = ignores key order).
  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  -- Owner vs owner, then owner vs a staff submit (which locks the same open_closings row).
  perform pg_advisory_xact_lock(hashtextextended('closing-day:' || p_shop_id || ':' || p_business_date, 0));
  perform 1 from public.open_closings where shop_id = p_shop_id and business_date = p_business_date for update;

  v_cur := private.current_closing(p_shop_id, p_business_date);
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
    select * into v_oc from public.open_closings
     where shop_id = p_shop_id and business_date = p_business_date
       and business_date < private.business_date(p_shop_id)
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = open_closings.id);
    if not found then
      return jsonb_build_object('ok', false, 'error', 'no_closing_day');
    end if;
    if p_config_id is distinct from v_oc.config_id then
      return jsonb_build_object('ok', false, 'error', 'config_mismatch');
    end if;
  end if;

  insert into public.closings (shop_id, kind, corrected_by, corrects_closing_id, config_id, business_date, inputs, idempotency_key)
  values (p_shop_id, 'owner_correction', auth.uid(), v_cur.id, p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  -- Lost a same-key race: answer as in the lookup above.
  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

revoke all on function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text) to authenticated;
