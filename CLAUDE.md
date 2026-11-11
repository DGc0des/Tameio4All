# Tameio4All

Configurable, sellable version of tameioV2 (cash-register closing). Design:
`docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md` (v1) and
`docs/superpowers/specs/2026-11-07-live-closing-and-history-design.md` (stage 2 live closing; its «History
dashboard» and «Owner corrections» sections are stage 3). Plans: `docs/superpowers/plans/` (stage 3:
`2026-11-11-stage-3-history-and-corrections.md`).

## Architecture
- `src/core/` — pure TypeScript money logic. No packages, no DOM, no Supabase. Every UI and
  report computes through these functions. The purity rule is enforced by
  `tests/core-purity.test.ts` (a Vitest check, not a linter).
- `src/features/register/draft.ts` + `derive.ts` — the register's pure model: `Draft` holds raw typed text
  (no `id`/`mode`; entry mode is a per-shop local preference); `deriveClosing(config, draft)` is the only
  bridge from text to money. The draft is never stored on its own any more — it is derived from the live
  closing's fields (`draftFromFields`).
- `src/features/register/live/` — the live shared closing engine. `fields.ts` (field model, key regex, value
  guards, `Snapshot`/`PendingEdit`/`ServerField` types), `merge.ts` (pure snapshot + pending edits → draft,
  last-write-wins reducers, the +1 revision rule), `syncEngine.ts` (per-author send queue, replay, stale/wrong_day
  handling, sign-out `drain`),
  `useLiveClosing.ts` (React binding; takes a `Writer`).
- `src/data/local/` — the only code that touches localStorage: theme, `phone.ts` (stored staff session +
  cached device context) and `openClosing.ts` (per shop: cached snapshot, pending edit queue, entry mode).
  Every call is failure-safe; `pickStore()` falls back to memory when storage is unavailable.
- `src/data/remote/` — the only code importing supabase-js. `owner.ts` (`createOwnerApi`) is the
  one path for owner reads/writes; `errors.ts` maps every failure into the closed `OwnerError`
  union; `client.ts` builds the PKCE client. `supabase.ts` exports `getSupabase()`: the ONE shared
  client (owner and phone use the same instance). `deviceApi.ts` (the `DeviceApi` interface),
  `device.ts` (`createDeviceApi`, the one path for phone reads/writes: context, staff list, pair,
  sign in/out, open closing, `setField`, submit, suggestions) and `deviceErrors.ts` (`mapDeviceError` →
  closed `DeviceError`). `live.ts` (`openShopChannel`) is the realtime channel wrapper (private channel
  `shop:<shopId>`: `field` and `submitted` broadcasts in, presence in/out) plus the shape-checked parsers
  (`parseSnapshot`, `parseServerField`, `parseStaleCurrent`). `history.ts` has the shape-checked parsers of the
  owner history payloads (`parseHistoryList`, `parseDayDetail`; they import `isIsoDate` from `src/app/dates.ts`).
- `src/features/owner/` — owner area (lazy-loaded from `#/owner`): `model/` is pure (settings
  reducer, terms, preview, limits, pairing, messages); screens get an injected `OwnerApi`. The shop tabs are
  «Σήμερα» · «Ιστορικό» · «Ρυθμίσεις» · «Προσωπικό» · «Συσκευές». «Σήμερα» (`TodayScreen`, the first tab): the
  owner sees and edits today's live closing through `todayWriter.ts` (`createTodayWriter`, the owner `Writer`
  adapter over `OwnerApi`). A bare shop route still lands on «Ρυθμίσεις».
- `src/features/owner/history/` — «Ιστορικό» (stage 3): `types.ts` (`HistoryList`/`HistoryDay`/`DayDetail`/
  `ClosingVersion`), pure `model.ts` (`summarizeInputs`/`summarizeOpen`, `weekCells`, `breakdown`, `snapshotFromInputs`,
  `applyLocalEdit`; every number goes through `evaluateTotals`/`planEnvelope`, never throws on unreadable
  stored data), and three screens over an injected `OwnerApi`: `HistoryScreen` (Monday–Sunday week of day cards via `weekCells`; «today» only from the server's `listClosings`), `DayScreen` (one
  day: versions, breakdown, Φάκελος), `CorrectionEditor` (edit + save a correction). Routes:
  `#/owner/shop/<id>/history` and `…/history/<YYYY-MM-DD>` (`router.ts`; a malformed date segment is dropped).
