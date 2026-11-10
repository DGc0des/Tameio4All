-- Stage 2: the live shared closing. One "open closing" per shop per business day holds the typed
-- fields (denomination boxes, channel boxes, expense lines) as key/value rows. Phones write one
-- field at a time through server functions (last-write-wins, optional stale check); every write
-- is broadcast on the private realtime topic 'shop:<shop id>'.
--
-- Field model (shared with the TypeScript side):
--   d:<denomCents>          {"text": string, "mode": "amount"|"count"}
--   c:<channelId>           {"text": string}
--   e:<expenseId>           {"addedBy": {...}, "removed": boolean, "order": number}
--   e:<expenseId>:d | :a    {"text": string}                      (description / amount)
-- Key regex: ^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$ ; text <= 200 chars.

-- 1. Tables. No client can touch them directly.
create table public.open_closings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  business_date date not null,
  config_id uuid not null references public.shop_configs (id),
  revision bigint not null default 0,
  last_submit jsonb,
  created_at timestamptz not null default now(),
  unique (shop_id, business_date)
);
create index open_closings_config_idx on public.open_closings (config_id);

create table public.open_closing_fields (
  open_closing_id uuid not null references public.open_closings (id) on delete cascade,
  key text not null,
  value jsonb not null,
  version int not null,
  updated_by_staff uuid references public.staff (id),
  updated_by_owner uuid,
  updated_at timestamptz not null default now(),
  primary key (open_closing_id, key)
);
create index open_closing_fields_staff_idx on public.open_closing_fields (updated_by_staff);

alter table public.open_closings enable row level security;
alter table public.open_closing_fields enable row level security;
revoke all on public.open_closings, public.open_closing_fields from public, anon, authenticated;

-- 2. Get-or-create today's open closing of a shop, pinning the shop's latest config at creation.
create function private.open_closing_for(p_shop uuid) returns public.open_closings
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_shop);
  v_row public.open_closings;
begin
  select * into v_row from public.open_closings where shop_id = p_shop and business_date = v_date;
  if found then return v_row; end if;
  insert into public.open_closings (shop_id, business_date, config_id)
  select p_shop, v_date, sc.id from public.shop_configs sc
   where sc.shop_id = p_shop order by sc.version desc limit 1
  on conflict (shop_id, business_date) do nothing;
  select * into v_row from public.open_closings where shop_id = p_shop and business_date = v_date;
  return v_row;
end $$;

