# Tameio4All

Configurable, sellable version of tameioV2 (cash-register closing). Design:
`docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md` (v1) and
`docs/superpowers/specs/2026-11-07-live-closing-and-history-design.md` (stage 2 live closing). Plans:
`docs/superpowers/plans/`.

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
  last-write-wins reducers), `syncEngine.ts` (send queue, replay, stale/wrong_day handling),
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
  (`parseSnapshot`, `parseServerField`, `parseStaleCurrent`).
- `src/features/owner/` — owner area (lazy-loaded from `#/owner`): `model/` is pure (settings
  reducer, terms, preview, limits, pairing, messages); screens get an injected `OwnerApi`. The first shop
  tab is «Σήμερα» (`TodayScreen`): the owner sees and edits today's live closing through
  `todayWriter.ts` (`createTodayWriter`, the owner `Writer` adapter over `OwnerApi`). A bare shop route
  still lands on «Ρυθμίσεις».
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
  and the exact key sets/value shapes live in SQL (`private.closing_field_ok`, migrations `…0001`, `…0001b`,
  `…0001c`) AND in `fields.ts` (`KEY_RE`, `isFieldValue`, `parseKey`). Change one side → new migration + same
  commit. Length is counted in code points (`char_length` in SQL; the TS guard must count the same way, not
  `.length`). The SQL regex is looser than TS in one place: it accepts non-canonical keys such as `d:0100`;
  `parseKey` rejects them, so a bad field must be dropped individually when parsing a snapshot, never null the
  whole snapshot.
- **One write path.** Phones write only through `set_closing_field(token, date, key, value, base_version)`, owners
  through `owner_set_closing_field(shop, key, value, base_version)`. The function validates, stamps the author
  (expense `addedBy` is set server-side on creation and kept on later writes), bumps the field `version` and the
  closing `revision`, and broadcasts a `field` event on `shop:<shopId>` **inside the function** (`realtime.send`,
  private). Clients may insert only `presence` rows into `realtime.messages` (policy: `extension = 'presence'`
  and `can_use_shop_topic`); they can never forge a `field`/`submitted` broadcast. Never add another write path.
- **Last-write-wins + optional stale check.** A write with `base_version = null` always lands (LWW); a write with
  a base that is older than the stored version returns `{ok:false,error:'stale',current}` and changes nothing.
  Rejected writes do not bump `revision`. The expense cap (`maxExpenses` of the pinned config) counts visible
  (not removed) lines; creating or un-removing a line needs a free slot (`too_many_expenses`).
- **Offline replay.** The client keeps a pending edit queue per shop (`data/local/openClosing.ts`), each edit with
  its `baseVersion`; replay sends them in order. A persisted item whose base was `null` gets a base from the
  reloaded snapshot on startup (otherwise a replay after a remount would silently overwrite a newer value).
  `stale` → adopt the server value (a stale write with the same value counts as an ack), `network` → keep and
  retry (fixed 3 s, no backoff), `wrong_day` → drop edits of the old day, tell the cashier, resync,
  `bad_field`/`too_many_expenses` → drop the item, notice, resync; any other error (`session_invalid`,
  `device_revoked`, …) → keep the item, halt the engine and call `onFatal` (phone: `onServerError` → gate; owner:
  `ownerErrorMessage`). A halted engine reports non-live; `restart()` resumes it.
- **`useLiveClosing`** needs stable `store`, `shopId` and `me.name` (they are effect dependencies — an inline
  object restarts the channel on every render). Do not render boxes while the draft is `null` (no snapshot yet).
- **Channel.** At most one live channel per shop on the shared client at a time: close before reopen
  (`openShopChannel` waits for the old same-topic channel to leave; two simultaneous wrappers for one shop clash).
  Authorization = private channel + `realtime.messages` policies calling `private.can_use_shop_topic(topic)`:
  owner of the shop, or a phone with a live staff session in that shop. A revoked phone / deactivated cashier /
  signed-out token loses access and writes.
- **Presence** (who is looking at the register, `name` only) is the only thing clients publish directly.
  Owner presence name is «Ιδιοκτήτης».
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
- **Wrong day.** The server only accepts writes and submits for the session's business date (`wrong_day`);
  nothing is silently written to another day. The client drops wrong-day pending edits with a visible notice.
- **Local keys.** Owner and phone share the `openClosing` local keys per shop in one browser (same shop → same
  cached snapshot / queue). Stage-1 keys `draft`, `draft-submitted`, `unsent` are no longer read or written
  (`drafts.ts`/`useDraftAutosave`/the unsent-draft notice were removed); they may linger on devices that ran
  stage 1 and are harmless.
- Expense suggestions come from `DeviceApi.suggestionData` (refetched after each successful submit); the owner
  Today view has no suggestion history.

## Conventions
- Code/comments English, UI Greek. Tests in `tests/`, importing real core functions.
- `npm test`, `npm run typecheck` must pass before every commit.

## DEV ONLY register
| What | Where | Remove when |
|---|---|---|
| (none) | | |
