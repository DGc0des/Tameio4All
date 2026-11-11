# Stage 3 — history dashboard + owner corrections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner gets an «Ιστορικό» tab per shop: a list of business days (submitted, or «Δεν υποβλήθηκε»),
a detail view of each day with every version, and «Διόρθωση», which stores a new owner version without
ever touching what staff submitted.

**Architecture:** `closings` becomes a version log: every staff submission and every owner correction is
one immutable row, ordered by a new monotonic `seq`; "the" closing of a day is the highest-`seq`
non-voided row. Three owner functions read and write it (`owner_list_closings`, `owner_get_closing_day`,
`owner_save_closing`), the last guarded on the expected current version id. The browser recomputes every
number from `config + inputs` through `src/core`, and the correction editor reuses `LiveClosingView` over
a local, in-memory `Snapshot` (no server writes until «Αποθήκευση»).

**Tech Stack:** React 19 + TypeScript strict, Vitest + Testing Library, Supabase Postgres functions,
supabase-js (through `OwnerApi` only).

**Spec:** `docs/superpowers/specs/2026-11-07-live-closing-and-history-design.md` — "History dashboard
(owner)", "Owner corrections", "Expense authorship", `expense_suggestion_data` note, "Delivery order → 3".
Stages 1–2 (merged) provide sessions, `private.business_date`, `open_closings`, `private.closing_snapshot`,
revision-checked `submit_closing`.

## Global Constraints

- All invariants in `CLAUDE.md` hold: RLS on, `anon` nothing, every function `security definer` +
  `search_path = ''`, explicit `revoke … from public, anon`, execute for `authenticated` only, identity only
  from `auth.uid()`; owner functions answer "not yours" and "doesn't exist" the same (`not_owner`, raised
  by `private.require_owner`).
- **A correction never modifies or deletes an existing `closings` row.** It inserts a new one.
- **Current version of a day = the non-voided `closings` row with the highest `seq`** for
  (shop, business_date). One rule, one SQL helper (`private.current_closing`); the list, the detail, the
  save guard and `expense_suggestion_data` all use it. Never order versions by `created_at`.
- **Totals are never stored or computed in SQL.** Every number on screen comes from
  `evaluateTotals`/`deriveClosing`/`planEnvelope` with the config of that closing version.
- Stored jsonb is untrusted when read back: `config` goes through `isShopConfig`, `inputs` through
  `validateClosingInputs`; a version that fails is shown as «Δεν διαβάζεται», it never throws and never
  hides the other rows.
- New closings written by the owner are `ClosingInputs` schema 2. Existing expense lines keep their
  `id` and `addedBy`; lines the owner adds are `{kind:'owner'}`.
- Staff still submit only for today's business date; the owner never presses Υποβολή. Owner saves do not
  touch `open_closings` (`revision`, `last_submit`) and broadcast nothing.
- Owner screens call only `OwnerApi`; UI tests use `tests/features/owner/fakeApi.ts`.
- Every new server error string gets a `mapError` case and a Greek `ownerErrorMessage` in the same task.
- The owner's browser never computes the shop's business date: "today" and the default range come from
  the server response.
- Components never parse or add money. Greek UI, English code. `npm test` + `npm run typecheck` before
  every commit.
- Migrations are applied to the dev project `fstfuhogvsdaiwpfdmep` with the Supabase connector
  (`apply_migration`), SQL tests run with `execute_sql` (each file ends in `ROLLBACK`). Never another
  project.

## Review Focus

1. **A stored version the browser cannot read** (hand-edited config, inputs that fail
   `validateClosingInputs`, a schema-1 row) — its row says «Δεν διαβάζεται», the rest of the list and the
   other versions of the day still render, «Διόρθωση» is not offered for it. Tests in Task 4 and Task 5.
2. **Staff resubmit (or a second owner tab saves) while the owner is correcting** — the save is refused
   (`closing_changed`), nothing is stored, the owner chooses «Φόρτωση νέας» or «Αποθήκευση πάνω της».
   Tests in Task 2 (T6, T11) and Task 7.
3. **Double tap / retry after a lost response on «Αποθήκευση»** — one version, not two (idempotency key
   kept until the inputs change or the save is acknowledged). Tests in Task 2 (T10) and Task 7.
4. **Correcting keeps authorship** — a line Μαρία added still says Μαρία after the owner fixes its amount
   (also when Μαρία has since been deactivated); a line the owner adds says «Ιδιοκτήτης»; schema-1 lines
   (no author) show «—». Tests in Task 2 (T9) and Task 4.
5. **Entry points with a bad or empty day** — `#/owner/shop/<id>/history/2026-02-30`, a future date, a day
   with nothing, a range with «Από» after «Έως»: the list or a plain «Δεν υπάρχει κλείσιμο για αυτή τη
   μέρα.» / the `bad_range` message, never a blank screen or a crash. Tests in Task 5 and Task 6.

---

## Decisions this plan makes (not in the spec)

| Decision | Why |
|---|---|
| `closings.seq bigint` identity, version order = `seq` | `created_at` is the transaction start time: a submit that started earlier but committed later would sort *behind* a correction it never saw. `seq` is assigned at insert, under the lock. Also makes one-transaction SQL tests deterministic. |
| `kind` values `'staff'` / `'owner_correction'`; a missed day filed by the owner is `owner_correction` with `corrects_closing_id = null` | Spec: "same versioning/marking as a correction, with no `corrects_closing_id`". |
| One write function `owner_save_closing(shop, date, config_id, inputs, expected_current_id, key)` instead of the spec's indicative `correct_closing(closing_id, …)` | Corrections and filing a missed day are the same write; one mutation path. `expected_current_id = null` means "no version yet". |
| Expected failures of the three functions are `{ok:false,error}` payloads; only `not_owner` is raised | Same as `owner_set_closing_field`; `closing_changed` must carry `current_id`. |
| Voided rows are invisible everywhere (no void UI in this stage) | The column and grant exist since Plan 3; nothing sets it yet. |
| Range: both bounds optional; default `to = today`, `from = to − 29`; span > 366 days or `from > to` → `bad_range`; no paging | Spec leaves pagination to the builder; a year of days is a few hundred KB at most. |
| Day detail is a route: `#/owner/shop/<id>/history/<YYYY-MM-DD>` | Phone back button and reload work. The editor is local state inside the day screen. |
| An unfinished correction is not persisted; leaving the screen drops it | Smallest version; recorded as an open item in `PROJECT_STATUS.md`. |
| Correcting a schema-1 line gives it a fresh id and `{kind:'owner'}` | It has no author to keep and schema-2 inputs need one. |

