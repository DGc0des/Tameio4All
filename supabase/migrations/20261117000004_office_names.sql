-- Stage 6: office-side names. Fields, versions and last_submit name the manager who acted instead of always
-- «Ιδιοκτήτης». Names are produced only here (SQL); the client never builds them. Payload shapes are unchanged.
-- Bodies copied whole from their latest versions (closing_snapshot and write_closing_field from
-- 20261117000001_multi_closing, closing_version_json from 20261111000001_closing_versions, owner_save_closing from
-- 20261117000003_shop_roles); only the name expressions change.

-- 1. The name of an office-side person: the display_name of the shop's member row for that uid with the latest
--    accepted_at (removed rows count: a removed manager keeps his name on past work; an erased one carries the
--    tombstone name written by owner_delete_account). Nobody found = the owner: «Ιδιοκτήτης».
create function private.office_name(p_shop uuid, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.display_name from public.shop_members m
      where m.shop_id = p_shop and m.member_uid = p_uid and m.accepted_at is not null
      order by m.accepted_at desc limit 1),
    'Ιδιοκτήτης');
$$;
revoke all on function private.office_name(uuid, uuid) from public, anon, authenticated;

-- 2. Version payload: author_name.
create or replace function private.closing_version_json(c public.closings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind,
    'author_name', coalesce((select s.name from public.staff s where s.id = c.staff_id),
                            private.office_name(c.shop_id, c.corrected_by)),
    'created_at', c.created_at, 'config_id', c.config_id, 'inputs', c.inputs,
    'corrects_closing_id', c.corrects_closing_id);
$$;
revoke all on function private.closing_version_json(public.closings) from public, anon, authenticated;

-- 3. Snapshot: updated_by_name of a field.
create or replace function private.closing_snapshot(p_oc uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', oc.id, 'business_date', oc.business_date, 'config_id', oc.config_id, 'config', sc.config,
    'revision', oc.revision, 'last_submit', oc.last_submit,
    'closing_no', oc.closing_no, 'closings_planned', oc.closings_planned, 'cash_mode', oc.cash_mode,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'value', f.value, 'version', f.version,
               'updated_by_name', coalesce(st.name, private.office_name(oc.shop_id, f.updated_by_owner)), 'updated_at', f.updated_at) order by f.key)
        from public.open_closing_fields f
        left join public.staff st on st.id = f.updated_by_staff
       where f.open_closing_id = oc.id), '[]'::jsonb))
  from public.open_closings oc
  join public.shop_configs sc on sc.id = oc.config_id
  where oc.id = p_oc;
$$;

revoke all on function private.closing_snapshot(uuid) from public, anon, authenticated;

-- 4. The one field write path: broadcast/returned name and the stale answer's current name.
create or replace function private.write_closing_field(
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
          coalesce((select name from public.staff where id = v_cur.updated_by_staff),
                   private.office_name(p_shop, v_cur.updated_by_owner)) end));
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

  v_name := case when p_staff is not null then (select name from public.staff where id = p_staff)
                 else private.office_name(p_shop, p_owner) end;
  perform realtime.send(
    jsonb_build_object('key', p_key, 'value', v_value, 'version', v_version, 'revision', v_revision,
                       'updated_by_name', v_name, 'updated_at', v_now, 'business_date', v_oc.business_date,
                       'closing_no', v_oc.closing_no),
    'field', 'shop:' || p_shop, true);

  return jsonb_build_object('ok', true, 'version', v_version, 'revision', v_revision, 'value', v_value);
end $$;
revoke all on function private.write_closing_field(uuid, uuid, uuid, int, text, jsonb, int) from public, anon, authenticated;

-- 5. owner_save_closing: last_submit.staff_name names the saving office person (guard kept: owner, manager).
create or replace function public.owner_save_closing(
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
  perform private.require_role(p_shop_id, array['owner', 'manager']);

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
      v_last := jsonb_build_object('closing_id', v_id, 'staff_name', private.office_name(p_shop_id, auth.uid()), 'at', v_at, 'revision', v_oc.revision,
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
revoke all on function public.owner_save_closing(uuid, date, uuid, jsonb, uuid, text, bigint, int) from public, anon;