- `src/features/phone/` — phone shell (lazy `PhoneEntry` builds the real `DeviceApi`): `model/gate.ts` is the
  pure gate reducer (loading → unconfigured | offline_no_cache | load_error | unpaired → signed_out → ready); `PhoneApp`
  renders only from it; `PairScreen`, `SignInScreen`. App tests pass `deviceApi={fakeDeviceApi()}`.
- `src/ui/` primitives, `src/features/*` screens and sheets, `src/app/` composition (App, hash
  router, theme, error boundary).
- `supabase/migrations/` — the database (source of truth; applied to the dev project
  `fstfuhogvsdaiwpfdmep` with the Supabase connector). `supabase/tests/` — SQL security tests,
  one rolled-back transaction each (see its README).

## Invariants
- Money is integer cents everywhere in core. Parse with `parseAmount`; display with `formatEuro`
  (UI) — `formatCents` is the plain form.
- `ShopConfig` and `ClosingInputs` both carry a `schema: 1` field (day-zero identifier). Bump it
  whenever the stored shape changes; validators reject a mismatched/missing schema as `bad_shape`.
- Configs and closing inputs are read back as JSON (jsonb / stored rows), so `validateConfig` and
  `validateClosingInputs` both accept `unknown` and never throw on foreign input — they report
  structural problems as `bad_shape`/`bad_id`/`bad_label`/etc. instead. `isShopConfig(x)` is the
  `unknown` → `ShopConfig` type guard built on `validateConfig`.
- Totals are computed only by `evaluateTotals(config, inputs)`. Closings store raw inputs +
  `config_id`, never totals (staff cannot fake a total; old closings keep their formulas).
- Shop configs are immutable versions; a new version is a new row.
- A config must pass `validateConfig` before use; `evaluateTotals` throws `ConfigInvalidError`
  otherwise, then `ClosingInputsInvalidError` if `validateClosingInputs` finds a problem.
- Envelope (Φάκελος) is computed only by `planEnvelope`, fed computed totals — never UI text.
  Exact up to ~20 000€ (`MAX_UNITS` at 5c units); best-effort above that.
- Staff/PINs are never part of `ShopConfig` (server-side table only).
- No shop's data ships in the code: expense suggestions are learned per shop from its own submitted
  expense lines via `buildSupplierHistory` (30 most recent amounts per supplier). Never add a
  hardcoded supplier list.
- Components never parse or add money: text → cents via `deriveClosing`/core, display via `formatEuro`.
- The Z photo is attached to the share only — never stored (not on the device, not on the server).
- Database: RLS on every table, `anon` gets nothing, phones have no direct table access (server
  functions only), every function is `security definer` + `search_path = ''` with execute for
  `authenticated` only. Identity only from `auth.uid()`/`auth.jwt()`.
- `ClosingInputs.schema` is 2 for new closings (`CLOSING_INPUTS_SCHEMA`): each expense carries `id` and `addedBy` (`{kind:'staff',id}` | `{kind:'owner'}`); schema 1 rows stay readable. `validateClosingInputs` enforces the schema-2 expense rules as `bad_shape`; a draft expense with no author (pre-sign-in) is blocked from submit by `submitBlockReason`.
- Cross-file invariant: the closing `inputs` shape is defined by `ClosingInputs` (src/core) AND
  checked by `private.inputs_shape_ok` (SQL). Bumping `schema` or changing the shape needs a new
  migration updating that check, or phones' submissions will be refused as `bad_inputs`.
