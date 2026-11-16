# Multiple Closings Per Day (Stage 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner choose how many times a day the till is closed (1–6) and whether the cash leaves the till at each closing, and show days with several closings in «Ιστορικό».

**Architecture:** A business day gets closings numbered 1..N (`closing_no`). Each closing is its own `open_closings` row and its own version log in `closings`; everything keyed by (shop, date) becomes keyed by (shop, date, closing_no). The *live closing* is the highest-numbered one of the shop's business date; `private.open_closing_for` returns it, so the existing one write path keeps working. A cashier starts the next closing explicitly. The day's result (sum or last) is computed in the pure history model, never in SQL.

**Tech Stack:** Postgres (Supabase, security-definer functions, Realtime broadcast), TypeScript strict, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-multiple-closings-per-day-design.md` — read it first. Also read the «Live shared closing» and «Closing history» sections of the root `CLAUDE.md`.

## Global Constraints

- `closing_no` is an integer 1..6. `MAX_CLOSINGS_PER_DAY = 6` (TS, `src/features/owner/model/limits.ts`) and the SQL checks `between 1 and 6` are a cross-file invariant.
- Cash mode values are exactly `'separate'` and `'running'` (SQL check, TS type `CashMode`).
- Defaults everywhere: `closing_no` 1, `closings_planned` 1, `cash_mode` `'separate'`. Data stored before this change (rows, cached snapshots, queued edits) is read as closing 1 of a 1-closing day.
- New SQL function arguments `p_closing_no` are declared `int default 1` (an older phone build keeps working in a 1-closing shop).
- Every new or re-created function: `security definer`, `set search_path = ''`, `revoke all … from public, anon`, `grant execute … to authenticated` (private helpers: revoke from `authenticated` too). A changed signature means `drop function` of the old one first.
- Phone functions return `{ok:false,error}` for expected failures and never raise there.
- Totals and sums are never computed in SQL. Components never add money: sums live in `src/features/owner/history/model.ts`.
- Greek UI copy is fixed by this plan; use it verbatim. Code and comments in English.
- `npm test` and `npm run typecheck` pass before every commit. Commit messages follow the repo style (`feat(db): …`, `feat(owner): …`).
- Migrations are written in Tasks 1–2 and applied to dev only in Task 9. Until then the SQL tests are «written, not run».

## Review Focus

1. Two cashiers tap «Έναρξη» at the same moment → exactly one new closing exists; the second caller gets the same one, no error. (Task 1, T6)
2. A phone with unsent edits for closing 1 comes back after closing 2 started → those edits are dropped with a notice, never written into closing 2. (Task 1 T4; Task 3 engine tests)
3. The owner changes the number or the mode in the middle of a day → the day that already started keeps its plan; the next day uses the new one. (Task 1, T2)
4. Data from before the change: a cached snapshot or queued edit without `closingNo`, and a day with rows but no plan → read as closing 1; history looks as before. (Task 3 local-storage tests; Task 2 T1; Task 7 parser tests)
5. A `separate` day where one closing is unreadable or uses another config → the day result is «—», the other closings are still listed and readable. (Task 7 model tests)

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/20261117000001_multi_closing.sql` | new: plan columns, `set_closing_plan`, live closing, write guard, `start_next_closing`, `submit_closing` |
| `supabase/migrations/20261117000002_multi_closing_history.sql` | new: `current_closing` per closing, list/day/save, suggestions |
| `supabase/tests/170_multi_closing.sql`, `180_multi_closing_history.sql` | new SQL tests |
| `src/app/closingLabel.ts` | new: Greek labels for closings (pure) |
| `src/features/register/live/fields.ts`, `syncEngine.ts` | `closingNo` on `Snapshot`/`PendingEdit`, `sameClosing`, `wrong_closing` |
| `src/data/remote/live.ts`, `device.ts`, `deviceApi.ts`, `deviceErrors.ts` | parsers, new args, `startNextClosing`, new errors |
| `src/data/local/openClosing.ts` | old stored shapes read as closing 1 |
| `src/features/register/RegisterScreen.tsx`, `StartNextSheet.tsx` (new), `share.ts` | label, start-next action |
| `src/data/remote/ownerApi.ts`, `owner.ts`, `errors.ts`, `history.ts` | plan API, `closingNo` args, new payload parsers |
| `src/features/owner/settings/ClosingPlanCard.tsx` (new), `SettingsScreen.tsx` | the two owner options |
| `src/features/owner/todayWriter.ts`, `TodayScreen.tsx` | live closing number |
| `src/features/owner/history/types.ts`, `model.ts`, `HistoryScreen.tsx`, `DayScreen.tsx`, `CorrectionEditor.tsx` | closings inside a day, day result |
| `src/app/router.ts` | `…/history/<date>/<n>` |
| `tests/features/owner/fakeApi.ts`, `tests/features/phone/fakeDeviceApi.ts` | follow the interfaces |

---

### Task 1: Database — plan, live closing, start next, submit

**Files:**
- Create: `supabase/migrations/20261117000001_multi_closing.sql`
- Create: `supabase/tests/170_multi_closing.sql`
- Modify: `supabase/tests/README.md` (one paragraph for `170`)

