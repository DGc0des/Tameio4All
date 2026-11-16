-- Stage 5, part 1: several closings per business day.
--   * Closings of a day are numbered 1..6 (`closing_no`); every open closing and every `closings` row carries one.
--   * The live closing of a shop is the highest-numbered open closing of its business date (`private.open_closing_for`).
--   * The day's plan (`closings_planned`, `cash_mode`, and the config) is pinned when closing 1 is created.
--   * The next closing starts only through `start_next_closing` (a signed-in cashier, the live one submitted and unchanged).
--   * Every write and submit names its closing; one that is not the live closing is refused as `wrong_closing`.
-- Existing rows read as closing 1 of a 1-closing, 'separate' day (column defaults).
-- Latest bodies this starts from: open_closing_for / closing_snapshot / set_closing_field 20261108000001_open_closings,
-- write_closing_field 20261114000007_max_expenses_clamp, owner_set_closing_field 20261108000003_live_fixes,
-- submit_closing 20261114000002_submit_lines_live_only. History, corrections and suggestions per closing are part 2
-- (20261117000002_multi_closing_history).

-- 1. Columns, constraints, indexes.
alter table public.shops
  add column closings_per_day int not null default 1 check (closings_per_day between 1 and 6),
  add column cash_mode text not null default 'separate' check (cash_mode in ('separate', 'running'));

alter table public.open_closings
  add column closing_no int not null default 1 check (closing_no between 1 and 6),
  add column closings_planned int not null default 1,
  add column cash_mode text not null default 'separate';
alter table public.open_closings drop constraint open_closings_shop_id_business_date_key;
alter table public.open_closings
  add constraint open_closings_shop_date_no_key unique (shop_id, business_date, closing_no);

alter table public.closings
  add column closing_no int not null default 1 check (closing_no between 1 and 6);
drop index public.closings_shop_date_seq_idx;
create index closings_shop_date_no_seq_idx on public.closings (shop_id, business_date, closing_no, seq desc)
  where voided_at is null;

-- 2. Owner: the plan for the days that start from now on (a day already started keeps its pinned plan).
create function public.set_closing_plan(p_shop_id uuid, p_count int, p_cash_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_shop_id);
  perform 1 from public.shops where id = p_shop_id for update;
  if p_count is null or p_count not between 1 and 6
     or p_cash_mode is null or p_cash_mode not in ('separate', 'running') then
    raise exception 'bad_closing_plan' using errcode = '22023';
  end if;
  update public.shops set closings_per_day = p_count, cash_mode = p_cash_mode where id = p_shop_id;
end $$;

-- 3. The live closing: the highest-numbered open closing of the shop's business date. A day without one gets
--    closing 1, pinning the shop's latest config and its current plan.
create or replace function private.open_closing_for(p_shop uuid) returns public.open_closings
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_shop);
  v_row public.open_closings;
begin
  select * into v_row from public.open_closings where shop_id = p_shop and business_date = v_date
   order by closing_no desc limit 1;
  if found then return v_row; end if;
  insert into public.open_closings (shop_id, business_date, config_id, closing_no, closings_planned, cash_mode)
  select p_shop, v_date, sc.id, 1, s.closings_per_day, s.cash_mode
    from public.shop_configs sc
    join public.shops s on s.id = sc.shop_id
   where sc.shop_id = p_shop order by sc.version desc limit 1
  on conflict (shop_id, business_date, closing_no) do nothing;
  select * into v_row from public.open_closings where shop_id = p_shop and business_date = v_date
   order by closing_no desc limit 1;
  return v_row;
end $$;

-- 4. Snapshot: as before plus closing_no, closings_planned, cash_mode.
create or replace function private.closing_snapshot(p_oc uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', oc.id, 'business_date', oc.business_date, 'config_id', oc.config_id, 'config', sc.config,
    'revision', oc.revision, 'last_submit', oc.last_submit,
    'closing_no', oc.closing_no, 'closings_planned', oc.closings_planned, 'cash_mode', oc.cash_mode,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'value', f.value, 'version', f.version,
               'updated_by_name', coalesce(st.name, 'Ιδιοκτήτης'), 'updated_at', f.updated_at) order by f.key)
        from public.open_closing_fields f
        left join public.staff st on st.id = f.updated_by_staff
       where f.open_closing_id = oc.id), '[]'::jsonb))
  from public.open_closings oc
  join public.shop_configs sc on sc.id = oc.config_id
  where oc.id = p_oc;
$$;

-- 5. The one write path, now naming its closing. Body of 20261114000007 plus the wrong_closing check and
--    closing_no in the `field` broadcast.
--    Under the lock on the live row: start_next_closing holds that same lock while it inserts the next closing,
--    so once we hold it, a higher row is either already visible (the row is no longer live) or cannot appear
--    until we commit.
drop function private.write_closing_field(uuid, uuid, uuid, text, jsonb, int);