## File structure

| File | Role |
|---|---|
| `supabase/migrations/20261111000001_closing_versions.sql` (new) | `closings` columns + `seq`, `private.current_closing`, suggestions on the current-version rule, the two read functions |
| `supabase/migrations/20261111000002_owner_save_closing.sql` (new) | `owner_save_closing` |
| `supabase/tests/100_history.sql`, `110_owner_save_closing.sql` (new) | SQL security tests |
| `src/features/owner/history/types.ts` (new) | `ClosingVersion`, `HistoryDay`, `HistoryList`, `DayDetail` |
| `src/data/remote/history.ts` (new) | shape-checked parsers for the three payloads (no supabase import) |
| `src/data/remote/ownerApi.ts`, `owner.ts`, `errors.ts` (modify) | three `OwnerApi` methods, new error codes |
| `src/features/owner/model/messages.ts` (modify) | Greek messages |
| `src/features/owner/history/model.ts` (new) | pure: summaries, breakdown, inputs ⇄ local snapshot |
| `src/app/router.ts`, `src/app/dates.ts` (modify) | `history` tab + optional date; `formatStampEl` |
| `src/features/owner/history/HistoryScreen.tsx`, `DayScreen.tsx`, `CorrectionEditor.tsx` (new) | list, detail, editor |
| `src/features/owner/ShopLayout.tsx`, `OwnerApp.tsx` (modify) | tab wiring |
| `tests/features/owner/fakeApi.ts` (modify), `tests/data/history.test.ts`, `tests/features/owner/history/{model.test.ts,history.test.tsx,day.test.tsx,correction.test.tsx}` (new) | tests |

## Server payloads (shared by SQL and the parsers — cross-file invariant)

```
version  = { id, kind: 'staff'|'owner_correction', author_name, created_at, config_id, inputs, corrects_closing_id|null }
             author_name = staff name, or 'Ιδιοκτήτης' for an owner row
list     = { ok:true, today, from, to, configs: {<config_id>: config},
             days: [ { business_date, status:'submitted', version_count, current: version }
                   | { business_date, status:'unsubmitted', open: <private.closing_snapshot> } ] }   -- newest day first
day      = { ok:true, today, business_date, versions: [version…] /* seq desc, [0] is current */,
             configs: {<config_id>: config}, staff_names: {<staff_id>: name} /* every staff of the shop, active or not */,
             open: <private.closing_snapshot> | null }
save     = { ok:true, closing_id, repeat: boolean }
         | { ok:false, error:'closing_changed', current_id: uuid|null }
         | { ok:false, error:'bad_inputs'|'config_mismatch'|'no_closing_day'|'idempotency_conflict' }
```

An **unsubmitted day** is: `open_closings` row of the shop with `business_date < private.business_date(shop)`,
at least one `open_closing_fields` row, and no non-voided `closings` row for that date. `day.open` is set
only when `versions` is empty and the date is such a day.

---

### Task 1: Version log + read functions (database)

**Files:**
- Create: `supabase/migrations/20261111000001_closing_versions.sql`
- Create: `supabase/tests/100_history.sql`
- Modify: `supabase/tests/README.md` (file list)

**Interfaces:**
- Consumes: `private.require_owner(uuid)`, `private.business_date(uuid)`, `private.closing_snapshot(uuid)`,
  tables `closings`, `open_closings`, `open_closing_fields`, `staff`, `shop_configs`.
- Produces: `closings.{seq, kind, corrected_by, corrects_closing_id}`;
  `private.current_closing(p_shop uuid, p_date date) returns public.closings` (null row when none);
  `private.closing_version_json(c public.closings) returns jsonb` (the `version` shape above);
  `public.owner_list_closings(p_shop_id uuid, p_from date, p_to date) returns jsonb`;
  `public.owner_get_closing_day(p_shop_id uuid, p_business_date date) returns jsonb`.

- [ ] **Step 1: Write `supabase/tests/100_history.sql`** in the style of `090_live_submit.sql` (one
  transaction, users `…a1` owner A, `…b1` owner B, `…d1` phone of shop A, ends in `ROLLBACK`; owner/phone
  calls under `set local role authenticated`, row setup as postgres). Setup: shop A with ΜΑΡΙΑ, phone
  paired, ΜΑΡΙΑ signed in; two submissions today through `submit_closing` (different keys, the second with
  another expense); as postgres, an `open_closings` row for `today − 1` with one `d:10000` field and no
  closing, and one for `today − 2` with **no** fields. Each failure raises a message starting with the id.

  | Id | Asserts |
  |---|---|
  | T0 | both functions: `authenticated` may execute, `anon` may not; `private.current_closing` and `private.closing_version_json` are not executable by `authenticated` |
  | T1 | `closings.seq` is unique and increases with insertion: the second submission has the higher `seq`; `private.current_closing(shopA, today).id` = the second submission's id |
  | T2 | owner A `owner_list_closings(shopA, null, null)`: `ok`, `today` = business date, `to = today`, `from = today − 29`; the day `today` is `submitted`, `version_count = 2`, `current.id` = second submission, `current.kind = 'staff'`, `current.author_name = 'ΜΑΡΙΑ'`, `current.inputs` equals what was submitted; `configs` has `current.config_id` |
  | T3 | same list: `today − 1` is `unsubmitted` with `open.fields` holding `d:10000`; `today − 2` (no fields) is absent; today is never `unsubmitted`; days are ordered newest first |
  | T4 | a voided current version: as postgres set `voided_at` on the second submission → list shows `version_count = 1` and `current.id` = first submission (then un-void) |
  | T5 | `owner_list_closings(shopA, today, today − 1)` and a 367-day span → `{ok:false,error:'bad_range'}`; a range before any data → `ok` with `days = []` |
  | T6 | `owner_get_closing_day(shopA, today)`: two versions, `[0]` is the second submission; `staff_names` maps ΜΑΡΙΑ's id to `'ΜΑΡΙΑ'`; `open` is null. For `today − 1`: `versions = []`, `open` not null. For `today − 2`, a future date and `null`: `versions = []`, `open` null, `ok` true |
  | T7 | owner B calling either function for shop A, and for a random uuid, raises `not_owner` (same message both times); the phone `…d1` (anonymous) raises `not_owner` |
  | T8 | `expense_suggestion_data()` as the phone returns only the lines of the second submission for today (current version, not both) |
  | T9 | every pre-existing row has `kind = 'staff'`, non-null `staff_id`/`device_user_id`; inserting (as postgres) a `kind='staff'` row with null `staff_id`, or an `owner_correction` row with a `staff_id`, violates `closings_kind_shape` |