**Interfaces — Produces (SQL):**
- `shops.closings_per_day int not null default 1 check (closings_per_day between 1 and 6)`, `shops.cash_mode text not null default 'separate' check (cash_mode in ('separate','running'))`.
- `open_closings.closing_no int not null default 1 check (closing_no between 1 and 6)`, `open_closings.closings_planned int not null default 1`, `open_closings.cash_mode text not null default 'separate'`; unique `(shop_id, business_date, closing_no)` replaces unique `(shop_id, business_date)`.
- `closings.closing_no int not null default 1 check (closing_no between 1 and 6)`; index `(shop_id, business_date, closing_no, seq desc) where voided_at is null` replaces `closings_shop_date_seq_idx`.
- `public.set_closing_plan(p_shop_id uuid, p_count int, p_cash_mode text) returns void` — `require_owner`; raises `bad_closing_plan` (errcode 22023) for a count outside 1..6 or an unknown mode.
- `private.open_closing_for(p_shop uuid) returns public.open_closings` — the live closing.
- `private.closing_snapshot(p_oc uuid)` — adds `closing_no`, `closings_planned`, `cash_mode`.
- `private.write_closing_field(p_shop uuid, p_staff uuid, p_owner uuid, p_closing_no int, p_key text, p_value jsonb, p_base_version int)`.
- `public.set_closing_field(p_token text, p_business_date date, p_key text, p_value jsonb, p_base_version int, p_closing_no int default 1)`.
- `public.owner_set_closing_field(p_shop_id uuid, p_business_date date, p_key text, p_value jsonb, p_base_version int, p_closing_no int default 1)`.
- `public.start_next_closing(p_token text, p_business_date date, p_closing_no int) returns jsonb` → `{ok:true, closing:<snapshot>}` | `{ok:false, error: session errors | 'wrong_day' | 'wrong_closing' | 'not_submitted' | 'no_more_closings'}`.
- `public.submit_closing(p_token text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_revision bigint, p_idempotency_key text, p_closing_no int default 1)`.
- Broadcasts on `shop:<shopId>`: `field` payload gains `closing_no`; `submitted` payload (= stored `last_submit`) gains `closing_no`; new event `closing_started` with `{business_date, closing_no}`.

- [ ] **Step 1: Write the SQL test `supabase/tests/170_multi_closing.sql`**

Same frame as `supabase/tests/090_live_submit.sql` (one transaction, test users from the README, ends in `ROLLBACK`; each failure raises a message starting with the test id). Shop A, cashiers ΜΑΡΙΑ and ΕΛΕΝΗ, phones `…d1`, `…d2`. Blocks:

- `T1` defaults: a new shop has `closings_per_day = 1`, `cash_mode = 'separate'`; `get_open_closing` snapshot has `closing_no = 1`, `closings_planned = 1`, `cash_mode = 'separate'`.
- `T2` plan and pinning: `set_closing_plan(shop, 0, 'separate')`, `(shop, 7, 'separate')`, `(shop, 3, 'x')` each raise `bad_closing_plan`; owner B calling it for shop A raises `not_owner`. With today's closing already created at plan 1, `set_closing_plan(shop, 3, 'separate')` leaves today's snapshot at `closings_planned = 1`. Then (as the migration owner) delete today's open closing and call `get_open_closing` again → `closings_planned = 3`. A later `set_closing_plan(shop, 2, 'running')` does not change that row.
- `T3` start refused: `start_next_closing` before any submit → `not_submitted`; after a submit plus one more field write → `not_submitted`; for yesterday's date → `wrong_day`; with `p_closing_no = 2` while 1 is live → `wrong_closing`.
- `T4` start, `separate`: submit closing 1, start → `ok`, snapshot `closing_no = 2`, `revision = 0`, no fields, same `config_id`, `closings_planned = 3`, `cash_mode = 'separate'`, `last_submit` null. `get_open_closing` from the other phone now returns closing 2. A write with `p_closing_no = 1` → `wrong_closing` and closing 1's fields and revision are unchanged; the same write with `p_closing_no = 2` → `ok`. `owner_set_closing_field` with `p_closing_no = 1` → `wrong_closing`. `submit_closing` with `p_closing_no = 1` → `wrong_closing`, no row stored. A submit of closing 2 stores a `closings` row with `closing_no = 2`; closing 1's row still has `closing_no = 1`.
- `T5` last closing: with plan 3, after closing 3 is submitted `start_next_closing(…, 3)` → `no_more_closings`.
- `T6` repeat: after closing 2 exists, `start_next_closing(…, 1)` again (second cashier, phone `…d2`) → `ok` with the snapshot of closing 2; there is exactly one `open_closings` row with `closing_no = 2`.
- `T7` `running` (shop C, plan 2 `running`): closing 1 has two visible expense lines (one by ΜΑΡΙΑ, one by the owner), one removed line, a count box and a channel box; submit, start. Closing 2 has exactly the two visible lines with their `:d`/`:a` fields, values and `addedBy` equal to closing 1's, every copied field at `version = 1`; no `d:`/`c:` field and not the removed line. ΕΛΕΝΗ can submit closing 2 with those two lines (authors unchanged).
- `T8` config pin: publish a new config after closing 1 exists; closing 2's `config_id` equals closing 1's.
- `T9` new day: move the shop's day forward (same technique as `060`) → `get_open_closing` returns `closing_no = 1` of the new date.
- `T10` grants: `anon` cannot execute `set_closing_plan`/`start_next_closing`; `authenticated` cannot execute `private.write_closing_field`; the 5-argument `set_closing_field` and the 6-argument `submit_closing` no longer exist.

- [ ] **Step 2: Write the migration `20261117000001_multi_closing.sql`**

Header comment: the model in five lines (closing numbers, live closing, pinned plan, explicit start, `wrong_closing`). Then, in this order:

