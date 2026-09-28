# Tameio4All Plan 3 — Supabase schema, security rules, server functions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The development database for Tameio4All: tables for shops, versioned settings, staff with hashed PINs, paired phones, pairing codes and closings; default-deny security rules; and the server functions owners and phones use — all proven by SQL security tests.

**Architecture:** SQL migration files in `supabase/migrations/` are the source of truth and are applied to the dev project `fstfuhogvsdaiwpfdmep` with the Supabase connector (`apply_migration`). Privileged work happens only in `security definer` functions with `search_path = ''`; internal helpers live in a `private` schema that the REST API does not expose. Tests are SQL scripts in `supabase/tests/` that create throwaway users, impersonate them (JWT claims + `set local role`) and always `ROLLBACK`.

**Tech Stack:** Supabase Postgres 17, pgcrypto (`extensions` schema), PL/pgSQL, Supabase connector (`apply_migration`, `execute_sql`, `get_advisors`).

**Spec:** `docs/superpowers/specs/2026-09-29-plan-3-supabase-design.md` (parent: `docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md`)

## Global Constraints

- Project id `fstfuhogvsdaiwpfdmep` (dev). Never run anything against another project.
- Every table has RLS enabled; `anon` has no privileges on any table or function; `authenticated` gets only the grants listed in Task 2.
- Every function is `security definer` with `set search_path = ''`, fully schema-qualifies every object (`public.`, `private.`, `extensions.`, `auth.`), and has `execute` revoked from `public, anon` and granted to `authenticated` only.
- Identity only from `auth.uid()` / `auth.jwt()`; never from an argument. Owner functions reject anonymous sessions.
- Expected failures of `verify_staff_pin` / `submit_closing` are returned as `{"ok": false, "error": <code>}` — never raised (a raise would roll back the PIN counter).
- The server never computes money. Config and inputs get only shape checks.
- Tests always end in `ROLLBACK`; nothing test-created may remain in the database.
- `get_advisors(security)` after each migration: no ERROR-level findings.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **PIN brute force**: five wrong PINs must lock the staff member for 15 minutes, and the counter must not be undone by an error — pinned in Task 4.
2. **Cross-shop access**: owner B and B's phones must not read, change or submit into shop A in any way — pinned in Tasks 2, 3, 5.
3. **Idempotency conflict**: same key + different inputs must be refused, not silently "succeed" — pinned in Task 5.
4. **Pairing code reuse / expiry / case**: a code works once, within 10 minutes, typed in any case or with spaces — pinned in Task 4.
5. **Column-level holes**: nobody can read `pin_hash` or change a closing's `inputs`, even the owner — pinned in Task 2.

---

## File Structure

```
supabase/migrations/20260929000001_schema.sql            tables, RLS, grants, policies, private.is_shop_owner
supabase/migrations/20260929000002_owner_functions.sql   create_shop, publish_config, create_staff, set_staff_pin, create_pairing_code
supabase/migrations/20260929000003_device_functions.sql  redeem_pairing_code, device_context, list_staff, verify_staff_pin
supabase/migrations/20260929000004_closings.sql          submit_closing, expense_suggestion_data
supabase/tests/README.md                                 how to run the tests
supabase/tests/010_tables_rls.sql
supabase/tests/020_owner_functions.sql
supabase/tests/030_device_functions.sql
supabase/tests/040_closings.sql
```

**How to run a migration:** `apply_migration(project_id: "fstfuhogvsdaiwpfdmep", name: "<file name without timestamp and .sql>", query: <file contents>)`. **How to run a test:** `execute_sql(project_id, query: <file contents>)`. A pass returns an empty/successful result; a failure returns an error whose message starts with the test id (e.g. `T3 …`).

Common test preamble (every test file starts with it, verbatim):

```sql
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());
```

Acting as a user (owner A shown; change `sub` and `is_anonymous`), and back to the migration owner:

```sql
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
-- … statements as that user …
reset role;
```

Expecting an error inside a test:

```sql
do $$ begin
  begin
    perform public.some_function(...);
  exception when others then
    if sqlerrm not like '%expected_code%' then raise exception 'Tn wrong error: %', sqlerrm; end if;
    return;
  end;
  raise exception 'Tn expected expected_code';
end $$;
```

---

### Task 1: Test harness and tooling check

**Files:**
- Create: `supabase/tests/README.md`

- [ ] **Step 1: Prove a failing assertion is reported and leaves nothing behind**

Run with `execute_sql`:

```sql
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f1@test.local', false, now(), now());
do $$ begin raise exception 'T0 deliberate failure'; end $$;
rollback;
```

Expected: an error containing `T0 deliberate failure`. Then run `select count(*) from auth.users where email like '%@test.local';` → `0`. If the count is not 0, stop: the connector keeps failed transactions open and the harness must be changed (report it).

- [ ] **Step 2: Write `supabase/tests/README.md`**