- [ ] **Step 2: Run it against dev before the migration** (`execute_sql`). Expected: fails at T0 (functions
  do not exist).

- [ ] **Step 3: Write the migration.** Contents, in order:

  1. Columns. `seq` is back-filled in submission order before it becomes an identity:
     ```sql
     alter table public.closings
       add column seq bigint,
       add column kind text not null default 'staff' check (kind in ('staff', 'owner_correction')),
       add column corrected_by uuid,
       add column corrects_closing_id uuid references public.closings (id),
       alter column staff_id drop not null,
       alter column device_user_id drop not null;
     update public.closings c set seq = r.n
       from (select id, row_number() over (order by created_at, id) as n from public.closings) r where r.id = c.id;
     alter table public.closings
       alter column seq set not null,
       alter column seq add generated always as identity,
       add constraint closings_seq_key unique (seq),
       add constraint closings_kind_shape check (
         (kind = 'staff' and staff_id is not null and device_user_id is not null
            and corrected_by is null and corrects_closing_id is null)
         or (kind = 'owner_correction' and staff_id is null and device_user_id is null and corrected_by is not null));
     select setval(pg_get_serial_sequence('public.closings', 'seq'), coalesce((select max(seq) from public.closings), 0) + 1, false);
     create index closings_corrects_idx on public.closings (corrects_closing_id);
     create index closings_shop_date_seq_idx on public.closings (shop_id, business_date, seq desc) where voided_at is null;
     ```
  2. `private.current_closing(p_shop, p_date)`: `select * … where shop_id, business_date, voided_at is null
     order by seq desc limit 1`. `language sql stable security definer set search_path = ''`; revoke from
     `public, anon, authenticated`.
  3. `private.closing_version_json(c public.closings)`: the `version` shape; `author_name` =
     `coalesce((select name from public.staff where id = c.staff_id), 'Ιδιοκτήτης')`. Same attributes and
     revoke.
  4. `create or replace function public.expense_suggestion_data()`: same signature, filters and window as
     `20261107000002_session_submit.sql`, but the per-day pick becomes
     `distinct on (cl.business_date) … order by cl.business_date, cl.seq desc`. Re-issue its revoke/grant.
  5. `public.owner_list_closings`: `perform private.require_owner(p_shop_id)` first; `v_to :=
     coalesce(p_to, today)`, `v_from := coalesce(p_from, v_to - 29)`; `bad_range` when `v_from > v_to` or
     `v_to - v_from > 366`; build the `list` payload (submitted days from the current-version rule with a
     count of non-voided rows; unsubmitted days per the definition above, limited to the range).
     `language plpgsql stable security definer set search_path = ''`.
  6. `public.owner_get_closing_day`: `require_owner` first; the `day` payload.
  7. `revoke all on function … from public, anon; grant execute … to authenticated` for the two public
     functions.

- [ ] **Step 4: Apply to dev** (`apply_migration`, name `closing_versions`), then run
  `100_history.sql` whole. Expected: completes without error. Then re-run `040`, `070`, `090` whole
  (they insert into `closings` and read suggestions). Expected: all pass unchanged. If `070` depended on
  `created_at` to pick the latest closing of a day (it updates `created_at` at line ~106), adjust the test
  to the `seq` rule and say so in the commit.

- [ ] **Step 5: Run `get_advisors` (security)** for the project. Expected: no new finding for `closings`,
  the two public functions or the two private helpers.

- [ ] **Step 6: Add `100` to the file list in `supabase/tests/README.md`; commit**

  ```bash
  git add supabase/migrations/20261111000001_closing_versions.sql supabase/tests/100_history.sql supabase/tests/README.md
  git commit -m "db: closings as a version log (seq), owner history read functions"
  ```

---

### Task 2: `owner_save_closing` (database)

**Files:**
- Create: `supabase/migrations/20261111000002_owner_save_closing.sql`
- Create: `supabase/tests/110_owner_save_closing.sql`
- Modify: `supabase/tests/README.md`

**Interfaces:**
- Consumes: Task 1's `private.current_closing`, `closings` columns; `private.inputs_shape_ok(jsonb)`.
- Produces: `public.owner_save_closing(p_shop_id uuid, p_business_date date, p_config_id uuid,
  p_inputs jsonb, p_expected_current_id uuid, p_idempotency_key text) returns jsonb` — the `save` payload.

- [ ] **Step 1: Write `supabase/tests/110_owner_save_closing.sql`.** Setup as in `100`, plus: staff ΕΛΕΝΗ in
  shop A, staff ΝΙΚΟΣ in shop B, one staff submission today by ΜΑΡΙΑ (`t.c1`, with expense `e1` by ΜΑΡΙΑ),
  an unsubmitted `today − 1` (open closing + one field), and `t.fix` = schema-2 inputs keeping `e1` (author
  ΜΑΡΙΑ) with another amount plus a line `e2` with `{kind:'owner'}`.

  | Id | Asserts |
  |---|---|
  | T0 | executable by `authenticated`, not by `anon` |
  | T1 | owner A saves `t.fix` for today with `expected = t.c1`, key `k1` → `{ok:true, repeat:false}`; the new row has `kind='owner_correction'`, `corrected_by` = owner A's uid, `staff_id`/`device_user_id` null, `corrects_closing_id = t.c1`, same `config_id` and `business_date`, `inputs = t.fix` |
  | T2 | **the original is untouched**: `to_jsonb` of row `t.c1` captured before T1 equals `to_jsonb` of it after |
  | T3 | `owner_get_closing_day` now lists two versions, `[0].kind = 'owner_correction'`, `[0].author_name = 'Ιδιοκτήτης'`; `open_closings.revision` and `last_submit` for today are unchanged by the save |
  | T4 | same call again with key `k1` → `{ok:true, repeat:true, closing_id}` equal to T1's, still two rows; key `k1` with different inputs → `idempotency_conflict`, still two rows |
  | T5 | `expected = t.c1` again with a new key (the current is now the correction) → `{ok:false,error:'closing_changed',current_id}` = the correction's id; `expected = null` with a new key → `closing_changed`; row count unchanged |
  | T6 | ΜΑΡΙΑ resubmits today through `submit_closing` (current revision, new key) → it becomes `[0]`; an owner save still expecting the correction's id → `closing_changed` with the resubmission's id |
  | T7 | owner B (shop A id), and owner A with a random shop uuid, raise `not_owner`; the phone raises `not_owner`; nothing stored |
  | T8 | `bad_inputs` and nothing stored for each: schema-1 inputs, `counts` not an object, null key, 101-char key, null date, an expense whose `addedBy` is ΝΙΚΟΣ (staff of shop B), an expense with `addedBy {kind:'staff', id:'x'}` (must not raise a uuid cast error) |
  | T9 | authorship: a save whose `e1` keeps `{kind:'staff', id: ΜΑΡΙΑ}` is accepted after `update public.staff set active = false` for ΜΑΡΙΑ (as postgres); a line by ΕΛΕΝΗ (same shop, never signed in) is accepted |
  | T10 | `config_mismatch`: a config id of shop A other than the current version's (publish a second config first) and a config id of shop B |
  | T11 | unsubmitted day: `today − 1`, `expected = null`, the open closing's `config_id` → `ok`, row has `corrects_closing_id` null and `kind='owner_correction'`; afterwards `owner_list_closings` shows that day `submitted` and `expense_suggestion_data()` (phone) includes its lines |
  | T12 | `no_closing_day` and nothing stored: today's date on a shop with no submission today (use a second shop of owner A), tomorrow's date, `today − 5` (no open closing), `today − 2` when its open closing has no fields |