create function private.write_closing_field(
  p_shop uuid, p_staff uuid, p_owner uuid, p_closing_no int, p_key text, p_value jsonb, p_base_version int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_oc public.open_closings;
  v_cur public.open_closing_fields;
  v_exists boolean;
  v_name text;
  v_value jsonb := p_value;
  v_version int;
  v_revision bigint;
  v_now timestamptz := now();
  v_max int;
  v_used int;
  v_cfg jsonb;
  v_ok boolean;
begin
  if private.closing_field_ok(p_key, p_value) is not true then
    return jsonb_build_object('ok', false, 'error', 'bad_field');
  end if;

  v_oc := private.open_closing_for(p_shop);
  select * into v_oc from public.open_closings where id = v_oc.id for update;   -- serialises writers of this closing
  if p_closing_no is distinct from v_oc.closing_no
     or exists (select 1 from public.open_closings o
                 where o.shop_id = v_oc.shop_id and o.business_date = v_oc.business_date
                   and o.closing_no > v_oc.closing_no) then
    return jsonb_build_object('ok', false, 'error', 'wrong_closing');
  end if;

  -- M42: d:/c: keys must exist in the pinned config (untrusted JSON: every check is NULL-safe and never raises).
  select sc.config into v_cfg from public.shop_configs sc where sc.id = v_oc.config_id;
  if p_key ~ '^d:' then
    v_ok := coalesce(
      p_key ~ '^d:[1-9][0-9]{0,5}$'
      and jsonb_typeof(v_cfg -> 'denominations') = 'array'
      and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_cfg -> 'denominations') = 'array'
                                                then v_cfg -> 'denominations' else '[]'::jsonb end) e
                   where e = to_jsonb(substring(p_key from 3)::int)), false);
    if not v_ok then
      return jsonb_build_object('ok', false, 'error', 'bad_field');
    end if;
  elsif p_key ~ '^c:' then
    v_ok := coalesce(
      jsonb_typeof(v_cfg -> 'channels') = 'array'
      and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_cfg -> 'channels') = 'array'
                                                then v_cfg -> 'channels' else '[]'::jsonb end) e
                   where jsonb_typeof(e) = 'object' and e ->> 'id' = substring(p_key from 3)), false);
    if not v_ok then
      return jsonb_build_object('ok', false, 'error', 'bad_field');
    end if;
  end if;

  select * into v_cur from public.open_closing_fields where open_closing_id = v_oc.id and key = p_key;
  v_exists := found;

  if p_base_version is not null and p_base_version <> (case when v_exists then v_cur.version else 0 end) then
    return jsonb_build_object('ok', false, 'error', 'stale', 'current', jsonb_build_object(
      'value', case when v_exists then v_cur.value end,
      'version', case when v_exists then v_cur.version else 0 end,
      'updated_by_name', case when v_exists then
          coalesce((select name from public.staff where id = v_cur.updated_by_staff), 'Ιδιοκτήτης') end));
  end if;

  if p_key ~ '^e:[A-Za-z0-9-]{1,64}$' then
    -- Author is decided here, never by the client; an existing line keeps its stored author.
    if v_exists then
      v_value := jsonb_set(p_value, '{addedBy}', v_cur.value -> 'addedBy');
    elsif p_staff is not null then
      v_value := jsonb_set(p_value, '{addedBy}', jsonb_build_object('kind', 'staff', 'id', p_staff));
    else
      v_value := jsonb_set(p_value, '{addedBy}', jsonb_build_object('kind', 'owner'));
    end if;
    -- M42: total e:<id> rows (removed ones too) are capped at maxExpenses * 5.
    if not v_exists then
      v_max := private.max_expenses(v_cfg);
      if (select count(*) from public.open_closing_fields f
           where f.open_closing_id = v_oc.id and f.key ~ '^e:[A-Za-z0-9-]{1,64}$') >= v_max * 5 then
        return jsonb_build_object('ok', false, 'error', 'too_many_expenses');
      end if;
    end if;
    -- A line that becomes visible (new, or un-removed) needs a free slot in the pinned config.
    -- The written value counts as visible unless it is provably removed (NULL-safe); the existing
    -- line must be provably removed for this to be an un-remove.
    if (p_value ->> 'removed') is distinct from 'true'
       and (not v_exists or (v_cur.value ->> 'removed') = 'true') then
      v_max := private.max_expenses(v_cfg);
      select count(*) into v_used from public.open_closing_fields f
       where f.open_closing_id = v_oc.id and f.key ~ '^e:[A-Za-z0-9-]{1,64}$' and f.key <> p_key
         and (f.value ->> 'removed') is distinct from 'true';
      if v_used + 1 > v_max then
        return jsonb_build_object('ok', false, 'error', 'too_many_expenses');
      end if;
    end if;
  elsif p_key ~ '^e:' then
    -- description/amount of a line that does not exist
    if not exists (select 1 from public.open_closing_fields
                    where open_closing_id = v_oc.id and key = substring(p_key from '^(e:[A-Za-z0-9-]+):[da]$')) then
      return jsonb_build_object('ok', false, 'error', 'bad_field');
    end if;
  end if;

  v_version := case when v_exists then v_cur.version + 1 else 1 end;
  insert into public.open_closing_fields (open_closing_id, key, value, version, updated_by_staff, updated_by_owner, updated_at)
  values (v_oc.id, p_key, v_value, v_version, p_staff, p_owner, v_now)
  on conflict (open_closing_id, key) do update
    set value = excluded.value, version = excluded.version, updated_by_staff = excluded.updated_by_staff,
        updated_by_owner = excluded.updated_by_owner, updated_at = excluded.updated_at;
  update public.open_closings set revision = revision + 1 where id = v_oc.id returning revision into v_revision;

  v_name := case when p_staff is not null then (select name from public.staff where id = p_staff) else 'Ιδιοκτήτης' end;
  perform realtime.send(
    jsonb_build_object('key', p_key, 'value', v_value, 'version', v_version, 'revision', v_revision,
                       'updated_by_name', v_name, 'updated_at', v_now, 'business_date', v_oc.business_date,
                       'closing_no', v_oc.closing_no),
    'field', 'shop:' || p_shop, true);

  return jsonb_build_object('ok', true, 'version', v_version, 'revision', v_revision, 'value', v_value);
