# Tameio4All — staff sign-in, live shared closing, closing history — design

Parent spec: `2026-09-28-tameio4all-v1-design.md`. Builds on Plan 3 (database) and Plan 4a (owner
app). Replaces the "4b (own spec later)" note in `2026-09-29-plan-4a-owner-app-design.md` and the
"closing history (Plan 5)" placeholder. Agreed with Dimitris 2026-11-07.

Marking used below: **[decided]** = Dimitris said so; **[call]** = my call during design, open to
change; everything unmarked follows from those or from existing project rules.

## Intent — why

The owner wants a **dashboard of every submitted closing** (ταμείο) per shop. That history is only
worth anything if it can't be faked or muddled, so **only staff the owner registered (name + PIN) on
a phone the owner paired can submit** [decided].

Closing is also a team activity: **two cashiers on two phones fill in the same closing, the morning
cashier logs expenses (έξοδα) during the day so the evening cashier finds them ready, and the owner
watches it fill in from home** [decided]. So the day's closing in progress is **one shared, live
document per shop**, not a per-phone draft.

Today: the register runs on `LOCAL_SHOP` with a device-local staff list (DEV ONLY), keeps drafts and
"submissions" in localStorage, and shares a PNG. Nothing reaches the server even though
`submit_closing`, `verify_staff_pin`, `list_staff`, `device_context`, `redeem_pairing_code` already
exist there.

## Goals

1. **Phone joins a shop and staff sign in.** Phone redeems the owner's pairing code once, loads the
   shop's latest config and the owner's staff list from the server. A cashier picks their name and
   enters their 4-digit PIN **once per shift** [decided].
2. **Live shared closing.** Every signed-in phone in the shop edits the same closing for the current
   business day; changes show on the other phones and the owner's view within ~1–2 s.
3. **Server submission.** Υποβολή stores the closing on the server under the signed-in cashier.
   **Resubmitting the same day is allowed; the dashboard shows the latest submission for the day**
   [decided]. Staff can submit **only for today's business date** [decided].
4. **Owner history dashboard** — list + detail of submitted closings, per shop.
5. **Owner corrections** to any past closing, **recorded as a later change by the owner**, original
   kept [decided].
6. **Owner-set day-change time** per shop [decided].

## Non-goals (v1 of this feature)

- Owner editing today's *open* closing live — owner's live view is **read-only** [call; corrections
  happen on shop phones or after submission through goal 5].
- Keystroke/field-level edit history of the open closing (who changed which box when) beyond the
  per-expense author shown in history [call].
- Export (Excel/PDF), charts/trends, cross-shop comparison [call].
- Field locking. Explicitly rejected in favour of last-write-wins + presence tag [decided].
- Storing the Z photo anywhere — unchanged rule: attached to the share only.
- Multi-timezone shops. Business day is computed in `Europe/Athens` [call].

## Anti-goals (would be a failure even if it "works")

- A phone write **erasing another phone's field** because it wrote the whole closing from a stale
  copy. Writes are per field, always.
- A submission that doesn't match what the phones show (submitted from a stale view).
- A staff member submitting **as someone else**, or a phone of shop A touching shop B.
- An owner correction that **silently replaces** what staff submitted.
- The PIN stored on the phone.
- Totals stored or computed in SQL (existing rule: totals only via `evaluateTotals` in `src/core`).

## Decided behaviour

### Staff sign-in

- Phone flow on first launch: «Κωδικός σύνδεσης» (pairing code) → shop loads → staff picker from
  `list_staff` → PIN pad → register. Existing lockout (5 wrong → 15 min) applies.
- After a correct PIN the server issues a **staff session** that lasts until the shop's next
  day-change moment (end of business day) or «Αλλαγή ατόμου» (sign out), whichever first [decided:
  once per shift; expiry mechanism is my call]. The phone keeps only the session token, never the PIN.
- **A paired phone with nobody signed in shows only the sign-in screen** («Ποιος είσαι;» → PIN) —
  no numbers, no totals [decided]. So reading the open closing (`get_open_closing`) and joining the
  shop's realtime channel both require a **valid staff session**, not just a paired device; the
  realtime authorization checks the session. Signing out (or session expiry) unsubscribes and clears
  the on-screen closing; the offline cache of pending edits stays on the phone but is not shown.