- [ ] **Step 2: Run against dev.** Expected: fails at T0.

- [ ] **Step 3: Write the migration** — `language plpgsql security definer set search_path = ''`, checks in
  exactly this order (each failure returns `{ok:false,error}` and writes nothing):

  1. `perform private.require_owner(p_shop_id)` (raises `not_owner`).
  2. `bad_inputs`: null date or key, key length not 1–100, `not private.inputs_shape_ok(p_inputs)`,
     `p_inputs -> 'schema' <> '2'::jsonb`. Then, in a **separate** `if` (the uuid cast runs only on shapes
     that passed): any expense whose `addedBy.kind` is `staff` and whose id is not a staff row of
     `p_shop_id` (active or not).
  3. Idempotency lookup on `(shop_id, idempotency_key)`: found → `repeat` when the stored row is
     `owner_correction` with equal `inputs`, `config_id` and `business_date`, else `idempotency_conflict`.
  4. Locks: `perform pg_advisory_xact_lock(hashtextextended('closing-day:' || p_shop_id || ':' || p_business_date, 0))`
     (owner vs owner), then `perform 1 from public.open_closings where shop_id = p_shop_id and
     business_date = p_business_date for update` (owner vs a staff submit, which locks the same row).
  5. `v_cur := private.current_closing(p_shop_id, p_business_date)`.
     - `v_cur.id is not null`: `p_expected_current_id is distinct from v_cur.id` → `closing_changed` +
       `current_id`; `p_config_id is distinct from v_cur.config_id` → `config_mismatch`.
     - no current: `p_expected_current_id is not null` → `closing_changed` with `current_id` null; the date
       is not an unsubmitted day (definition above) → `no_closing_day`; `p_config_id` is distinct from that
       open closing's `config_id` → `config_mismatch`.
  6. `insert … (shop_id, kind, corrected_by, corrects_closing_id, config_id, business_date, inputs,
     idempotency_key) values (…, 'owner_correction', auth.uid(), v_cur.id, …) on conflict (shop_id,
     idempotency_key) do nothing returning id`; if nothing was inserted (lost a same-key race) answer as
     in check 3. Return `{ok:true, closing_id, repeat:false}`.

  Revoke from `public, anon`; grant execute to `authenticated`. No `realtime.send`, no update of
  `open_closings`.

- [ ] **Step 4: Apply to dev** (`apply_migration`, name `owner_save_closing`), run `110` whole, then `100`
  and `090` again. Expected: all complete without error.

- [ ] **Step 5: `get_advisors` (security)**: no new finding. Add `110` to the README; commit

  ```bash
  git add supabase/migrations/20261111000002_owner_save_closing.sql supabase/tests/110_owner_save_closing.sql supabase/tests/README.md
  git commit -m "db: owner_save_closing — corrections as new versions, guarded on the current version"
  ```

---

### Task 3: `OwnerApi` — types, parsers, errors, messages

**Files:**
- Create: `src/features/owner/history/types.ts`, `src/data/remote/history.ts`
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/data/remote/errors.ts`,
  `src/features/owner/model/messages.ts`, `tests/features/owner/fakeApi.ts`
- Test: `tests/data/history.test.ts` (new), `tests/data/ownerApi.test.ts`, `tests/data/remoteErrors.test.ts`,
  `tests/features/owner/messages.test.ts`

**Interfaces:**
- Consumes: the payloads above; `parseSnapshot` from `src/data/remote/live.ts`; `Snapshot` from
  `src/features/register/live/fields.ts`.
- Produces (`types.ts`):
  ```ts
  export type VersionKind = 'staff' | 'owner_correction';
  export interface ClosingVersion {
    id: string; kind: VersionKind; authorName: string; createdAt: string;
    configId: string; inputs: unknown; correctsId: string | null;
  }
  export type HistoryDay =
    | { status: 'submitted'; businessDate: string; current: ClosingVersion; versionCount: number }
    | { status: 'unsubmitted'; businessDate: string; open: Snapshot };
  export interface HistoryList { today: string; from: string; to: string; configs: Record<string, unknown>; days: HistoryDay[] }
  export interface DayDetail {
    today: string; businessDate: string; versions: ClosingVersion[]; // newest first; [0] is current
    configs: Record<string, unknown>; staffNames: Record<string, string>; open: Snapshot | null;
  }
  export interface SaveClosingArgs {
    businessDate: string; configId: string; inputs: ClosingInputs;
    expectedCurrentId: string | null; key: string;
  }
  ```
  `history.ts`: `parseHistoryList(x: unknown): HistoryList | null`, `parseDayDetail(x: unknown): DayDetail | null`.
  `OwnerApi`:
  ```ts
  listClosings(shopId: string, from: string | null, to: string | null): Promise<Result<HistoryList>>;
  closingDay(shopId: string, businessDate: string): Promise<Result<DayDetail>>;
  saveClosing(shopId: string, args: SaveClosingArgs): Promise<Result<{ closingId: string; repeat: boolean }>>;
  ```
  `OwnerError` gains `{ code: 'closing_changed'; currentId: string | null }`, `{ code: 'bad_inputs' }`,
  `{ code: 'config_mismatch' }`, `{ code: 'no_closing_day' }`, `{ code: 'idempotency_conflict' }`,
  `{ code: 'bad_range' }`.

- [ ] **Step 1: Write failing parser tests** (`tests/data/history.test.ts`):
  - `parseHistoryList` maps a full payload (one submitted day, one unsubmitted) to camelCase.
  - a day with a malformed `current` (missing `id`, unknown `kind`) or an `open` that `parseSnapshot`
    rejects is **dropped individually**; the other days survive.
  - a payload without `days`/`today`, a non-object, `null` → `null`.
  - `configs` values are passed through untouched (`unknown`); `inputs` likewise.
  - `parseDayDetail`: versions keep the server order; a malformed version is dropped; `staff_names` with a
    non-string value drops that entry; `open: null` stays null; a bad `open` becomes null.

- [ ] **Step 2: Run** `npx vitest run tests/data/history.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `types.ts` and `history.ts`.** Dates are checked with `isIsoDate`; ids are
  non-empty strings. No supabase import in `history.ts`.

