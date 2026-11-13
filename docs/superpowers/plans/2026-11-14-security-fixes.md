# Security Fixes 2026-11-14 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task: a fresh implementer subagent per task, a fresh reviewer subagent per task, then one whole-branch review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the nine findings in `SECURITY_FINDINGS_2026-11-14.md` (H23, H24, M39–M42, L93–L95).

**Architecture:** Every fix lives on the authoritative side: five new SQL migrations re-create the affected `security definer` functions, each with a rolled-back SQL test file. The client changes only where a signature or an error code changes (`DeviceApi.suggestionData`, one new `DeviceError`, three new `OwnerError`s). One `vercel.json` adds response headers.

**Tech Stack:** Postgres (Supabase, plpgsql), TypeScript + React + Vitest, Vercel static hosting.

**Spec:** `SECURITY_FINDINGS_2026-11-14.md` (repo root). Read it with `CLAUDE.md` before any task. Where the spec's «Fix» bullets and this plan differ (H24/M39), this plan wins: its design is in Task 3.

## Roles (read first)

- **Controller (you, the session running this plan):** creates the branch, dispatches one implementer subagent per task and one reviewer subagent per task, applies migrations to dev, runs the SQL test files on dev, does Task 7.
- **Implementer subagents:** write the migration, the SQL test, the client code and the Vitest tests of one task, and commit. They do **not** touch the database.
- **Database gate:** applying a migration to the dev project `fstfuhogvsdaiwpfdmep` (Supabase connector, `apply_migration`) changes a shared backend. **Ask the user once, before the first apply**, and tell them: after migration 1 the currently deployed client can no longer load expense suggestions until the new build is deployed. Run SQL test files with `execute_sql` (each is one transaction ending in `ROLLBACK`).
- If the connector is not available, stop at the first «Controller» step, hand the user the migration and test files to run in the dashboard SQL editor, and continue with the next task's code.

## Global Constraints

- Branch: `fix/security-2026-11-14`, created from the current `HEAD`. Do not push or open a PR unless the user asks.
- `npm test -- --exclude '.claude/**'` and `npm run typecheck` must pass before every commit.
- Code and comments in English, UI text in Greek.
- Migrations are append-only: never edit an existing file in `supabase/migrations/`. A changed function is re-created **in full from its latest body** with only the described change. Latest bodies:
  - `submit_closing`, `owner_save_closing` → `20261111000003_today_save_and_submit_revision.sql`
  - `write_closing_field` → `20261108000003_live_fixes.sql`
  - `closing_field_ok` → `20261108000001b_open_closing_validation.sql`
  - `check_staff_pin`, `publish_config` → `20260929000005_hardening.sql`
  - `staff_sign_in`, `join_shop`, `owner_remove_device`, `owner_rotate_join_key` → `20261112000001_store_join_keys.sql`
  - `expense_suggestion_data` → `20261111000001_closing_versions.sql`
  - `create_shop`, `create_staff`, `set_staff_pin` → `20260929000002_owner_functions.sql`; `unlock_staff` → `20260929000006_owner_app.sql`
- Every function: `security definer`, `set search_path = ''`. Every new or re-signatured `public` function: `revoke all … from public, anon;` then `grant execute … to authenticated;`. Every new `private` function: `revoke all … from public, anon, authenticated;`. Every new table: `enable row level security` + `revoke all … from public, anon, authenticated` and no policies.
- Phone functions (`staff_sign_in`, `submit_closing`, `set_closing_field`) return `{ok:false,error}` for expected failures and never raise (a raise rolls back the PIN counters). Owner functions raise the error string as the message.
- Identity only from `auth.uid()` / `auth.jwt()`, never from an argument.
- SQL tests follow `supabase/tests/README.md`: one transaction, throwaway users (owner A `…a1`, owner B `…b1`, phones `…d1`…), `set local role authenticated` + `request.jwt.claims`, a failure raises a message starting with the test id, the file ends in `ROLLBACK`.
- A new device error needs: the `DeviceError` union (`deviceApi.ts`), `deviceErrors.ts`, a Greek message in `src/features/phone/model/messages.ts`. A new owner error needs: the `OwnerError` union + a `mapError` case (`errors.ts`), a Greek message in `src/features/owner/model/messages.ts`.
- Docs are part of each task: the task that changes an invariant edits the matching `CLAUDE.md` lines in the same commit.

## Review Focus

