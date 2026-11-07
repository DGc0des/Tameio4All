# Stage 1 — phone joins shop, staff sign-in, server submit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone pairs with the owner's shop, a cashier from the owner's staff list signs in with
their PIN once per shift, and Υποβολή stores the closing on the server for today's business date
(resubmits allowed). Removes every DEV ONLY item.

**Architecture:** New migration adds day-change time, staff sessions, a session-based
`submit_closing`, and `ClosingInputs` schema 2 (expense id + author). The phone side gets a
`DeviceApi` (the one path for phone reads/writes, like `OwnerApi`), a pure gate state machine
(unconfigured → unpaired → signed-out → ready), and the register reads its shop/config/staff from
the server. One shared supabase client for owner and phone areas.

**Tech Stack:** React 19 + TypeScript strict, Vite, Vitest + Testing Library (jsdom), Supabase
(Postgres functions, anonymous auth), supabase-js.

**Spec:** `docs/superpowers/specs/2026-11-07-live-closing-and-history-design.md` — this plan is
"Delivery order → 1". Stages 2 (live shared closing) and 3 (history + corrections) are out of scope.

## Global Constraints

- Every rule under **Invariants** in `CLAUDE.md` still holds; the ones this plan touches most:
  RLS on everything, `anon` nothing, phones only via server functions, every function
  `security definer` + `set search_path = ''`, `revoke all … from public, anon` + `grant execute … to authenticated`,
  identity only from `auth.uid()`/`auth.jwt()`; expected failures return `{ok:false,error}` (never
  raise where it would roll back the PIN lockout counter).
- Business day is computed only by `private.business_date(shop_id, at)` in SQL, timezone
  `'Europe/Athens'`. The client never computes "today" for submission; it displays the server's.
- Day-change default `'04:00'`; a change takes effect from the **next** business day.
- Staff session = one cashier on one phone for one business date. Token is 32 random bytes,
  hex; only `sha256(token)` hex is stored. PIN is never stored on the phone.
- New submissions are `ClosingInputs` **schema 2**; stored rows may be schema 1 or 2; both validators
  (`validateClosingInputs`, `private.inputs_shape_ok`) accept both.
- Paired phone with nobody signed in shows **only** the sign-in screen — no numbers.
- Greek UI copy, English code. `npm test` and `npm run typecheck` pass before every commit.
- Only `src/data/remote/` imports supabase-js; UI tests use fake APIs and never load it.
- A new server error string needs a case in the matching error mapper and a Greek message.

## Review Focus

1. **Session for yesterday after the day changes** — a cashier signed in at 22:00, phone left open
   past 04:00: the next submit must fail `session_invalid` (not file under today), the phone goes to
   sign-in and keeps the typed draft. Test in Task 1 (T8) and Task 6.
2. **Expense author spoofing** — a phone sends `addedBy: {kind:'owner'}` or another shop's staff id:
   server refuses `bad_inputs`. Test in Task 2 (T6).
3. **Retry after a network drop during submit** — same idempotency key, same inputs → `repeat:true`,
   one row; editing after a failed submit then tapping again uses a **new** key. Test in Task 6.
4. **Revoked phone mid-shift** — owner revokes the device while a cashier is signed in: next call
   returns `device_revoked`, phone shows the pairing screen and clears its session. Test in Task 5.
5. **App opened with no network** — paired phone with a cached context and a still-valid stored
   session opens the register with «Εκτός σύνδεσης»; without a cache it shows a retry screen, never a
   blank page. Test in Task 5.

---

## File map