- [ ] **Step 4: Write failing API/error tests.**
  - `ownerApi.test.ts`: `listClosings` calls `rpc('owner_list_closings', { p_shop_id, p_from, p_to })`
    (nulls passed as null); `closingDay` → `rpc('owner_get_closing_day', { p_shop_id, p_business_date })`;
    `saveClosing` → `rpc('owner_save_closing', { p_shop_id, p_business_date, p_config_id, p_inputs,
    p_expected_current_id, p_idempotency_key })`. `{ok:false,error:'closing_changed',current_id:'x'}` →
    `{ok:false, error:{code:'closing_changed', currentId:'x'}}` (and `current_id: null` → `currentId: null`);
    `{ok:false,error:'bad_range'}` → `{code:'bad_range'}`; an `ok:true` payload the parser rejects →
    `{code:'unknown', detail:'bad_response'}`; `{ok:true, closing_id:'c', repeat:true}` →
    `{closingId:'c', repeat:true}`.
  - `remoteErrors.test.ts`: `mapError({message})` for each of `bad_inputs`, `config_mismatch`,
    `no_closing_day`, `idempotency_conflict`, `bad_range` returns that code; `closing_changed` returns
    `currentId: null` (the id is added by `owner.ts` from the payload).
  - `messages.test.ts`: each new code has a non-empty message that is not the `unknown` fallback.

- [ ] **Step 5: Implement** in `errors.ts`, `owner.ts` (reuse `run`, `payloadError`, `BAD_RESPONSE`),
  `ownerApi.ts`, and `messages.ts` with exactly these strings:

  | Code | Message |
  |---|---|
  | `closing_changed` | `Το κλείσιμο αυτής της μέρας άλλαξε από αλλού.` |
  | `bad_inputs` | `Ο διακομιστής απέρριψε το κλείσιμο.` |
  | `config_mismatch` | `Το κλείσιμο ανήκει σε άλλες ρυθμίσεις — φόρτωσε τη νέα έκδοση.` |
  | `no_closing_day` | `Δεν υπάρχει κλείσιμο για αυτή τη μέρα.` |
  | `idempotency_conflict` | `Η αποθήκευση συγκρούστηκε με προηγούμενη — δοκίμασε ξανά.` |
  | `bad_range` | `Το διάστημα δεν είναι έγκυρο (έως 366 ημέρες, «Από» πριν το «Έως»).` |

  Add the three methods to `fakeApi` (defaults: an empty list with `today/from/to` =
  `'2026-11-11'/'2026-10-13'/'2026-11-11'`, an empty day, `ok({closingId:'c-new', repeat:false})`).

- [ ] **Step 6: Run** `npm test && npm run typecheck` — Expected: PASS (the `ownerErrorMessage` switch is
  exhaustive, so typecheck fails until every code has a case).

- [ ] **Step 7: Commit**

  ```bash
  git add src/features/owner/history/types.ts src/data/remote src/features/owner/model/messages.ts tests/data tests/features/owner/fakeApi.ts tests/features/owner/messages.test.ts
  git commit -m "feat(owner): OwnerApi for closing history and owner saves"
  ```

---

### Task 4: Pure history model

**Files:**
- Create: `src/features/owner/history/model.ts`
- Modify: `src/app/dates.ts` (`formatStampEl`)
- Test: `tests/features/owner/history/model.test.ts` (new), `tests/app/dates.test.ts`

**Interfaces:**
- Consumes: `isShopConfig`, `validateClosingInputs`, `evaluateTotals`, `planEnvelope`, `centsToPlain`,
  `deriveClosing`, `draftFromFields`, `isFieldValue`, `KEY_RE`, value builders from `fields.ts`
  (`denomKey`, `channelKey`, `expenseKey`, `expenseDescKey`, `expenseAmountKey`, `denomValue`,
  `amountValue`, `textValue`, `expenseMetaValue`), `Snapshot`.
- Produces:
  ```ts
  export const OWNER_NAME = 'Ιδιοκτήτης';
  export const UNKNOWN_AUTHOR = '—';
  export interface TotalLine { id: string; label: string; cents: Cents }
  export interface Summary { totals: TotalLine[]; expensesCents: Cents }   // totals = showInSummary, config order
  /** null when the config or the inputs cannot be read. Never throws. */
  export function summarizeInputs(config: unknown, inputs: unknown): Summary | null;
  /** The open closing's last numbers (invalid boxes left out, as on the register). */
  export function summarizeOpen(open: Snapshot): Summary | null;
  export interface Breakdown {
    config: ShopConfig; inputs: ClosingInputs;
    denominations: { denom: Cents; count: number; cents: Cents }[];   // counted only, largest first
    channels: { id: string; label: string; cents: Cents }[];          // config order, non-zero only
    expenses: { key: string; description: string; cents: Cents; author: string }[];
    totals: TotalLine[];                                              // every total, config order
    expensesCents: Cents; envelope: EnvelopePlan;
  }
  export function breakdown(config: unknown, inputs: unknown, staffNames: Record<string, string>): Breakdown | null;
  /** The open closing as inputs, for showing an unsubmitted day. */
  export function openInputs(open: Snapshot): { config: ShopConfig; inputs: ClosingInputs } | null;
  /** A local, editable copy of stored inputs (never sent to the server as fields). */
  export function snapshotFromInputs(a: { config: ShopConfig; configId: string; businessDate: string; inputs: ClosingInputs; newId: () => string }): Snapshot;
  /** Applies one box edit locally; an invalid key/value returns the same snapshot. */
  export function applyLocalEdit(s: Snapshot, key: FieldKey, value: unknown): Snapshot;
  ```
  `dates.ts`: `formatStampEl(iso: string): string` — `"Δευ 09/11 14:32"` in `Europe/Athens`; unknown input
  returned unchanged.