```markdown
# Database security tests

Each `*.sql` file here is one self-contained transaction: it creates throwaway users and data,
impersonates owners and paired phones (`request.jwt.claims` + `set local role authenticated`),
checks what they can and cannot do, and ends in `ROLLBACK` — nothing is left in the database.

Run a file against the **dev** project only:
- Supabase dashboard → SQL editor → paste the whole file → Run, or
- Claude via the Supabase connector (`execute_sql`).

A pass finishes without error. A failure raises an exception whose message starts with the test id
(`T3 owner B can read shop A`).

Test user ids: owner A `…a1`, owner B `…b1`, stranger `…51` (regular users); phones `…d1`, `…d2`
(anonymous users). All use the `@test.local` domain.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/README.md
git commit -m "chore(db): SQL security test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, RLS, grants and policies

**Files:**
- Create: `supabase/migrations/20260929000001_schema.sql`, `supabase/tests/010_tables_rls.sql`

- [ ] **Step 1: Write the test `supabase/tests/010_tables_rls.sql`**

```sql
-- 010 — direct table access. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Data inserted as the migration owner (bypasses RLS).
insert into public.shops (id, owner_id, name) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'Shop A'),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', 'Shop B');
insert into public.shop_configs (id, shop_id, version, config) values
  ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000aa01', 1, '{"schema":1}'),
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-00000000bb01', 1, '{"schema":1}');
insert into public.staff (id, shop_id, name, pin_hash) values
  ('00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-00000000aa01', 'ΜΑΡΙΑ', 'x'),
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000bb01', 'ΝΙΚΟΣ', 'x');
insert into public.devices (user_id, shop_id, label) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000aa01', 'Ταμείο');
insert into public.closings (id, shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000a501',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000ac01', '2026-09-28',
   '{"schema":1,"counts":{},"channelCents":{},"expenses":[]}', 'k1'),
  ('00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000b501',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000bc01', '2026-09-28',
   '{"schema":1,"counts":{},"channelCents":{},"expenses":[]}', 'k1');

-- T1 the anon role has no table access at all
set local role anon;
do $$ begin
  begin perform 1 from public.shops; exception when insufficient_privilege then return; end;
  raise exception 'T1 anon can read shops';
end $$;
reset role;

-- T2 a stranger (regular user, owns nothing) sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.shops) <> 0 then raise exception 'T2 stranger sees shops'; end if;
  if (select count(*) from public.shop_configs) <> 0 then raise exception 'T2 stranger sees configs'; end if;
  if (select count(id) from public.staff) <> 0 then raise exception 'T2 stranger sees staff'; end if;
  if (select count(*) from public.devices) <> 0 then raise exception 'T2 stranger sees devices'; end if;
  if (select count(*) from public.closings) <> 0 then raise exception 'T2 stranger sees closings'; end if;
end $$;
reset role;

-- T3–T8 as owner A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ declare n int; begin
  -- T3 sees only own rows
  if (select array_agg(name) from public.shops) is distinct from array['Shop A'] then raise exception 'T3 owner A sees wrong shops'; end if;
  if (select count(*) from public.shop_configs where shop_id <> '00000000-0000-0000-0000-00000000aa01') <> 0 then raise exception 'T3 owner A sees B configs'; end if;
  if (select array_agg(id) from public.staff) is distinct from array['00000000-0000-0000-0000-00000000a501'::uuid] then raise exception 'T3 owner A sees wrong staff'; end if;
  if (select array_agg(id) from public.closings) is distinct from array['00000000-0000-0000-0000-00000000ae01'::uuid] then raise exception 'T3 owner A sees wrong closings'; end if;
  if (select count(*) from public.devices) <> 1 then raise exception 'T3 owner A sees wrong devices'; end if;

  -- T4 pin_hash is unreadable
  begin perform pin_hash from public.staff; raise exception 'T4 owner can read pin_hash';
  exception when insufficient_privilege then null; end;

  -- T5 no direct inserts into protected tables
  begin insert into public.shops (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'X'); raise exception 'T5 owner can insert shops';
  exception when insufficient_privilege then null; end;
  begin insert into public.shop_configs (shop_id, version, config) values ('00000000-0000-0000-0000-00000000aa01', 2, '{"schema":1}'); raise exception 'T5 owner can insert configs';
  exception when insufficient_privilege then null; end;
  begin insert into public.staff (shop_id, name, pin_hash) values ('00000000-0000-0000-0000-00000000aa01', 'Y', 'x'); raise exception 'T5 owner can insert staff';
  exception when insufficient_privilege then null; end;
  begin insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
        values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-00000000ac01', '2026-09-28', '{}', 'k9');
        raise exception 'T5 owner can insert closings';
  exception when insufficient_privilege then null; end;

  -- T6 owner renames own staff; B's staff is untouched
  update public.staff set name = 'ΜΑΡΙΑ Κ' where id = '00000000-0000-0000-0000-00000000a501';
  get diagnostics n = row_count; if n <> 1 then raise exception 'T6 owner cannot rename own staff'; end if;
  update public.staff set name = 'hacked' where id = '00000000-0000-0000-0000-00000000b501';
  get diagnostics n = row_count; if n <> 0 then raise exception 'T6 owner renamed B staff'; end if;
  begin update public.staff set pin_hash = 'y' where id = '00000000-0000-0000-0000-00000000a501'; raise exception 'T6 owner can write pin_hash';
  exception when insufficient_privilege then null; end;

  -- T7 owner voids own closing but cannot change inputs; B's closing untouched
  update public.closings set voided_at = now() where id = '00000000-0000-0000-0000-00000000ae01';
  get diagnostics n = row_count; if n <> 1 then raise exception 'T7 owner cannot void own closing'; end if;
  begin update public.closings set inputs = '{}' where id = '00000000-0000-0000-0000-00000000ae01'; raise exception 'T7 owner can change inputs';
  exception when insufficient_privilege then null; end;
  update public.closings set voided_at = now() where id = '00000000-0000-0000-0000-00000000be01';
  get diagnostics n = row_count; if n <> 0 then raise exception 'T7 owner voided B closing'; end if;

  -- T8 pairing codes are not readable at all
  begin perform 1 from public.pairing_codes; raise exception 'T8 pairing codes readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- T9 an anonymous session carrying owner A's id sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.shops) <> 0 then raise exception 'T9 anonymous session sees owner shops'; end if;
end $$;
reset role;

-- T10 a paired phone has no direct table access to its shop's rows
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.shops) + (select count(*) from public.closings) + (select count(id) from public.staff) <> 0 then
    raise exception 'T10 phone reads tables directly';
  end if;
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `execute_sql` with the file contents. Expected: error `relation "public.shops" does not exist`.

- [ ] **Step 3: Write `supabase/migrations/20260929000001_schema.sql`**

