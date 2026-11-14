-- Final review I1: `maxExpenses` is bounded on the server, and `private.write_closing_field` never raises on the
-- pinned config.
--
-- 1. `private.check_config` (latest body: 20260929000005_hardening.sql) also refuses, as `bad_config`, a
--    `maxExpenses` that is present but not a JSON integer in 0..30 — the rule of `validateConfig`
--    (src/core/config.ts). Cross-file invariant: change both together. A config without the key is still accepted
--    (the server reads it as 0, see 2). Only new configs (create_shop, publish_config) are checked; stored rows are
--    not touched, so this migration cannot fail on old data. Separate IF statements and a regex (no cast), so the
--    check itself cannot raise anything but `bad_config`.
-- 2. `private.max_expenses(config)` is the one server reading of `maxExpenses`: a JSON integer of at most 9 digits
--    -> clamped to 0..30; anything else (missing, null, string, fractional, negative, huge, non-object config) -> 0.
--    Never raises. Stored configs from before 1 (and any row written as the migration owner) go through it.
-- 3. `private.write_closing_field` (latest body: 20261114000005_closing_field_limits.sql) with only: both expense
--    caps (visible lines <= max, all e:<id> rows <= max * 5) use `private.max_expenses(v_cfg)` instead of two
--    `shop_configs` re-reads with an `::int` cast (which raised on "x", 2.5, 1e10, and `v_max * 5` overflowed), and
--    `jsonb_array_elements` gets `[]` unless the config value is an array (Postgres does not guarantee that the
--    `jsonb_typeof(...) = 'array' and exists (...)` guard runs left to right).
-- Comes after 20261114000006_six_digit_pins.sql and touches nothing in it.

-- 1. check_config: same attributes (immutable, not security definer: it reads no table) and privileges.
create or replace function private.check_config(p_config jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' or p_config -> 'schema' is distinct from '1'::jsonb
     or pg_column_size(p_config) > 65536 then
    raise exception 'bad_config' using errcode = '22023';
  end if;
  -- maxExpenses, when present: a JSON integer 0..30 (no cast: the regex decides).
  if p_config ? 'maxExpenses' then
    if jsonb_typeof(p_config -> 'maxExpenses') is distinct from 'number' then
      raise exception 'bad_config' using errcode = '22023';
    end if;
    if (p_config ->> 'maxExpenses') !~ '^([0-9]|[12][0-9]|30)$' then
      raise exception 'bad_config' using errcode = '22023';
    end if;
  end if;
end $$;

revoke all on function private.check_config(jsonb) from public, anon, authenticated;

-- 2. max_expenses: never raises. Each test is its own statement, so the cast only runs on 1-9 plain digits.
create or replace function private.max_expenses(p_config jsonb) returns int
language plpgsql immutable security definer set search_path = '' as $$
declare
  v_text text;
begin
  if jsonb_typeof(p_config) is distinct from 'object'
     or jsonb_typeof(p_config -> 'maxExpenses') is distinct from 'number' then
    return 0;
  end if;
  v_text := p_config ->> 'maxExpenses';
  if v_text is null or v_text !~ '^[0-9]{1,9}$' then
    return 0;   -- fractional, negative, exponent/huge
  end if;
  return least(v_text::int, 30);
end $$;

revoke all on function private.max_expenses(jsonb) from public, anon, authenticated;

-- 3. write_closing_field: create or replace keeps its privileges (revoked in 20261108000001_open_closings.sql),
--    restated below.
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
                       'updated_by_name', v_name, 'updated_at', v_now, 'business_date', v_oc.business_date),
    'field', 'shop:' || p_shop, true);

  return jsonb_build_object('ok', true, 'version', v_version, 'revision', v_revision, 'value', v_value);
end $$;

revoke all on function private.write_closing_field(uuid, uuid, uuid, text, jsonb, int) from public, anon, authenticated;