Conditions the spec implies that are most likely to hurt a real user; each has a test in the task named.

1. A real cashier mistypes the PIN five times on the shop phone → that phone is locked; the screen must say until when, and other phones must be unaffected (Task 3, SQL T3 + Vitest).
2. An attacker has locked a cashier from outside → the cashier still signs in on a phone they have used before (Task 3, SQL T5).
3. A cashier with no expenses, or who removed a line after typing it, presses Υποβολή → it must still succeed; a retry of an already stored submit must still answer `repeat` even if a line was removed afterwards (Task 2, SQL T3/T4).
4. The pinned config has junk in `denominations`/`channels` (the server only checks `schema`) → a field write answers `bad_field`, never raises (Task 5, SQL T4).
5. A browser still running the old build calls `expense_suggestion_data()` with no argument after the migration → the register must stay usable without suggestions (Task 1, Vitest).

---

### Task 1: H23 — suggestions need a staff session

**Files:**
- Create: `supabase/migrations/20261114000001_suggestions_need_session.sql`
- Create: `supabase/tests/130_suggestions_session.sql`
- Modify: `src/data/remote/deviceApi.ts`, `src/data/remote/device.ts`, `src/features/register/RegisterScreen.tsx` (line ~101), `tests/features/phone/fakeDeviceApi.ts`, `tests/data/deviceApi.test.ts`, `supabase/tests/040_closings.sql`, `supabase/tests/100_history.sql` (their suggestion calls), `supabase/tests/README.md`, `CLAUDE.md`

**Interfaces:**
- Produces (SQL): `public.expense_suggestion_data(p_token text) returns table (description text, cents bigint, business_date date)`. The zero-argument form no longer exists.
- Produces (TS): `DeviceApi.suggestionData(token: string): Promise<DResult<PastExpense[]>>`.

- [ ] **Step 1: Write the SQL test `130_suggestions_session.sql`**

Setup: owner A, shop, one staff, one submitted closing today with one expense; phone `…d1` joined and signed in (token), phone `…d2` joined, never signed in.
- T1 `…d2` (joined, no session): `expense_suggestion_data(null)` and `expense_suggestion_data('x')` return 0 rows.
- T2 `…d1` with its token: returns the expense row.
- T3 `…d1` after `staff_sign_out(token)`: 0 rows.
- T4 `…d2` sending `…d1`'s live token: 0 rows (the token is bound to its phone).
- T5 `has_function_privilege('anon', 'public.expense_suggestion_data(text)', 'execute')` is false, and `to_regprocedure('public.expense_suggestion_data()')` is null.

- [ ] **Step 2: Write the migration**

`drop function public.expense_suggestion_data();` then create the one-argument form (`language plpgsql stable`): `v_sess := private.staff_session(p_token)`; when not ok, `return;` (no rows, no raise). Otherwise `return query` the body of the current function with `d.shop_id` replaced by the session's `shop_id` (no `devices` join needed). Keep the `seq desc` current-version rule and the 180-day window unchanged. Grants per Global Constraints.

- [ ] **Step 3: Update the suggestion calls in `040_closings.sql` and `100_history.sql`** to sign a cashier in and pass the token.

- [ ] **Step 4: Write the failing Vitest tests**

In `tests/data/deviceApi.test.ts`: `suggestionData('tok')` calls `rpc('expense_suggestion_data', { p_token: 'tok' })`. In the register tests (the file that already covers suggestions; find it with `grep -rl suggestionData tests`): the register calls `suggestionData` with the signed-in session's token; and, Review Focus 5, when `suggestionData` resolves `{ok:false, error:{code:'unknown', detail:'x'}}` the register boxes are still rendered and editable.

- [ ] **Step 5: Run them — expected FAIL** (`npm test -- --exclude '.claude/**'`).

- [ ] **Step 6: Implement** `suggestionData(token)` in `deviceApi.ts`, `device.ts`, `fakeDeviceApi.ts`; pass the session token in `RegisterScreen.tsx`. If the Review Focus 5 test fails because an `unknown` suggestion failure reaches the gate, stop routing `unknown` suggestion failures to `onServerError` (session errors still go there).

- [ ] **Step 7: Run tests and typecheck — expected PASS.**