- [ ] **Step 1: Write the failing tests** (`joinJuicePreset` as config; inputs built by hand):
  - `summarizeInputs`: totals equal `evaluateTotals(config, inputs)` for exactly the `showInSummary`
    totals, in config order; `expensesCents` = sum of expense cents.
  - `summarizeInputs` returns `null` (no throw) for: `config = {}`, `inputs = null`, a negative count, an
    expense missing `addedBy` in schema 2. A valid **schema-1** row is summarized.
  - `breakdown`: 100€ × 3 → `{denom:10000,count:3,cents:30000}`; zero channels omitted; `envelope` deep-equals
    `planEnvelope(totals[config.envelopeTotalId] ?? 0, inputs.counts, config.denominations)`.
  - authors: `{kind:'staff', id:'s1'}` with `staffNames {s1:'ΜΑΡΙΑ'}` → `'ΜΑΡΙΑ'`; an id missing from the map
    → `UNKNOWN_AUTHOR`; `{kind:'owner'}` → `OWNER_NAME`; a schema-1 line → `UNKNOWN_AUTHOR`.
  - **round trip:** for schema-2 inputs with counts, two channels and two expenses,
    `deriveClosing(config, draftFromFields(snapshotFromInputs({…}), [])).inputs` deep-equals the inputs
    (ids, `addedBy`, expense order included) and reports no errors.
  - `snapshotFromInputs`: a schema-1 expense (no id/author), and a schema-2 id that fails the field-key
    charset (`'a b'`), get `newId()` — the schema-1 line with `{kind:'owner'}`, the schema-2 one keeping its
    author; denomination boxes are stored as `mode: 'count'`; `revision` 0, `lastSubmit` null.
  - `applyLocalEdit`: editing `d:10000` changes the derived count; setting `e:<id>` meta with
    `removed: true` drops the line from the derived inputs; an unknown-shape value or a bad key returns
    the identical object (`toBe`).
  - `summarizeOpen`: a snapshot with `d:10000 = {text:'300', mode:'amount'}` gives the same totals as
    inputs `counts {10000: 3}`; a snapshot whose `config` is `{}` → `null`.
  - `formatStampEl('2026-11-09T12:32:00Z')` → `'Δευ 09/11 14:32'`; `formatStampEl('x')` → `'x'`.

- [ ] **Step 2: Run** `npx vitest run tests/features/owner/history/model.test.ts tests/app/dates.test.ts` —
  Expected: FAIL.

- [ ] **Step 3: Implement.** `summarizeInputs`/`breakdown` gate on `isShopConfig(config)` and
  `validateClosingInputs(config, inputs).length === 0` before calling `evaluateTotals`.
  `snapshotFromInputs` writes `ServerField`s with `version: 1`, `updatedByName: ''`, `updatedAt: ''`,
  expense `order` = index; `applyLocalEdit` bumps that field's `version`. `summarizeOpen`/`openInputs` go
  through `draftFromFields(open, [])` → `deriveClosing`. No `Date`, no storage, no React in this file.

- [ ] **Step 4: Run** the two test files, then `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/features/owner/history/model.ts src/app/dates.ts tests/features/owner/history/model.test.ts tests/app/dates.test.ts
  git commit -m "feat(owner): pure history model — summaries, breakdown, inputs to local snapshot"
  ```

---

### Task 5: «Ιστορικό» tab — route + list

**Files:**
- Create: `src/features/owner/history/HistoryScreen.tsx`
- Modify: `src/app/router.ts`, `src/features/owner/ShopLayout.tsx`, `src/features/owner/OwnerApp.tsx`,
  `src/app/theme.css`
- Test: `tests/app/ownerRouter.test.ts`, `tests/features/owner/history/history.test.tsx` (new)

**Interfaces:**
- Consumes: `OwnerApi.listClosings`, `summarizeInputs`, `summarizeOpen`, `formatDayEl`, `formatEuro`,
  `ownerErrorMessage`.
- Produces: `ShopTab` gains `'history'`; the shop route becomes
  `{ name: 'shop'; shopId: string; tab: ShopTab; date?: string }` (`date` only with `tab: 'history'`);
  `ShopLayoutProps` gains `date?: string`;
  `HistoryScreen({ api, shopId, navigate }: { api: OwnerApi; shopId: string; navigate: OwnerNavigate })`.

- [ ] **Step 1: Write failing router tests**
  - `parseOwnerRoute('/shop/<ID>/history')` → `{name:'shop', shopId, tab:'history'}` (no `date` key).
  - `'/shop/<ID>/history/2026-11-09'` → `…, date:'2026-11-09'`; `ownerHash` of it round-trips.
  - `'/shop/<ID>/history/2026-02-30'` and `'/shop/<ID>/history/abc'` → `{…, tab:'history'}` without a date.
  - `'/shop/<ID>/settings/2026-11-09'` and five-part paths → `{name:'shops'}`.
  - `ownerHash({name:'shop', shopId, tab:'settings', date:'2026-11-09'})` has no date segment.

- [ ] **Step 2: Run** `npx vitest run tests/app/ownerRouter.test.ts` — FAIL. **Implement** in `router.ts`
  (use `isIsoDate` from `./dates`). Run — PASS.

