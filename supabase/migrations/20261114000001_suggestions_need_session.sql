-- H23: expense suggestions need a live staff session. The zero-argument form only checked that the
-- caller had a device row, so anyone with the store link could read 180 days of expense lines.
-- Now the staff token is checked first (private.staff_session: token bound to this phone, the shop and
-- today's business date); without a live session the function returns no rows (it never raises).
drop function public.expense_suggestion_data();

create function public.expense_suggestion_data(p_token text) returns table (description text, cents bigint, business_date date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
begin
  if (v_sess ->> 'ok')::boolean is not true then return; end if;
  -- Same body as 20261111000001, with the shop taken from the session instead of the devices row.
  return query
  select e ->> 'description', (e ->> 'cents')::bigint, c.business_date
  from (select (v_sess ->> 'shop_id')::uuid as shop_id) s
  cross join lateral (select private.business_date(s.shop_id) as today) t
  cross join lateral (
    select distinct on (cl.business_date) cl.business_date, cl.inputs
    from public.closings cl
    where cl.shop_id = s.shop_id and cl.voided_at is null
      and cl.business_date between t.today - 180 and t.today
    order by cl.business_date, cl.seq desc
  ) c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.inputs -> 'expenses') = 'array' then c.inputs -> 'expenses' else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'description') = 'string'
    and jsonb_typeof(e -> 'cents') = 'number'
    and (e ->> 'cents') ~ '^[0-9]{1,15}$';
end $$;

revoke all on function public.expense_suggestion_data(text) from public, anon;
grant execute on function public.expense_suggestion_data(text) to authenticated;