- Schema 2 is a cross-file invariant: `validateClosingInputs` and `private.inputs_shape_ok` both accept 1|2;
  `submit_closing` accepts only 2 (`bad_inputs` otherwise); schema-2 expenses need `id` (1–64 chars) and `addedBy`
  (`{kind:'staff',id: uuid of a staff of the shop}` or `{kind:'owner'}`). Change one side and the other needs a
  migration/commit in the same change.
- Internal `private.*` helpers are not callable by clients, except `private.is_shop_owner` and
  `private.can_use_shop_topic` (both executable by `authenticated`; row-level security / realtime policies need
  them; each only answers a boolean about the caller's own access).
- Database: a new table or function in `public` needs an explicit `revoke … from public, anon` (default
  privileges still grant new objects to anon/authenticated); table grants chosen deliberately.
- Owner functions report "not yours" and "doesn't exist" the same way (`not_owner`), so ids can't be
  probed; there is no `staff_not_found` error from owner functions (only phone functions return
  `staff_not_found`).
- A revoked phone stays revoked until an owner gives it a fresh pairing code; redeeming one re-pairs it
  (possibly to another shop). That's intended.
- A non-UUID id sent to any function fails with a Postgres type error before the function runs (nothing
  is changed).
- `verify_staff_pin` / `staff_sign_in` / `submit_closing` return `{ok:false,error}` for expected failures — never
  raise there (a raise rolls back the PIN lockout counter).
- Owner screens never call supabase directly — only through `OwnerApi`; UI tests use
  `tests/features/owner/fakeApi.ts` and never load supabase-js.
- Auth uses PKCE with `detectSessionInUrl: false`; email links return as `?auth=signup|recovery&code=…`
  and `OwnerApp` exchanges the code exactly once. Redirect URLs must be allow-listed in the Supabase
  dashboard.
- Shared-browser rule: signing in as owner in a browser holding an anonymous (paired phone) session
  unpairs it; the login/signup screens require explicit confirmation.
- A new server error string needs a case in `mapError` and a Greek message in `ownerErrorMessage`, or
  it surfaces as «Κάτι πήγε στραβά».
- `publish_config` conflicts are never retried automatically; the owner chooses «Φόρτωση νέας» or
  «Δημοσίευση πάνω της».
- The settings preview computes only through `previewTotals` → `evaluateTotals`.
- Theme (`src/app/theme.css`): frosted glass over midnight/pale backgrounds; electric blue = actions,
  cantaloupe (`--hl`) = key numbers. `.share-card` must stay opaque (`--solid`) — `shareCard` renders it
  to a PNG using its computed background. Glass panels use `backdrop-filter`, which traps
  `position: fixed` children, so `Sheet` renders through a portal to `<body>`; keep any new fixed overlay
  out of glass containers the same way.
- Business day: the shop's business date comes only from `private.business_date` (Europe/Athens, the owner's
  day-change time, default 04:00; a new time takes effect from the next business day, via
  `prev_day_change_time`/`day_change_switch_at`). The phone never computes it; it reads `business_date` from
  `device_context()` and `staff_sign_in`.