- [ ] **Step 3: Write failing screen tests** (`history.test.tsx`, `fakeApi` + `joinJuicePreset`; render
  `HistoryScreen` directly unless noted):
  - on mount calls `listClosings(SHOP, null, null)`; shows «Φόρτωση…» then the rows; the «Από»/«Έως» date
    inputs hold the response's `from`/`to`.
  - a submitted row shows `formatDayEl(date)`, the author name, each summary total label with
    `formatEuro`, «Έξοδα» with `formatEuro(expensesCents)`; `versionCount: 3` shows «3 υποβολές», 1 shows
    none; `current.kind: 'owner_correction'` shows the badge «διορθωμένο», a staff version does not.
  - an unsubmitted row shows «Δεν υποβλήθηκε» and its numbers from `summarizeOpen`.
  - **Review Focus 1:** a row whose config is `{}` shows «Δεν διαβάζεται»; the row before and after it
    still render with their totals.
  - tapping a row calls `navigate({name:'shop', shopId: SHOP, tab:'history', date})`.
  - changing «Από» to `2026-10-01` calls `listClosings(SHOP, '2026-10-01', <to>)`; clearing a date input
    does not call the API.
  - **Review Focus 5:** `listClosings` failing with `bad_range` shows its message in a `role="alert"` and
    keeps the date inputs usable; a `network` failure shows the message plus «Ξανά», which refetches.
  - `days: []` shows «Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.».
  - through `ShopLayout` with `tab="history"`: the nav has «Ιστορικό» second (after «Σήμερα») marked
    `aria-current="page"`.
  - a response that arrives after a newer request was made is ignored (resolve two `listClosings`
    promises out of order; the rows are the newer range's).

- [ ] **Step 4: Run** `npx vitest run tests/features/owner/history/history.test.tsx` — FAIL.

- [ ] **Step 5: Implement.** `TABS` order: Σήμερα, Ιστορικό, Ρυθμίσεις, Προσωπικό, Συσκευές; five tabs must
  fit a 360 px screen: in `theme.css` give `.tabs` `overflow-x: auto` and `.tabs button`
  `white-space: nowrap; padding: 0 10px; font-size: 13px` (min-height stays 44px). `TabBody`: `history` →
  `date ? <DayScreen …/> : <HistoryScreen …/>` (until Task 6 lands, the date branch renders
  `HistoryScreen`). `OwnerApp` passes `route.date`. Rows are `<button>`s in a `Card`; the badge is a new
  `.badge` class (small pill, `--hl` text). Every load path settles the loading flag (success, error,
  superseded).

- [ ] **Step 6: Run** `npm test && npm run typecheck` — PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/router.ts src/app/theme.css src/features/owner tests/app/ownerRouter.test.ts tests/features/owner/history/history.test.tsx
  git commit -m "feat(owner): «Ιστορικό» tab with the closings list"
  ```

---

### Task 6: Day detail

**Files:**
- Create: `src/features/owner/history/DayScreen.tsx`
- Modify: `src/features/owner/ShopLayout.tsx`
- Test: `tests/features/owner/history/day.test.tsx` (new)

**Interfaces:**
- Consumes: `OwnerApi.closingDay`, `breakdown`, `openInputs`, `formatDateEl`, `formatTimeEl`,
  `formatStampEl`, `EnvelopeSheet`, `denomLabel`, `formatEuro`.
- Produces: `DayScreen({ api, shopId, date, navigate, now, newId? })` — props type
  `{ api: OwnerApi; shopId: string; date: string; navigate: OwnerNavigate; now: () => Date; newId?: () => string }`.
  It owns the `editing` state that Task 7 fills; in this task «Διόρθωση» / «Αποθήκευση ως κλείσιμο» only
  set it and the screen renders a placeholder `<p>` for it.

- [ ] **Step 1: Write the failing tests** (day with two versions: v2 current by ΜΑΡΙΑ at
  `2026-11-09T19:42:00Z`, v1 earlier; expenses by ΜΑΡΙΑ and the owner):
  - calls `closingDay(SHOP, '2026-11-09')`; heading shows `formatDateEl('2026-11-09')`; «← Ιστορικό» calls
    `navigate({name:'shop', shopId: SHOP, tab:'history'})`.
  - the current staff version reads «Υποβλήθηκε 21:42 · ΜΑΡΙΑ».
  - counted denominations appear as `100€ × 3` with their value; channels with label + amount; each
    expense line with description, amount and author («ΜΑΡΙΑ», «Ιδιοκτήτης»); every total of the config
    with its amount.
  - «Φάκελος» opens the `EnvelopeSheet` dialog (contains «Τι μένει στο ταμείο» when pieces remain).
  - versions list header «2 υποβολές»; rows newest first with time and author; tapping the older row
    shows its numbers and the note «Βλέπεις παλαιότερη έκδοση»; tapping the first returns.
  - a current `owner_correction` version with `correctsId` reads «Διορθώθηκε από ιδιοκτήτη ·
    Δευ 09/11 14:32»; one with `correctsId: null` reads «Καταχωρήθηκε από ιδιοκτήτη · Δευ 09/11 14:32».
  - **Review Focus 1:** the current version unreadable (`configs` lacks its config) → «Δεν διαβάζεται»,
    no «Διόρθωση» button, the versions list still shows and the older readable version can be opened.
  - unsubmitted day (`versions: []`, `open` set): «Δεν υποβλήθηκε», the numbers from the open closing, a
    button «Αποθήκευση ως κλείσιμο»; no «Διόρθωση».
  - **Review Focus 5:** `versions: []` and `open: null` → «Δεν υπάρχει κλείσιμο για αυτή τη μέρα.» and the
    back link; a load error shows the message and «Ξανά».
  - «Διόρθωση» is shown for a readable current version, including when `businessDate === today`.
  - through `ShopLayout` with `tab="history" date="2026-11-09"` the day screen renders (not the list).

- [ ] **Step 2: Run** `npx vitest run tests/features/owner/history/day.test.tsx` — FAIL.

- [ ] **Step 3: Implement.** Selected version defaults to `versions[0]`; the breakdown is
  `breakdown(configs[v.configId], v.inputs, staffNames)`. Reuse `.list`/`.list-row`/`.tot` classes; no new
  money formatting. The fetch is keyed on `(shopId, date, reloadCount)` and ignores a superseded response.

- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/features/owner tests/features/owner/history/day.test.tsx
  git commit -m "feat(owner): closing day detail with versions and Φάκελος"
  ```

---

### Task 7: Correction editor + conflict

**Files:**
- Create: `src/features/owner/history/CorrectionEditor.tsx`
- Modify: `src/features/owner/history/DayScreen.tsx`
- Test: `tests/features/owner/history/correction.test.tsx` (new)

**Interfaces:**
- Consumes: `snapshotFromInputs`, `applyLocalEdit`, `openInputs`, `draftFromFields`, `deriveClosing`,
  `envelopeBlockReason`, `LiveClosingView`, `OwnerApi.saveClosing`, `Sheet`, `randomId`.
- Produces:
  ```ts
  export interface CorrectionEditorProps {
    api: OwnerApi; shopId: string;
    /** Local starting point: snapshotFromInputs(current) or the unsubmitted day's open snapshot. */
    base: Snapshot;
    /** The version being corrected; null when filing an unsubmitted day. */
    expectedCurrentId: string | null;
    onSaved: () => void;      // parent refetches the day and leaves edit mode
    onReload: () => void;     // «Φόρτωση νέας»: parent refetches; the editor remounts on the new current
    onCancel: () => void;
    now: () => Date; newId?: () => string;
  }
  ```

- [ ] **Step 1: Write the failing tests** (render `DayScreen`, press «Διόρθωση»):
  - the boxes are prefilled from the current version (100€ box shows `3` in Κομμάτια; switching to Ποσό
    shows `300`); the expense line by ΜΑΡΙΑ is there with its text and amount.
  - «Αποθήκευση» is disabled with «Δεν άλλαξε κάτι» until a box changes.
  - change 100€ to `4`, press «Αποθήκευση» → `saveClosing(SHOP, {businessDate:'2026-11-09', configId,
    inputs, expectedCurrentId: 'v2', key})` where `inputs.counts['10000'] === 4`, `inputs.schema === 2`,
    and **the expense keeps `id` and `addedBy {kind:'staff', id: ΜΑΡΙΑ}`** (Review Focus 4); then
    `closingDay` is fetched again and the editor is gone.
  - a line added in the editor is sent with `addedBy {kind:'owner'}`.
  - an invalid box (`5-3` in a channel) blocks «Αποθήκευση» and shows the `envelopeBlockReason` text;
    `saveClosing` is not called.
  - **Review Focus 3:** `saveClosing` failing with `network` shows the message and keeps the typed
    values; pressing «Αποθήκευση» again sends the **same** `key`; after another edit the next save sends a
    **different** key. While a save is in flight the button is disabled (two quick clicks → one call).
  - **Review Focus 2:** `saveClosing` → `closing_changed, currentId:'v3'` opens a dialog «Το κλείσιμο
    άλλαξε» with «Φόρτωση νέας» and «Αποθήκευση πάνω της». «Αποθήκευση πάνω της» calls `saveClosing` again
    with `expectedCurrentId: 'v3'`, the same inputs and a new key. «Φόρτωση νέας» refetches the day and the
    editor shows the new current version's values. With `currentId: null` only «Φόρτωση νέας» is offered.
  - `config_mismatch` shows its message and only offers «Φόρτωση νέας».
  - «Άκυρο» returns to the detail without calling `saveClosing`.
  - unsubmitted day: «Αποθήκευση ως κλείσιμο» opens the editor prefilled from `open`; «Αποθήκευση» is
    enabled without any change and sends `expectedCurrentId: null` and `configId = open.configId`.
  - nothing is written through `setTodayField` and `live` is never opened (assert both fakes uncalled).

- [ ] **Step 2: Run** `npx vitest run tests/features/owner/history/correction.test.tsx` — FAIL.

- [ ] **Step 3: Implement.** State: `snapshot` (starts as `base`), `viewMode` (local, starts `'count'`; not
  the shared per-shop preference), `key` (minted with `newId` on mount, re-minted by every `edit` and
  after a `closing_changed`), `busy`, `error`, `conflict`. `LiveClosingView` gets
  `edit={(k, v) => setSnapshot((s) => applyLocalEdit(s, k, v))}`, no-op `flush`/`focus`, `presence={[]}`,
  `author={{ kind: 'owner' }}`, `history={{}}`. "Changed" = `JSON.stringify(derived.inputs)` differs from
  the base's derived inputs. Every branch of the save clears `busy`. In `DayScreen`, `base` for a
  correction is `snapshotFromInputs({ config, configId, businessDate, inputs, newId })` from the current
  version's breakdown; the editor is keyed on the current version id so «Φόρτωση νέας» remounts it.

- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/features/owner/history tests/features/owner/history/correction.test.tsx
  git commit -m "feat(owner): corrections as new versions, with conflict handling"
  ```

---

### Task 8: Docs, full verification

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_STATUS.md`, `supabase/tests/README.md`

- [ ] **Step 1: Run every SQL test file `010`–`110` whole against dev** (`execute_sql`), then
  `list_migrations`. Expected: all complete without error; both stage-3 migrations listed. Record the date
  and whether the 080/090 realtime blocks ran or skipped.

- [ ] **Step 2: `npm test && npm run typecheck && npm run build`.** Expected: all green; record the counts.

- [ ] **Step 3: Update `CLAUDE.md`**
  - Architecture: `src/features/owner/history/` (types, pure `model.ts`, the three screens),
    `src/data/remote/history.ts` (parsers); the tab list (first tab still «Σήμερα», bare route still
    «Ρυθμίσεις»); spec/plan pointers.
  - New section **Closing history (stage 3)** with the invariants: `closings` is an append-only version
    log; current = highest `seq` non-voided (`private.current_closing`), never `created_at`; `kind` and
    `closings_kind_shape`; one owner write path `owner_save_closing` and its check order; `closing_changed`
    is never retried automatically; owner saves do not touch the open closing or broadcast; unsubmitted-day
    definition; the correction editor is local (`applyLocalEdit`), never the live engine.
  - Cross-file invariants: the `version`/`list`/`day`/`save` payload shapes (SQL ↔ `history.ts`); the
    author check in `owner_save_closing` vs `validateClosingInputs`; the six new error strings
    (`mapError` + `ownerErrorMessage`).
  - Remove "the owner cannot read…" style notes that stage 3 makes untrue, if any remain.

- [ ] **Step 4: Update `PROJECT_STATUS.md`**: a Stage 3 line under Stages (code complete; pending the manual
  check); a "Stage 3 findings" table continuing the ID scheme (start at the next free H/M/L numbers) with
  what the reviews found; these known open items — an unfinished correction is lost on leaving the screen;
  no void UI; the owner can attribute a line to any staff member of the shop (trusted role); no device
  label in history (`closings.device_user_id` has no FK, open since Plan 3); `seq` back-fill order on dev
  followed `created_at`; Tests paragraph; and under **Not verified**:
  1. In a real browser against dev: submit twice from a phone, open «Ιστορικό», check list totals against
     the register's Σύνοψη, open the day, correct an amount, confirm the phone register and
     «Υποβλήθηκε …» are unchanged and the list shows «διορθωμένο».
  2. Two owner tabs correcting the same day → the conflict dialog, both choices.
  3. A phone resubmitting while the owner's editor is open on today.
  4. A missed day (open closing, no submit, after the day change) appears as «Δεν υποβλήθηκε» and can be
     filed.
  5. Five tabs and the day detail on a real phone (360 px wide).
  6. A year-long range on a shop with real data (response size, render time).

- [ ] **Step 5: Commit**

  ```bash
  git add CLAUDE.md PROJECT_STATUS.md supabase/tests/README.md
  git commit -m "docs: stage 3 — closing history, owner corrections, verification record"
  ```
