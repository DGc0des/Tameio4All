-- Today's versions always come from the live closing.
--
-- 1. `last_submit` records the open closing's `revision` at the submit, so clients can tell the live
--    closing changed after it («Άλλαξε μετά την υποβολή»: snapshot.revision > last_submit.revision).
-- 2. `owner_save_closing` gets an optional 7th argument `p_revision`. For the shop's business date (today) the
--    owner saves the LIVE numbers, like a cashier's Υποβολή: a current version must exist (`no_closing_day`
--    otherwise), `p_revision` must equal the open closing's revision (`draft_changed` + revision otherwise,
--    nothing stored), a line that exists as `e:<id>` must carry its stored author (`bad_inputs`), and the
--    save records `last_submit` (staff_name «Ιδιοκτήτης») and broadcasts `submitted`. A later cashier resubmit
--    is then built from the same live fields, so it cannot silently drop the owner's change.
--    Past days are unchanged (p_revision ignored; open_closings untouched, nothing broadcast). Future days:
--    `no_closing_day`.

-- (1) submit_closing: body of 20261108000002b with `revision` in last_submit / the broadcast.
create or replace function public.submit_closing(
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
  if exists (
       select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
       where not exists (select 1 from public.open_closing_fields f
                           join public.open_closings oc on oc.id = f.open_closing_id
                          where oc.shop_id = v_shop and oc.business_date = private.business_date(v_shop)
                            and f.key = 'e:' || (e ->> 'id'))
         and (e -> 'addedBy' ->> 'kind' <> 'staff'
              or not exists (select 1 from public.staff st
                             where st.id = (e -> 'addedBy' ->> 'id')::uuid and st.shop_id = v_shop))) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

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

  v_oc := private.open_closing_for(v_shop);
  select * into v_oc from public.open_closings where id = v_oc.id for update;
  if v_oc.config_id is distinct from p_config_id then
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

  insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
  values (v_shop, v_staff, auth.uid(), p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    select name into v_name from public.staff where id = v_staff;
    v_last := jsonb_build_object('closing_id', v_id, 'staff_name', v_name, 'at', v_at, 'revision', v_oc.revision);
    update public.open_closings set last_submit = v_last where id = v_oc.id;
    perform realtime.send(v_last, 'submitted', 'shop:' || v_shop, true);
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  select * into v_existing from public.closings where shop_id = v_shop and idempotency_key = p_idempotency_key;
  if v_existing.inputs = p_inputs and v_existing.staff_id = v_staff
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

revoke all on function public.submit_closing(text, uuid, date, jsonb, bigint, text) from public, anon;
grant execute on function public.submit_closing(text, uuid, date, jsonb, bigint, text) to authenticated;

-- (2) owner_save_closing: body of 20261111000002b + the today path. The 6-argument form is replaced (a default on
-- the new 7th argument keeps 6-argument calls working for past days).
drop function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text);

create function public.owner_save_closing(
  p_shop_id uuid, p_business_date date, p_config_id uuid, p_inputs jsonb,
  p_expected_current_id uuid, p_idempotency_key text, p_revision bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.closings;
  v_cur public.closings;
  v_oc public.open_closings;
  v_id uuid;
  v_today date;
  v_at timestamptz := now();
  v_last jsonb;
begin
  perform private.require_owner(p_shop_id);

  if p_business_date is null or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100
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
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('closing-day:' || p_shop_id || ':' || p_business_date, 0));
  select * into v_oc from public.open_closings where shop_id = p_shop_id and business_date = p_business_date for update;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  v_today := private.business_date(p_shop_id);
  if p_business_date > v_today then
    return jsonb_build_object('ok', false, 'error', 'no_closing_day');
  end if;

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
    -- Today with nothing submitted yet is the cashiers' (the owner has no Υποβολή); a past day must be unsubmitted.
    if p_business_date = v_today or v_oc.id is null
       or not exists (select 1 from public.open_closing_fields f where f.open_closing_id = v_oc.id) then
      return jsonb_build_object('ok', false, 'error', 'no_closing_day');
    end if;
    if p_config_id is distinct from v_oc.config_id then
      return jsonb_build_object('ok', false, 'error', 'config_mismatch');
    end if;
  end if;

  if p_business_date = v_today then
    -- The live closing is the source of today's numbers: same proof as a cashier's submit.
    if v_oc.id is null or p_config_id is distinct from v_oc.config_id then
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

  insert into public.closings (shop_id, kind, corrected_by, corrects_closing_id, config_id, business_date, inputs, idempotency_key)
  values (p_shop_id, 'owner_correction', auth.uid(), v_cur.id, p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    if p_business_date = v_today then
      v_last := jsonb_build_object('closing_id', v_id, 'staff_name', 'Ιδιοκτήτης', 'at', v_at, 'revision', v_oc.revision);
      update public.open_closings set last_submit = v_last where id = v_oc.id;
      perform realtime.send(v_last, 'submitted', 'shop:' || p_shop_id, true);
    end if;
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

revoke all on function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text, bigint) from public, anon;
grant execute on function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text, bigint) to authenticated;
