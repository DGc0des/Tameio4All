-- Stage 5, part 2: owner history, owner corrections and expense suggestions per closing.
--   * "Current version" is now per (shop, business date, closing_no): private.current_closing takes the number
--     (the 2-argument form is dropped).
--   * owner_list_closings: one item per day, each with its closings (submitted or unsubmitted) by closing_no.
--   * owner_get_closing_day: one item per closing of the day, plus the day's plan and the live closing's number.
--   * owner_save_closing: a trailing p_closing_no (default 1). Only the LIVE closing keeps today's rule (live
--     revision, live authors, last_submit + broadcast); an earlier closing of today is corrected like a past day.
--   * expense_suggestion_data: the current version of every closing; a 'running' day only its last closing (its
--     lines repeat in every checkpoint).
-- A day's cash_mode / closings_planned come from its closing-1 open closing; a day without one (rows from before
-- stage 2) reports 'separate' and the number of closings it has.
-- Latest bodies this starts from: current_closing / owner_list_closings / owner_get_closing_day
-- 20261111000001_closing_versions, owner_save_closing 20261111000003_today_save_and_submit_revision,
-- expense_suggestion_data(p_token) 20261114000001_suggestions_need_session. private.closing_version_json is unchanged.

-- 1. The one rule for "current version of a closing" (null row when there is none).
create function private.current_closing(p_shop uuid, p_date date, p_closing_no int) returns public.closings
language sql stable security definer set search_path = '' as $$
  select * from public.closings c
   where c.shop_id = p_shop and c.business_date = p_date and c.closing_no = p_closing_no and c.voided_at is null
   order by c.seq desc limit 1;
$$;

-- Its only callers (owner_list_closings, owner_save_closing) are re-created below with the 3-argument form.
drop function private.current_closing(uuid, date);

-- 2. History list: days newest first; each day carries its plan and its closings by closing_no.
--    entry = {closing_no, status:'submitted', version_count, current} | {closing_no, status:'unsubmitted', open}.
--    A closing is unsubmitted when its open closing is of a date before today, has at least one field and there is
--    no non-voided closings row for the same (business_date, closing_no).
create or replace function public.owner_list_closings(p_shop_id uuid, p_from date, p_to date) returns jsonb
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
    select d.business_date, d.closing_no, d.cnt, private.closing_version_json(cc) as ver, cc.config_id
    from (select c.business_date, c.closing_no, count(*) as cnt
            from public.closings c
           where c.shop_id = p_shop_id and c.voided_at is null and c.business_date between v_from and v_to
           group by c.business_date, c.closing_no) d
    cross join lateral private.current_closing(p_shop_id, d.business_date, d.closing_no) cc
  ), unsub as (
    select oc.business_date, oc.closing_no, private.closing_snapshot(oc.id) as snap
      from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date between v_from and v_to and oc.business_date < v_today
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = oc.id)
       and not exists (select 1 from public.closings c
                        where c.shop_id = p_shop_id and c.business_date = oc.business_date
                          and c.closing_no = oc.closing_no and c.voided_at is null)
  ), entries as (
    select business_date, closing_no, jsonb_build_object('closing_no', closing_no, 'status', 'submitted',
             'version_count', cnt, 'current', ver) as j from sub
    union all
    select business_date, closing_no, jsonb_build_object('closing_no', closing_no, 'status', 'unsubmitted',
             'open', snap) from unsub
  ), days as (
    select e.business_date,
           jsonb_build_object('business_date', e.business_date,
             'cash_mode', coalesce(p.cash_mode, 'separate'),
             'closings_planned', coalesce(p.closings_planned, count(distinct e.closing_no)),
             'closings', jsonb_agg(e.j order by e.closing_no)) as j
      from entries e
      left join public.open_closings p
        on p.shop_id = p_shop_id and p.business_date = e.business_date and p.closing_no = 1
     group by e.business_date, p.cash_mode, p.closings_planned
  )
  select coalesce((select jsonb_agg(j order by business_date desc) from days), '[]'::jsonb),
         coalesce((select jsonb_object_agg(sc.id::text, sc.config)
                     from public.shop_configs sc where sc.id in (select config_id from sub)), '{}'::jsonb)
    into v_days, v_cfgs;

  return jsonb_build_object('ok', true, 'today', v_today, 'from', v_from, 'to', v_to,
                            'configs', v_cfgs, 'days', v_days);
end $$;

