-- Fix round 1 for the open closing (follows 20261108000001_open_closings.sql, which stays unchanged):
--  I1. closing_field_ok is strict and never NULL: exact property set per key kind, every predicate
--      false-on-missing. write_closing_field rejects anything that is not exactly `true`, and its
--      expense-cap checks cannot be skipped by a NULL.
--  I2. Clients may only INSERT presence messages into realtime.messages. `field` broadcasts come
--      solely from realtime.send inside the security definer functions (a client could otherwise
--      forge them). Realtime records the message type in realtime.messages.extension
--      ('presence' | 'broadcast').

-- Exact keys of a jsonb object, sorted, as text[] (null for a non-object).
create function private.jsonb_keys_sorted(p_value jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'object'
              then coalesce((select array_agg(k order by k) from jsonb_object_keys(p_value) k), '{}'::text[]) end;
$$;
revoke all on function private.jsonb_keys_sorted(jsonb) from public, anon, authenticated;

-- Shape check for (key, value). Always returns true or false, never NULL.
--   d:<cents>        {mode: "amount"|"count", text: string <= 200}
--   c:<id>           {text: string <= 200}
--   e:<id>           {addedBy: object, order: number, removed: boolean}
--   e:<id>:d | :a    {text: string <= 200}
create or replace function private.closing_field_ok(p_key text, p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_keys text[];
begin
  if p_key is null or p_value is null
     or p_key !~ '^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$' then
    return false;
  end if;
  v_keys := private.jsonb_keys_sorted(p_value);
  if v_keys is null then return false; end if;

  if p_key ~ '^e:[A-Za-z0-9-]{1,64}$' then
    return v_keys = array['addedBy', 'order', 'removed']
       and coalesce(jsonb_typeof(p_value -> 'removed') = 'boolean', false)
       and coalesce(jsonb_typeof(p_value -> 'order') = 'number', false)
       and coalesce(jsonb_typeof(p_value -> 'addedBy') = 'object', false);
  end if;
  if p_key ~ '^d:' then
    return v_keys = array['mode', 'text']
       and coalesce(jsonb_typeof(p_value -> 'text') = 'string' and char_length(p_value ->> 'text') <= 200, false)
       and coalesce(p_value ->> 'mode' in ('amount', 'count'), false);
  end if;
  -- c:<id>, e:<id>:d, e:<id>:a
  return v_keys = array['text']
     and coalesce(jsonb_typeof(p_value -> 'text') = 'string' and char_length(p_value ->> 'text') <= 200, false);
end $$;

-- Same write path as before; changes: strict validation result check and NULL-safe expense cap.
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
begin
  if private.closing_field_ok(p_key, p_value) is not true then
    return jsonb_build_object('ok', false, 'error', 'bad_field');
  end if;

  v_oc := private.open_closing_for(p_shop);
  perform 1 from public.open_closings where id = v_oc.id for update;   -- serialises writers of this closing

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
    -- A line that becomes visible (new, or un-removed) needs a free slot in the pinned config.
    -- Anything not provably `removed = true` counts as visible, so a NULL can never skip the cap.
    if (p_value ->> 'removed') is distinct from 'true'
       and (not v_exists or (v_cur.value ->> 'removed') is distinct from 'true') then
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

  return jsonb_build_object('ok', true, 'version', v_version, 'revision', v_revision);
end $$;

-- I2: clients may only send presence messages on their shop topic.
drop policy shop_topic_send on realtime.messages;
create policy shop_topic_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'presence' and private.can_use_shop_topic((select realtime.topic())));