- One cashier per phone at a time. A shared phone handed from morning to evening cashier → evening
  cashier signs in again.
- A revoked phone or deactivated staff member loses access immediately (server checks on every call).
- Header shows the signed-in name; the existing «Διάλεξε όνομα» people sheet becomes the
  sign-in/sign-out sheet.

### Live shared closing

- **One open closing per (shop, business_date).** Created on first write of the day. It does **not**
  end on submit — it stays editable for resubmissions until the business day ends.
- What's shared: denomination entries, channel amounts, expenses (description + amount, add/remove).
  Expenses entered in the morning are simply part of that day's open closing.
- **Entry mode** (Ποσό / Κομμάτια) is **shared for the closing** [call]: switching converts every
  entry (existing `convertEntry`) for everyone, so a box's text always means the same thing on every
  phone. (Rejected: per-phone mode — the same box would hold "300" on one phone and "3" on another
  and last-write-wins becomes ambiguous.)
- **Conflict rule: each box saves independently; same box → last write to reach the server wins**
  [decided]. The other phones' box updates to the new value. A write is sent when the person pauses
  typing (~400 ms debounce) or leaves the box [call].
- **Presence tag**: while someone has a box focused, other phones show their name on it («Νίκος»).
  Not a lock [decided].
- **Offline**: banner «Εκτός σύνδεσης»; typing continues; edits queue on the phone and send on
  reconnect; Υποβολή is disabled until online and fully synced [decided]. On reconnect, a queued edit
  whose box **changed on the server while this phone was offline** is dropped in favour of the server
  value, with a toast «Το πεδίο Χ άλλαξε από Νίκο» [call — protects against a stale offline edit
  overwriting a newer online one; online edits are plain last-write-wins].
- **Config is pinned per open closing [call].** An open closing records the `config_id` that was
  current when it was created; all phones and the owner's live view compute with that config, and
  `submit_closing` refuses any other `config_id`. A config the owner publishes mid-day applies from the
  next business day's closing. (Prevents two screens computing different totals from the same boxes.)
- **Every field write and submission carries the business date it was made for [call].** The server
  refuses a write/submit whose date isn't the shop's current business date (`wrong_day`). A phone
  that comes back online after the day changed drops its queued edits for the old day with a toast
  («Η ημέρα άλλαξε — οι αλλαγές εκτός σύνδεσης δεν αποθηκεύτηκαν»). Edits are never filed under the
  wrong day.
- Owner area: per shop, a **«Σήμερα» live view** of the open closing — same numbers, totals and
  Φάκελος as the register, read-only, with presence names.

### Submission

- Υποβολή (with the signed-in cashier) sends the closing **as the phone currently sees it, plus the
  open closing's revision it was computed from**. If anything changed on the server since that
  revision, the server refuses (`draft_changed`), the phone resyncs and the cashier taps again.
  This is the optimistic-concurrency guard for submit.
- Business date is **computed by the server** from the shop's day-change time; the phone no longer
  chooses a date (the date field in the submit sheet goes away). Only today's business date is
  accepted.
- Each submission is a new `closings` row. **Latest non-voided submission per (shop, business_date)
  is "the" closing**; earlier ones are kept and visible in the detail view as «N υποβολές» [call].
- After submit: all phones see «Υποβλήθηκε 21:42 · Μαρία» on the register; the open closing stays
  editable; a later Υποβολή is a resubmission.
- The share PNG + Z photo flow stays as today (after a successful submit).

### Day-change time

- A change to the day-change time **takes effect from the next business day** [call]; today's
  open closing, sessions and business date are not re-dated.

- Per-shop setting in owner settings, «Αλλαγή ημέρας», a time of day, **default 04:00** [call on
  default]. A moment before that time belongs to the previous calendar date.
- Stored on the shop, **not in `ShopConfig`** [call]: it's operational, not part of a closing's
  formulas, and changing it must not mint a new config version.

