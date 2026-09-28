# Tameio4All Plan 3 — Supabase schema, security rules, server functions — design

Parent spec: `2026-09-28-tameio4all-v1-design.md` ("Data & security"). This document fixes the
details that spec left open. Agreed 2026-09-29.

## Goal

The database behind Tameio4All: owners own shops; each shop has versioned settings, staff with
hashed PINs, paired phones and stored closings. Everything is locked down by default; phones can
only do what the server functions allow. No UI in this plan (owner app = Plan 4, register wiring =
Plan 5).

## Environment

- Supabase project **tameio4All** (`fstfuhogvsdaiwpfdmep`, eu-west-1) is the **development**
  database. A separate production project is created later and replays the same migrations.
- No local Supabase/Docker: migrations are SQL files in `supabase/migrations/` (source of truth,
  committed) and are applied with the Supabase connector (`apply_migration`). Security advisors are
  checked after every migration.
- Tests are SQL scripts in `supabase/tests/`, each a single transaction that impersonates users
  (JWT claims + role) and always ends in `ROLLBACK`, so the dev database stays clean. A failed check
  raises an exception naming the test. They are run through the connector and can be re-run from the
  dashboard SQL editor. Task 1 of the plan verifies this tooling works before anything else is built.
- Before Plan 4: the owner enables Authentication → Sign In / Providers → "Allow anonymous sign-ins"
  (phones sign in anonymously). Plan 3's tests simulate these users and don't need it.

## Roles

| Who | How identified | Can |
|---|---|---|
| Owner | authenticated, non-anonymous user (`auth.uid()`, `is_anonymous` false) | everything about their own shops |
| Paired phone | anonymous user with a live `devices` row | read its shop's current settings and staff names; submit closings; read suggestion data |
| Anyone else | anon / other users | nothing |

Identity always comes from `auth.uid()` / `auth.jwt()`, never from a function argument.

## Tables (schema `public`, RLS on for all, default deny)

- `shops(id uuid pk, owner_id uuid → auth.users on delete cascade, name text 1–80, created_at)`
- `shop_configs(id uuid pk, shop_id → shops cascade, version int > 0, config jsonb, created_by uuid,
  created_at, unique(shop_id, version))` — insert-only, only through `publish_config`/`create_shop`.
- `staff(id uuid pk, shop_id → shops cascade, name text 1–40, pin_hash text, active bool default
  true, failed_attempts int default 0, locked_until timestamptz, created_at, unique(shop_id, lower(name)))`
  — `pin_hash` is readable by nobody (column privilege revoked).
- `devices(user_id uuid pk → auth.users cascade, shop_id → shops cascade, label text, created_at,
  revoked_at)`
- `pairing_codes(code_hash text pk, shop_id → shops cascade, created_by uuid, expires_at,
  used_at, used_by uuid)` — no direct access for anyone.
- `closings(id uuid pk, shop_id → shops cascade, staff_id → staff, device_user_id uuid, config_id →
  shop_configs, business_date date, inputs jsonb, idempotency_key text, voided_at, created_at,
  unique(shop_id, idempotency_key))` — insert only through `submit_closing`.

**Direct table privileges (authenticated role, filtered by RLS to the caller's own shops):**
owners `select` shops, shop_configs, staff (all columns except `pin_hash`), devices, closings;
`update` only `staff(name, active)`, `devices(label, revoked_at)`, `closings(voided_at)`.
Phones get no direct table access at all — only functions. `anon` gets nothing.

## Server functions (security definer, `search_path = ''`, execute granted to `authenticated` only)

Owner functions (reject anonymous callers and non-owners):
- `create_shop(name text, config jsonb) → uuid` — shop + settings version 1.
- `publish_config(shop_id uuid, expected_version int, config jsonb) → int` — new version =
  expected + 1; if the current version isn't `expected_version` → error `version_conflict`
  (no last-write-wins between two owner tabs).
- `create_staff(shop_id uuid, name text, pin text) → uuid`; `set_staff_pin(staff_id uuid, pin text)`
  (also clears lockout). PIN must be exactly 4 digits; stored as bcrypt (`pgcrypto`).
- `create_pairing_code(shop_id uuid) → text` — 8 characters from an unambiguous alphabet
  (no 0/O/1/I), stored as SHA-256, expires in 10 minutes, single use.

Phone functions (caller must be a device that isn't revoked):
- `redeem_pairing_code(code text, label text) → uuid` (shop id) — caller must be signed in;
  binds `auth.uid()` to the shop; marks the code used. Wrong/expired/used code → `invalid_code`.
- `device_context() → (shop_id, shop_name, config_id, version, config)` — current settings.
- `list_staff() → (id, name)` — active staff of the phone's shop.
- `verify_staff_pin(staff_id uuid, pin text) → jsonb` and
  `submit_closing(staff_id, pin, config_id, business_date, inputs, idempotency_key) → jsonb`.
- `expense_suggestion_data() → (description, cents, business_date)` — the phone's shop, last 180
  days, non-voided closings only. (Parent spec wrote `(shop_id)`; the shop comes from the caller's
  identity instead, so there is no parameter to misuse.)

**Expected failures return a result instead of raising**, because raising rolls back the whole call —
including the failed-attempt counter, which would make the PIN lockout impossible. `verify_staff_pin`
and `submit_closing` return `{"ok": true, …}` or `{"ok": false, "error": <code>}` with codes
`not_a_device`, `device_revoked`, `staff_not_found`, `staff_locked`, `bad_pin`, `config_mismatch`,
`bad_inputs`, `idempotency_conflict`. Five wrong PINs → locked for 15 minutes, counter reset;
a correct PIN resets the counter.

**`submit_closing` checks** device → shop, staff active and in that shop, PIN, `config_id` belongs to
the shop, `inputs` is a JSON object with `"schema": 1`, `counts`/`channelCents` objects and an
`expenses` array, under 64 KB. It never computes money (totals are recomputed from raw inputs by
`src/core` — the rules live in one language only). Same `idempotency_key` with identical `inputs` →
returns the existing closing id (a harmless repeat); same key with different inputs →
`idempotency_conflict` (carried over from the Plan 2 final review).

Configs: the server only checks that `config` is a JSON object with `"schema": 1` and under 64 KB.
Full validation stays in `src/core` `validateConfig` (one language); a malformed config can only
break its own shop and is reported by the app when loaded.

## Tests (`supabase/tests/*.sql`)

At least: stranger/anon sees nothing; owner A can't see owner B's shops/staff/closings; nobody can
select `pin_hash`; owners can't insert closings or configs directly; anonymous users can't call owner
functions; `publish_config` rejects a stale version; pairing code works once, expires, and is
case-insensitive; a revoked phone is refused; wrong PIN five times locks the staff member and the
counter survives (not rolled back); `submit_closing` stores once per key, repeats are harmless,
conflicting repeats are refused; config from another shop is refused; malformed inputs refused;
suggestion data excludes voided and other shops' closings; owner can void a closing but not change
its inputs. Security advisors report no errors.

## Out of scope

Owner app, pairing screens, PIN screen (Plan 4); supabase-js client and register wiring (Plan 5);
production project, backups, rate limiting beyond the PIN lockout.
