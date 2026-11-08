-- Stage 1: closings are submitted under a staff session (no PIN per submit), only for the
-- session's business date, with ClosingInputs schema 2 (expense ids + authors). Suggestions read
-- only the latest non-voided closing of each business day.

-- 1. Inputs shape. Schema 1 stays valid for stored rows; schema 2 adds per-expense checks.
--    CASE (not AND) guards jsonb_array_elements, so a non-array never reaches it.
--    Cross-file invariant: mirrors ClosingInputs / validateClosingInputs in src/core.
create or replace function private.inputs_shape_ok(p_inputs jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_inputs) = 'object'
    and p_inputs -> 'schema' in ('1'::jsonb, '2'::jsonb)
    and jsonb_typeof(p_inputs -> 'counts') = 'object'
    and jsonb_typeof(p_inputs -> 'channelCents') = 'object'
    and pg_column_size(p_inputs) <= 65536
    and case
      when jsonb_typeof(p_inputs -> 'expenses') is distinct from 'array' then false
      when p_inputs -> 'schema' = '1'::jsonb then true
      else not exists (
        select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
        where not coalesce(
          jsonb_typeof(e) = 'object'
          and jsonb_typeof(e -> 'id') = 'string'
          and char_length(e ->> 'id') between 1 and 64
          and jsonb_typeof(e -> 'description') = 'string'
          and jsonb_typeof(e -> 'cents') = 'number'
          and jsonb_typeof(e -> 'addedBy') = 'object'
          and case e -> 'addedBy' ->> 'kind'
                when 'owner' then true
                when 'staff' then jsonb_typeof(e -> 'addedBy' -> 'id') = 'string'
                  and (e -> 'addedBy' ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                else false
              end,
          false))
    end,
    false);
$$;

revoke all on function private.inputs_shape_ok(jsonb) from public, anon, authenticated;

-- 2. submit_closing under a staff session. Never raises for expected failures.
drop function public.submit_closing(uuid, text, uuid, date, jsonb, text);

create function public.submit_closing(
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

  -- Same key seen before: a harmless retry only if it is the same closing (jsonb = ignores key order).
  select * into v_existing from public.closings where shop_id = v_shop and idempotency_key = p_idempotency_key;
  if v_existing.inputs = p_inputs and v_existing.staff_id = v_staff
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

revoke all on function public.submit_closing(text, uuid, date, jsonb, text) from public, anon;
grant execute on function public.submit_closing(text, uuid, date, jsonb, text) to authenticated;

-- 3. Suggestions: the shop is still identified by the calling (non-revoked) device; only the
--    latest non-voided closing of each business day counts (a resubmit supersedes earlier ones);
--    window = the shop's last 180 business days up to today. Malformed lines are skipped.
create or replace function public.expense_suggestion_data() returns table (description text, cents bigint, business_date date)
language sql stable security definer set search_path = '' as $$
  select e ->> 'description', (e ->> 'cents')::bigint, c.business_date
  from public.devices d
  cross join lateral (select private.business_date(d.shop_id) as today) t
  cross join lateral (
    select distinct on (cl.business_date) cl.business_date, cl.inputs
    from public.closings cl
    where cl.shop_id = d.shop_id and cl.voided_at is null
      and cl.business_date between t.today - 180 and t.today
    order by cl.business_date, cl.created_at desc, cl.id desc
  ) c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.inputs -> 'expenses') = 'array' then c.inputs -> 'expenses' else '[]'::jsonb end) e
  where d.user_id = (select auth.uid()) and d.revoked_at is null
    and jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'description') = 'string'
    and jsonb_typeof(e -> 'cents') = 'number'
    and (e ->> 'cents') ~ '^[0-9]{1,15}$';
$$;

revoke all on function public.expense_suggestion_data() from public, anon;
grant execute on function public.expense_suggestion_data() to authenticated;