| File | Role |
|---|---|
| `supabase/migrations/20261107000001_staff_sessions.sql` | day-change, `business_date`, sessions, sign-in/out, `device_context` + business date |
| `supabase/migrations/20261107000002_session_submit.sql` | schema-2 shape check, new `submit_closing`, suggestions = latest per day |
| `supabase/tests/060_staff_sessions.sql`, `070_session_submit.sql` | SQL security tests |
| `supabase/tests/040_closings.sql` | rewritten for the new `submit_closing` |
| `src/core/formula.ts` | `ClosingInputs` schema `1 \| 2`, `ExpenseEntry` id/addedBy |
| `src/features/register/draft.ts`, `derive.ts` | draft loses staff/date editing; expense author |
| `src/data/remote/supabase.ts` | memoised shared client (replaces direct `createSupabase` calls) |
| `src/data/remote/deviceApi.ts`, `device.ts`, `deviceErrors.ts` | `DeviceApi` types, implementation, error mapping |
| `src/data/local/phone.ts` | stored staff session + cached device context |
| `src/features/phone/model/gate.ts` | pure phone gate reducer |
| `src/features/phone/model/messages.ts` | Greek messages for `DeviceError` |
| `src/features/phone/PhoneApp.tsx`, `PairScreen.tsx`, `SignInScreen.tsx`, `PhoneEntry.tsx` | phone shell |
| `src/features/register/*` | register wired to session + `DeviceApi` |
| `src/features/owner/settings/DayChangeCard.tsx` + `OwnerApi` additions | owner day-change setting |
| Deleted | `src/app/shop.ts`, `src/data/local/staff.ts`, `src/data/local/submissions.ts`, `src/features/staff/StaffScreen.tsx`, `src/features/register/PeopleSheet.tsx` |

---

### Task 1: Database — day-change time, business date, staff sessions

**Files:**
- Create: `supabase/migrations/20261107000001_staff_sessions.sql`
- Create: `supabase/tests/060_staff_sessions.sql`

**Interfaces:**
- Produces (SQL):
  - `shops` columns: `day_change_time time not null default '04:00'`, `prev_day_change_time time`,
    `day_change_switch_at timestamptz` (owner has select via existing RLS; no new update grant).
  - `private.business_date(p_shop_id uuid, p_at timestamptz default now()) returns date`
  - `public.set_day_change_time(p_shop_id uuid, p_time time) returns date` — owner; returns the first
    business date the new time applies to; raises `not_owner`.
  - `public.staff_sign_in(p_staff_id uuid, p_pin text) returns jsonb` —
    `{ok:true, token, staff_id, name, business_date}` or `{ok:false,error}` with errors
    `not_a_device | device_revoked | staff_not_found | staff_locked(+locked_until) | bad_pin`.
  - `public.staff_sign_out(p_token text) returns void` (idempotent, never raises for unknown token).
  - `private.staff_session(p_token text) returns jsonb` — `{ok:true, shop_id, staff_id}` or
    `{ok:false,error}` with `not_a_device | device_revoked | session_invalid`.
  - `public.device_context()` gains a trailing column `business_date date`.
  - Table `public.staff_sessions(token_hash text pk, shop_id, staff_id, device_user_id, business_date date, created_at, revoked_at)`, RLS on, no grants to anyone.

- [ ] **Step 1: Write `060_staff_sessions.sql`** following the `040_closings.sql` setup (owner A/B,
  staff ΜΑΡΙΑ PIN 1234 + ΝΙΚΟΣ in shop B, phone d1 paired to A, phone d2 unpaired). Tests:
  - T1 `staff_sign_in(maria,'1234')` from d1 → ok, 64-hex token, `business_date = private.business_date(shop_a)`.
  - T2 the raw token is not stored: `not exists (select 1 from staff_sessions where token_hash = token)`.
  - T3 d2 (unpaired) → `not_a_device`; ΝΙΚΟΣ (other shop) from d1 → `staff_not_found`.
  - T4 5× wrong PIN → 5th returns `staff_locked`; counter survives (not rolled back).
  - T5 `private.staff_session(token)` as d1 → ok with maria's id; as d2 → `not_a_device`; random token → `session_invalid`.
  - T6 after `staff_sign_out(token)` → `session_invalid`; sign-out twice does not raise.
  - T7 owner revokes d1 → `staff_session` returns `device_revoked`; owner deactivates maria → `session_invalid`.
  - T8 day change: `update staff_sessions set business_date = business_date - 1` → `session_invalid`.
  - T9 `business_date` boundary, as superuser with shop day change 04:00:
    `private.business_date(shop, '2026-11-08 03:59 Europe/Athens')` = `2026-11-07`, at `04:00` = `2026-11-08`.
  - T10 `set_day_change_time(shop_a,'06:00')` at a fixed moment is exercised via a helper
    overload `private.business_date` with explicit `p_at`: with `prev=04:00`, `new=06:00`,
    `switch_at='2026-11-08 04:00 Europe/Athens'` → `'2026-11-08 05:00'` gives `2026-11-08` (not 07),
    `'2026-11-09 05:00'` gives `2026-11-08`, `'2026-11-09 06:00'` gives `2026-11-09`.
  - T11 owner B → `set_day_change_time(shop_a, …)` raises `not_owner`; anon/phone cannot select `staff_sessions`.
  - T12 `device_context()` as d1 returns `business_date`.