- [ ] **Step 8: Docs.** `CLAUDE.md`: in the device API line, the suggestions bullet («Expense suggestions come from `DeviceApi.suggestionData`…») and the Closing history bullet that names `expense_suggestion_data`, say it requires the staff token; add «without a live staff session a phone can read only the shop name, the config and the staff names». `supabase/tests/README.md`: add `130`.

- [ ] **Step 9: Commit** `fix(db): expense suggestions require a staff session (H23)`.

- [ ] **Step 10 (Controller):** database gate (ask the user now), apply the migration to dev, run `130`, `040`, `100` whole. Expected: no error.

---

### Task 2: M40 — a submitted expense line must exist in the live closing

**Files:**
- Create: `supabase/migrations/20261114000002_submit_lines_live_only.sql`
- Modify: `supabase/tests/090_live_submit.sql`, `supabase/tests/070_session_submit.sql` (any test that submits a line with no `e:<id>` field must first create it with `set_closing_field`), `CLAUDE.md`

**Interfaces:**
- Produces: `public.submit_closing(text, uuid, date, jsonb, bigint, text)`, same signature and result shapes; one rule changed.

- [ ] **Step 1: Add SQL tests to `090_live_submit.sql`**

- T-M40-1 cashier A submits an expense whose id has no `e:<id>` field, `addedBy` = cashier B → `{ok:false,error:'bad_inputs'}`, no `closings` row.
- T-M40-2 same with `addedBy` = cashier A (own id, invented line) → `bad_inputs`.
- T-M40-3 a line whose `e:<id>` field has `removed: true` is in `inputs` → `bad_inputs`.
- T-M40-4 `expenses: []` with fields present → ok. A line that exists and is not removed, with its stored author → ok.
- T-M40-5 submit succeeds with key K; the line is then removed (revision moves); the same call with key K again → `{ok:true, repeat:true}`.

- [ ] **Step 2: Write the migration** — `submit_closing` from its latest body with exactly these changes:
  - Delete the pre-lock `if exists (… not exists (… open_closing_fields …) and (e -> 'addedBy' ->> 'kind' <> 'staff' or not exists (… staff …)))` block (the stage-1 fallback).
  - Replace the post-lock author check with: `bad_inputs` when any element of `p_inputs -> 'expenses'` has no row `f` in `open_closing_fields` with `f.open_closing_id = v_oc.id and f.key = 'e:' || (e ->> 'id')`, or that row's `(f.value ->> 'removed') = 'true'`, or `(f.value -> 'addedBy') is distinct from (e -> 'addedBy')`.
  - Everything else (order of checks, idempotency lookup before the day check, `last_submit`, broadcast) unchanged. `owner_save_closing` is not changed.

- [ ] **Step 3: Fix the older tests in `070`/`090`** that relied on the fallback.

- [ ] **Step 4: Docs.** `CLAUDE.md`: rewrite «Owner-authored lines are submittable» (drop «for an id with no `e:<id>` field the stage-1 rule applies»; state: every submitted line must exist, not removed, in the open closing with its stored author) and the schema-2 cross-file invariant line that mentions staff authors for `submit_closing`.

- [ ] **Step 5: Run `npm test -- --exclude '.claude/**'` and `npm run typecheck`** (no client change expected) — PASS. **Commit** `fix(db): submit accepts only expense lines of the live closing (M40)`.

- [ ] **Step 6 (Controller):** apply the migration, run `070`, `090`, `110` whole.

---

### Task 3: H24 + M39 + L93 — PIN lockout that escalates and cannot be used to lock a shop out

**Design (decided here; do not redesign):**

A phone is **trusted for a cashier** once that cashier has entered a correct PIN on it. Wrong PINs are counted on two separate tracks:

| Phone is… | Wrong PIN is counted on | At 5 wrong | Blocks |
|---|---|---|---|
| not trusted for this cashier | `staff.failed_attempts` | the **cashier** is locked | only phones not trusted for this cashier |
| trusted for this cashier | `device_staff_trust.failed_attempts` | the **phone** is locked | everyone on that phone |

- Lock time escalates: `least(interval '15 minutes' * 2^least(level, 7), interval '24 hours')` → 15 m, 30 m, 1 h, 2 h, 4 h, 8 h, 16 h, then 24 h. When the previous lock ended more than 7 days ago (or there was none) the level restarts at 0.
- A correct PIN never clears `locked_until` or the level (an expired lock is harmless and the level must survive). It resets only the counter of its own track.
- Result for an outsider with the link: 35 guesses in the first ~32 h, then 5 a day (years for 10 000 PINs), and the cashier keeps working on their usual phone. For an insider on the shop phone: 5 guesses lock that phone, escalating.
- Residual, accepted: an outsider can keep a cashier locked on phones that cashier has **never** used. The way out is «Νέος σύνδεσμος». A phone locked for a long time is freed by the owner's «Αφαίρεση» (the row and its lock go; the phone re-joins as untrusted).
- 6-digit PINs are out of scope (product decision for the user).