-- 3. One day in full: one item per closing that has a non-voided version or is unsubmitted (closing_no
--    ascending), each with its versions (seq desc) and, for an unsubmitted one only, its open closing; the configs
--    of every version; the shop's staff names; the day's plan; live_closing_no = the live closing's number when the
--    date is the shop's business date and an open closing exists (null otherwise). Read only: never creates a row.
create or replace function public.owner_get_closing_day(p_shop_id uuid, p_business_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_closings jsonb;
  v_cfgs jsonb;
  v_names jsonb;
  v_plan public.open_closings;
  v_cash_mode text;
  v_planned int;
  v_live int := null;
begin
  perform private.require_owner(p_shop_id);
  v_today := private.business_date(p_shop_id);

  with nums as (
    select c.closing_no from public.closings c
     where c.shop_id = p_shop_id and c.business_date = p_business_date and c.voided_at is null
    union
    select oc.closing_no from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date = p_business_date and p_business_date < v_today
       and exists (select 1 from public.open_closing_fields f where f.open_closing_id = oc.id)
  ), items as (
    select u.closing_no,
           coalesce((select jsonb_agg(private.closing_version_json(c) order by c.seq desc)
                       from public.closings c
                      where c.shop_id = p_shop_id and c.business_date = p_business_date
                        and c.closing_no = u.closing_no and c.voided_at is null), '[]'::jsonb) as versions
      from nums u
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'closing_no', i.closing_no,
           'versions', i.versions,
           'open', case when i.versions = '[]'::jsonb then
                     (select private.closing_snapshot(oc.id) from public.open_closings oc
                       where oc.shop_id = p_shop_id and oc.business_date = p_business_date
                         and oc.closing_no = i.closing_no) end)
           order by i.closing_no), '[]'::jsonb)
    into v_closings
    from items i;

  select coalesce(jsonb_object_agg(sc.id::text, sc.config), '{}'::jsonb) into v_cfgs
    from public.shop_configs sc
   where sc.id in (select c.config_id from public.closings c
                    where c.shop_id = p_shop_id and c.business_date = p_business_date and c.voided_at is null);
  select coalesce(jsonb_object_agg(s.id::text, s.name), '{}'::jsonb) into v_names
    from public.staff s where s.shop_id = p_shop_id;

  select * into v_plan from public.open_closings
   where shop_id = p_shop_id and business_date = p_business_date and closing_no = 1;
  if found then
    v_cash_mode := v_plan.cash_mode;
    v_planned := v_plan.closings_planned;
  else
    -- Rows from before stage 2 (or an empty day): 'separate', as many closings as it has (at least 1).
    v_cash_mode := 'separate';
    v_planned := greatest(1, jsonb_array_length(v_closings));
  end if;

  if p_business_date = v_today then
    select max(oc.closing_no) into v_live from public.open_closings oc
     where oc.shop_id = p_shop_id and oc.business_date = v_today;
  end if;

  return jsonb_build_object('ok', true, 'today', v_today, 'business_date', p_business_date,
                            'cash_mode', v_cash_mode, 'closings_planned', v_planned, 'live_closing_no', v_live,
                            'closings', v_closings, 'configs', v_cfgs, 'staff_names', v_names);
end $$;

-- 4. owner_save_closing: body of 20261111000003 plus the trailing closing number. The day lock, the open closing
--    and the current-version guard are per (shop, date, closing_no). `v_live` (today AND this is the live closing)
--    replaces every "is today" test: only the live closing needs the live revision and authors and records
--    last_submit; an earlier closing of today is corrected like a past day (open_closings untouched, no broadcast).
--    A repeat (same key) must also name the same closing.
drop function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text, bigint);