- [ ] **Step 2: Run it against dev via Supabase connector `execute_sql`** — Expected: fails (functions missing).
- [ ] **Step 3: Write the migration.** `private.business_date` algorithm (must match T9/T10):

```sql
-- local = p_at at time zone 'Europe/Athens'
-- if switch_at is null or p_at < switch_at: return (local - prev_or_current_time)::date
--   (use prev_day_change_time when switch_at is not null and p_at < switch_at, else day_change_time)
-- else: return greatest((local - day_change_time)::date, (switch_at at time zone 'Europe/Athens')::date)
```

  `set_day_change_time`: `require_owner`; lock the shop row; `D := business_date(shop, now())`;
  set `prev_day_change_time := <time in force now>`, `day_change_time := p_time`,
  `day_change_switch_at := ((D + 1) + <time in force now>) at time zone 'Europe/Athens'`; return `D + 1`.
  `staff_sign_in`: `device_shop()` → `check_staff_pin` (reuse; keep its no-raise contract) → insert
  session with `business_date = private.business_date(shop)`, token from
  `encode(extensions.gen_random_bytes(32),'hex')`, store `encode(extensions.digest(token,'sha256'),'hex')`.
  `private.staff_session`: device check first, then session row for this device, not revoked,
  `business_date = private.business_date(shop)`, staff still active. Keep `verify_staff_pin` unchanged.
  Revoke/grant per Global Constraints; `private.*` gets `revoke … from public, anon, authenticated`.
- [ ] **Step 4: Apply with `apply_migration`, run 060 and the existing 010–050** — Expected: all pass.
- [ ] **Step 5: Commit** `feat(db): day-change time, business date, staff sessions`.

### Task 2: Database — session-based submit, schema-2 inputs, suggestions per day

**Files:**
- Create: `supabase/migrations/20261107000002_session_submit.sql`
- Create: `supabase/tests/070_session_submit.sql`; Modify: `supabase/tests/040_closings.sql`

**Interfaces:**
- Consumes: Task 1 `private.staff_session`, `private.business_date`.
- Produces:
  - `drop function public.submit_closing(uuid, text, uuid, date, jsonb, text)`.
  - `public.submit_closing(p_token text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_idempotency_key text) returns jsonb` —
    `{ok:true, closing_id, repeat}` or errors `not_a_device | device_revoked | session_invalid | wrong_day | config_mismatch | bad_inputs | idempotency_conflict`.
  - `private.inputs_shape_ok(jsonb)` accepts `schema` 1 or 2; for 2 every expense is an object with
    string `id` (1–64 chars), string `description`, numeric `cents`, and `addedBy` object with `kind`
    `'staff'` (+ uuid-text `id`) or `'owner'`.
  - `expense_suggestion_data()` reads only the latest non-voided closing per `(shop, business_date)`
    (by `created_at desc, id desc`); window `business_date between business_date(shop)-180 and business_date(shop)`.