```sql
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
```

- [ ] **Step 4: Apply it**

`apply_migration(project_id: "fstfuhogvsdaiwpfdmep", name: "schema", query: <file contents>)`. Expected: success.

- [ ] **Step 5: Run the test**

`execute_sql` with `supabase/tests/010_tables_rls.sql`. Expected: success (no error). Then `select count(*) from auth.users where email like '%@test.local' or is_anonymous;` → `0` and `select count(*) from public.shops;` → `0`.

- [ ] **Step 6: Security advisors**

`get_advisors(project_id, type: "security")`. Expected: no ERROR-level findings. Record any WARN findings in the task report with the reason they are acceptable, or fix them in a follow-up migration file `20260929000001b_schema_fixes.sql`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929000001_schema.sql supabase/tests/010_tables_rls.sql
git commit -m "feat(db): schema with default-deny RLS, column grants and owner policies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Owner functions

**Files:**
- Create: `supabase/migrations/20260929000002_owner_functions.sql`, `supabase/tests/020_owner_functions.sql`

**Interfaces (produced, used by Plan 4):** `create_shop(p_name text, p_config jsonb) → uuid`; `publish_config(p_shop_id uuid, p_expected_version int, p_config jsonb) → int`; `create_staff(p_shop_id uuid, p_name text, p_pin text) → uuid`; `set_staff_pin(p_staff_id uuid, p_pin text) → void`; `create_pairing_code(p_shop_id uuid) → text`. Errors (exception messages): `not_owner`, `bad_config`, `version_conflict`, `bad_pin_format`, `staff_name_taken`, `staff_not_found`.

- [ ] **Step 1: Write the test `supabase/tests/020_owner_functions.sql`**

```sql
-- 020 — owner functions. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- As owner A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;

-- T1 create_shop stores the shop and settings version 1
select set_config('t.shop_a', public.create_shop('  Join Juice  ', '{"schema":1,"floatCents":100000}')::text, true);
do $$ begin
  if (select name from public.shops where id = current_setting('t.shop_a')::uuid) <> 'Join Juice' then raise exception 'T1 shop name not trimmed/stored'; end if;
  if (select array_agg(version) from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid) is distinct from array[1] then raise exception 'T1 no version 1'; end if;
end $$;

-- T2 a malformed config is refused
do $$ begin
  begin perform public.create_shop('X', '{"schema":2}');
  exception when others then if sqlerrm not like '%bad_config%' then raise exception 'T2 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T2 expected bad_config';
end $$;
do $$ begin
  begin perform public.create_shop('X', '[1,2]');
  exception when others then if sqlerrm not like '%bad_config%' then raise exception 'T2b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T2b expected bad_config';
end $$;

-- T3 publish_config: expected version → next version; stale version → version_conflict
do $$ begin
  if public.publish_config(current_setting('t.shop_a')::uuid, 1, '{"schema":1,"floatCents":50000}') <> 2 then raise exception 'T3 not version 2'; end if;
  begin perform public.publish_config(current_setting('t.shop_a')::uuid, 1, '{"schema":1}');
  exception when others then if sqlerrm not like '%version_conflict%' then raise exception 'T3 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T3 expected version_conflict';
end $$;

-- T4 create_staff: 4-digit PIN only, stored hashed, names unique per shop (case/space-insensitive)
select set_config('t.staff_a', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
do $$ begin
  begin perform public.create_staff(current_setting('t.shop_a')::uuid, 'ΝΙΚΟΣ', '12a4');
  exception when others then if sqlerrm not like '%bad_pin_format%' then raise exception 'T4 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T4 expected bad_pin_format';
end $$;
do $$ begin
  begin perform public.create_staff(current_setting('t.shop_a')::uuid, ' μαρια ', '5678');
  exception when others then if sqlerrm not like '%staff_name_taken%' then raise exception 'T4b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T4b expected staff_name_taken';
end $$;

-- T5 create_pairing_code: 8 chars from the unambiguous alphabet
select set_config('t.code', public.create_pairing_code(current_setting('t.shop_a')::uuid), true);
do $$ begin
  if current_setting('t.code') !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'T5 bad code format: %', current_setting('t.code'); end if;
end $$;
reset role;

-- T6 PIN and code are stored hashed only (checked as the migration owner)
do $$ begin
  if (select pin_hash from public.staff where id = current_setting('t.staff_a')::uuid) = '1234' then raise exception 'T6 PIN stored in plain text'; end if;
  if (select extensions.crypt('1234', pin_hash) = pin_hash from public.staff where id = current_setting('t.staff_a')::uuid) is not true then raise exception 'T6 PIN hash does not verify'; end if;
  if (select count(*) from public.pairing_codes where code_hash = encode(extensions.digest(current_setting('t.code'), 'sha256'), 'hex')) <> 1 then raise exception 'T6 code not stored as sha256'; end if;
  if (select expires_at from public.pairing_codes where code_hash = encode(extensions.digest(current_setting('t.code'), 'sha256'), 'hex')) > now() + interval '10 minutes 5 seconds' then raise exception 'T6 code lives longer than 10 minutes'; end if;
end $$;

-- T7 owner B cannot touch shop A through any owner function
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.publish_config(current_setting('t.shop_a')::uuid, 2, '{"schema":1}');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 publish wrong error: %', sqlerrm; end if; end;
  begin perform public.create_staff(current_setting('t.shop_a')::uuid, 'Z', '1111');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 staff wrong error: %', sqlerrm; end if; end;
  begin perform public.set_staff_pin(current_setting('t.staff_a')::uuid, '1111');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 pin wrong error: %', sqlerrm; end if; end;
  begin perform public.create_pairing_code(current_setting('t.shop_a')::uuid);
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T7 code wrong error: %', sqlerrm; end if; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid) <> 2 then raise exception 'T7 B published into A'; end if;
  if (select count(*) from public.staff where shop_id = current_setting('t.shop_a')::uuid) <> 1 then raise exception 'T7 B added staff to A'; end if;
  if (select count(*) from public.pairing_codes where shop_id = current_setting('t.shop_a')::uuid) <> 1 then raise exception 'T7 B made a code for A'; end if;
end $$;

-- T8 anonymous sessions (phones) cannot use owner functions
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.create_shop('Phone shop', '{"schema":1}');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T8 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T8 phone created a shop';
end $$;
reset role;

-- T9 set_staff_pin by the owner changes the PIN and clears a lockout
update public.staff set failed_attempts = 3, locked_until = now() + interval '10 minutes' where id = current_setting('t.staff_a')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.set_staff_pin(current_setting('t.staff_a')::uuid, '9876');
reset role;
do $$ begin
  if (select extensions.crypt('9876', pin_hash) = pin_hash and failed_attempts = 0 and locked_until is null
      from public.staff where id = current_setting('t.staff_a')::uuid) is not true then raise exception 'T9 PIN not reset'; end if;
end $$;

-- T10 the anon role cannot execute any function
set local role anon;
do $$ begin
  begin perform public.create_shop('X', '{"schema":1}'); exception when insufficient_privilege then return; end;
  raise exception 'T10 anon can execute create_shop';
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Run to see it fail**

`execute_sql` with the file. Expected: error `function public.create_shop(unknown, unknown) does not exist`.

- [ ] **Step 3: Write `supabase/migrations/20260929000002_owner_functions.sql`**

```sql
-- Owner functions. Reject anonymous sessions and non-owners; identity only from auth.uid().