-- 3. Snapshot: {id, business_date, config_id, config, revision, last_submit, fields:[{key, value,
--    version, updated_by_name, updated_at}]}. updated_by_name = staff name, or «Ιδιοκτήτης».
create function private.closing_snapshot(p_oc uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', oc.id, 'business_date', oc.business_date, 'config_id', oc.config_id, 'config', sc.config,
    'revision', oc.revision, 'last_submit', oc.last_submit,
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

-- 4. Is (key, value) a well-formed field? (Shape only; author/slots/line existence are checked in
--    private.write_closing_field.)
create function private.closing_field_ok(p_key text, p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_key is null or p_value is null or jsonb_typeof(p_value) <> 'object'
     or p_key !~ '^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$' then
    return false;
  end if;
  if p_key ~ '^e:[A-Za-z0-9-]{1,64}$' then
    return jsonb_typeof(p_value -> 'removed') = 'boolean' and jsonb_typeof(p_value -> 'order') = 'number'
       and jsonb_typeof(p_value -> 'addedBy') = 'object';
  end if;
  if jsonb_typeof(p_value -> 'text') <> 'string' or char_length(p_value ->> 'text') > 200 then return false; end if;
  if p_key ~ '^d:' then return p_value ->> 'mode' in ('amount', 'count'); end if;
  return true;
end $$;

-- 5. The one write path (phone and owner). Caller has already authenticated; exactly one of
--    p_staff / p_owner is set. Returns {ok, version, revision} or {ok:false, error[, current]}.
create function private.write_closing_field(
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
  if not private.closing_field_ok(p_key, p_value) then
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
    if not (p_value -> 'removed')::boolean and (not v_exists or (v_cur.value -> 'removed')::boolean) then
      select coalesce((sc.config ->> 'maxExpenses')::int, 0) into v_max from public.shop_configs sc where sc.id = v_oc.config_id;
      select count(*) into v_used from public.open_closing_fields f
       where f.open_closing_id = v_oc.id and f.key ~ '^e:[A-Za-z0-9-]{1,64}$' and f.key <> p_key
         and not (f.value -> 'removed')::boolean;
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

revoke all on function private.open_closing_for(uuid), private.closing_snapshot(uuid),
  private.closing_field_ok(text, jsonb), private.write_closing_field(uuid, uuid, uuid, text, jsonb, int)
  from public, anon, authenticated;

-- 6. Phone functions. Session errors: not_a_device | device_revoked | session_invalid.
-- Returns {ok:true, closing:<snapshot>}.
create function public.get_open_closing(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess jsonb := private.staff_session(p_token);
  v_oc public.open_closings;
begin
  if not (v_sess ->> 'ok')::boolean then return v_sess; end if;
  v_oc := private.open_closing_for((v_sess ->> 'shop_id')::uuid);
  return jsonb_build_object('ok', true, 'closing', private.closing_snapshot(v_oc.id));
end $$;

-- Writes one field. {ok:true, version, revision} | {ok:false, error: session errors | wrong_day |
-- bad_field | too_many_expenses | stale (+ current {value, version, updated_by_name})}. A null
-- p_base_version means last-write-wins; otherwise a different current version is `stale`.
create function public.set_closing_field(
  p_token text, p_business_date date, p_key text, p_value jsonb, p_base_version int
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
  return private.write_closing_field(v_shop, (v_sess ->> 'staff_id')::uuid, null, p_key, p_value, p_base_version);
end $$;

-- 7. Owner functions: same shapes; the owner's day is always the shop's business date. `not_owner`
-- is raised like every other owner function.
create function public.owner_get_open_closing(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_oc public.open_closings;
begin
  perform private.require_owner(p_shop_id);
  v_oc := private.open_closing_for(p_shop_id);
  return jsonb_build_object('ok', true, 'closing', private.closing_snapshot(v_oc.id));
end $$;

create function public.owner_set_closing_field(p_shop_id uuid, p_key text, p_value jsonb, p_base_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_shop_id);
  return private.write_closing_field(p_shop_id, null, auth.uid(), p_key, p_value, p_base_version);
end $$;

revoke all on function public.get_open_closing(text), public.set_closing_field(text, date, text, jsonb, int),
  public.owner_get_open_closing(uuid), public.owner_set_closing_field(uuid, text, jsonb, int) from public, anon;
grant execute on function public.get_open_closing(text), public.set_closing_field(text, date, text, jsonb, int),
  public.owner_get_open_closing(uuid), public.owner_set_closing_field(uuid, text, jsonb, int) to authenticated;

-- 8. Realtime authorization. A client may use topic 'shop:<id>' if it owns the shop, or is a phone
-- paired (not revoked) to it with a live staff session for today's business date. Executable by
-- `authenticated` because the realtime.messages policies call it (like private.is_shop_owner).
create function private.can_use_shop_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_shop uuid;
begin
  if p_topic is null or p_topic !~ '^shop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_shop := substring(p_topic from 6)::uuid;
  if auth.uid() is null then return false; end if;
  if private.is_shop_owner(v_shop) then return true; end if;
  return exists (
    select 1
      from public.devices d
      join public.staff_sessions ss on ss.device_user_id = d.user_id and ss.shop_id = d.shop_id
      join public.staff st on st.id = ss.staff_id and st.shop_id = d.shop_id and st.active
     where d.user_id = auth.uid() and d.shop_id = v_shop and d.revoked_at is null
       and ss.revoked_at is null and ss.business_date = private.business_date(v_shop));
end $$;

revoke all on function private.can_use_shop_topic(text) from public, anon;
grant execute on function private.can_use_shop_topic(text) to authenticated;

create policy shop_topic_receive on realtime.messages for select to authenticated
  using (private.can_use_shop_topic((select realtime.topic())));
create policy shop_topic_send on realtime.messages for insert to authenticated
  with check (private.can_use_shop_topic((select realtime.topic())));
