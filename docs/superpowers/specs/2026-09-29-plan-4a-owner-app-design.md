# Tameio4All Plan 4a — owner app — design

Parent spec: `2026-09-28-tameio4all-v1-design.md` (build order step 4). Database: Plan 3
(`2026-09-29-plan-3-supabase-design.md`). Agreed 2026-09-29.

## Scope

Plan 4 is split:
- **4a (this spec): the owner app** — email/password auth, create shop, settings editor with the
  +/− formula builder, staff + PINs, pairing codes, paired-devices list.
- **4b (own spec later): the phone side** — redeem a pairing code, load config + staff from the
  server, staff PIN sign-in, remove `LOCAL_SHOP` and the device-local staff list (DEV ONLY register).

Not in 4a: anything on the register screen (still runs on `LOCAL_SHOP`), `submit_closing`, closing
history (Plan 5).

## Goal / success

The owner signs up on a desktop or phone, creates a shop, builds Join Juice's settings in the
editor (same totals as `joinJuicePreset`), publishes, adds staff with PINs, and generates a pairing
code — all against the dev Supabase project.

## Architecture

**Same app, owner area under `#/owner/…`**, lazy-loaded (`React.lazy`) so the register bundle stays
small. One deploy, one PWA, shared `src/core`, `src/ui`, theme and error boundary. (Rejected: a second
Vite entry — duplicated boot/PWA scope; a separate app — would duplicate `src/core`.)

- **Dependency:** `@supabase/supabase-js`. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
  (already in `.env.example`; register them in Vercel).
- **`src/data/remote/`** — the only code that imports supabase-js.
  - `client.ts` creates the client (`flowType: 'pkce'`); its auth session storage is an adapter over
    `src/data/local/storage` (failure-safe), so `data/local` stays the only localStorage code.
  - `owner.ts` — typed wrappers, one per RPC / table read / allowed update. **The one mutation path**
    for owner writes. Each returns `Result<T> = {ok:true,data:T} | {ok:false,error:OwnerError}`.
  - `errors.ts` — `mapError(unknown): OwnerError`, one closed union: `not_owner`, `version_conflict`
    (with current version), `staff_name_taken`, `bad_pin_format`, `bad_config`, `invalid_credentials`,
    `email_not_confirmed`, `email_taken`, `weak_password`, `rate_limited`, `network`, `unknown`.
- **Pure owner logic, `src/features/owner/model/`** (no React, no supabase; Vitest):
  - `settingsDraft.ts` — reducer over `ShopConfig`: general (float, denominations, maxExpenses,
    envelope total), channels (add/rename/change type/remove), totals (add/rename/remove, add/remove
    term, flip sign, show flags, reorder), tare items. Removing a channel or total that another total
    references is refused (returns the referencing labels) instead of producing an invalid config.
  - `firstSetup.ts` — `buildFirstConfig({floatCents, channels})` → `newShopConfig()` (core) with the
    given float and channels; totals are `defaultTotals()` (they reference channel *types*, so they
    need no per-channel edits), ΜΕΤΡΗΤΑ is the envelope total, maxExpenses 10, no tare.
  - `messages.ts` — `ConfigError` → Greek text (exhaustive over `ConfigErrorCode`), `OwnerError` → Greek.
  - `limits.ts` — name checks: shop 1–80, staff 1–40, device label ≤ 60 (trimmed); PIN `^[0-9]{4}$`.
  - `pairing.ts` — `formatPairingCode('ABCDEFGH') → 'ABCD-EFGH'`, `secondsLeft(expiresAt, now)`.
- **Router:** extend `src/app/router.ts` into a typed union with params, still hash-based, no new
  dependency: `register | tare | staff | owner/login | owner/signup | owner/forgot | owner/reset |
  owner/shops | owner/new | owner/shop/:id/settings | owner/shop/:id/staff | owner/shop/:id/devices`.
  Unknown/malformed hashes (bad uuid) fall back safely (register, or shops list inside owner).
- **Screens, `src/features/owner/`:** Auth (login, signup, forgot, reset), Shops list (auto-opens the
  shop when there is exactly one; «Νέο κατάστημα»), New shop (name, float, pick channels), Settings
  (sections Γενικά · Κανάλια · Σύνολα · Αποβάρα, sticky «Δημοσίευση» bar), Staff, Devices, plus an
  owner header (shop name with rename, section tabs, sign out). Greek UI, mobile-first, existing
  `ui/` primitives and theme; 44px touch targets.

## Data flow

### Auth
- Email + password (Supabase), email confirmation on, «Ξέχασα τον κωδικό» reset.
- PKCE: confirm/reset links return as `?code=…` (not `#access_token=…`), so they never collide with
  the hash router. A boot step in `src/app` exchanges the code, strips it from the URL, and routes to
  `#/owner/reset` (recovery) or `#/owner/shops`. If the exchange fails (link opened in another
  browser, expired): «Άνοιξε τον σύνδεσμο στη συσκευή όπου τον ζήτησες» + resend.
- Dashboard (owner does this): Site URL + redirect allowlist for the local dev URL and the Vercel URL.
- **Shared-browser rule:** a paired phone (4b) is an anonymous session. Signing in as owner in that
  browser replaces it and silently unpairs the phone. The login/signup screens detect an anonymous
  session and require explicit confirmation («Αυτή η συσκευή είναι συνδεδεμένη ως ταμείο — θα
  αποσυνδεθεί») before continuing.
- Owner routes require a non-anonymous session; otherwise → `owner/login`.