- [ ] **Step 1: Write `070_session_submit.sql`** (sign in maria on d1 first). Tests:
  - T1 happy path schema 2 → ok; row has `staff_id = maria`, `business_date = business_date(shop)`.
  - T2 retry same key/inputs (keys reordered) → `repeat:true`, same id; same key other inputs → `idempotency_conflict`.
  - T3 `p_business_date = business_date - 1` → `wrong_day`; `+1` → `wrong_day`.
  - T4 schema 1 inputs → `bad_inputs` (new submissions must be 2).
  - T5 shop B config → `config_mismatch`; signed-out token → `session_invalid`.
  - T6 `addedBy {kind:'owner'}` → `bad_inputs`; `addedBy {kind:'staff', id:<nikos (shop B)>}` → `bad_inputs`; expense without `id` → `bad_inputs`.
  - T7 resubmit same day with a new key → second row; `expense_suggestion_data()` returns only the second row's expenses.
  - T8 `private.inputs_shape_ok` still true for a stored schema-1 shape.
- [ ] **Step 2: Rewrite `040_closings.sql`** to sign in and call the new signature; keep its existing
  intents (happy path, idempotency, cross-shop, malformed, revoked device, suggestions). Remove the
  ±7-day business-date tests (superseded by T3 above).
- [ ] **Step 3: Run 040/070 → fail; write the migration** (author check: each staff `addedBy.id` must
  be a staff row of the session's shop; owner kind refused from phones); **apply; run 010–070** → all pass.
- [ ] **Step 4: Commit** `feat(db): session-based submit_closing, inputs schema 2`.

### Task 3: Core — `ClosingInputs` schema 2 and draft changes

**Files:**
- Modify: `src/core/formula.ts`, `src/features/register/draft.ts`, `src/features/register/derive.ts`
- Test: `tests/core/formula.test.ts`, `tests/features/register/*` (draft/derive tests that exist)

**Interfaces:**
- Produces:
  - `export type ExpenseAuthor = { kind: 'staff'; id: string } | { kind: 'owner' }`
  - `export interface ExpenseEntry { description: string; cents: Cents; id?: string; addedBy?: ExpenseAuthor }`
  - `ClosingInputs.schema: 1 | 2`; `export const CLOSING_INPUTS_SCHEMA = 2`
  - `ExpenseDraft` gains `addedBy: ExpenseAuthor | null`
  - `Draft` = `{ id, businessDate, mode, entries, channels, expenses }` (no `staffName`)
  - `DraftAction`: remove `setStaff`, `setDate`; `addExpense` gains `addedBy: ExpenseAuthor | null`;
    `resetInputs` keeps `{id}`.
  - `newDraft(id: string, businessDate: string, mode?: EntryMode): Draft`
  - `deriveClosing(config, draft)` emits `schema: 2` and each expense `{id, description, cents, addedBy}`;
    an expense with `addedBy === null` derives with no `addedBy` key **and** `submitBlockReason`
    returns `'Συνδέσου ξανά για υποβολή'` for it (cannot happen in normal flow; guards old drafts).
  - `submitBlockReason(derived: Derived, draft: Draft): string | null` — no staff check any more.

- [ ] **Step 1: Failing tests**
  - `validateClosingInputs` accepts schema 1 rows (existing fixtures) and schema 2 with ids/authors;
    rejects schema 2 expense missing `id` (`bad_shape`), `addedBy.kind` not staff/owner (`bad_shape`), schema 3.
  - `deriveClosing` of a draft with one expense `{id:'e1', addedBy:{kind:'staff',id:'s1'}}` gives
    `inputs.schema === 2` and `inputs.expenses[0]` equal to `{id:'e1', description:'Nice', cents:1300, addedBy:{kind:'staff',id:'s1'}}`.
  - `draftReducer(…, {type:'addExpense', id:'e2', max:5, addedBy:{kind:'staff',id:'s1'}})` stores `addedBy`.
  - `isDraft` accepts a draft without `staffName`, and rejects an expense that has no `addedBy` key
    (so drafts saved by the old app are discarded on load).
- [ ] **Step 2: Run `npx vitest run tests/core tests/features/register`** → FAIL.
- [ ] **Step 3: Implement.** `evaluateTotals` is unchanged (it only reads cents).
- [ ] **Step 4: Keep the build green with minimal call-site edits**: `RegisterScreen` stops rendering
  `PeopleSheet` and its header shows only the date; `addExpense` dispatches pass `addedBy: null` for
  now (Task 6 sets the real author). Run `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(core): closing inputs schema 2 with expense ids and authors`.

### Task 4: Remote — shared client and `DeviceApi`

**Files:**
- Create: `src/data/remote/supabase.ts`, `src/data/remote/deviceApi.ts`, `src/data/remote/device.ts`, `src/data/remote/deviceErrors.ts`
- Modify: `src/features/owner/OwnerEntry.tsx` (use `getSupabase`)
- Create: `src/features/phone/model/messages.ts`
- Test: `tests/data/deviceErrors.test.ts`, `tests/data/deviceApi.test.ts`, `tests/features/phone/fakeDeviceApi.ts`

**Interfaces:**
- Produces:
  - `getSupabase(store: KeyValueStore): SupabaseClient | null` — memoised per page (one GoTrue client).
  - `deviceApi.ts`:
    ```ts
    export type DeviceError =
      | { code: 'not_a_device' } | { code: 'device_revoked' } | { code: 'invalid_code' }
      | { code: 'owner_signed_in' } | { code: 'staff_not_found' } | { code: 'bad_pin' }
      | { code: 'staff_locked'; lockedUntil: string | null } | { code: 'session_invalid' }
      | { code: 'wrong_day' } | { code: 'config_mismatch' } | { code: 'bad_inputs' }
      | { code: 'idempotency_conflict' } | { code: 'network' } | { code: 'unknown'; detail: string };
    export type DResult<T> = { ok: true; data: T } | { ok: false; error: DeviceError };
    export interface DeviceContext { shopId: string; shopName: string; configId: string; config: unknown; businessDate: string }
    export interface StaffSession { token: string; staffId: string; name: string; businessDate: string; shopId: string }
    export interface DeviceApi {
      /** null = no auth session at all; anonymous=false means an owner is signed in in this browser. */
      session(): Promise<{ anonymous: boolean } | null>;
      /** Signs in anonymously if needed, then redeems. `force` signs an owner out first. */
      pair(code: string, label: string, opts?: { force?: boolean }): Promise<DResult<void>>;
      /** null data = signed in but not paired. */
      context(): Promise<DResult<DeviceContext | null>>;
      listStaff(): Promise<DResult<{ id: string; name: string }[]>>;
      signIn(staffId: string, pin: string): Promise<DResult<StaffSession>>;
      signOut(token: string): Promise<void>;
      submit(token: string, configId: string, businessDate: string, inputs: ClosingInputs, idempotencyKey: string): Promise<DResult<{ closingId: string; repeat: boolean }>>;
      suggestionData(): Promise<DResult<PastExpense[]>>;
    }
    ```
  - `mapDeviceError(err: unknown): DeviceError` (never throws) and `fromServerResult(json: unknown): DeviceError | null`
    for `{ok:false,error}` payloads (unknown codes → `unknown`).
  - `deviceErrorMessage(e: DeviceError): string` (Greek), e.g. `bad_pin` → «Λάθος PIN.»,
    `staff_locked` → «Κλείδωσε για 15 λεπτά μετά από 5 λάθος PIN.», `session_invalid` → «Η σύνδεση έληξε. Βάλε ξανά το PIN σου.»,
    `wrong_day` → «Άλλαξε η ημέρα. Συνδέσου ξανά.», `invalid_code` → «Ο κωδικός δεν ισχύει ή έληξε.»,
    `device_revoked` → «Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.», `network` → «Δεν υπάρχει σύνδεση.»
  - `fakeDeviceApi(overrides?: Partial<DeviceApi>): DeviceApi` (paired to shop «Join Juice» with
    `joinJuicePreset`, staff ΜΑΡΙΑ/ΝΙΚΟΣ, PIN `1234`, businessDate `2026-11-07`).

- [ ] **Step 1: Failing tests** — `mapDeviceError` for a fetch failure → `network`; postgres
  `invalid_code` message → `invalid_code`; `fromServerResult({ok:false,error:'staff_locked',locked_until:'2026-…'})`
  → `{code:'staff_locked', lockedUntil:'2026-…'}`; `{ok:true}` → `null`; garbage → `unknown`.
  `createDeviceApi` with a stub client object (rpc/auth as `vi.fn`): `pair` when `session()` is an
  owner and no `force` → `owner_signed_in` and no RPC called; `submit` passes
  `p_token, p_config_id, p_business_date, p_inputs, p_idempotency_key`; `suggestionData` maps rows to
  `{description, cents, date}`. Every message case in `deviceErrorMessage` is non-empty (iterate a list of all codes).
- [ ] **Step 2: Run → FAIL. Step 3: Implement.** `pair`: `auth.signInAnonymously()` when no session
  (with `force`: `auth.signOut({scope:'local'})` first), then `rpc('redeem_pairing_code', {p_code, p_label})`.
- [ ] **Step 4: Run tests, typecheck. Step 5: Commit** `feat(remote): DeviceApi and shared supabase client`.

### Task 5: Phone shell — gate, pairing, sign-in, offline cache; remove DEV ONLY

**Files:**
- Create: `src/data/local/phone.ts`, `src/features/phone/model/gate.ts`, `src/features/phone/PhoneApp.tsx`, `PairScreen.tsx`, `SignInScreen.tsx`, `PhoneEntry.tsx`
- Modify: `src/app/App.tsx`, `src/app/router.ts`, `src/features/register/HeaderMenu.tsx`, `src/data/local/drafts.ts`
- Delete: `src/app/shop.ts`, `src/data/local/staff.ts`, `src/features/staff/StaffScreen.tsx`, `src/features/register/PeopleSheet.tsx`, their tests' cases
- Test: `tests/data/phoneLocal.test.ts`, `tests/features/phone/gate.test.ts`, `tests/features/phone/phoneApp.test.tsx`, update `tests/app/app.test.tsx`, `tests/app/routerTheme.test.ts`, `tests/features/people.test.tsx` (delete StaffScreen/PeopleSheet cases)

**Interfaces:**
- Consumes: Task 4 `DeviceApi`, `fakeDeviceApi`, `deviceErrorMessage`.
- Produces:
  - `phone.ts`: `loadStaffSession(store): StaffSession | null`, `saveStaffSession(store, s): boolean`,
    `clearStaffSession(store): void`, `loadCachedContext(store): DeviceContext | null`,
    `saveCachedContext(store, c): boolean` — keys `tameio4all:v1:phone:session` / `:phone:context`; failure-safe.
  - `drafts.ts`: `loadDraft(store, shopId, businessDate: string): Draft | null` — returns null (and
    removes) when the stored draft's `businessDate` differs; TTL removed (the business date replaces it).
  - `gate.ts`:
    ```ts
    export type Gate =
      | { s: 'loading' } | { s: 'unconfigured' }
      | { s: 'offline_no_cache' }
      | { s: 'unpaired'; notice: string | null }
      | { s: 'signed_out'; ctx: DeviceContext; offline: boolean }
      | { s: 'ready'; ctx: DeviceContext; session: StaffSession; offline: boolean };
    export type GateEvent =
      | { t: 'no_client' }
      | { t: 'loaded'; ctx: DeviceContext | null; stored: StaffSession | null }
      | { t: 'load_failed'; error: DeviceError; cached: DeviceContext | null; stored: StaffSession | null }
      | { t: 'paired' } | { t: 'signed_in'; session: StaffSession } | { t: 'signed_out' }
      | { t: 'server_error'; error: DeviceError };
    export function gateReducer(g: Gate, e: GateEvent): Gate;
    ```
    Rules: a stored session is used only if `session.shopId === ctx.shopId && session.businessDate === ctx.businessDate`;
    `load_failed` with `network` + cache → state from cache with `offline:true`; without cache →
    `offline_no_cache`; `device_revoked`/`not_a_device` → `unpaired` with notice; `server_error`
    `session_invalid`/`wrong_day` → `signed_out`; `device_revoked` → `unpaired`.
  - `PhoneApp({ api: DeviceApi | null, store, now, newId, share, themePref, onTheme, onOwner })`
    drives the gate: on mount `api.context()` (+ `saveCachedContext` on success); on `signed_out`/
    `device_revoked` clears the stored session. Renders: `PairScreen` (code input, label input,
    «Σύνδεση συσκευής»; on `owner_signed_in` shows confirm «Είσαι συνδεδεμένος ως ιδιοκτήτης σε αυτόν
    τον browser. Η σύνδεση συσκευής θα σε αποσυνδέσει.» → retry with `force`), `SignInScreen`
    (title «Ποιος είσαι;», staff choices from `listStaff`, 4-digit PIN input `inputMode="numeric"`,
    «Είσοδος», error via `deviceErrorMessage`), `RegisterScreen` when `ready`, offline banner
    «Εκτός σύνδεσης» when `offline`, retry screen «Δεν υπάρχει σύνδεση» + «Δοκίμασε ξανά» for `offline_no_cache`.
  - `App` props: replace `shop?: LocalShop` with `deviceApi?: DeviceApi | null` (tests) — real one
    comes from lazy `PhoneEntry` which builds `createDeviceApi(getSupabase(store))`. Router `Route`
    becomes `'register'` only; `#/staff` parses to register. HeaderMenu loses «Προσωπικό».

- [ ] **Step 1: Failing tests**
  - gate: each rule above, including Review Focus 4 (`server_error device_revoked` from `ready` → `unpaired`)
    and 5 (`load_failed network` with cache + valid stored session → `ready` offline; without cache → `offline_no_cache`);
    stored session for another businessDate → `signed_out`.
  - phoneLocal: round-trip, corrupt JSON → null, memory store.
  - phoneApp (fake API): unpaired → type code → `pair` called → sign-in screen; wrong PIN shows «Λάθος PIN.»
    and stays; correct PIN → register visible with «ΜΑΡΙΑ» in the header; signed-out phone renders **no**
    `input.field` and no euro amounts (assert `queryByText(/€/)` is null); reload with stored session of
    same day → straight to register; `owner_signed_in` → confirm → `pair` called with `{force:true}`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement; delete DEV ONLY files and their tests' cases;
  update `app.test.tsx` to pass `deviceApi={fakeDeviceApi()}` with a stored session.**
- [ ] **Step 4: `npm test && npm run typecheck`** → PASS.
- [ ] **Step 5: Commit** `feat(phone): pairing, staff sign-in, offline-cached context; remove DEV ONLY local shop/staff`.

### Task 6: Register — signed-in cashier, server submit, server suggestions

**Files:**
- Modify: `src/features/register/RegisterScreen.tsx`, `SubmitSheet.tsx`, `ExpensesCard.tsx`, `HeaderMenu.tsx`
- Delete: `src/data/local/submissions.ts` (+ its tests in `tests/data/local.test.ts`)
- Test: `tests/features/register/submitSheet.test.tsx`, `tests/app/app.test.tsx`

**Interfaces:**
- Consumes: `DeviceApi.submit`, `DeviceApi.suggestionData`, `StaffSession`, `DeviceContext`, gate `server_error`.
- Produces: `RegisterProps` = `{ ctx: DeviceContext; config: ShopConfig; session: StaffSession; api: DeviceApi; store; now; newId; share; themePref; active; offline: boolean; onTheme; onOwner; onSignOut: () => void; onServerError: (e: DeviceError) => void }`
  (`config` = `ctx.config` already checked with `isShopConfig` by `PhoneApp`; an invalid config shows
  «Οι ρυθμίσεις του καταστήματος δεν είναι έγκυρες» instead of the register).

- [ ] **Step 1: Failing tests**
  - Header shows `«Σαβ 07/11 · ΜΑΡΙΑ»`; tapping it opens a sheet with «Αλλαγή ατόμου» → `api.signOut(token)` + `onSignOut`.
  - New expense line carries `addedBy {kind:'staff', id: session.staffId}`.
  - Submit: `api.submit` called once with `(token, ctx.configId, ctx.businessDate, inputs(schema 2), key)`;
    success → title «Υποβλήθηκε ✓», **draft is kept** (numbers still in fields), toast «Το κλείσιμο υποβλήθηκε».
  - Retry: first `submit` → `network`, tap «Υποβολή» again in the same sheet → same key; close the sheet,
    edit a field, submit again → a different key (Review Focus 3).
  - `submit` → `session_invalid` → `onServerError` called, draft still in storage (Review Focus 1).
  - Submit button disabled with «Χρειάζεται σύνδεση για υποβολή» when `offline`.
  - Suggestions: `suggestionData` result feeds `buildSupplierHistory` (chip appears for a known amount).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Idempotency key: `newId()` when the SubmitSheet opens; kept for retries
  inside that sheet. Remove the date input and the local-submission path. Keep share/Z-photo flow
  (enabled after a successful submit). `RegisterScreen` loads the draft with
  `loadDraft(store, ctx.shopId, ctx.businessDate) ?? newDraft(newId(), ctx.businessDate)`.
- [ ] **Step 4: `npm test && npm run typecheck`** → PASS.
- [ ] **Step 5: Commit** `feat(register): submit to server as the signed-in cashier; resubmits keep the draft`.

### Task 7: Owner — day-change setting

**Files:**
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/features/owner/settings/SettingsScreen.tsx`, `tests/features/owner/fakeApi.ts`
- Create: `src/features/owner/settings/DayChangeCard.tsx`
- Test: `tests/features/owner/dayChange.test.tsx`, `tests/data/ownerApi.test.ts`

**Interfaces:**
- Produces:
  - `OwnerApi.dayChange(shopId: string): Promise<Result<{ time: string; fromDate: string | null }>>`
    — reads `shops.day_change_time, day_change_switch_at`; `fromDate` = switch date if `switch_at > now`, else null; `time` as `HH:MM`.
  - `OwnerApi.setDayChange(shopId: string, time: string): Promise<Result<string>>` → `rpc('set_day_change_time')`, returns the from-date.
  - `DayChangeCard({ api, shopId })`: card «Αλλαγή ημέρας», `<input type="time">`, button «Αποθήκευση»,
    hint «Κλεισίματα πριν από αυτή την ώρα μετράνε για την προηγούμενη μέρα.»; after save or when
    `fromDate` → «Ισχύει από ΣΑΒ 08/11» (`formatDayEl`). Saved independently of «Δημοσίευση».

- [ ] **Step 1: Failing tests** — renders `04:00` from the fake; save calls `setDayChange(shopId,'06:00')`
  and shows «Ισχύει από»; `not_owner` shows `ownerErrorMessage`; owner.ts maps `'06:00:00'` → `'06:00'`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run tests, typecheck → PASS.**
- [ ] **Step 5: Commit** `feat(owner): day-change time setting`.

### Task 8: Verify for real and update docs

**Files:** `CLAUDE.md`, `PROJECT_STATUS.md`, `supabase/tests/README.md`

- [ ] **Step 1: Supabase dashboard: enable Anonymous sign-ins** (Authentication → Providers) — manual, user
  confirms. Note in PROJECT_STATUS release checklist.
- [ ] **Step 2: Run all SQL tests 010–070 against dev** → all pass.
- [ ] **Step 3: Manual browser run** (`npm run dev`): owner creates staff + pairing code in one browser
  profile; second profile pairs, signs in as ΜΑΡΙΑ, submits; `select … from closings` shows schema-2
  inputs with `addedBy`; resubmit makes a second row; sign out shows only the sign-in screen; owner
  sets day change and sees «Ισχύει από».
- [ ] **Step 4: Docs.** `CLAUDE.md`: remove both DEV ONLY rows; add `src/features/phone/` and
  `DeviceApi` to Architecture; invariants: business day only from `private.business_date`; staff
  session rules; schema 2 cross-file invariant (`ClosingInputs` ↔ `inputs_shape_ok`, both accept 1|2,
  new submissions 2); one shared supabase client via `getSupabase`. `PROJECT_STATUS.md`: stage 1 done,
  what was not verified (real phones, iOS Safari, offline cache on a real device).
- [ ] **Step 5: Commit** `docs: stage 1 shipped — phone sign-in and server submit`.