- Staff session (`staff_sessions`): `staff_sign_in` verifies the PIN and returns a random token; only its sha256
  is stored (the PIN is never stored; the raw token only lives on the phone). One live session per phone (a new
  sign-in revokes the phone's earlier ones), valid for its business date only; it dies on sign-out, device
  revocation or staff deactivation. Phone functions authorize from the token + `auth.uid()`, never a
  client-sent staff or shop id. Phones cannot read `staff_sessions` or call `private.*`.
- Phone: a stored `StaffSession` is used only when its `shopId` and `businessDate` match the device context;
  it is saved while the gate is `ready` and cleared on `signed_out`/`unpaired`. The gate entering `loading` is the
  one reload path (PhoneApp re-runs `context()`): after pairing, after a sign-in that was offline or doesn't match
  the context, on `session_invalid`/`wrong_day` (which also clear the stored session), and on the gate's `retry`
  (while offline: the `online` event, the page becoming visible, «Δοκίμασε ξανά»; also from `load_error`). Load
  order: `session()` first — only a lookup that succeeded with no session means unpaired (stored session + cached
  context cleared); a failed lookup is "couldn't tell" (auth-js returns `{session:null, error}` when an expired
  access token can't be refreshed offline) and falls through to `context()`. `pair` refuses on a failed lookup. Only a `network` failure falls back to the cached context (offline); `device_revoked`/
  `not_a_device` (incl. Postgres 42501) unpair; any other failure is `load_error` (message + retry, never a cached
  register). A paired phone with nobody signed in renders only the sign-in screen (no register fields, no amounts).

### Live shared closing (stage 2)
- **Open closing.** One row per shop per business day in `open_closings` (+ `open_closing_fields`), created by
  `get_open_closing`/`owner_get_open_closing` on first use. Its config is **pinned** at creation (`config_id`): a
  publish later the same day does not change today's closing. The snapshot returned to clients carries `config`,
  `config_id`, `business_date`, `revision`, `fields[]` and `last_submit`; the register takes its config from it,
  not from `device_context`. No client has direct table access.
- **Field model** (`fields.ts`; values are strict shapes — no missing and no extra properties; `text` ≤ 200
  Unicode code points):

  | Key | Value |
  |---|---|
  | `d:<cents>` (`[0-9]{1,6}`) | `{text, mode: 'amount'\|'count'}` |
  | `c:<channelId>` (`[A-Za-z0-9_-]{1,40}`) | `{text}` |
  | `e:<id>` (`[A-Za-z0-9-]{1,64}`) | `{addedBy, order, removed}` (line meta) |
  | `e:<id>:d` / `e:<id>:a` | `{text}` (description / amount; only after `e:<id>` exists) |

- **Cross-file invariant: field keys and values.** The key regex `^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$`
  and the exact key sets/value shapes live in SQL (`private.closing_field_ok`, migrations `…0001`, `…0001b`)
  AND in `fields.ts` (`KEY_RE`, `isFieldValue`, `parseKey`). Change one side → new migration + same
  commit. Length is counted in code points (`char_length` in SQL; the TS guard must count the same way, not
  `.length`). The SQL regex is looser than TS in one place: it accepts non-canonical keys such as `d:0100`;
  `parseKey` rejects them, so a bad field must be dropped individually when parsing a snapshot, never null the
  whole snapshot.
- **One write path.** Phones write only through `set_closing_field(token, date, key, value, base_version)`, owners
  through `owner_set_closing_field(shop, date, key, value, base_version)` (migration `…0003_live_fixes`; the date is
  the snapshot's — the day on screen — and anything but the shop's business date is `wrong_day`, like the phone).
  Both go through `private.write_closing_field` (latest body: `…0003`), which validates, stamps the author
  (expense `addedBy` is set server-side on creation and kept on later writes), bumps the field `version` and the
  closing `revision`, returns `{ok:true, version, revision, value}` — `value` is what was **stored** (the client's
  ack applies it, never only what it sent: the author may differ) — and broadcasts a `field` event on `shop:<shopId>` **inside the function** (`realtime.send`,
  private). Clients may insert only `presence` rows into `realtime.messages` (policy: `extension = 'presence'`
  and `can_use_shop_topic`); they can never forge a `field`/`submitted` broadcast. Never add another write path.
- **Last-write-wins + optional stale check.** A write with `base_version = null` always lands (LWW); a write with
  a base that is older than the stored version returns `{ok:false,error:'stale',current}` and changes nothing.
  Rejected writes do not bump `revision`. The expense cap (`maxExpenses` of the pinned config) counts visible
  (not removed) lines; creating or un-removing a line needs a free slot (`too_many_expenses`).
- **Offline replay.** The client keeps a pending edit queue per shop (`data/local/openClosing.ts`), each edit with
  its `baseVersion` and its **author** (`PendingEdit.author`: the cashier's staff id, or `OWNER_QUEUE_AUTHOR` =
  `'owner'`); replay sends them in order. **The queue is per author:** an engine (`EngineState.author`, from
  `useLiveClosing`'s `me.id`) loads, shows and sends only its author's items — they go out with that person's
  credentials, so cashier A's unsent edits are never sent as cashier B, nor the owner's as a phone's in a shared
  browser. Other authors' items stay stored, hidden; `savePending(store, shop, author, mine, currentDate)` is a
  read-modify-write that keeps them and drops other authors' items of a day before `currentDate` (unsendable).
  An item stored without an author (pre-tagging) fails the shape check and is dropped. **Sign-out** drains first:
  `drain(SIGN_OUT_DRAIN_MS = 3000)` flushes typing and waits until nothing of the day is queued or in flight (at
  once `false` when offline/halted), then `staff_sign_out`; whatever is left stays stored under the cashier. A persisted item whose base was `null` gets a base from the
  reloaded snapshot on startup (otherwise a replay after a remount would silently overwrite a newer value).
  `stale` → adopt the server value (a stale write with the same value counts as an ack), `network` → keep and
  retry (fixed 3 s, no backoff), `wrong_day` (phone and owner) → drop edits of the old day, tell the person, resync,
  `bad_field`/`too_many_expenses` → drop the item, notice, resync; any other error (`session_invalid`,
  `device_revoked`, …) → keep the item, halt the engine and call `onFatal` (phone: `onServerError` → gate; owner:
  `ownerErrorMessage`). A halted engine reports non-live; `restart()` resumes it.
- **Revision: the +1 rule.** The local `snapshot.revision` (what Υποβολή sends) means "every write up to here is
  in this snapshot". It advances only when an ack or broadcast carries exactly `revision + 1` (whether or not that
  field was newer than ours — a superseded write still counts); a higher one is a gap (a broadcast late or lost):
  the field is applied by its own version rule, the revision is kept, and the engine resyncs. A load takes the
  higher of its revision and ours (ours is always complete, and the merge keeps our newer fields). Never use
  `max` on an ack/broadcast revision: a submit could then pass the server's revision check without a write the
  phone never saw. A wrong guess costs at most one extra `draft_changed`.
- **`useLiveClosing`** needs stable `store`, `shopId`, `me.name` and `me.id` (they are effect dependencies — an
  inline object restarts the channel on every render; RegisterScreen memoizes `me`). Do not render boxes while the
  draft is `null` (no snapshot yet). RegisterScreen, while the gate is online, also treats a cached snapshot whose
  `businessDate` is not `ctx.businessDate` as no snapshot (startup shows «Φόρτωση…», never yesterday's boxes:
  anything typed there would be tagged with the old day and dropped).
- **Channel.** At most one live channel per shop on the shared client at a time: close before reopen
  (`openShopChannel` waits for the old same-topic channel to leave; two simultaneous wrappers for one shop clash).
  Authorization = private channel + `realtime.messages` policies calling `private.can_use_shop_topic(topic)`:
  owner of the shop, or a phone with a live staff session in that shop. A revoked phone / deactivated cashier /
  signed-out token loses **writes** at once (every call re-checks the session) and cannot **join** the channel.
  Known limit: Realtime checks the policy at channel join (and on token refresh), not per message — a client
  already joined keeps *receiving* broadcasts until it rejoins or its access token is refreshed. Likewise an idle
  phone keeps showing yesterday's numbers after the day change until something makes it resync (a write, a
  broadcast of the new day, a reconnect, a reload).
  Known clash: an owner signing in on a paired phone's browser leaves the register mounted-but-hidden, so opening
  «Σήμερα» for the same shop there would open a second channel on one topic (see `live.ts`).
- **Presence** (who is looking at the register, `name` only) is the only thing clients publish directly.
  Owner presence name is «Ιδιοκτήτης». Presence names are self-declared by clients (cosmetic only; nothing
  trusts them — authorship of fields comes from the server).
- **Submit.** `submit_closing(token, config_id, date, inputs, revision, key)` (the 5-arg stage-1 form is gone).
  Order of checks: session → date/inputs → idempotency-key lookup (a repeat is answered before anything else) →
  `wrong_day` → `config_mismatch` (config must be the closing's pinned one) → revision. A `revision` that is not
  exactly the current one (including `null` or a future value) → `{ok:false,error:'draft_changed',revision}`,
  nothing stored. A successful submit stores a `closings` row, records `last_submit` on the open closing and
  broadcasts `submitted`; the open closing and its fields are kept (resubmit with a new key stores another
  row). The revision proves the client saw the latest fields; it does not prove `inputs` equals the merged
  fields (same trust as stage 1: the phone is the authenticated cashier).
- **Owner-authored lines are submittable.** An expense `addedBy` must equal the stored author of that line's
  `e:<id>` field in the open closing (owner or staff); for an id with no `e:<id>` field the stage-1 rule applies
  (staff of the shop only, no owner). Authors stay server-attributed.
- **Idempotency key** (client): minted when the submit sheet opens, kept while the inputs are unchanged and not
  yet acknowledged (retry / reopened sheet reuse it); an edit, a successful submit, or `draft_changed` makes the
  next opening mint a new key. `draft_changed` is not a failure: it does **not** go to `onServerError` (the sheet
  resyncs and asks the cashier to review); every other submit/suggestion failure does (the gate decides). The
  register submits only through `DeviceApi.submit` as the signed-in cashier; nothing is stored as a local
  "submission".
- **Wrong day.** The server only accepts writes and submits for the session's business date (owner writes: the
  shop's business date) (`wrong_day`); nothing is silently written to another day. The client drops wrong-day pending edits with a visible notice.
- **Local keys.** Owner and phone share the `openClosing` local keys per shop in one browser (same shop → same
  cached snapshot; one queue key holding everyone's items, each engine using only its author's). Stage-1 keys `draft`, `draft-submitted`, `unsent` are no longer read or written
  (`drafts.ts`/`useDraftAutosave`/the unsent-draft notice were removed); they may linger on devices that ran
  stage 1 and are harmless.
- Expense suggestions come from `DeviceApi.suggestionData` (refetched after each successful submit); the owner
  Today view has no suggestion history.
- **Owner «Σήμερα»** shows the same boxes, totals and Φάκελος as the register: it reuses `LiveClosingView`, the
 register's `BottomBar` (without `onSubmit` there is no Υποβολή button) and `EnvelopeSheet` over the same
 `deriveClosing` → `planEnvelope` result. No Υποβολή from the owner; once a cashier has submitted, the owner can
 record later changes with «Καταχώρηση αλλαγών» (see «Today's versions» below).
- **`last_submit.revision`** (migration `…0003_today_save_and_submit_revision`): the open closing's revision at that
 submit. `changedSinceSubmit(snapshot)` (`fields.ts`) = `revision > lastSubmit.revision` → «Άλλαξε μετά την υποβολή»
 on the phone header and «Σήμερα». Absent on older rows (`SubmitInfo.revision` optional) → no notice.

### Closing history (stage 3)
- **`closings` is an append-only version log.** A correction inserts a new row and never updates or deletes
  one. The only owner-writable column is `voided_at` (column grant + `closings_owner_update` policy from Plan 3); no
  UI sets it, and voided rows are invisible everywhere. Columns (migration `20261111000001_closing_versions`): `seq` (identity, unique, back-filled in
  `created_at, id` order), `kind` (`'staff'` | `'owner_correction'`), `corrected_by`, `corrects_closing_id`
  (the version it replaced). `closings_kind_shape`: a `staff` row has `staff_id` and `device_user_id` and no
  `corrected_by`/`corrects_closing_id`; an `owner_correction` row has `corrected_by` and neither `staff_id` nor
  `device_user_id` (both are nullable now).
- **Current version of a day = the non-voided row with the highest `seq`** for (shop, business date) —
  `private.current_closing(shop, date)` is the helper. The list, the day detail and the save guard use it;
  `expense_suggestion_data` and `owner_get_closing_day` repeat the same `seq desc` rule inline — change all together. Never order versions by `created_at` (100 T1 backdates one to prove it).
- **Totals are never stored or computed in SQL**: every number in history comes from `evaluateTotals`/
  `deriveClosing`/`planEnvelope` with the config of that version (`config_id`; the day detail carries every
  version's config, the list only the current versions'). Stored `config`/`inputs` are untrusted: they go
  through `isShopConfig`/`validateClosingInputs`; a version that fails shows «Δεν διαβάζεται» and never hides
  the other rows.
- **Read path.** `owner_list_closings(shop, from, to)` (default: last 30 days up to the shop's today; `to − from`
  over 366 days or `from > to` → `bad_range`) and `owner_get_closing_day(shop, date)`; both
  `private.require_owner` first. The owner's browser never computes the business date: `today`, `from` and `to`
  come from the response.
- **Unsubmitted day**: an `open_closings` row of the shop with `business_date` before the shop's business date,
  at least one `open_closing_fields` row, and no non-voided `closings` row for that date. The list shows it as
  `status:'unsubmitted'`; `day.open` is set only when `versions` is empty and the date is such a day.
- **One owner write path: `owner_save_closing(shop, date, config_id, inputs, expected_current_id, key, revision default null)`**
 (latest body: `…0003_today_save_and_submit_revision`; the 6-argument form was dropped). Check order: `require_owner` → `bad_inputs` (key 1–100
  chars, `private.inputs_shape_ok`, `schema` exactly 2, every `{kind:'staff'}` expense author is a staff row of
  *this* shop, active or not; owner lines are fine) → idempotency lookup (same key + owner row + same inputs/
  config/date → `repeat:true`; else `idempotency_conflict`) → advisory lock on the day, then `open_closings … for
  update` (so it serializes with a staff submit) → **the idempotency lookup again, under the locks** (a concurrent
  same-key retry gets `repeat`, not `closing_changed`) → current-version guard: when a current exists
  `expected_current_id` must equal it (`closing_changed` + `current_id` otherwise) and `config_id` must be its
  `config_id` (`config_mismatch`); when none exists `expected_current_id` must be null (`closing_changed`, `current_id`
  null) and the day must be an unsubmitted day (`no_closing_day`) with `config_id` = the open closing's pinned
 one (`config_mismatch`) → insert `owner_correction` (`corrects_closing_id` = the replaced current, null for a first
 filing) `on conflict (shop_id, idempotency_key) do nothing` and answer a lost same-key race like the lookup.
 A date after the shop's business date → `no_closing_day`. Never add another owner write path for closings
 (`submit_closing` is the staff one).
- **Today's versions come only from the live closing.** For the shop's business date a current version must exist
 (`no_closing_day`; the owner never files today first), `revision` must equal the open closing's (`draft_changed`
 + revision, nothing stored), a line that exists as `e:<id>` must carry its stored author (`bad_inputs`), and a
 successful save sets `last_submit` (`staff_name` «Ιδιοκτήτης», with `revision`) and broadcasts `submitted`. So a
 later cashier resubmit is built from the same live fields and cannot silently drop the owner's change. The UI:
 «Καταχώρηση αλλαγών» in «Σήμερα» (shown while `changedSinceSubmit`; guarded on `lastSubmit.closingId`, idempotency
 key kept while the inputs are unchanged); `DayScreen` offers no «Διόρθωση»/«Επαναφορά» when `businessDate ===
 today` (from the server). Edits made after a submit and never re-saved are still not in history (only flagged).
- **Past-day owner saves are isolated from the live closing**: they do not touch `open_closings` (`revision`,
 `last_submit`), write no `open_closing_fields` and broadcast nothing. Staff still submit only for the shop's
 business date.
- **`closing_changed` is never retried automatically.** `CorrectionEditor` shows a sheet: «Φόρτωση νέας» (refetch
  the day; the editor remounts on the new current version, the owner's local edits are dropped) or, when the
  error carries a `currentId`, «Αποθήκευση πάνω της» (resend the same inputs guarded on that newer version). The
  idempotency key is kept across retries of the same inputs and re-minted by every edit and after `closing_changed`.
  `config_mismatch` offers «Φόρτωση νέας» only.
- **The correction editor is local.** It starts from `snapshotFromInputs` (the current version) or the
  unsubmitted day's open snapshot, applies box edits with `applyLocalEdit`, derives through `deriveClosing`
  (blocked by `envelopeBlockReason`, and by «Δεν άλλαξε κάτι» for an unchanged correction) and saves through
  `OwnerApi.saveClosing`. It never uses `useLiveClosing`, the sync engine or `setTodayField`; no field is sent
  per edit. Existing expense lines keep their `id` and `addedBy`; lines the owner adds are `{kind:'owner'}`;
  new closings are `ClosingInputs` schema 2. Editing always starts from the **current** version, never a
  selected older one.
- **Change marks and «Επαναφορά» (DayScreen).** An owner correction is shown against its original: the newest
 `staff` version older than it (`originalOf`); `diffBreakdown` marks changed/added/removed lines with the original
 value, and the header names the original submitter. «Επαναφορά» on an older version re-saves its inputs through
 `OwnerApi.saveClosing` (guarded on the current id; offered only for a past day, the current `config_id`, schema 2
 and inputs that differ from the current) — a new `owner_correction` row, nothing is deleted.
- **Cross-file invariant: history payload shapes.** `private.closing_version_json` and the `owner_list_closings`/
  `owner_get_closing_day`/`owner_save_closing` results are parsed by `history.ts` (`parseHistoryList`,
  `parseDayDetail`) and `owner.ts` (`saveClosing`):
  - `version` = `{id, kind, author_name, created_at, config_id, inputs, corrects_closing_id|null}` (`author_name`
    = the staff's name, or «Ιδιοκτήτης» for an owner row);
  - `list` = `{ok, today, from, to, configs:{<config_id>:config}, days:[{business_date, status:'submitted',
    version_count, current:version} | {business_date, status:'unsubmitted', open:<closing_snapshot>}]}`, newest day first;
  - `day` = `{ok, today, business_date, versions:[version…] (seq desc, [0] current), configs, staff_names (every staff
    of the shop, active or not), open: <closing_snapshot>|null}`;
 - `save` = `{ok:true, closing_id, repeat}` | `{ok:false, error:'closing_changed', current_id}` |
 `{ok:false, error:'draft_changed', revision}` (today only) |
 `{ok:false, error:'bad_inputs'|'config_mismatch'|'no_closing_day'|'idempotency_conflict'}`.
  The parsers drop a bad day/version individually (a bad top level → `null` → `unknown`/`bad_response`); change a shape on
  one side → a migration + the parser in the same commit.
- **Cross-file invariant: the author check.** `owner_save_closing` accepts a staff `addedBy` only if that staff row
  belongs to the shop; `validateClosingInputs` (schema-2 expense rules) and `private.inputs_shape_ok` check the
  rest. The server accepts any staff author of the shop on any line (including changing an existing
  line's author); «editing keeps the author» is enforced by the client (`snapshotFromInputs`). Trusted role.
- **Seven owner error strings** added in stage 3, each with a `mapError` case (`errors.ts`) and a Greek `ownerErrorMessage`:
 `closing_changed`, `bad_inputs`, `config_mismatch`, `no_closing_day`, `idempotency_conflict`, `bad_range`, `draft_changed`.
  `mapError` alone gives `closing_changed` a null `currentId`; `saveClosing` in `owner.ts` builds it from the
  payload's `current_id` (the editor offers «Αποθήκευση πάνω της» only with an id).
- `private.current_closing` and `private.closing_version_json` are `private.*` helpers: no client execute.

## Conventions
- Code/comments English, UI Greek. Tests in `tests/`, importing real core functions.
- `npm test`, `npm run typecheck` must pass before every commit.

## DEV ONLY register
| What | Where | Remove when |
|---|---|---|
| (none) | | |