create function private.is_anonymous() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
$$;

create function private.require_owner(p_shop_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_shop_owner(p_shop_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
end $$;

create function private.check_config(p_config jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' or p_config ->> 'schema' is distinct from '1'
     or pg_column_size(p_config) > 65536 then
    raise exception 'bad_config' using errcode = '22023';
  end if;
end $$;

create function private.check_pin(p_pin text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'bad_pin_format' using errcode = '22023';
  end if;
end $$;

revoke all on function private.is_anonymous(), private.require_owner(uuid), private.check_config(jsonb), private.check_pin(text) from public, anon;
grant execute on function private.is_anonymous(), private.require_owner(uuid), private.check_config(jsonb), private.check_pin(text) to authenticated;

create function public.create_shop(p_name text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_shop uuid;
begin
  if v_uid is null or private.is_anonymous() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.check_config(p_config);
  insert into public.shops (owner_id, name) values (v_uid, btrim(p_name)) returning id into v_shop;
  insert into public.shop_configs (shop_id, version, config, created_by) values (v_shop, 1, p_config, v_uid);
  return v_shop;
end $$;

create function public.publish_config(p_shop_id uuid, p_expected_version int, p_config jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
begin
  perform private.require_owner(p_shop_id);
  perform private.check_config(p_config);
  perform 1 from public.shops where id = p_shop_id for update;  -- one publisher per shop at a time
  select coalesce(max(version), 0) into v_current from public.shop_configs where shop_id = p_shop_id;
  if v_current <> p_expected_version then
    raise exception 'version_conflict' using detail = format('current version is %s', v_current);
  end if;
  insert into public.shop_configs (shop_id, version, config, created_by)
  values (p_shop_id, v_current + 1, p_config, auth.uid());
  return v_current + 1;
end $$;

create function public.create_staff(p_shop_id uuid, p_name text, p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_owner(p_shop_id);
  perform private.check_pin(p_pin);
  insert into public.staff (shop_id, name, pin_hash)
  values (p_shop_id, btrim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'staff_name_taken' using errcode = '23505';
end $$;

create function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';  -- don't reveal whether the staff id exists
  end if;
  perform private.require_owner(v_shop);
  perform private.check_pin(p_pin);
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null
   where id = p_staff_id;
end $$;

-- 8 characters from 32 unambiguous symbols (no 0/O/1/I): 32^8 ≈ 10^12 codes, 10-minute life.
create function public.create_pairing_code(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  perform private.require_owner(p_shop_id);
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.pairing_codes (code_hash, shop_id, created_by, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), p_shop_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end $$;

revoke all on function public.create_shop(text, jsonb), public.publish_config(uuid, int, jsonb),
  public.create_staff(uuid, text, text), public.set_staff_pin(uuid, text), public.create_pairing_code(uuid)
  from public, anon;
grant execute on function public.create_shop(text, jsonb), public.publish_config(uuid, int, jsonb),
  public.create_staff(uuid, text, text), public.set_staff_pin(uuid, text), public.create_pairing_code(uuid)
  to authenticated;
```

Note on T7 `set_staff_pin` by owner B: the function raises `not_owner` for a staff id B doesn't own (and also for a non-existent id), so it never reveals whether an id exists.

- [ ] **Step 4: Apply** — `apply_migration(name: "owner_functions", …)`. Expected: success.

- [ ] **Step 5: Run tests 020 and 010** (010 must still pass). Expected: both succeed; leftover check → 0 test users, 0 shops.

- [ ] **Step 6: Security advisors** — no ERROR findings; note/justify WARNs.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929000002_owner_functions.sql supabase/tests/020_owner_functions.sql
git commit -m "feat(db): owner functions (shops, versioned settings, staff PINs, pairing codes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Phone functions — pairing, context, staff, PIN check

**Files:**
- Create: `supabase/migrations/20260929000003_device_functions.sql`, `supabase/tests/030_device_functions.sql`

**Interfaces (used by Plans 4–5):** `redeem_pairing_code(p_code text, p_label text) → uuid` (errors `not_a_device_session`, `invalid_code`); `device_context() → table(shop_id uuid, shop_name text, config_id uuid, version int, config jsonb)` (empty when not a live device); `list_staff() → table(id uuid, name text)`; `verify_staff_pin(p_staff_id uuid, p_pin text) → jsonb` `{ok:true}` or `{ok:false, error, locked_until?}` with errors `not_a_device`, `device_revoked`, `staff_not_found`, `staff_locked`, `bad_pin`. Internal: `private.device_shop() → jsonb`, `private.check_staff_pin(p_shop_id uuid, p_staff_id uuid, p_pin text) → jsonb`.

- [ ] **Step 1: Write the test `supabase/tests/030_device_functions.sql`**

```sql
-- 030 — pairing and phone functions. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A sets up a shop, two staff, a second settings version and a pairing code.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop', public.create_shop('Shop A', '{"schema":1}')::text, true);
select public.publish_config(current_setting('t.shop')::uuid, 1, '{"schema":1,"floatCents":100000}');
select set_config('t.maria', public.create_staff(current_setting('t.shop')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop')::uuid, 'ΝΙΚΟΣ', '5555')::text, true);
update public.staff set active = false where id = current_setting('t.nikos')::uuid;
select set_config('t.code', public.create_pairing_code(current_setting('t.shop')::uuid), true);

-- T1 an owner (non-anonymous) session cannot redeem a code
do $$ begin
  begin perform public.redeem_pairing_code(current_setting('t.code'), 'x');
  exception when others then if sqlerrm not like '%not_a_device_session%' then raise exception 'T1 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T1 owner redeemed a code';
end $$;
reset role;

-- Phone D1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

-- T2 before pairing: no context, not a device
do $$ begin
  if (select count(*) from public.device_context()) <> 0 then raise exception 'T2 unpaired phone has context'; end if;
  if public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'error' <> 'not_a_device' then raise exception 'T2 expected not_a_device'; end if;
end $$;

-- T3 redeem works with lowercase and spaces, once
do $$ begin
  if public.redeem_pairing_code('  ' || lower(current_setting('t.code')) || ' ', 'Ταμείο 1') <> current_setting('t.shop')::uuid then
    raise exception 'T3 redeem returned wrong shop';
  end if;
end $$;

-- T4 context = latest settings version; staff list = active only
do $$ begin
  if (select version from public.device_context()) <> 2 then raise exception 'T4 context not latest version'; end if;
  if (select config ->> 'floatCents' from public.device_context()) <> '100000' then raise exception 'T4 wrong config'; end if;
  if (select array_agg(name) from public.list_staff()) is distinct from array['ΜΑΡΙΑ'] then raise exception 'T4 staff list wrong'; end if;
end $$;

-- T5 correct PIN ok; wrong PIN ×4 bad_pin; 5th → locked; correct PIN while locked → still locked
do $$ declare r jsonb; begin
  if (public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'ok')::boolean is not true then raise exception 'T5 correct PIN refused'; end if;
  for i in 1..4 loop
    r := public.verify_staff_pin(current_setting('t.maria')::uuid, '0000');
    if r ->> 'error' <> 'bad_pin' then raise exception 'T5 attempt % expected bad_pin, got %', i, r; end if;
  end loop;
  r := public.verify_staff_pin(current_setting('t.maria')::uuid, '0000');
  if r ->> 'error' <> 'staff_locked' then raise exception 'T5 5th attempt expected staff_locked, got %', r; end if;
  r := public.verify_staff_pin(current_setting('t.maria')::uuid, '1234');
  if r ->> 'error' <> 'staff_locked' then raise exception 'T5 correct PIN while locked should stay locked, got %', r; end if;
end $$;
reset role;

-- T6 the lockout was persisted (the function returned instead of raising) — lock ≈ 15 minutes
do $$ begin
  if (select locked_until from public.staff where id = current_setting('t.maria')::uuid) not between now() + interval '14 minutes' and now() + interval '16 minutes' then
    raise exception 'T6 lockout not persisted for ~15 minutes';
  end if;
end $$;

-- T7 after the lock expires, the correct PIN works and resets the counter
update public.staff set locked_until = now() - interval '1 second', failed_attempts = 2 where id = current_setting('t.maria')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'ok')::boolean is not true then raise exception 'T7 correct PIN refused after lock expired'; end if;
  if public.verify_staff_pin(current_setting('t.nikos')::uuid, '5555') ->> 'error' <> 'staff_not_found' then raise exception 'T7 inactive staff accepted'; end if;
  if public.verify_staff_pin(current_setting('t.maria')::uuid, '12') ->> 'error' <> 'bad_pin' then raise exception 'T7 malformed PIN not bad_pin'; end if;
end $$;
reset role;
do $$ begin
  if (select failed_attempts from public.staff where id = current_setting('t.maria')::uuid) <> 1 then raise exception 'T7 counter not reset by correct PIN then +1 by bad one'; end if;
end $$;

-- T8 the used code cannot be redeemed again (by another phone); an expired code is refused
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.redeem_pairing_code(current_setting('t.code'), 'x');
  exception when others then if sqlerrm not like '%invalid_code%' then raise exception 'T8 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T8 code reused';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.code2', public.create_pairing_code(current_setting('t.shop')::uuid), true);
reset role;
update public.pairing_codes set expires_at = now() - interval '1 second' where code_hash = encode(extensions.digest(current_setting('t.code2'), 'sha256'), 'hex');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.redeem_pairing_code(current_setting('t.code2'), 'x');
  exception when others then if sqlerrm not like '%invalid_code%' then raise exception 'T8b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T8b expired code accepted';
end $$;
reset role;

-- T9 a revoked phone gets nothing
update public.devices set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.device_context()) <> 0 then raise exception 'T9 revoked phone has context'; end if;
  if (select count(*) from public.list_staff()) <> 0 then raise exception 'T9 revoked phone lists staff'; end if;
  if public.verify_staff_pin(current_setting('t.maria')::uuid, '1234') ->> 'error' <> 'device_revoked' then raise exception 'T9 expected device_revoked'; end if;
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Run to see it fail.** Expected: error `function public.redeem_pairing_code(text, unknown) does not exist`.

- [ ] **Step 3: Write `supabase/migrations/20260929000003_device_functions.sql`**

```sql
-- Phone (paired device) functions. A phone is an anonymous auth user with a live devices row.

create function private.device_shop() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_revoked timestamptz;
begin
  select d.shop_id, d.revoked_at into v_shop, v_revoked from public.devices d where d.user_id = auth.uid();
  if v_shop is null then return jsonb_build_object('ok', false, 'error', 'not_a_device'); end if;
  if v_revoked is not null then return jsonb_build_object('ok', false, 'error', 'device_revoked'); end if;
  return jsonb_build_object('ok', true, 'shop_id', v_shop);
end $$;

-- Returns a result instead of raising so the failed-attempt counter is never rolled back.
create function private.check_staff_pin(p_shop_id uuid, p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff_id and shop_id = p_shop_id and active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'staff_not_found'); end if;
  if v_staff.locked_until is not null and v_staff.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', v_staff.locked_until);
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    if v_staff.failed_attempts + 1 >= 5 then
      update public.staff set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = p_staff_id;
      return jsonb_build_object('ok', false, 'error', 'staff_locked', 'locked_until', now() + interval '15 minutes');
    end if;
    update public.staff set failed_attempts = failed_attempts + 1 where id = p_staff_id;
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;
  if v_staff.failed_attempts <> 0 or v_staff.locked_until is not null then
    update public.staff set failed_attempts = 0, locked_until = null where id = p_staff_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.device_shop(), private.check_staff_pin(uuid, uuid, text) from public, anon, authenticated;

create function public.redeem_pairing_code(p_code text, p_label text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
  v_row public.pairing_codes;
begin
  if v_uid is null or not private.is_anonymous() then
    raise exception 'not_a_device_session' using errcode = '42501';
  end if;
  select * into v_row from public.pairing_codes where code_hash = v_hash for update;
  if not found or v_row.used_at is not null or v_row.expires_at < now() then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  update public.pairing_codes set used_at = now(), used_by = v_uid where code_hash = v_hash;
  insert into public.devices (user_id, shop_id, label)
  values (v_uid, v_row.shop_id, left(btrim(coalesce(p_label, '')), 60))
  on conflict (user_id) do update
    set shop_id = excluded.shop_id, label = excluded.label, revoked_at = null, created_at = now();
  return v_row.shop_id;
end $$;

create function public.device_context()
returns table (shop_id uuid, shop_name text, config_id uuid, version int, config jsonb)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, c.id, c.version, c.config
  from public.devices d
  join public.shops s on s.id = d.shop_id
  join lateral (
    select sc.id, sc.version, sc.config from public.shop_configs sc
    where sc.shop_id = s.id order by sc.version desc limit 1
  ) c on true
  where d.user_id = (select auth.uid()) and d.revoked_at is null;
$$;

create function public.list_staff() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select st.id, st.name
  from public.devices d
  join public.staff st on st.shop_id = d.shop_id and st.active
  where d.user_id = (select auth.uid()) and d.revoked_at is null
  order by lower(st.name);
$$;

create function public.verify_staff_pin(p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev jsonb := private.device_shop();
begin
  if not (v_dev ->> 'ok')::boolean then return v_dev; end if;
  return private.check_staff_pin((v_dev ->> 'shop_id')::uuid, p_staff_id, p_pin);
end $$;

revoke all on function public.redeem_pairing_code(text, text), public.device_context(), public.list_staff(),
  public.verify_staff_pin(uuid, text) from public, anon;
grant execute on function public.redeem_pairing_code(text, text), public.device_context(), public.list_staff(),
  public.verify_staff_pin(uuid, text) to authenticated;
```

Note: `private.device_shop` and `private.check_staff_pin` are callable only by the security-definer functions (owner `postgres`), not by clients — execute is revoked from `authenticated` too.

- [ ] **Step 4: Apply** — `apply_migration(name: "device_functions", …)`.
- [ ] **Step 5: Run tests 030, 020, 010.** Expected: all succeed; leftover check → 0.
- [ ] **Step 6: Security advisors** — no ERROR findings.
- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929000003_device_functions.sql supabase/tests/030_device_functions.sql
git commit -m "feat(db): phone pairing, context, staff list and PIN check with lockout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Closings — submit and suggestion data

**Files:**
- Create: `supabase/migrations/20260929000004_closings.sql`, `supabase/tests/040_closings.sql`

**Interfaces (used by Plan 5):** `submit_closing(p_staff_id uuid, p_pin text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_idempotency_key text) → jsonb` → `{ok:true, closing_id, repeat}` or `{ok:false, error}` (errors: `not_a_device`, `device_revoked`, `staff_not_found`, `staff_locked`, `bad_pin`, `config_mismatch`, `bad_inputs`, `idempotency_conflict`); `expense_suggestion_data() → table(description text, cents bigint, business_date date)`.

- [ ] **Step 1: Write the test `supabase/tests/040_closings.sql`**

```sql
-- 040 — submitting closings and suggestion data. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner A: shop, staff, code. Owner B: shop + staff (for cross-shop checks).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.maria', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);
select set_config('t.code', public.create_pairing_code(current_setting('t.shop_a')::uuid), true);
select set_config('t.cfg_a', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_a')::uuid), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
select set_config('t.nikos', public.create_staff(current_setting('t.shop_b')::uuid, 'ΝΙΚΟΣ', '1234')::text, true);
select set_config('t.cfg_b', (select id::text from public.shop_configs where shop_id = current_setting('t.shop_b')::uuid), true);
reset role;

-- Phone D1 pairs with shop A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select public.redeem_pairing_code(current_setting('t.code'), 'Ταμείο');

do $$
declare
  good jsonb := '{"schema":1,"counts":{"10000":5},"channelCents":{"wolt":4560},"expenses":[{"description":"Nice","cents":1300}]}';
  r jsonb;
begin
  -- T1 happy path
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date, good, 'key-1');
  if (r ->> 'ok')::boolean is not true then raise exception 'T1 submit failed: %', r; end if;
  perform set_config('t.closing', r ->> 'closing_id', true);

  -- T2 same key, same inputs (key order different) → harmless repeat, same id
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date,
        '{"expenses":[{"cents":1300,"description":"Nice"}],"channelCents":{"wolt":4560},"counts":{"10000":5},"schema":1}', 'key-1');
  if (r ->> 'ok')::boolean is not true or r ->> 'closing_id' <> current_setting('t.closing') or (r ->> 'repeat')::boolean is not true then
    raise exception 'T2 repeat not recognised: %', r;
  end if;

  -- T3 same key, different inputs → idempotency_conflict
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date,
        '{"schema":1,"counts":{"10000":9},"channelCents":{},"expenses":[]}', 'key-1');
  if r ->> 'error' <> 'idempotency_conflict' then raise exception 'T3 expected idempotency_conflict: %', r; end if;

  -- T4 another shop's config / staff are refused
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_b')::uuid, current_date, good, 'key-2');
  if r ->> 'error' <> 'config_mismatch' then raise exception 'T4 expected config_mismatch: %', r; end if;
  r := public.submit_closing(current_setting('t.nikos')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date, good, 'key-2');
  if r ->> 'error' <> 'staff_not_found' then raise exception 'T4b expected staff_not_found: %', r; end if;

  -- T5 malformed inputs are refused
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date, '{"schema":2,"counts":{},"channelCents":{},"expenses":[]}', 'key-3');
  if r ->> 'error' <> 'bad_inputs' then raise exception 'T5 schema 2 accepted: %', r; end if;
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date, '{"schema":1,"counts":{},"channelCents":{}}', 'key-3');
  if r ->> 'error' <> 'bad_inputs' then raise exception 'T5 missing expenses accepted: %', r; end if;
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, null, good, 'key-3');
  if r ->> 'error' <> 'bad_inputs' then raise exception 'T5 null date accepted: %', r; end if;
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date, good, '');
  if r ->> 'error' <> 'bad_inputs' then raise exception 'T5 empty key accepted: %', r; end if;

  -- T6 wrong PIN stores nothing
  r := public.submit_closing(current_setting('t.maria')::uuid, '9999', current_setting('t.cfg_a')::uuid, current_date, good, 'key-4');
  if r ->> 'error' <> 'bad_pin' then raise exception 'T6 expected bad_pin: %', r; end if;

  -- T7 a second real closing stores fine
  r := public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date - 1,
        '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Μεβγάλ","cents":2160},{"description":7,"cents":"x"}]}', 'key-5');
  if (r ->> 'ok')::boolean is not true then raise exception 'T7 second closing failed: %', r; end if;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.closings where shop_id = current_setting('t.shop_a')::uuid) <> 2 then raise exception 'T8 expected exactly 2 stored closings'; end if;
  if (select device_user_id from public.closings where id = current_setting('t.closing')::uuid) <> '00000000-0000-0000-0000-0000000000d1' then raise exception 'T8 device not recorded'; end if;
end $$;

-- An old and a voided closing (inserted directly) must not appear in suggestions.
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key, voided_at) values
  (current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg_a')::uuid,
   current_date - 200, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Old","cents":100}]}', 'old', null),
  (current_setting('t.shop_a')::uuid, current_setting('t.maria')::uuid, '00000000-0000-0000-0000-0000000000d1', current_setting('t.cfg_a')::uuid,
   current_date, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Voided","cents":100}]}', 'void', now());
insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key) values
  (current_setting('t.shop_b')::uuid, current_setting('t.nikos')::uuid, '00000000-0000-0000-0000-0000000000d2', current_setting('t.cfg_b')::uuid,
   current_date, '{"schema":1,"counts":{},"channelCents":{},"expenses":[{"description":"Shop B supplier","cents":100}]}', 'b-1');

-- T9 suggestion data: own shop, last 180 days, not voided, malformed lines skipped
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  if (select array_agg(description order by description) from public.expense_suggestion_data()) is distinct from array['Nice', 'Μεβγάλ'] then
    raise exception 'T9 wrong suggestion data: %', (select array_agg(description) from public.expense_suggestion_data());
  end if;
  if (select cents from public.expense_suggestion_data() where description = 'Nice') <> 1300 then raise exception 'T9 wrong cents'; end if;
end $$;
reset role;

-- T10 an owner session (not a phone) cannot submit
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  if public.submit_closing(current_setting('t.maria')::uuid, '1234', current_setting('t.cfg_a')::uuid, current_date,
       '{"schema":1,"counts":{},"channelCents":{},"expenses":[]}', 'owner-key') ->> 'error' <> 'not_a_device' then
    raise exception 'T10 owner submitted a closing';
  end if;
  if (select count(*) from public.expense_suggestion_data()) <> 0 then raise exception 'T10 owner got phone suggestion data'; end if;
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Run to see it fail.** Expected: error `function public.submit_closing(…) does not exist`.

- [ ] **Step 3: Write `supabase/migrations/20260929000004_closings.sql`**

```sql
-- Submitting closings (raw inputs only — totals are recomputed by src/core) and suggestion data.

create function private.inputs_shape_ok(p_inputs jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_inputs) = 'object'
    and p_inputs ->> 'schema' = '1'
    and jsonb_typeof(p_inputs -> 'counts') = 'object'
    and jsonb_typeof(p_inputs -> 'channelCents') = 'object'
    and jsonb_typeof(p_inputs -> 'expenses') = 'array'
    and pg_column_size(p_inputs) <= 65536,
    false);
$$;
revoke all on function private.inputs_shape_ok(jsonb) from public, anon, authenticated;

create function public.submit_closing(
  p_staff_id uuid, p_pin text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev jsonb := private.device_shop();
  v_shop uuid;
  v_pin jsonb;
  v_existing public.closings;
  v_id uuid;
begin
  if not (v_dev ->> 'ok')::boolean then return v_dev; end if;
  v_shop := (v_dev ->> 'shop_id')::uuid;

  v_pin := private.check_staff_pin(v_shop, p_staff_id, p_pin);
  if not (v_pin ->> 'ok')::boolean then return v_pin; end if;

  if not exists (select 1 from public.shop_configs where id = p_config_id and shop_id = v_shop) then
    return jsonb_build_object('ok', false, 'error', 'config_mismatch');
  end if;
  if p_business_date is null or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 100 or not private.inputs_shape_ok(p_inputs) then
    return jsonb_build_object('ok', false, 'error', 'bad_inputs');
  end if;

  insert into public.closings (shop_id, staff_id, device_user_id, config_id, business_date, inputs, idempotency_key)
  values (v_shop, p_staff_id, auth.uid(), p_config_id, p_business_date, p_inputs, p_idempotency_key)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'closing_id', v_id, 'repeat', false);
  end if;

  -- Same key seen before: a harmless retry only if it is the same closing (jsonb = ignores key order).
  select * into v_existing from public.closings where shop_id = v_shop and idempotency_key = p_idempotency_key;
  if v_existing.inputs = p_inputs and v_existing.staff_id = p_staff_id
     and v_existing.config_id = p_config_id and v_existing.business_date = p_business_date then
    return jsonb_build_object('ok', true, 'closing_id', v_existing.id, 'repeat', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
end $$;

create function public.expense_suggestion_data() returns table (description text, cents bigint, business_date date)
language sql stable security definer set search_path = '' as $$
  select e ->> 'description', (e ->> 'cents')::bigint, c.business_date
  from public.devices d
  join public.closings c
    on c.shop_id = d.shop_id and c.voided_at is null and c.business_date >= current_date - 180
  cross join lateral jsonb_array_elements(c.inputs -> 'expenses') e
  where d.user_id = (select auth.uid()) and d.revoked_at is null
    and jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'description') = 'string'
    and jsonb_typeof(e -> 'cents') = 'number'
    and (e ->> 'cents') ~ '^[0-9]{1,15}$';
$$;

revoke all on function public.submit_closing(uuid, text, uuid, date, jsonb, text), public.expense_suggestion_data() from public, anon;
grant execute on function public.submit_closing(uuid, text, uuid, date, jsonb, text), public.expense_suggestion_data() to authenticated;
```

- [ ] **Step 4: Apply** — `apply_migration(name: "closings", …)`.
- [ ] **Step 5: Run tests 040, 030, 020, 010.** Expected: all succeed; leftover check → 0.
- [ ] **Step 6: Security advisors** — no ERROR findings; also `get_advisors(type: "performance")` and note anything relevant.
- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929000004_closings.sql supabase/tests/040_closings.sql
git commit -m "feat(db): submit_closing with PIN, idempotency and shape checks; suggestion data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_STATUS.md`, `README.md`, `docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md`

- [ ] **Step 1: `CLAUDE.md`** — in Architecture replace the "(Plan 3+)" line with:

```markdown
- `supabase/migrations/` — the database (source of truth; applied to the dev project
  `fstfuhogvsdaiwpfdmep` with the Supabase connector). `supabase/tests/` — SQL security tests,
  one rolled-back transaction each (see its README).
```

and add under Invariants:

```markdown
- Database: RLS on every table, `anon` gets nothing, phones have no direct table access (server
  functions only), every function is `security definer` + `search_path = ''` with execute for
  `authenticated` only. Identity only from `auth.uid()`/`auth.jwt()`.
- Cross-file invariant: the closing `inputs` shape is defined by `ClosingInputs` (src/core) AND
  checked by `private.inputs_shape_ok` (SQL). Bumping `schema` or changing the shape needs a new
  migration updating that check, or phones' submissions will be refused as `bad_inputs`.
- `verify_staff_pin` / `submit_closing` return `{ok:false,error}` for expected failures — never raise
  there (a raise rolls back the PIN lockout counter).
```

- [ ] **Step 2: `PROJECT_STATUS.md`** — set `- [x] Plan 3 — Supabase schema, RLS, RPCs (dev project)`; add to Tests: `Database: supabase/tests 010–040 (RLS, owner functions, pairing/PIN lockout, submit/idempotency/suggestions) — run against the dev project, all passing.`; add to Not verified: `Production Supabase project not created yet; anonymous sign-ins not yet enabled in the dashboard (needed before Plan 4); migrations applied via the connector, so remote migration versions are timestamps chosen by Supabase, not the file names.`

- [ ] **Step 3: `README.md`** — add a `## Database` section:

```markdown
## Database
Supabase (dev project `fstfuhogvsdaiwpfdmep`). Migrations: `supabase/migrations/` (apply in order).
Security tests: `supabase/tests/` — paste a file into the dashboard SQL editor and run; it cleans up
after itself. Before the owner app works: Authentication → Sign In / Providers → allow anonymous sign-ins.
```

- [ ] **Step 4: Parent spec** — in `2026-09-28-tameio4all-v1-design.md` change `expense_suggestion_data(shop_id)` to `expense_suggestion_data()` (shop from the caller's identity) and note that `submit_closing` refuses a reused idempotency key with different inputs.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md PROJECT_STATUS.md README.md docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md
git commit -m "docs: Plan 3 database architecture, invariants and status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
