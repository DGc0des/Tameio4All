-- Stage 3: closings become a version log. A day's current version is the non-voided row with the
-- highest `seq` (never created_at). Owner corrections (a later task) insert new rows of kind
-- 'owner_correction'; existing rows are never modified. This migration adds the columns, the
-- "current version" helper, the version JSON shape, and the owner history read functions.

-- 1. Columns. seq is back-filled in submission order, then becomes an identity.
alter table public.closings
  add column seq bigint,
  add column kind text not null default 'staff' check (kind in ('staff', 'owner_correction')),
  add column corrected_by uuid,
  add column corrects_closing_id uuid references public.closings (id),
  alter column staff_id drop not null,
  alter column device_user_id drop not null;
update public.closings c set seq = r.n
  from (select id, row_number() over (order by created_at, id) as n from public.closings) r where r.id = c.id;
alter table public.closings
  alter column seq set not null,
  alter column seq add generated always as identity,
  add constraint closings_seq_key unique (seq),
  add constraint closings_kind_shape check (
    (kind = 'staff' and staff_id is not null and device_user_id is not null
       and corrected_by is null and corrects_closing_id is null)
    or (kind = 'owner_correction' and staff_id is null and device_user_id is null and corrected_by is not null));
select setval(pg_get_serial_sequence('public.closings', 'seq'), coalesce((select max(seq) from public.closings), 0) + 1, false);
create index closings_corrects_idx on public.closings (corrects_closing_id);
create index closings_shop_date_seq_idx on public.closings (shop_id, business_date, seq desc) where voided_at is null;

-- 2. The one rule for "current version of a day" (null row when there is none).
create function private.current_closing(p_shop uuid, p_date date) returns public.closings
language sql stable security definer set search_path = '' as $$
  select * from public.closings c
   where c.shop_id = p_shop and c.business_date = p_date and c.voided_at is null
   order by c.seq desc limit 1;
$$;
revoke all on function private.current_closing(uuid, date) from public, anon, authenticated;

-- 3. The `version` payload shape shared with the TypeScript parsers.
create function private.closing_version_json(c public.closings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind,
    'author_name', coalesce((select s.name from public.staff s where s.id = c.staff_id), 'Ιδιοκτήτης'),
    'created_at', c.created_at, 'config_id', c.config_id, 'inputs', c.inputs,
    'corrects_closing_id', c.corrects_closing_id);
$$;
revoke all on function private.closing_version_json(public.closings) from public, anon, authenticated;

-- 4. Suggestions read the current version of each day (seq, not created_at).
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
    order by cl.business_date, cl.seq desc
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

-- 5. History list: submitted days (current version + count) and unsubmitted days (past open closing
--    with at least one field and no non-voided closing), newest first.
create function public.owner_list_closings(p_shop_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_to date;
  v_from date;
  v_days jsonb;
  v_cfgs jsonb;
begin
  perform private.require_owner(p_shop_id);
  v_today := private.business_date(p_shop_id);
  v_to := coalesce(p_to, v_today);
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to or v_to - v_from > 366 then
    return jsonb_build_object('ok', false, 'error', 'bad_range');
  end if;

  with sub as (
    select d.business_date, d.cnt, private.closing_version_json(cc) as ver, cc.config_id
    from (select c.business_date, count(*) as cnt
            from public.closings c
           where c.shop_id = p_shop_id and c.voided_at is null and c.business_date between v_from and v_to
           group by c.business_date) d
    cross join lateral private.current_closing(p_shop_id, d.business_date) cc
  ), unsub as (
    select oc.business_date, private.closing_snapshot(oc.id) as snap
      from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date between v_from and v_to and oc.business_date < v_today
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = oc.id)
       and not exists (select 1 from public.closings c
                        where c.shop_id = p_shop_id and c.business_date = oc.business_date and c.voided_at is null)
  ), items as (
    select business_date, jsonb_build_object('business_date', business_date, 'status', 'submitted',
             'version_count', cnt, 'current', ver) as j from sub
    union all
    select business_date, jsonb_build_object('business_date', business_date, 'status', 'unsubmitted',
             'open', snap) from unsub
  )
  select coalesce((select jsonb_agg(j order by business_date desc) from items), '[]'::jsonb),
         coalesce((select jsonb_object_agg(sc.id::text, sc.config)
                     from public.shop_configs sc where sc.id in (select config_id from sub)), '{}'::jsonb)
    into v_days, v_cfgs;

  return jsonb_build_object('ok', true, 'today', v_today, 'from', v_from, 'to', v_to,
                            'configs', v_cfgs, 'days', v_days);
end $$;

-- 6. One day in full: all non-voided versions (seq desc), their configs, the shop's staff names, and
--    the unsubmitted open closing when the day is one.
create function public.owner_get_closing_day(p_shop_id uuid, p_business_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_versions jsonb;
  v_cfgs jsonb;
  v_names jsonb;
  v_open jsonb := null;
  v_oc uuid;
begin
  perform private.require_owner(p_shop_id);
  v_today := private.business_date(p_shop_id);
  select coalesce(jsonb_agg(private.closing_version_json(c) order by c.seq desc), '[]'::jsonb)
    into v_versions
    from public.closings c
   where c.shop_id = p_shop_id and c.business_date = p_business_date and c.voided_at is null;
  select coalesce(jsonb_object_agg(sc.id::text, sc.config), '{}'::jsonb) into v_cfgs
    from public.shop_configs sc
   where sc.id in (select c.config_id from public.closings c
                    where c.shop_id = p_shop_id and c.business_date = p_business_date and c.voided_at is null);
  select coalesce(jsonb_object_agg(s.id::text, s.name), '{}'::jsonb) into v_names
    from public.staff s where s.shop_id = p_shop_id;
  if jsonb_array_length(v_versions) = 0 and p_business_date < v_today then
    select oc.id into v_oc from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date = p_business_date
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = oc.id);
    if v_oc is not null then v_open := private.closing_snapshot(v_oc); end if;
  end if;
  return jsonb_build_object('ok', true, 'today', v_today, 'business_date', p_business_date,
                            'versions', v_versions, 'configs', v_cfgs, 'staff_names', v_names, 'open', v_open);
end $$;

-- 7. Grants.
revoke all on function public.owner_list_closings(uuid, date, date) from public, anon;
grant execute on function public.owner_list_closings(uuid, date, date) to authenticated;
revoke all on function public.owner_get_closing_day(uuid, date) from public, anon;
grant execute on function public.owner_get_closing_day(uuid, date) to authenticated;
