-- M42: live closing fields limited to the pinned config.
--
-- `private.write_closing_field` (latest body: 20261108000003_live_fixes.sql) only checked keys against the key
-- regex, and removed expense lines were never counted, so a signed-in cashier could write unlimited fields until
-- the day's snapshot stopped loading. Now, after the closing is locked:
--   * `d:<cents>` must be canonical (`^d:[1-9][0-9]{0,5}$`) and an element of the pinned config's `denominations`;
--   * `c:<id>` must equal the `id` of an element of the pinned config's `channels`;
--   * a new `e:<id>` line is refused (`too_many_expenses`) once the closing already holds `maxExpenses * 5`
--     `e:<id>` rows, removed ones included.
-- The config is untrusted JSON (the server only checks `schema`): junk `denominations`/`channels` (not an array)
-- simply means no key is accepted -> `bad_field`; the checks never raise. Rejected writes return before the
-- revision bump. `closing_field_ok` and the signature are unchanged; the rest of the body is as before.

create or replace function private.write_closing_field(
  p_shop uuid, p_staff uuid, p_owner uuid, p_key text, p_value jsonb, p_base_version int
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
  perform 1 from public.open_closings where id = v_oc.id for update;   -- serialises writers of this closing

  -- M42: d:/c: keys must exist in the pinned config (untrusted JSON: every check is NULL-safe and never raises).
  select sc.config into v_cfg from public.shop_configs sc where sc.id = v_oc.config_id;
  if p_key ~ '^d:' then
    v_ok := coalesce(
      p_key ~ '^d:[1-9][0-9]{0,5}$'
      and jsonb_typeof(v_cfg -> 'denominations') = 'array'
      and exists (select 1 from jsonb_array_elements(v_cfg -> 'denominations') e
                   where e = to_jsonb(substring(p_key from 3)::int)), false);
    if not v_ok then
      return jsonb_build_object('ok', false, 'error', 'bad_field');
    end if;
  elsif p_key ~ '^c:' then
    v_ok := coalesce(
      jsonb_typeof(v_cfg -> 'channels') = 'array'
      and exists (select 1 from jsonb_array_elements(v_cfg -> 'channels') e
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
      select coalesce((sc.config ->> 'maxExpenses')::int, 0) into v_max from public.shop_configs sc where sc.id = v_oc.config_id;
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
      select coalesce((sc.config ->> 'maxExpenses')::int, 0) into v_max from public.shop_configs sc where sc.id = v_oc.config_id;
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
                       'updated_by_name', v_name, 'updated_at', v_now, 'business_date', v_oc.business_date),
    'field', 'shop:' || p_shop, true);

  return jsonb_build_object('ok', true, 'version', v_version, 'revision', v_revision, 'value', v_value);
end $$;