**Files:**
- Create: `supabase/migrations/20261114000003_pin_lockout.sql`
- Create: `supabase/tests/140_pin_lockout.sql`
- Modify: `supabase/tests/030_device_functions.sql`, `supabase/tests/060_staff_sessions.sql` (tests that call `verify_staff_pin`, or assert `locked_until is null` after a correct PIN), `src/data/remote/deviceApi.ts`, `src/data/remote/deviceErrors.ts`, `src/features/phone/model/messages.ts`, `tests/data/deviceErrors.test.ts`, the messages test, `supabase/tests/README.md`, `CLAUDE.md`

**Interfaces:**
- Produces (SQL): `private.lock_duration(p_level int) returns interval` (immutable); `private.check_staff_pin(p_shop_id uuid, p_staff_id uuid, p_pin text) returns jsonb` — same signature, new result `{ok:false, error:'device_locked', locked_until}`; table `public.device_staff_trust (device_user_id uuid references public.devices (user_id) on delete cascade, staff_id uuid references public.staff (id) on delete cascade, failed_attempts int not null default 0 check (failed_attempts >= 0), created_at timestamptz not null default now(), primary key (device_user_id, staff_id))`; columns `staff.lock_level int not null default 0`, `devices.locked_until timestamptz`, `devices.lock_level int not null default 0`. `public.verify_staff_pin` no longer exists.
- Produces (TS): `DeviceError` gains `{ code: 'device_locked'; lockedUntil: string | null }`.

- [ ] **Step 1: Write the SQL test `140_pin_lockout.sql`**