### History dashboard (owner)

- New owner tab per shop: **«Ιστορικό»** (alongside the existing tabs).
- **Days nobody submitted [call]:** if a business date ended with an open closing that has
  entries but no submission, the list shows it as «Δεν υποβλήθηκε» with its last numbers. The owner
  can save it as an owner-entered closing (same versioning/marking as a correction, with no
  `corrects_closing_id`). Staff never submit for a past day (the "today only" rule stands); missed
  days are the owner's to file.
- **List**, newest first, date range filter defaulting to the last 30 days [call]. One row per
  business date that has a submission: date, who submitted the current version, the shop's summary
  totals (`showInSummary` totals of that closing's config), total expenses, and a «διορθωμένο» badge
  if the current version is an owner correction [decided: date, who, totals, expenses].
- **Tap a row → detail** [decided: more info on tap]: every denomination counted, every channel,
  each expense line (description, amount, who added it), Φάκελος breakdown and what stays in the drawer, list of versions
  (staff submissions + owner corrections) with time and author.
- Totals are recomputed in the browser with `evaluateTotals(config of that closing, inputs)` — never
  stored.

### Expense authorship [call]

- `ClosingInputs` moves to **`schema: 2`**: each expense entry gains `id` (string) and `addedBy`
  (`{kind:'staff', id}` or `{kind:'owner'}`). Author = the staff session that created the line;
  editing a line keeps its original author; lines the owner adds in a correction are `owner`.
- Cross-file invariant: migration updates `private.inputs_shape_ok` to accept schema 1 (existing
  rows) and schema 2; `validateClosingInputs` accepts both; new submissions are always 2.
  `expense_suggestion_data` reads both shapes.

### Owner corrections

- From the detail view, «Διόρθωση» opens the same inputs in an editable form (reuse the register's
  count/channel/expense components) [call on reuse].
- Saving creates a **new closing version** marked as an owner correction: who (owner), when, which
  version it corrects; same `config_id` and `business_date` as the version it corrects. It becomes
  the current version for that day. Shown as «Διορθώθηκε από ιδιοκτήτη · Δευ 09/11 14:32».
  Original staff submission is never modified [decided].
- Owner corrections are allowed for **any past business date**, including today's after a
  submission. Staff can still resubmit today after an owner correction; the latest version wins
  either way [call].
- Concurrency: correcting is guarded on "current version id" — if the day got a newer version
  while the owner was editing, the save is refused with the existing conflict pattern («Φόρτωση νέας»
  / «Αποθήκευση πάνω της») [call, mirrors `publish_config`].

## Constraints (existing rules this must keep)

- Database: RLS on, `anon` nothing, phones have **no direct table access** (server functions only),
  every function `security definer` + `search_path = ''`, execute for `authenticated` only, identity
  only from `auth.uid()`/`auth.jwt()`; every new table/function gets an explicit
  `revoke … from public, anon`. Expected failures return `{ok:false,error}`; never raise where a raise
  would roll back a lockout counter.
- Owner functions answer "not yours" and "doesn't exist" the same (`not_owner`).
- `ClosingInputs` shape ↔ `private.inputs_shape_ok` cross-file invariant. Any shape change bumps
  `schema` and needs the migration.
- Money is integer cents; text → cents only via `deriveClosing`/core; components never parse money.
  The open closing stores **raw typed text** (like `Draft`), never cents; the submission sends
  `ClosingInputs` derived on the phone. (Parsing stays in TypeScript only — one language.)
- Owner screens only through `OwnerApi`; UI tests use the fake API and never load supabase-js.
  Phone-side remote calls get the same treatment: a `DeviceApi` (one path for phone reads/writes)
  with a fake for tests.
- A new server error string needs a `mapError` case and a Greek message.
- Free tier: Supabase Realtime is fine at this scale (a few phones per shop).

## Architecture (decided parts and calls)

- **Realtime transport [call]: Supabase Realtime *private Broadcast* channels**, topic per shop
  (`shop:<shop_id>`), authorized by RLS policies on `realtime.messages` (paired, non-revoked device of
  that shop **with a live staff session**; or the shop's owner). Field writes go through a server function which updates the row
  **and** broadcasts the change from inside the function. This keeps the "phones have no direct
  table access" rule (rejected: Postgres-changes subscriptions — they need table SELECT grants for
  phones). **Presence** on the same channel carries `{staffName, focusedField}`.
- After (re)subscribe, a phone always **re-fetches the full open closing** via a function — broadcasts
  are a fast path, not the source of truth.
- **New data (names indicative, builder may rename):**
  - `staff_sessions` — token hash, staff, device, shop, expires_at, revoked_at.
  - `open_closings` — (shop_id, business_date) unique, `mode`, `revision` (bumped on every write),
    timestamps.
  - `open_closing_fields` — one row per box: (open_closing, field key), text, `updated_by_staff`,
    `updated_at`, per-field version. Expense lines are fields keyed by expense id
    (description/amount), with a removed flag so removal propagates.
  - `shops.day_change_time` (time, default 04:00).
  - `closings` additions: `kind` (staff | owner_correction), nullable `staff_id` when owner,
    `corrected_by` (owner uid), `corrects_closing_id`, and expense authorship captured at submit.
- **New functions (indicative):** phone — `staff_sign_in(staff_id, pin) → session`,
  `staff_sign_out`, `get_open_closing`, `set_closing_field(session, key, text, base_version?)`,
  `set_closing_mode`, `submit_closing(session, config_id, inputs, revision, idempotency_key)`
  (business_date server-computed; the old PIN-based signature is removed). Owner —
  `get_open_closing_for_owner(shop)`, `list_closings(shop, from, to)`, `get_closing_day(shop, date)`
  (all versions), `correct_closing(closing_id, inputs, expected_current_id)`, `set_day_change_time`.
  `private.business_date(shop)` is the one place "today" is computed; `submit_closing`,
  `set_closing_field` and session expiry all use it.
- `expense_suggestion_data` keeps working off submitted closings — use the **current version per
  day** so corrected/resubmitted days don't double-count [call].
- **Client:**
  - `src/data/remote/device.ts` (`DeviceApi`) + realtime subscription wrapper; errors through the
    same `mapError` pattern.
  - Register state becomes: server snapshot + local pending edits queue (persisted via
    `src/data/local`, failure-safe) → merged view → existing `deriveClosing`. The merge and the
    offline-replay rule are **pure modules with Vitest tests** (they are the concurrency logic).
  - `Draft` loses `staffName`/`businessDate` ownership (they come from the session/server).
  - Remove DEV ONLY items: `LOCAL_SHOP`, `src/data/local/staff.ts`, `StaffScreen` + its route and
    menu item. Device-local "submissions" history is replaced by server history.

## Testing expectations

- Pure: merge of snapshot + pending edits, offline replay/drop rule, business-date computation
  mirror used only for display (server is authoritative), presence → tag mapping.
- SQL security tests (rolled-back transactions, existing pattern) for every new function: other
  shop's phone can't read/write/subscribe; revoked phone / expired or signed-out session / inactive
  staff refused; submit for a non-today date refused; `draft_changed` on stale revision; owner of
  shop A can't list/correct shop B; correction never mutates the original row; realtime
  authorization policies.
- UI tests with fake `DeviceApi`/`OwnerApi`.
- Manual on real devices: two phones + owner browser, same box typed from both, airplane-mode
  offline edit and reconnect, submission, resubmission, owner correction.

## Delivery order

Three plans, in order, each shippable:
1. **Phone joins + staff sign-in + server submit** (no live sharing yet: single phone works end to
   end; removes DEV ONLY items; day-change time).
2. **Live shared closing** (open closing tables/functions, realtime, presence, offline queue, owner
   «Σήμερα» view).
3. **History dashboard + owner corrections.**

## Left to the builder

Exact table/function/column names; debounce timing; channel naming; UI copy beyond the Greek strings
quoted here; how the PIN pad looks; how sessions are tokenised (as long as only a hash is stored
server-side and the PIN never is); pagination of the history list; how the detail view lays out the
versions list.