create function public.owner_save_closing(
  p_shop_id uuid, p_business_date date, p_config_id uuid, p_inputs jsonb,
  p_expected_current_id uuid, p_idempotency_key text, p_revision bigint default null, p_closing_no int default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.closings;
  v_cur public.closings;
  v_oc public.open_closings;
  v_id uuid;
  v_today date;
  v_live boolean := false;
  v_at timestamptz := now();
  v_last jsonb;
begin
  perform private.require_owner(p_shop_id);

  if p_business_date is null or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100
     or p_closing_no is null or p_closing_no not between 1 and 6
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
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date
       and v_existing.closing_no = p_closing_no then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('closing-day:' || p_shop_id || ':' || p_business_date
                                                 || ':' || p_closing_no, 0));
  select * into v_oc from public.open_closings
   where shop_id = p_shop_id and business_date = p_business_date and closing_no = p_closing_no for update;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
       and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date
       and v_existing.closing_no = p_closing_no then
      return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;

  v_today := private.business_date(p_shop_id);
  if p_business_date > v_today then
    return jsonb_build_object('ok', false, 'error', 'no_closing_day');
  end if;
  -- The live closing: under our lock on v_oc a start_next_closing (which locks the live row) cannot commit a
  -- higher row; one that committed before is visible here, so v_oc is then not live.
  if p_business_date = v_today and v_oc.id is not null then
    v_live := v_oc.id = (private.open_closing_for(p_shop_id)).id;
  end if;
  -- Today with no open closing row but a current version would fall through the past-day path below: unreachable in
  -- practice, since a version of (shop, date, closing_no) is only stored by submit_closing (on the live open closing)
  -- or by this function (a first filing needs v_oc), and open closings are deleted only with their whole shop.

  v_cur := private.current_closing(p_shop_id, p_business_date, p_closing_no);
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
    -- The live closing with nothing submitted yet is the cashiers' (the owner has no Υποβολή); any other closing
    -- must be unsubmitted (an open closing with at least one field).
    if v_live or v_oc.id is null
       or not exists (select 1 from public.open_closing_fields f where f.open_closing_id = v_oc.id) then
      return jsonb_build_object('ok', false, 'error', 'no_closing_day');
    end if;
    if p_config_id is distinct from v_oc.config_id then
      return jsonb_build_object('ok', false, 'error', 'config_mismatch');
    end if;
  end if;

  if v_live then
    -- The live closing is the source of its numbers: same proof as a cashier's submit.
    if p_config_id is distinct from v_oc.config_id then
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

  insert into public.closings (shop_id, kind, corrected_by, corrects_closing_id, config_id, business_date, inputs,
                               idempotency_key, closing_no)
  values (p_shop_id, 'owner_correction', auth.uid(), v_cur.id, p_config_id, p_business_date, p_inputs,
          p_idempotency_key, p_closing_no)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    if v_live then
      v_last := jsonb_build_object('closing_id', v_id, 'staff_name', 'Ιδιοκτήτης', 'at', v_at, 'revision', v_oc.revision,
                                   'closing_no', v_oc.closing_no);
      update public.open_closings set last_submit = v_last where id = v_oc.id;
      perform realtime.send(v_last, 'submitted', 'shop:' || p_shop_id, true);
    end if;
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  select * into v_existing from public.closings where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if v_existing.kind = 'owner_correction' and v_existing.inputs = p_inputs
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date
     and v_existing.closing_no = p_closing_no then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

-- 5. Suggestions: the current version of every (business_date, closing_no); for a day whose closing-1 open closing
--    is 'running', only its highest-numbered closing (every checkpoint repeats the day's lines). Same session rule
--    as 20261114000001: without a live staff session no rows, never a raise.
create or replace function public.expense_suggestion_data(p_token text) returns table (description text, cents bigint, business_date date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
begin
  if (v_sess ->> 'ok')::boolean is not true then return; end if;
  return query
  select e ->> 'description', (e ->> 'cents')::bigint, c.business_date
  from (select (v_sess ->> 'shop_id')::uuid as shop_id) s
  cross join lateral (select private.business_date(s.shop_id) as today) t
  cross join lateral (
    select x.business_date, x.inputs
      from (select cur.business_date, cur.closing_no, cur.inputs,
                   max(cur.closing_no) over (partition by cur.business_date) as last_no
              from (select distinct on (cl.business_date, cl.closing_no) cl.business_date, cl.closing_no, cl.inputs
                      from public.closings cl
                     where cl.shop_id = s.shop_id and cl.voided_at is null
                       and cl.business_date between t.today - 180 and t.today
                     order by cl.business_date, cl.closing_no, cl.seq desc) cur) x
     where x.closing_no = x.last_no
        or not exists (select 1 from public.open_closings oc
                        where oc.shop_id = s.shop_id and oc.business_date = x.business_date
                          and oc.closing_no = 1 and oc.cash_mode = 'running')
  ) c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.inputs -> 'expenses') = 'array' then c.inputs -> 'expenses' else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'description') = 'string'
    and jsonb_typeof(e -> 'cents') = 'number'
    and (e ->> 'cents') ~ '^[0-9]{1,15}$';
end $$;

-- 6. Privileges. Private helper: nobody but the owner of the functions. Public functions: authenticated only.
revoke all on function private.current_closing(uuid, date, int) from public, anon, authenticated;

revoke all on function public.owner_list_closings(uuid, date, date),
  public.owner_get_closing_day(uuid, date),
  public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text, bigint, int),
  public.expense_suggestion_data(text)
  from public, anon;
grant execute on function public.owner_list_closings(uuid, date, date),
  public.owner_get_closing_day(uuid, date),
  public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text, bigint, int),
  public.expense_suggestion_data(text)
  to authenticated;