1. Columns, constraints and indexes from the Interfaces block (drop the old unique constraint and the old index by name).
2. `set_closing_plan`: locks the shop row `for update`, validates, updates the two columns.
3. `private.open_closing_for(p_shop)`: returns the row of the shop's business date with the highest `closing_no`. When the day has none, inserts closing 1 with the shop's latest config and the shop's `closings_per_day` → `closings_planned`, `cash_mode` → `cash_mode` (`on conflict (shop_id, business_date, closing_no) do nothing`, then re-select, as today).
4. `private.closing_snapshot`: existing body plus the three keys.
5. `private.write_closing_field`: body of `20261114000007` with the new `p_closing_no` argument. Directly after the `for update` on the open closing: re-read the row, and if `p_closing_no is distinct from v_oc.closing_no` return `{ok:false,error:'wrong_closing'}`. The `field` broadcast payload gains `'closing_no', v_oc.closing_no`. Drop the 6-argument form.
6. `set_closing_field`, `owner_set_closing_field`: drop and re-create with the trailing `p_closing_no int default 1`, passed through.
7. `start_next_closing`. Check order: session → `wrong_day` (`p_business_date` ≠ the shop's business date) → `v_oc := open_closing_for`, lock it `for update` and re-read the day's highest row under the lock → if `v_oc.closing_no = p_closing_no + 1` return `ok` with its snapshot (a repeat) → if `v_oc.closing_no <> p_closing_no` → `wrong_closing` → if `p_closing_no >= v_oc.closings_planned` → `no_more_closings` → if `v_oc.last_submit` is null or `(v_oc.last_submit ->> 'revision')::bigint` is distinct from `v_oc.revision` → `not_submitted` → insert the next row (`closing_no + 1`; `config_id`, `closings_planned`, `cash_mode` copied from `v_oc`) → when `v_oc.cash_mode = 'running'`, copy every field whose key is `e:<id>`, `e:<id>:d` or `e:<id>:a` of a line whose `e:<id>` value has `removed = false` (same `value`, `updated_by_staff`, `updated_by_owner`; `version = 1`) → `realtime.send(jsonb_build_object('business_date', …, 'closing_no', …), 'closing_started', 'shop:' || shop, true)` → return `ok` with the new snapshot.
8. `submit_closing`: body of `20261114000002` with the trailing `p_closing_no int default 1`. After the `for update` on `v_oc` and before the `config_mismatch` check: `p_closing_no is distinct from v_oc.closing_no` → `wrong_closing`. The insert sets `closing_no = v_oc.closing_no`; `v_last` gains `'closing_no', v_oc.closing_no`. The idempotency lookup stays where it is (a repeat is still answered first). Drop the 6-argument form.
9. Revokes and grants for everything above.

- [ ] **Step 3: README paragraph, then commit**

```bash
git add supabase/migrations/20261117000001_multi_closing.sql supabase/tests/170_multi_closing.sql supabase/tests/README.md
git commit -m "feat(db): closings per day, live closing, start next closing (written, not applied)"
```

---

### Task 2: Database — history, corrections and suggestions per closing

**Files:**
- Create: `supabase/migrations/20261117000002_multi_closing_history.sql`
- Create: `supabase/tests/180_multi_closing_history.sql`
- Modify: `supabase/tests/README.md`

**Interfaces — Consumes:** Task 1 columns and `private.open_closing_for`.

**Interfaces — Produces (SQL, parsed by Tasks 7–8):**
- `private.current_closing(p_shop uuid, p_date date, p_closing_no int) returns public.closings` (the 2-argument form is dropped).
- `owner_list_closings(p_shop_id, p_from, p_to)` → `{ok, today, from, to, configs, days:[day…]}` newest day first, with
  `day = {business_date, cash_mode, closings_planned, closings:[entry…]}` (entries by `closing_no` ascending) and
  `entry = {closing_no, status:'submitted', version_count, current:<version>}` | `{closing_no, status:'unsubmitted', open:<closing_snapshot>}`.
- `owner_get_closing_day(p_shop_id, p_business_date)` → `{ok, today, business_date, cash_mode, closings_planned, live_closing_no, closings:[{closing_no, versions:[version…] (seq desc), open:<closing_snapshot>|null}], configs, staff_names}`.
  `live_closing_no` is the live closing's number when `business_date` is the shop's business date and an open closing exists, else null.
- `owner_save_closing(p_shop_id uuid, p_business_date date, p_config_id uuid, p_inputs jsonb, p_expected_current_id uuid, p_idempotency_key text, p_revision bigint default null, p_closing_no int default 1)` — same result shapes as today.
- `expense_suggestion_data(p_token text)` — unchanged signature.
- `version` JSON is unchanged.

A day's `cash_mode`/`closings_planned` come from its `open_closings` row with `closing_no = 1`; a day without one (rows from before stage 2) reports `'separate'` and the number of distinct `closing_no` values it has.

- [ ] **Step 1: Write `supabase/tests/180_multi_closing_history.sql`**

Frame as `110_owner_save_closing.sql`. Blocks:

- `T1` old-style day: a `closings` row written as the migration owner for a past date with no `open_closings` row → the list has one day, `cash_mode = 'separate'`, `closings_planned = 1`, one entry `closing_no = 1`, `status = 'submitted'`.
- `T2` list, three closings submitted on a past date (plan 3; rows written as the migration owner with back-dated `business_date`, as `100` does) with a correction on closing 2 → one day, three entries in order 1, 2, 3; entry 2 has `version_count = 2` and `current` is the correction; `configs` holds the config.
- `T3` list, unsubmitted tail: a past date where closings 1 and 2 are submitted and closing 3's open closing has a field but no row → entries 1 and 2 `submitted`, entry 3 `unsubmitted` with `open.closing_no = 3`.
- `T4` day detail of the `T2` date: `closings` has three items, each with its own `versions`; `live_closing_no` null. For today with closing 2 live: `live_closing_no = 2`.
- `T5` current per closing: `private.current_closing(shop, date, 2)` is the correction; `(shop, date, 1)` is closing 1's row (as the migration owner).
- `T6` save a past closing: `owner_save_closing(…, p_closing_no => 2)` guarded on closing 2's current → `ok`, the new row has `closing_no = 2` and `corrects_closing_id` = that current; the same call guarded on closing 1's current id → `closing_changed`.
- `T7` earlier closing of today is corrected like a past day: with closing 2 live today, saving closing 1 needs no `p_revision`, does not change any `open_closings.last_submit` or `revision`, and returns `ok`.
- `T8` the live closing keeps today's rule: saving closing 2 (live) with a wrong `p_revision` → `draft_changed`; with the right one → `ok`, `last_submit.staff_name` = «Ιδιοκτήτης» on closing 2's open closing only.
- `T9` suggestions: a `separate` day with two closings each holding one expense line → both lines returned; a `running` day whose closings 1 and 2 hold the same line (closing 2 one more) → each line returned once (closing 2's).
- `T10` grants: the 7-argument `owner_save_closing` and 2-argument `private.current_closing` no longer exist; `authenticated` cannot execute the 3-argument `private.current_closing`.

- [ ] **Step 2: Write the migration `20261117000002_multi_closing_history.sql`**

1. `private.current_closing` with the `closing_no` filter; drop the 2-argument form.
2. `owner_list_closings`: body of `20261111000001` grouped by `(business_date, closing_no)`. The unsubmitted rule becomes per closing: an open closing of a date before today, with at least one field and no non-voided `closings` row for the same `(business_date, closing_no)`. Build entries, then aggregate them per date with the day's plan.
3. `owner_get_closing_day`: one item per `closing_no` present in `closings` (non-voided) or qualifying as unsubmitted for that date; `open` set only for an unsubmitted one; `configs` covers every version's config.
4. `owner_save_closing`: body of `20261111000003` with the trailing `p_closing_no int default 1`. Changes: the advisory lock key ends in `':' || p_closing_no`; `v_oc` is selected by `(shop, date, closing_no)`; `current_closing` is called with the number; a new boolean `v_live` = (`p_business_date = v_today` and `v_oc.id` is the id returned by `private.open_closing_for(p_shop_id)`) replaces every `p_business_date = v_today` test; `p_closing_no` outside 1..6 → `bad_inputs`; the insert sets `closing_no`; `v_last` gains `'closing_no'`. Drop the 7-argument form.
5. `expense_suggestion_data(p_token)`: the lateral picks the current version per `(business_date, closing_no)` (`distinct on … order by business_date, closing_no, seq desc`), then keeps, for a date whose closing-1 open closing has `cash_mode = 'running'`, only the highest `closing_no`.
6. Revokes and grants.

- [ ] **Step 3: README paragraph, then commit**

```bash
git add supabase/migrations/20261117000002_multi_closing_history.sql supabase/tests/180_multi_closing_history.sql supabase/tests/README.md
git commit -m "feat(db): history, corrections and suggestions per closing (written, not applied)"
```

---

### Task 3: Client live model — closing number in snapshots, edits and the engine

**Files:**
- Create: `src/app/closingLabel.ts`, `tests/app/closingLabel.test.ts`
- Modify: `src/features/register/live/fields.ts`, `src/features/register/live/syncEngine.ts`, `src/data/remote/live.ts`, `src/data/remote/deviceApi.ts`, `src/data/remote/device.ts`, `src/data/remote/deviceErrors.ts`, `src/data/local/openClosing.ts`, `src/features/phone/model/messages.ts`, `src/features/phone/model/gate.ts`, `src/features/register/RegisterScreen.tsx` (call sites only), `tests/features/phone/fakeDeviceApi.ts`
- Test: `tests/features/register/live/fields.test.ts`, `syncEngine.test.ts`, `tests/data/liveRemote.test.ts`, `tests/data/openClosing.test.ts`, `tests/data/deviceApi.test.ts`, `tests/data/deviceErrors.test.ts`, `tests/features/phone/gate.test.ts`

**Interfaces — Produces:**

```ts
// src/app/closingLabel.ts
export function closingLabel(no: number): string;                    // 2 → «2ο κλείσιμο»
export function closingOfLabel(no: number, planned: number): string; // (2,3) → «2ο κλείσιμο από 3»
export function closingsDoneLabel(done: number, planned: number): string; // (2,3) → «2 από 3 κλεισίματα»

// fields.ts
export type CashMode = 'separate' | 'running';
export interface Snapshot { /* existing */ closingNo: number; closingsPlanned: number; cashMode: CashMode }
export interface PendingEdit { /* existing */ closingNo: number }
export interface SubmitInfo { /* existing */ closingNo?: number }
/** Same business date and same closing number. */
export function sameClosing(a: { businessDate: string; closingNo: number }, b: { businessDate: string; closingNo: number }): boolean;

// live.ts
export type LiveFieldEvent = ServerField & { revision: number; businessDate: string; closingNo: number };
export interface LiveHandlers { /* existing */ onClosingStarted(e: { businessDate: string; closingNo: number }): void }

// deviceApi.ts
// DeviceError gains: { code: 'wrong_closing' } | { code: 'not_submitted' } | { code: 'no_more_closings' }
submit(token, configId, businessDate, closingNo: number, inputs, revision, idempotencyKey): …;
setField(token, businessDate, closingNo: number, key, value, baseVersion): …;
startNextClosing(token: string, businessDate: string, closingNo: number): Promise<DResult<Snapshot>>;

// syncEngine.ts
export const WRONG_CLOSING_NOTICE = 'Ξεκίνησε νέο κλείσιμο — οι αλλαγές σου στο προηγούμενο δεν αποθηκεύτηκαν';
```

- [ ] **Step 1: Failing tests**

- `closingLabel.test.ts`: the three examples above; `closingOfLabel(1, 1)` is `'1ο κλείσιμο'` (no «από» for a 1-closing plan is the caller's job — the function always formats).
- `liveRemote.test.ts`: `parseSnapshot` reads `closing_no: 2, closings_planned: 3, cash_mode: 'running'`; a snapshot without the three keys parses with `1, 1, 'separate'`; `closing_no: 0`, `7`, `1.5` or an unknown `cash_mode` → `null`. The field-broadcast parser reads `closing_no` (absent → 1). The `closing_started` parser accepts `{business_date:'2026-11-17', closing_no:2}` and rejects a bad date or number. `parseSubmitInfo` carries `closingNo` when present.
- `openClosing.test.ts`: a stored pending edit without `closingNo` loads with `closingNo: 1`; one with `closingNo: 'x'` is dropped; a stored snapshot without the three fields loads with the defaults.
- `fields.test.ts`: `sameClosing` true only when both parts match.
- `syncEngine.test.ts`:
  - `reduceEdit` stamps the snapshot's `closingNo` on the new edit.
  - `visibleDraft`/`nextToSend`/`isDrained` ignore a pending edit of the same date but another `closingNo`.
  - `reduceBroadcast` with a field of the same date and another `closingNo` → `resync: true`, state unchanged.
  - `reduceLoaded` with a snapshot of the same date, `closingNo` 2, while pending holds closing-1 edits → those edits are dropped, `notice === WRONG_CLOSING_NOTICE`; with no such edits → no notice. (A date change still gives `WRONG_DAY_NOTICE`.)
  - `reduceWriteResult` for `wrong_closing` → the edits of that item's date + closing are dropped, `WRONG_CLOSING_NOTICE`, effect `resync`.
  - engine: `onClosingStarted` triggers one `load()`; `onSubmitted` with `closingNo` different from the snapshot's does not set `lastSubmit` and triggers a `load()`; with the same or no `closingNo` it sets `lastSubmit` as today.
  - startup: a persisted edit with a `null` base gets its base from the reloaded snapshot only when `sameClosing` (today: same date).
- `deviceErrors.test.ts`: the three new strings map to their codes. `deviceApi.test.ts`: `setField`/`submit` send `p_closing_no`; `startNextClosing` calls `start_next_closing` with `p_token`, `p_business_date`, `p_closing_no` and parses `closing` with `parseSnapshot` (an unparsable one → `unknown`).
- `gate.test.ts`: a `server_error` with `wrong_closing`, `not_submitted` or `no_more_closings` leaves the gate state unchanged.

- [ ] **Step 2: Run** `npx vitest run tests/app/closingLabel.test.ts tests/data tests/features/register/live tests/features/phone/gate.test.ts` — the new cases fail.

- [ ] **Step 3: Implement**

- `fields.ts`, `live.ts`, `openClosing.ts`: types, `sameClosing`, parsers and the defaults for old stored shapes. `live.ts` subscribes to the `closing_started` broadcast and calls `onClosingStarted`.
- `syncEngine.ts`: replace every `x.businessDate === y.businessDate` comparison between a pending edit / broadcast / snapshot with `sameClosing` (the `grep -n businessDate src/features/register/live/syncEngine.ts` list is the checklist: lines 108, 131–132, 138–147, 166–167, 184, 200, 207, 257, 291, 300, 357–358). `savePending`'s `currentDate` argument stays a date. Add the `wrong_closing` case next to `wrong_day`.
- `device.ts`, `deviceErrors.ts`, `fakeDeviceApi.ts`: the new arguments, method and codes. `RegisterScreen.tsx`: pass `e.closingNo` / `snapshot.closingNo` at the two call sites (lines 58 and 226) — no UI yet.
- `messages.ts` (phone): `wrong_closing` → «Ξεκίνησε νέο κλείσιμο. Το ταμείο ανανεώθηκε.»; `not_submitted` → «Κάνε πρώτα Υποβολή του κλεισίματος.»; `no_more_closings` → «Δεν υπάρχει άλλο κλείσιμο για σήμερα.».
- `gate.ts`: the three codes are ignored by the gate (like a suggestion `unknown`).
- Submit path in `RegisterScreen`: a `wrong_closing` from `api.submit` is handled like `draft_changed` (resync, the sheet asks the cashier to review; not sent to `onServerError`).

- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — pass.

- [ ] **Step 5: Commit** `feat(register): closing number in the live model and sync engine`

---

### Task 4: Register UI — which closing, and starting the next one

**Files:**
- Create: `src/features/register/StartNextSheet.tsx`
- Modify: `src/features/register/RegisterScreen.tsx`, `src/features/register/share.ts`, `src/features/register/SubmitSheet.tsx` (passes the label to the share card)
- Test: `tests/features/register/liveRegister.test.tsx`, `tests/features/register/share.test.ts`

**Interfaces — Consumes:** `Snapshot.closingNo/closingsPlanned/cashMode`, `changedSinceSubmit`, `DeviceApi.startNextClosing`, `closingLabel`, `closingOfLabel` (Task 3).

**Interfaces — Produces:**

```ts
// StartNextSheet.tsx
export function StartNextSheet(props: { nextNo: number; cashMode: CashMode; busy: boolean; error: string | null; onConfirm(): void; onClose(): void }): JSX.Element;
/** Pure: may the cashier start the next closing from this snapshot? */
export function canStartNext(s: Snapshot, hasUnsent: boolean): boolean;
```

`canStartNext` is true only when `closingNo < closingsPlanned`, `lastSubmit !== null`, `!changedSinceSubmit(s)` and `!hasUnsent`.

Copy:
- Header line (only when `closingsPlanned > 1`): `closingOfLabel(closingNo, closingsPlanned)`, e.g. «2ο κλείσιμο από 3», shown under the date · cashier line.
- Button (only when `canStartNext`): «Έναρξη 3ου κλεισίματος» (`Έναρξη ${n}ου κλεισίματος`).
- Sheet title: the same text. Body, `separate`: «Τα κουτιά θα αδειάσουν για το νέο κλείσιμο. Το προηγούμενο δεν αλλάζει πια από το ταμείο.» Body, `running`: «Τα έξοδα μένουν. Η καταμέτρηση και τα ποσά ξεκινούν κενά για νέα καταγραφή. Το προηγούμενο κλείσιμο δεν αλλάζει πια από το ταμείο.» Buttons: «Έναρξη» / «Άκυρο».
- Share card: when `closingsPlanned > 1`, the card's date line ends with ` · ${closingLabel(closingNo)}`.

- [ ] **Step 1: Failing tests** (`liveRegister.test.tsx`, with `fakeDeviceApi`)

- Plan 1: no closing line and no «Έναρξη» button, before and after a submit.
- Plan 3, closing 1, not submitted: «1ο κλείσιμο από 3» is shown, no «Έναρξη» button.
- Plan 3, closing 1, submitted and unchanged: the button «Έναρξη 2ου κλεισίματος» is shown; after typing in a box it disappears.
- Confirming calls `startNextClosing(token, date, 1)` once; when it resolves with the closing-2 snapshot the header shows «2ο κλείσιμο από 3» and the boxes are empty.
- `startNextClosing` failing with `not_submitted` shows «Κάνε πρώτα Υποβολή του κλεισίματος.» inside the sheet, which stays open; failing with `wrong_closing` closes the sheet and reloads (one `getOpenClosing` call); failing with `network` shows the network message and re-enables «Έναρξη» (the busy flag is cleared on every path).
- Plan 3, closing 3, submitted: no button.
- `running` mode shows the `running` body text.
- `share.test.ts`: the label is on the card for plan 3, absent for plan 1.

- [ ] **Step 2: Run** the two test files — the new cases fail.

- [ ] **Step 3: Implement.** After a successful start call the hook's `resync()` (the returned snapshot is not applied by hand: one load path). The submit sheet's idempotency key state is reset when `snapshot.closingNo` changes.

- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — pass.

- [ ] **Step 5: Commit** `feat(register): show the closing number and start the next closing`

---

### Task 5: Owner settings — the two options

**Files:**
- Create: `src/features/owner/settings/ClosingPlanCard.tsx`, `tests/features/owner/closingPlan.test.tsx`
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/data/remote/errors.ts`, `src/features/owner/model/messages.ts`, `src/features/owner/model/limits.ts`, `src/features/owner/settings/SettingsScreen.tsx`, `tests/features/owner/fakeApi.ts`
- Test: also `tests/data/ownerApi.test.ts`, `tests/data/remoteErrors.test.ts`, `tests/features/owner/messages.test.ts`

**Interfaces — Produces:**

```ts
// limits.ts
export const MAX_CLOSINGS_PER_DAY = 6;
// ownerApi.ts
export interface ClosingPlan { count: number; cashMode: CashMode }
closingPlan(shopId: string): Promise<Result<ClosingPlan>>;          // reads shops.closings_per_day, cash_mode
setClosingPlan(shopId: string, plan: ClosingPlan): Promise<Result<void>>; // rpc set_closing_plan
// errors.ts: OwnerError gains { code: 'bad_closing_plan' } and { code: 'wrong_closing' }
```

Copy for `ClosingPlanCard` (placed directly after `DayChangeCard`, same card style and save pattern):
- Title: «Κλεισίματα ανά ημέρα»
- Hint: «Πόσες φορές κλείνει το ταμείο μέσα σε μία ημέρα (π.χ. μία σε κάθε αλλαγή βάρδιας).»
- Number control 1–6 (− / + buttons with the number between them, labelled «Κλεισίματα»).
- When the number is above 1, a two-option choice titled «Τα μετρητά σε κάθε κλείσιμο»:
  - «Φεύγουν από το ταμείο» — «Κάθε κλείσιμο ξεκινά από την αρχή. Το αποτέλεσμα της ημέρας είναι το άθροισμα των κλεισιμάτων.» (`separate`)
  - «Μένουν στο ταμείο» — «Κάθε κλείσιμο δείχνει το σύνολο της ημέρας ως εκείνη τη στιγμή. Το αποτέλεσμα της ημέρας είναι το τελευταίο κλείσιμο.» (`running`)
- Save button «Αποθήκευση» (disabled while unchanged or saving). After a save: «Αποθηκεύτηκε. Μια ημέρα που έχει ήδη ξεκινήσει μένει όπως ξεκίνησε.»
- Messages: `bad_closing_plan` → «Τα κλεισίματα ανά ημέρα πρέπει να είναι από 1 έως 6.»; `wrong_closing` → «Ξεκίνησε νέο κλείσιμο. Η οθόνη ανανεώθηκε.»

When the number is 1 the card saves `cashMode: 'separate'`.

- [ ] **Step 1: Failing tests**

- `closingPlan.test.tsx`: loads and shows the stored plan; the mode choice is hidden at 1 and visible at 2; − stops at 1 and + at 6; saving `3` + «Μένουν στο ταμείο» calls `setClosingPlan(shopId, {count: 3, cashMode: 'running'})`; going back to 1 saves `separate`; a failed load shows the error with a retry and no controls; a failed save shows the message and re-enables the button.
- `ownerApi.test.ts`: `closingPlan` maps the row (a missing row → `not_owner`; a `cash_mode` that is neither value → `bad_response`/`unknown` as the file's other parsers do); `setClosingPlan` sends `p_shop_id`, `p_count`, `p_cash_mode`.
- `remoteErrors.test.ts` / `messages.test.ts`: the two new codes map and have Greek messages.

- [ ] **Step 2: Run** — fail. **Step 3: Implement.** **Step 4:** `npm test`, `npm run typecheck` — pass.

- [ ] **Step 5: Commit** `feat(owner): closings per day and cash mode in settings`

---

### Task 6: Owner «Σήμερα» — follows the live closing

**Files:**
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/features/owner/todayWriter.ts`, `src/features/owner/TodayScreen.tsx`, `src/features/owner/history/types.ts` (`SaveClosingArgs`), `tests/features/owner/fakeApi.ts`
- Test: `tests/features/owner/todayWriter.test.ts`, `tests/features/owner/today.test.tsx`, `tests/data/ownerApi.test.ts`

**Interfaces — Produces:**

```ts
setTodayField(shopId, businessDate, closingNo: number, key, value, baseVersion): …; // sends p_closing_no
export interface SaveClosingArgs { /* existing */ closingNo: number }               // saveClosing sends p_closing_no
```

- [ ] **Step 1: Failing tests**

- `todayWriter.test.ts`: `write` passes the edit's `closingNo`; an `OwnerError` `wrong_closing` becomes the device error `wrong_closing` (so the engine drops and resyncs, as for `wrong_day`).
- `today.test.tsx`: with plan 3 and closing 2 live the screen shows «2ο κλείσιμο από 3» next to the date; with plan 1 it does not; «Καταχώρηση αλλαγών» calls `saveClosing` with `closingNo: 2`; a `closing_started` event from the fake channel makes the screen load and show closing 3.
- `ownerApi.test.ts`: both calls send `p_closing_no`.

- [ ] **Step 2: Run** — fail. **Step 3: Implement** (every existing `saveClosing` caller passes a `closingNo`; `CorrectionEditor`/`DayScreen` pass `1` for now — Task 8 gives them the real number). **Step 4:** `npm test`, `npm run typecheck` — pass.

- [ ] **Step 5: Commit** `feat(owner): Today follows the live closing`

---

### Task 7: History list — closings inside a day and the day result

**Files:**
- Modify: `src/features/owner/history/types.ts`, `src/features/owner/history/model.ts`, `src/data/remote/history.ts` (`parseHistoryList`), `src/features/owner/history/HistoryScreen.tsx`, `tests/features/owner/fakeApi.ts`
- Test: `tests/data/history.test.ts`, `tests/features/owner/history/model.test.ts`, `tests/features/owner/history/history.test.tsx`

**Interfaces — Produces:**

```ts
// types.ts
export type HistoryClosing =
  | { closingNo: number; status: 'submitted'; current: ClosingVersion; versionCount: number }
  | { closingNo: number; status: 'unsubmitted'; open: Snapshot };
export interface HistoryDay { businessDate: string; cashMode: CashMode; closingsPlanned: number; closings: HistoryClosing[] } // closings by closingNo ascending, never empty

// model.ts
/** One closing's readable result with the config it was computed with. */
export interface ClosingResult { closingNo: number; configId: string; summary: Summary | null }
/**
 * The day's result. running: the summary of the highest-numbered item (null if unreadable).
 * separate: per total id, the sum over all items — null unless every item is readable and all share one configId.
 * An empty list → null.
 */
export function combineDay(mode: CashMode, results: readonly ClosingResult[]): Summary | null;
export interface DaySummary { result: Summary | null; done: number; planned: number; hasUnsubmitted: boolean }
/** `done` = submitted closings; `planned` = max(day.closingsPlanned, day.closings.length). Only submitted closings feed `result`. */
export function summarizeDay(day: HistoryDay, configs: Record<string, unknown>): DaySummary;
```

`WeekCell.kind` for a listed day: `'submitted'` when at least one closing is submitted, else `'unsubmitted'`.

`combineDay` in `separate` mode keeps the ids, labels and order of the first item's totals and adds `cents` and `expensesCents`.

- [ ] **Step 1: Failing tests**

- `history.test.ts`: `parseHistoryList` reads the Task 2 `day` shape; a day with an empty `closings` array is dropped; a bad entry is dropped individually while its siblings stay; a day whose entries are all bad is dropped; an unknown `cash_mode` or a `closings_planned` outside 1..6 drops that day only; a bad top level → `null`.
- `model.test.ts` (real configs and inputs through `summarizeInputs`, no re-implemented arithmetic — expected sums are written as literals):
  - `combineDay('separate', …)` of two closings with ΜΕΤΡΗΤΑ 100,00 € and 250,50 € → 350,50 €, expenses added the same way, labels and order kept.
  - `combineDay('running', …)` of three → equal to the third's summary.
  - `separate` with one `summary: null` → `null`; with two different `configId`s → `null`; `running` whose last is `null` → `null`; `[]` → `null`.
  - `summarizeDay`: 2 submitted + 1 unsubmitted with plan 3 → `done: 2, planned: 3, hasUnsubmitted: true`, result from the two submitted; 4 closings with a stored plan of 3 → `planned: 4`; a 1-closing day → the same `result` as `summarizeInputs` of its current version.
  - `weekCells`: a day with one submitted and one unsubmitted closing is `'submitted'`.
- `history.test.tsx`: a 1-closing day card renders exactly as before (existing assertions keep passing with the new fixture shape); a plan-3 day with two submitted shows the day's totals and «2 από 3 κλεισίματα»; a `separate` day with an unreadable closing shows «—» for the totals and still «2 από 3 κλεισίματα»; a day with only unsubmitted closings keeps the existing unsubmitted look; a day with an unsubmitted tail shows the badge «Δεν υποβλήθηκε το 3ο».

- [ ] **Step 2: Run** — fail. **Step 3: Implement.** The card links to `…/history/<date>` as today (Task 8 adds the closing segment). **Step 4:** `npm test`, `npm run typecheck` — pass (DayScreen still compiles: `DayDetail` is untouched in this task).

- [ ] **Step 5: Commit** `feat(owner): history week shows closings per day and the day result`

---

### Task 8: History day — one closing at a time, corrections per closing

**Files:**
- Modify: `src/app/router.ts`, `src/features/owner/history/types.ts` (`DayDetail`), `src/data/remote/history.ts` (`parseDayDetail`), `src/features/owner/history/DayScreen.tsx`, `src/features/owner/history/CorrectionEditor.tsx`, `src/features/owner/ShopLayout.tsx` (passes the route's closing number), `tests/features/owner/fakeApi.ts`
- Test: `tests/app/ownerRouter.test.ts`, `tests/data/history.test.ts`, `tests/features/owner/history/day.test.tsx`, `tests/features/owner/history/correction.test.tsx`

**Interfaces — Produces:**

```ts
// router.ts — OwnerRoute 'shop' gains: closingNo?: number  (only with tab 'history' and a date)
// hash: #/owner/shop/<id>/history/<YYYY-MM-DD>/<n>, n an integer 1..6 written without leading zeros

// types.ts
export interface DayClosing { closingNo: number; versions: ClosingVersion[]; open: Snapshot | null } // versions newest first
export interface DayDetail {
  today: string; businessDate: string; cashMode: CashMode; closingsPlanned: number;
  /** The live closing's number when this day is the shop's today; else null. */
  liveClosingNo: number | null;
  closings: DayClosing[];        // by closingNo ascending; may be empty
  configs: Record<string, unknown>; staffNames: Record<string, string>;
}
```

Behaviour:
- A malformed closing segment (`0`, `7`, `02`, `x`) is dropped: the route is the day without a closing. `parseOwnerRoute` accepts up to 5 parts for this case only.
- The shown closing: the route's `closingNo` when the day has it; otherwise the highest-numbered closing of the day.
- When the day has more than one closing (or `closingsPlanned > 1`): a card «Σύνολο ημέρας» on top with `combineDay` over each closing's current version (unsubmitted closings excluded) and `closingsDoneLabel`, then a selector with one button per closing («1ο», «2ο», «3ο»; the unsubmitted one carries «Δεν υποβλήθηκε») that navigates to the closing's hash. With one closing and plan 1 neither is rendered.
- Below, the selected closing is rendered by the existing day body (versions, breakdown, change marks, Φάκελος, «Διόρθωση», «Επαναφορά», «Αποθήκευση ως κλείσιμο»), fed that closing's `versions`/`open`.
- The rule that hid «Διόρθωση»/«Επαναφορά» for today now reads: hidden when `businessDate === today && closingNo === liveClosingNo`. An earlier closing of today offers both.
- `CorrectionEditor` takes `closingNo` and sends it in `SaveClosingArgs`; `DayScreen`'s «Επαναφορά» does too. The editor remounts when the selected closing changes (key includes `closingNo`), so local edits and the idempotency key never move between closings.
- Empty day text stays «Δεν υπάρχει κλείσιμο για αυτή τη μέρα.».

- [ ] **Step 1: Failing tests**

- `ownerRouter.test.ts`: round trip of `…/history/2026-11-16/2`; the four malformed segments parse to the day route; a closing segment after a non-history tab → shops list (as other malformed routes).
- `history.test.ts`: `parseDayDetail` reads the Task 2 shape; a bad closing item is dropped alone; a bad version inside a closing is dropped alone; `live_closing_no` null and a number both parse; `0`/`7` → null field value, not a rejected payload.
- `day.test.tsx`: 1-closing past day — no day card, no selector, existing assertions pass; 3-closing `separate` day — the day card shows the sum and «3 από 3 κλεισίματα», the selector has three buttons, the highest closing is shown by default, clicking «1ο» navigates to `…/1` and shows closing 1's versions; route `…/9` on a 3-closing day falls back to closing 3; today with closing 2 live — closing 2 has no «Διόρθωση», closing 1 has it; «Επαναφορά» on closing 2 of a past day calls `saveClosing` with `closingNo: 2` and `expectedCurrentId` = closing 2's current.
- `correction.test.tsx`: a save sends the editor's `closingNo`; `closing_changed` → «Φόρτωση νέας» refetches and stays on the same closing.

- [ ] **Step 2: Run** — fail. **Step 3: Implement.** **Step 4:** `npm test`, `npm run typecheck`, `npm run build` — pass.

- [ ] **Step 5: Commit** `feat(owner): history day per closing, corrections per closing`

---

### Task 9: Apply to dev, run the SQL tests, update the docs

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_STATUS.md`, `project-notes/index.md`, `project-notes/architecture.md`, `project-notes/decisions.md`, `project-notes/session-log.md`, `supabase/tests/README.md`

- [ ] **Step 1: Ask the project owner before touching the dev database.** Applying changes the history payloads; the deployed client and the migrations must go out together.
- [ ] **Step 2: Apply** `20261117000001_multi_closing`, then `20261117000002_multi_closing_history` to dev `fstfuhogvsdaiwpfdmep` (Supabase connector).
- [ ] **Step 3: Run** `170` and `180` whole, then re-run `080`, `090`, `100`, `110`, `130`, `160` (they call the re-created functions). Expected: each finishes without an exception. Positional calls in the old files that broke because an argument was added are fixed in the test file, not in the migration. Run the security advisors and read any new finding.
- [ ] **Step 4: Manual check on a real phone** with a throwaway shop: plan 3 `separate` — submit, start closing 2 from one phone while a second phone is open on closing 1 (it must switch by itself), type on the second phone, submit closing 2; then the same with `running` and two expense lines. Check «Ιστορικό» week and day for both. Check a 1-closing shop looks exactly as before.
- [ ] **Step 5: Docs.**
  - `CLAUDE.md`: a section «Multiple closings per day (stage 5)» with the model (closing numbers, live closing, pinned plan, explicit start, `running` copy rule, day result rule), the changed function signatures, the new broadcast, and these cross-file invariants: the 1..6 limit (SQL checks ↔ `MAX_CLOSINGS_PER_DAY`); the cash-mode values (SQL check ↔ `CashMode`); the history payload shapes (replace the `list`/`day` bullets); «current version» is now per `(shop, date, closing_no)` in `private.current_closing`, the list, the day detail, the save guard and `expense_suggestion_data`; the error strings `wrong_closing`, `not_submitted`, `no_more_closings` (phone) and `bad_closing_plan`, `wrong_closing` (owner) with their mapping files. Correct the sentences that say «one row per shop per business day». Add the plan and spec paths to the header.
  - `PROJECT_STATUS.md`: stage 5 entry; tests; under «Not verified» whatever of Steps 3–4 was not done.
  - `project-notes/`: update index (migration count, conventions), architecture (data flow step for starting the next closing), one decision entry (explicit start; plan pinned per day; `running` copies only expenses), a session-log entry.
- [ ] **Step 6: Commit** `docs: stage 5 multiple closings per day`