end $$;

-- 6. Phone and owner field writes: same as before plus the trailing closing number (default 1, so an older
--    build keeps working in a 1-closing shop). Also returns `wrong_closing`.
drop function public.set_closing_field(text, date, text, jsonb, int);

create function public.set_closing_field(
  p_token text, p_business_date date, p_key text, p_value jsonb, p_base_version int, p_closing_no int default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
  v_shop uuid;
begin
  if not (v_sess ->> 'ok')::boolean then return v_sess; end if;
  v_shop := (v_sess ->> 'shop_id')::uuid;
  if p_business_date is distinct from private.business_date(v_shop) then
    return jsonb_build_object('ok', false, 'error', 'wrong_day');
  end if;
  return private.write_closing_field(v_shop, (v_sess ->> 'staff_id')::uuid, null, p_closing_no,
                                     p_key, p_value, p_base_version);
end $$;

drop function public.owner_set_closing_field(uuid, date, text, jsonb, int);

-- {ok:true, version, revision, value} | {ok:false, error: wrong_day | wrong_closing | bad_field |
-- too_many_expenses | stale (+ current)}; `not_owner` is raised like every other owner function.
create function public.owner_set_closing_field(
  p_shop_id uuid, p_business_date date, p_key text, p_value jsonb, p_base_version int, p_closing_no int default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_shop_id);
  if p_business_date is distinct from private.business_date(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'wrong_day');
  end if;
  return private.write_closing_field(p_shop_id, null, auth.uid(), p_closing_no, p_key, p_value, p_base_version);
end $$;

-- 7. A cashier starts the next closing of the day. p_closing_no is the closing the phone shows as live.
--    {ok:true, closing:<snapshot>} | {ok:false, error: session errors | wrong_day | wrong_closing | not_submitted |
--    no_more_closings}. A repeat (the next one already exists) answers ok with its snapshot.
--    Lock: the live row `for update` (the same lock writers and submit take), then the day's highest row is re-read.
create function public.start_next_closing(p_token text, p_business_date date, p_closing_no int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
  v_shop uuid;
  v_locked public.open_closings;
  v_oc public.open_closings;
  v_new public.open_closings;
begin
  if not (v_sess ->> 'ok')::boolean then return v_sess; end if;
  v_shop := (v_sess ->> 'shop_id')::uuid;
  if p_business_date is distinct from private.business_date(v_shop) then
    return jsonb_build_object('ok', false, 'error', 'wrong_day');
  end if;

  v_locked := private.open_closing_for(v_shop);
  select * into v_locked from public.open_closings where id = v_locked.id for update;
  select * into v_oc from public.open_closings
   where shop_id = v_shop and business_date = v_locked.business_date
   order by closing_no desc limit 1;

  if p_closing_no >= 1 and v_oc.closing_no = p_closing_no + 1 then
    return jsonb_build_object('ok', true, 'closing', private.closing_snapshot(v_oc.id));   -- a repeat
  end if;
  -- A null/out-of-range number is not the live closing either; a highest row we did not lock (a start that
  -- committed while we waited) is only ever answered as a repeat above.
  if p_closing_no is distinct from v_oc.closing_no or v_oc.id <> v_locked.id then
    return jsonb_build_object('ok', false, 'error', 'wrong_closing');
  end if;
  if p_closing_no >= v_oc.closings_planned then
    return jsonb_build_object('ok', false, 'error', 'no_more_closings');
  end if;
  if v_oc.last_submit is null or (v_oc.last_submit ->> 'revision')::bigint is distinct from v_oc.revision then
    return jsonb_build_object('ok', false, 'error', 'not_submitted');
  end if;

  insert into public.open_closings (shop_id, business_date, config_id, closing_no, closings_planned, cash_mode)
  values (v_shop, v_oc.business_date, v_oc.config_id, v_oc.closing_no + 1, v_oc.closings_planned, v_oc.cash_mode)
  returning * into v_new;

  if v_oc.cash_mode = 'running' then
    -- The visible expense lines (meta, description, amount) carry over; count and channel boxes start empty.
    insert into public.open_closing_fields (open_closing_id, key, value, version, updated_by_staff, updated_by_owner, updated_at)
    select v_new.id, f.key, f.value, 1, f.updated_by_staff, f.updated_by_owner, now()
      from public.open_closing_fields f
     where f.open_closing_id = v_oc.id
       and f.key ~ '^e:[A-Za-z0-9-]{1,64}(:[da])?$'
       and exists (select 1 from public.open_closing_fields m
                    where m.open_closing_id = v_oc.id
                      and m.key = substring(f.key from '^(e:[A-Za-z0-9-]{1,64})')
                      and (m.value -> 'removed') = 'false'::jsonb);
  end if;

  perform realtime.send(
    jsonb_build_object('business_date', v_new.business_date, 'closing_no', v_new.closing_no),
    'closing_started', 'shop:' || v_shop, true);

  return jsonb_build_object('ok', true, 'closing', private.closing_snapshot(v_new.id));
end $$;

-- 8. Submit: body of 20261114000002 plus the trailing closing number. The idempotency lookup still answers a
--    repeat first; after the lock, a closing that is not the live one is `wrong_closing` (before config_mismatch).
drop function public.submit_closing(text, uuid, date, jsonb, bigint, text);

create function public.submit_closing(
  p_token text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_revision bigint, p_idempotency_key text,
  p_closing_no int default 1
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
  if p_closing_no is distinct from v_oc.closing_no
     or exists (select 1 from public.open_closings o
                 where o.shop_id = v_oc.shop_id and o.business_date = v_oc.business_date
                   and o.closing_no > v_oc.closing_no) then
    return jsonb_build_object('ok', false, 'error', 'wrong_closing');
  end if;
  if v_oc.config_id is distinct from p_config_id then
    return jsonb_build_object('ok', false, 'error', 'config_mismatch');
  end if;
  if p_revision is distinct from v_oc.revision then
    return jsonb_build_object('ok', false, 'error', 'draft_changed', 'revision', v_oc.revision);
  end if;

  -- M40: every submitted line must exist (not removed) in the live closing, with its stored author.
  if exists (
       select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
       where not exists (select 1 from public.open_closing_fields f
                          where f.open_closing_id = v_oc.id and f.key = 'e:' || (e ->> 'id')
                            and (f.value ->> 'removed') is distinct from 'true'
                            and (f.value -> 'addedBy') is not distinct from (e -> 'addedBy'))) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

  insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key, closing_no)
  values (v_shop, v_staff, auth.uid(), p_config_id, p_business_date, p_inputs, p_idempotency_key, v_oc.closing_no)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    select name into v_name from public.staff where id = v_staff;
    v_last := jsonb_build_object('closing_id', v_id, 'staff_name', v_name, 'at', v_at, 'revision', v_oc.revision,
                                 'closing_no', v_oc.closing_no);
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

-- 9. Privileges. Private helpers: nobody but the owner of the functions. Public functions: authenticated only.
revoke all on function private.open_closing_for(uuid), private.closing_snapshot(uuid),
  private.write_closing_field(uuid, uuid, uuid, int, text, jsonb, int)
  from public, anon, authenticated;

revoke all on function public.set_closing_plan(uuid, int, text),
  public.set_closing_field(text, date, text, jsonb, int, int),
  public.owner_set_closing_field(uuid, date, text, jsonb, int, int),
  public.start_next_closing(text, date, int),
  public.submit_closing(text, uuid, date, jsonb, bigint, text, int)
  from public, anon;
grant execute on function public.set_closing_plan(uuid, int, text),
  public.set_closing_field(text, date, text, jsonb, int, int),
  public.owner_set_closing_field(uuid, date, text, jsonb, int, int),
  public.start_next_closing(text, date, int),
  public.submit_closing(text, uuid, date, jsonb, bigint, text, int)
  to authenticated;