Setup: owner A, shop, cashiers S1 (PIN 1111) and S2 (PIN 2222); phones `…d1` (shop phone), `…d2` (attacker), `…d3`, all joined. S1 signs in once on `…d1` (now trusted for S1).
- T1 `…d2`: 4 wrong PINs for S1 → `bad_pin` each; the 5th → `staff_locked` with `locked_until` ≈ now + 15 min; `staff.lock_level = 1`.
- T2 `…d2`, S1 locked: the **correct** PIN → `staff_locked` (no PIN comparison leaks).
- T3 `…d1` (trusted for S1) while S1 is locked: correct PIN → `ok` with a token (Review Focus 2). `staff.locked_until` is still set, `lock_level` still 1.
- T4 escalation: as the migration owner set `staff.locked_until = now() - interval '1 minute'`; 5 more wrong from `…d2` → `locked_until` ≈ now + 30 min, `lock_level = 2`. Then set `locked_until = now() - interval '8 days'`; 5 more wrong → ≈ now + 15 min, `lock_level = 1`.
- T5 trusted track (Review Focus 1): on `…d1`, 4 wrong PINs for S1 → `bad_pin`; `staff.failed_attempts` for S1 unchanged by them; the 5th → `device_locked` with `locked_until`; then S2's **correct** PIN on `…d1` → `device_locked`; S2's correct PIN on `…d3` → `ok`.
- T6 the trusted counter is per cashier: on a fourth phone `…d4` where S1 and S2 have each signed in once: 4 wrong for S1, then S2 signs in correctly on `…d4`, then 1 more wrong for S1 → `device_locked` (S2's success did not reset S1's count).
- T7 `unlock_staff(S1)` → `failed_attempts = 0`, `locked_until is null`, `lock_level = 0`; `set_staff_pin` does the same.
- T8 `owner_remove_device(…d1)` deletes its `device_staff_trust` rows (cascade); after re-joining, `…d1` is untrusted for S1.
- T9 `private.lock_duration`: 0 → 15 min, 3 → 2 h, 7 → 24 h, 50 → 24 h.
- T10 `to_regprocedure('public.verify_staff_pin(uuid, text)')` is null; `authenticated` has no privilege on `device_staff_trust`; `private.lock_duration` is not executable by `authenticated`.
- T11 back-fill: a `(device, staff)` pair that had a `staff_sessions` row before the migration has a trust row (insert the session row, run the migration's back-fill statement text inside the test, assert).

- [ ] **Step 2: Write the migration**

1. Columns and table as in Interfaces; RLS + revoke on the table.
2. Back-fill: `insert into public.device_staff_trust (device_user_id, staff_id) select distinct ss.device_user_id, ss.staff_id from public.staff_sessions ss join public.devices d on d.user_id = ss.device_user_id and d.shop_id = ss.shop_id on conflict do nothing;`
3. `private.lock_duration`.
4. `private.check_staff_pin`, in this order (keep the «FOR UPDATE must stay» comment):

```
d := devices row where user_id = auth.uid() and shop_id = p_shop_id   FOR UPDATE   -- device first, then staff: one lock order
     not found → not_a_device
s := staff row where id = p_staff_id and shop_id = p_shop_id and active   FOR UPDATE
     not found → staff_not_found
d.locked_until > now()                       → device_locked (+ locked_until = d.locked_until)
t := device_staff_trust row (d.user_id, s.id);  trusted := found
not trusted and s.locked_until > now()       → staff_locked (+ locked_until)
PIN wrong (null, not ^[0-9]{4}$, or crypt mismatch):
  trusted:   t.failed_attempts + 1 >= 5 → lock the DEVICE (below), t.failed_attempts = 0 → device_locked (+ locked_until)
             else t.failed_attempts += 1 → bad_pin
  untrusted: s.failed_attempts + 1 >= 5 → lock the STAFF (below), s.failed_attempts = 0 → staff_locked (+ locked_until)
             else s.failed_attempts += 1 → bad_pin
PIN right:
  trusted:   t.failed_attempts = 0
  untrusted: s.failed_attempts = 0; insert the trust row (on conflict do nothing)
  → {ok:true}

lock X:  level := case when X.locked_until is null or X.locked_until < now() - interval '7 days' then 0 else X.lock_level end
         X.locked_until := now() + private.lock_duration(level);  X.lock_level := level + 1
```

5. `staff_sign_in` is not re-created: the trust row is written inside `check_staff_pin`, and `fromServerResult` passes the new `device_locked` result through like `staff_locked`.
6. `unlock_staff`, `set_staff_pin`: also set `lock_level = 0`.
7. `join_shop`: in the branch that moves the phone to another shop (`on conflict (user_id) do update`), also `delete from public.device_staff_trust where device_user_id = v_uid` and reset `locked_until = null, lock_level = 0`.
8. `drop function public.verify_staff_pin(uuid, text);`

- [ ] **Step 3: Fix `030`/`060`** (remove or port `verify_staff_pin` tests to `staff_sign_in`; adjust assertions that a correct PIN clears `locked_until`).

- [ ] **Step 4: Write the failing Vitest tests**

`tests/data/deviceErrors.test.ts`: `fromServerResult({ok:false, error:'device_locked', locked_until:'2026-11-14T10:00:00Z'})` → `{code:'device_locked', lockedUntil:'2026-11-14T10:00:00Z'}`; without `locked_until` → `lockedUntil: null`. Messages test: `device_locked` renders «Πολλές λάθος προσπάθειες σε αυτή τη συσκευή. Δοκίμασε ξανά στις HH:MM.» (same time formatting as the existing `staff_locked` message; without a time: «…Δοκίμασε ξανά αργότερα.»). Sign-in screen test: a `device_locked` reply shows that message and does not leave the screen.

- [ ] **Step 5: Run — expected FAIL. Step 6: Implement** the union member, the `fromServerResult` case, the message. Check every `switch` over `DeviceError['code']` compiles (the gate must treat `device_locked` like `staff_locked`: stay on the sign-in screen).

- [ ] **Step 7: Run tests and typecheck — PASS.**

- [ ] **Step 8: Docs.** `CLAUDE.md`: a new «PIN lockout» invariant with the table above, the escalation, «a correct PIN never clears `locked_until`/`lock_level`», the lock order device → staff, the residual; remove `verify_staff_pin` from the «never raise» line; add `device_staff_trust` to the tables with no client access. README of tests: add `140`.

- [ ] **Step 9: Commit** `fix(db): escalating PIN lockout per trusted phone; drop verify_staff_pin (H24, M39, L93)`.

- [ ] **Step 10 (Controller):** apply the migration, run `140`, `030`, `060`, `120` whole.

---

### Task 4: M41 — caps on shops, staff and config versions

**Files:**
- Create: `supabase/migrations/20261114000004_owner_caps.sql`
- Modify: `supabase/tests/020_owner_functions.sql`, `src/data/remote/errors.ts`, `src/features/owner/model/messages.ts`, their tests (`grep -rl "mapError\|ownerErrorMessage" tests`), `CLAUDE.md`

**Interfaces:**
- Produces: `create_shop`, `create_staff`, `publish_config` — same signatures; three new raised messages (`errcode '22023'`): `too_many_shops`, `too_many_staff`, `too_many_versions`.
- Produces (TS): `OwnerError` gains `{code:'too_many_shops'} | {code:'too_many_staff'} | {code:'too_many_versions'}`.

Limits: **20** shops per owner; **100** staff rows per shop (active or not); **50** config versions per shop created in the last 24 hours.

- [ ] **Step 1: Add SQL tests to `020_owner_functions.sql`**: the 21st `create_shop` raises `too_many_shops` (the 20th succeeds); the 101st `create_staff` raises `too_many_staff`; the 51st `publish_config` within 24 h raises `too_many_versions`, and succeeds after the older rows' `created_at` is moved back 25 h (as the migration owner); owner B is not affected by owner A's counts.

- [ ] **Step 2: Write the migration.** Count under a lock so two parallel calls cannot both pass: `create_shop` takes `pg_advisory_xact_lock(hashtextextended('create-shop:' || v_uid, 0))` before counting; `create_staff` does `perform 1 from public.shops where id = p_shop_id for update` before counting; `publish_config` already holds that row lock — count after it, before the version check.

- [ ] **Step 3: Write the failing Vitest tests**: `mapError({message:'too_many_shops'})` → `{code:'too_many_shops'}` (same for the other two); messages: «Έφτασες το όριο των 20 καταστημάτων.», «Έφτασες το όριο των 100 ατόμων σε αυτό το κατάστημα.», «Πάρα πολλές αλλαγές ρυθμίσεων σήμερα. Δοκίμασε ξανά αύριο.»

- [ ] **Step 4: Run — FAIL. Step 5: Implement. Step 6: Run tests and typecheck — PASS.**

- [ ] **Step 7: Docs.** `CLAUDE.md`: one invariant line with the three limits and their error strings. **Commit** `fix(db): caps on shops, staff and config versions (M41)`.

- [ ] **Step 8 (Controller):** apply the migration, run `020`, `050` whole.

---

### Task 5: M42 — live closing fields limited to the pinned config

**Files:**
- Create: `supabase/migrations/20261114000005_closing_field_limits.sql`
- Modify: `supabase/tests/080_open_closing.sql`, `CLAUDE.md`

**Interfaces:**
- Produces: `private.write_closing_field(uuid, uuid, uuid, text, jsonb, int)`, same signature and result shapes; three more rejections using existing error strings (`bad_field`, `too_many_expenses`). No client change: the sync engine already drops the item and resyncs on both.

- [ ] **Step 1: Add SQL tests to `080_open_closing.sql`** (the test config must list its denominations and at least one channel; adapt existing writes that use other keys):
  - T-M42-1 `d:<cents>` not in the pinned config's `denominations` → `bad_field`; one that is → ok. `d:0100` (non-canonical) → `bad_field` even when 100 is a denomination.
  - T-M42-2 `c:<id>` not among the pinned config's `channels[].id` → `bad_field`; one that is → ok.
  - T-M42-3 with `maxExpenses = 2`: create and remove lines until 10 `e:<id>` rows exist (all removed); the 11th new line → `too_many_expenses`. Un-removing an existing line while fewer than 2 are visible → ok.
  - T-M42-4 (Review Focus 4) as the migration owner, set the pinned config's `denominations` to `"x"` and `channels` to `7`: a `d:` write and a `c:` write each return `bad_field`, no exception.
  - Rejected writes do not bump `revision` (assert on one case).

- [ ] **Step 2: Write the migration** — `write_closing_field` from its latest body, adding after the `for update` on the open closing (and before the stale check):
  - load `v_cfg := sc.config` of `v_oc.config_id`;
  - key `d:`: require `p_key ~ '^d:[1-9][0-9]{0,5}$'` and the number to be an element of `v_cfg -> 'denominations'` when that is a JSON array; anything else → `bad_field`;
  - key `c:`: require an element of `v_cfg -> 'channels'` (when a JSON array) whose `->> 'id'` equals the key's id; else `bad_field`;
  - key `e:<id>` that does not exist yet: `too_many_expenses` when the number of existing `e:<id>` meta rows (removed or not) is already `>= v_max * 5`.
  Every check NULL-safe (`coalesce(…, false)`); the existing visible-line cap stays as is. `closing_field_ok` is not changed.

- [ ] **Step 3: Docs.** `CLAUDE.md`, «Cross-file invariant: field keys and values»: the regex still accepts `d:0100`, but the write path now rejects non-canonical and out-of-config `d:`/`c:` keys, and caps total expense lines at `maxExpenses × 5` including removed ones (the parser rule «drop a bad field individually» stays).

- [ ] **Step 4: Run `npm test -- --exclude '.claude/**'` and typecheck — PASS. Commit** `fix(db): live closing fields limited to the pinned config (M42)`.

- [ ] **Step 5 (Controller):** apply the migration, run `080`, `090`, `110` whole (note the README's «no partitions → SKIPPED» rule for the realtime blocks).

---

### Task 6: L95 — response headers on Vercel

**Files:**
- Create: `vercel.json`
- Modify: `README.md` (Deploy section), `CLAUDE.md` (one line)

- [ ] **Step 1: Create `vercel.json`** with a `headers` rule for `/(.*)`:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `X-Frame-Options: DENY`

- [ ] **Step 2: Check the build against the policy.** `npm run build`, then confirm `dist/index.html` has no inline `<script>` without `src` and no external origin (`grep -n "<script" dist/index.html`; `grep -rhoE "https?://[a-zA-Z0-9./-]+" dist/assets | sort -u` must show nothing fetched at runtime except Supabase). If the share card (`shareCard`) or the print view loads anything the policy blocks (read `src/features/register` share code and `StoreLinkCard.tsx` print code), widen only the directive it needs and say why in a comment line in `README.md`.

- [ ] **Step 3: Docs.** README: «headers come from `vercel.json`; a new external origin needs a CSP entry». `CLAUDE.md` invariant: same sentence. **Commit** `chore(host): security headers and CSP (L95)`.

Not verifiable here: the headers only exist on a Vercel deployment. Listed in Task 7's «not verified».

---

### Task 7 (Controller): whole-branch review, full SQL run, status docs

- [ ] **Step 1:** dispatch one reviewer subagent over the whole branch diff with the Review Focus list and these questions: does any function lose a `revoke`/`grant`; does any phone function raise where it must return; is any function body different from its latest version beyond the described change (diff each against the file named in Global Constraints); do the `CLAUDE.md` invariants match the SQL.
- [ ] **Step 2:** fix what the review confirms (one commit per fix).
- [ ] **Step 3:** run `010`–`140` whole on dev, in order. Run Supabase security advisors: expected only the known «authenticated can execute SECURITY DEFINER» warnings (minus `verify_staff_pin` and with `expense_suggestion_data(p_token text)`), «RLS enabled no policy» now also for `device_staff_trust`, and the anonymous-policy warnings.
- [ ] **Step 4:** `npm test -- --exclude '.claude/**'`, `npm run typecheck`, `npm run build` — record the numbers.
- [ ] **Step 5: `PROJECT_STATUS.md`.** Add a «Security review 2026-11-14» table with H23, H24, M39, M40, M41, M42, L93, L94, L95: problem, fix, status + commit. L94 stays **open — user action** (dashboard: enable leaked-password protection). Add the SQL run and test numbers. Add to «Not verified»: the CSP on a real Vercel deployment (share card, QR, print, realtime websocket under the policy); a real-device check that five wrong PINs lock the phone and show the time; the lock/advisory-lock races (a SQL file is one transaction); Supabase dashboard settings (email confirmation, anonymous sign-in rate limit/captcha).
- [ ] **Step 6:** in `SECURITY_FINDINGS_2026-11-14.md`, add a status column to the summary table (fixed + commit / open) and a line under H24/M39 pointing to the design in this plan.
- [ ] **Step 7:** write `WORK_LOG_2026-11-14.md` (what was done, what was applied to dev and when, what has **not** been verified). Commit `docs: security fixes 2026-11-14`.
- [ ] **Step 8:** tell the user: the branch name, what is applied on dev, that the new client build must be deployed for suggestions to work again, and the two things only they can do (L94 in the dashboard; the real-device checks).
