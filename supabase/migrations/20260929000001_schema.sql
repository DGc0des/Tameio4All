-- Tameio4All schema: shops, versioned settings, staff, paired phones, pairing codes, closings.
-- Default deny: RLS on everywhere, anon gets nothing, owners get read + a few column updates,
-- phones get no direct table access (server functions only).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create index shops_owner_idx on public.shops (owner_id);

create table public.shop_configs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  version int not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object' and config ->> 'schema' = '1' and pg_column_size(config) <= 65536),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (shop_id, version)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  pin_hash text not null,
  active boolean not null default true,
  failed_attempts int not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index staff_shop_name_uidx on public.staff (shop_id, lower(btrim(name)));

create table public.devices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 60),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index devices_shop_idx on public.devices (shop_id);

create table public.pairing_codes (
  code_hash text primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_by uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid
);
create index pairing_codes_shop_idx on public.pairing_codes (shop_id);

create table public.closings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  device_user_id uuid not null,
  config_id uuid not null references public.shop_configs (id),
  business_date date not null,
  inputs jsonb not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 100),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, idempotency_key)
);
create index closings_shop_date_idx on public.closings (shop_id, business_date desc);
create index closings_staff_idx on public.closings (staff_id);
create index closings_config_idx on public.closings (config_id);

alter table public.shops enable row level security;
alter table public.shop_configs enable row level security;
alter table public.staff enable row level security;
alter table public.devices enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.closings enable row level security;

-- Start from nothing (Supabase grants new tables to anon/authenticated by default).
revoke all on public.shops, public.shop_configs, public.staff, public.devices, public.pairing_codes, public.closings
  from public, anon, authenticated;

-- True only for a non-anonymous caller who owns the shop. Security definer so policies don't
-- recurse through RLS on shops.
create function private.is_shop_owner(p_shop_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.shops s where s.id = p_shop_id and s.owner_id = (select auth.uid()));
$$;
revoke all on function private.is_shop_owner(uuid) from public, anon;
grant execute on function private.is_shop_owner(uuid) to authenticated;

-- Owners: read their own rows.
grant select on public.shops, public.shop_configs, public.devices, public.closings to authenticated;
grant select (id, shop_id, name, active, failed_attempts, locked_until, created_at) on public.staff to authenticated;

create policy shops_owner_read on public.shops for select to authenticated using (private.is_shop_owner(id));
create policy configs_owner_read on public.shop_configs for select to authenticated using (private.is_shop_owner(shop_id));
create policy staff_owner_read on public.staff for select to authenticated using (private.is_shop_owner(shop_id));
create policy devices_owner_read on public.devices for select to authenticated using (private.is_shop_owner(shop_id));
create policy closings_owner_read on public.closings for select to authenticated using (private.is_shop_owner(shop_id));

-- Owners: the only direct changes allowed (column-level grants keep everything else read-only).
grant update (name, active) on public.staff to authenticated;
grant update (label, revoked_at) on public.devices to authenticated;
grant update (voided_at) on public.closings to authenticated;

create policy staff_owner_update on public.staff for update to authenticated
  using (private.is_shop_owner(shop_id)) with check (private.is_shop_owner(shop_id));
create policy devices_owner_update on public.devices for update to authenticated
  using (private.is_shop_owner(shop_id)) with check (private.is_shop_owner(shop_id));
create policy closings_owner_update on public.closings for update to authenticated
  using (private.is_shop_owner(shop_id)) with check (private.is_shop_owner(shop_id));
