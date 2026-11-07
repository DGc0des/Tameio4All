# Tameio4All

Configurable, sellable version of tameioV2 (cash-register closing). Design:
`docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md`. Plans: `docs/superpowers/plans/`.

## Architecture
- `src/core/` — pure TypeScript money logic. No packages, no DOM, no Supabase. Every UI and
  report computes through these functions. The purity rule is enforced by
  `tests/core-purity.test.ts` (a Vitest check, not a linter).
- `src/features/register/draft.ts` + `derive.ts` — the register's pure model: the draft holds raw
  typed text; `deriveClosing(config, draft)` is the only bridge from text to money.
- `src/data/local/` — the only code that touches localStorage (drafts, theme, and `phone.ts`:
  the stored staff session + cached device context).
  Every call is failure-safe; `pickStore()` falls back to memory when storage is unavailable.
- `src/data/remote/` — the only code importing supabase-js. `owner.ts` (`createOwnerApi`) is the
  one path for owner reads/writes; `errors.ts` maps every failure into the closed `OwnerError`
  union; `client.ts` builds the PKCE client.
- `src/features/owner/` — owner area (lazy-loaded from `#/owner`): `model/` is pure (settings
  reducer, terms, preview, limits, pairing, messages); screens get an injected `OwnerApi`.
- `src/features/phone/` — phone shell (lazy `PhoneEntry` builds the real `DeviceApi`): `model/gate.ts` is the
  pure gate reducer (loading → unconfigured | offline_no_cache | unpaired → signed_out → ready); `PhoneApp`
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
- Totals are computed only by `evaluateTotals(config, inputs)`. Closings will store raw inputs +
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
- `ClosingInputs.schema` is 2 for new closings (`CLOSING_INPUTS_SCHEMA`): each expense carries `id` and `addedBy` (`{kind:'staff',id}` | `{kind:'owner'}`); schema 1 rows stay readable. `validateClosingInputs` enforces the schema-2 expense rules as `bad_shape`; a draft expense with no author (pre-sign-in draft) is blocked from submit by `submitBlockReason`.
- Cross-file invariant: the closing `inputs` shape is defined by `ClosingInputs` (src/core) AND
  checked by `private.inputs_shape_ok` (SQL). Bumping `schema` or changing the shape needs a new
  migration updating that check, or phones' submissions will be refused as `bad_inputs`.
- The register submits only through `DeviceApi.submit` as the signed-in cashier; nothing is stored as a
  local "submission". The idempotency key is minted when the submit sheet opens and kept while the inputs are
  unchanged and not yet acknowledged (retries and a sheet reopened after a failed/lost submit reuse it; any
  edit or a successful submit makes the next opening mint a new key). The draft is kept after a
  submit. Every submit/suggestion failure goes to `onServerError` → gate; the draft is written first.
- Expense suggestions come from `DeviceApi.suggestionData` (refetched after each successful submit).
- `verify_staff_pin` / `submit_closing` return `{ok:false,error}` for expected failures — never raise
  there (a raise rolls back the PIN lockout counter).
- Owner functions report "not yours" and "doesn't exist" the same way (`not_owner`), so ids can't be
  probed; there is no `staff_not_found` error from owner functions (only phone functions return
  `staff_not_found`).
- Internal `private.*` helpers are not callable by clients, except `private.is_shop_owner` (row-level
  security policies need it).
- A revoked phone stays revoked until an owner gives it a fresh pairing code; redeeming one re-pairs it
  (possibly to another shop). That's intended.
- Default privileges in `public` still grant new tables/functions to anon/authenticated — every new
  table or function needs an explicit `revoke … from public, anon` (and table grants chosen deliberately).
- A closing's `business_date` must be within [today−7, today+1] (server-checked in `submit_closing`).
- A non-UUID id sent to any function fails with a Postgres type error before the function runs (nothing
  is changed).
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
- Phone: a stored `StaffSession` is used only when its `shopId` and `businessDate` match the device context;
  it is saved while the gate is `ready` and cleared on `signed_out`/`unpaired`. The gate entering `loading` is the
  one reload path (PhoneApp re-runs `context()`): after pairing, after a sign-in that was offline or doesn't match
  the context, and on `session_invalid`/`wrong_day` (which also clear the stored session). A paired phone with nobody
  signed in renders only the sign-in screen (no register fields, no amounts). A draft is discarded when its
  `businessDate` differs from the server's (`loadDraft(store, shopId, businessDate)`; no TTL).

## Conventions
- Code/comments English, UI Greek. Tests in `tests/`, importing real core functions.
- `npm test`, `npm run typecheck` must pass before every commit.

## DEV ONLY register
| What | Where | Remove when |
|---|---|---|
| (none) | | |