### Settings: load → edit → publish
1. Load the latest `shop_configs` row for the shop (RLS: own shops only). Draft = `{config,
   baseVersion}`, autosaved per shop in `src/data/local/ownerDrafts.ts` (failure-safe; corrupt JSON →
   no draft). A saved draft whose `baseVersion` is older than the server's is offered as «Συνέχεια
   πρόχειρου» / «Απόρριψη».
2. Edits go through `settingsDraft`. `validateConfig` runs on every change; errors appear next to
   their section in Greek; «Δημοσίευση» is disabled while any exist.
3. `publish_config(shop, baseVersion, config)`. Success → draft becomes the new version, local draft
   cleared.
4. `version_conflict` → **no automatic retry** (the config is one whole document; re-sending would be
   last-write-wins). Dialog: «Οι ρυθμίσεις άλλαξαν από αλλού (έκδοση N)» with **Φόρτωση νέας**
   (discard the draft) or **Δημοσίευση πάνω της** (set `baseVersion = N` and publish, a deliberate
   overwrite).
5. Formula builder live preview: sample inputs (counted, float, one per channel, expenses) →
   `evaluateTotals` → each total's value (or the config error). Components never add money.

### Staff
List from `staff` (columns granted to owners; never `pin_hash`). Add → `create_staff(shop, name,
pin)`; change PIN → `set_staff_pin` (also clears lockout); unlock without PIN change → new
`unlock_staff`; rename / (de)activate → direct update of the granted columns. The list shows «Κλειδωμένος
έως HH:MM» when `locked_until` is in the future.

### Devices and pairing
«Σύνδεση συσκευής» → `create_pairing_code(shop)`; the code is shown as `ABCD-EFGH` with a live 10:00
countdown, then «Έληξε» + «Νέος κωδικός». The code is shown once and never stored client-side.
Devices list from `devices`: label (editable, ≤ 60), paired date, status; «Ανάκληση» sets `revoked_at
= now()` after a confirm. (Accepting the hyphenated form on the phone is 4b.)

### Shop
Create → `create_shop(name, buildFirstConfig(...))`. Rename → direct update of `shops.name` (new grant).
Names validated client-side before calling (fixes **L23**).

## Database changes — `supabase/migrations/20260929000006_owner_app.sql`

- Shop rename: `grant update (name) on public.shops to authenticated` + policy `shops_owner_update`
  (using/with check `private.is_shop_owner(id)`). The existing length CHECK still applies.
- `public.unlock_staff(p_staff_id uuid) returns void` — security definer, `search_path = ''`;
  missing or foreign id → `not_owner` (no existence oracle); anonymous → `not_owner`; sets
  `failed_attempts = 0, locked_until = null`. Revoked from `public, anon`, granted to `authenticated`.
- `create_pairing_code` (replaced): first deletes this shop's codes that are expired or used, then
  behaves as before (fixes **L26**).
- Applied to the dev project with the connector; `get_advisors` (security) checked afterwards.

Tests: `supabase/tests/050_owner_app.sql` (one rolled-back transaction, like 010–040) — rename own
shop ok; foreign shop / anonymous → 0 rows changed; 81-char name → rejected; `unlock_staff` own ok,
foreign / missing → `not_owner`, anonymous phone → `not_owner`; expired/used codes deleted on create,
other shops' codes untouched; `unlock_staff` not executable by `anon`.

## Error handling

- Every async action has one `status` (`idle | busy | error`) and every branch settles it (no
  infinite spinner); errors shown as Greek text in an `role="alert"` region next to the action.
- Network failure → «Δεν υπάρχει σύνδεση» + retry; nothing is half-applied because each action is
  one RPC / one update.
- Session expiry mid-edit → route to login; the settings draft survives in local storage.
- Buttons disabled while busy (no double submit); `create_shop` is not retried automatically.

## Trust notes

- The server checks only the config's `schema` and size; full validation is TypeScript
  (`validateConfig`). A hand-crafted bad config can only break the owner's own shop, and 4b phones
  reject it with `isShopConfig`. Accepted rather than duplicating `validateConfig` in SQL
  (never keep the same rule in two languages).
- PINs are typed by the owner and sent only to `create_staff` / `set_staff_pin`; never stored or
  displayed client-side after submit.

## Testing

**Vitest, pure (importing the real functions):** `settingsDraft` (every action; delete blocked while
referenced; result always passes or fails `validateConfig` as expected), `buildFirstConfig` (valid
config; with `joinJuicePreset`'s float and channels, ΤΑΜΕΙΟ and ΜΕΤΡΗΤΑ evaluate to the preset's values
on the same sample inputs), `messages` (exhaustive over every
`ConfigErrorCode` / `OwnerError`), `mapError` (each server error string, Auth errors, network,
unknown), `pairing`, `limits`, `ownerDrafts` storage (failure-safe, per shop, corrupt → none),
router parsing (every owner route, bad uuid, unknown hash).

**UI (jsdom + Testing Library)** with an injected fake of the `owner.ts` API (supabase-js is never
imported in tests): auth forms (validation, error display, busy cleared on every branch, anonymous
session warning), new shop, settings (publish disabled while invalid, preview updates, conflict
dialog both choices, draft restore), staff (add, PIN, unlock, lock label), devices (code + countdown
+ expiry, revoke confirm).

**Database:** `050_owner_app.sql` via the connector; 010–040 re-run after the migration.

## Not verified in 4a (to record in PROJECT_STATUS)

- Real email delivery and the confirm/reset links end to end, incl. the same-browser PKCE rule —
  needs the dashboard redirect setup; to be run together on the dev project.
- Owner UI on a real phone vs desktop.
- The anonymous-session warning against a real paired phone (paired phones exist from 4b).
- Supabase Auth rate limits / email provider limits of the free tier.
