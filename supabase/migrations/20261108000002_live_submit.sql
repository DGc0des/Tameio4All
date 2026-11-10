-- Stage 2, task 2: submit against the live shared closing.
-- submit_closing gains p_revision. Stage-1 checks and their order are unchanged (session, shop config,
-- inputs shape, expense authors, idempotency lookup, business day). New, after those:
--   * the session's open closing is locked (same row write_closing_field locks), so no field write can
--     land between the revision check and the insert;
--   * p_config_id must be the config pinned by the open closing (config_mismatch);
--   * p_revision must equal the open closing's revision (draft_changed, carries the current revision).
--     It is checked after the idempotency lookup so a retry of a lost answer is still a `repeat`.
-- On success open_closings.last_submit = {closing_id, staff_name, at} and a private 'submitted'
-- broadcast goes to shop:<id>. The open closing itself stays (the day keeps one live closing).
drop function public.submit_closing(text, uuid, date, jsonb, text);

create function public.submit_closing(
  p_token text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_revision bigint, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
  v_shop uuid;
  v_staff uuid;
  v_existing public.closings;
  v_oc public.open_closings;
  v_id uuid;
  v_name text;
  v_at timestamptz := now();
  v_last jsonb;
begin
  if not (v_sess ->> 'ok')::boolean then return v_sess; end if;
  v_shop := (v_sess ->> 'shop_id')::uuid;
  v_staff := (v_sess ->> 'staff_id')::uuid;

  if not exists (select 1 from public.shop_configs where id = p_config_id and shop_id = v_shop) then
    return jsonb_build_object('ok', false, 'error', 'config_mismatch');
  end if;
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
  -- order). Checked before the day and revision rules so a retry whose answer was lost is still a
  -- repeat even after later field writes or across the day change.
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

  -- The live closing of this business day; lock it, then re-read (a writer may have bumped it).
  v_oc := private.open_closing_for(v_shop);
  select * into v_oc from public.open_closings where id = v_oc.id for update;
  if v_oc.config_id is distinct from p_config_id then
    return jsonb_build_object('ok', false, 'error', 'config_mismatch');
  end if;
  if p_revision is distinct from v_oc.revision then
    return jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', v_oc.revision);
  end if;

  insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
  values (v_shop, v_staff, auth.uid(), p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    select name into v_name from public.staff where id = v_staff;
    v_last := jsonb_build_object('closing_id', v_id, 'staff_name', v_name, 'at', v_at);
    update public.open_closings set last_submit = v_last where id = v_oc.id;
    perform realtime.send(v_last, 'submitted', 'shop:' || v_shop, true);
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

revoke all on function public.submit_closing(text, uuid, date, jsonb, bigint, text) from public, anon;
grant execute on function public.submit_closing(text, uuid, date, jsonb, bigint, text) to authenticated;
