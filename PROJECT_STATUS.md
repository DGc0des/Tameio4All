# Project Status

## Stages
- [x] Plan 1 — day zero + `src/core`
- [ ] Plan 2 — register UI on local preset (code complete; pending real-phone test + Vercel URL)
- [x] Plan 3 — Supabase schema, RLS, RPCs (dev project)
- [ ] Plan 4 — owner app + device pairing
- [ ] Plan 5 — closings, history, suggestions, PWA, deploy

## Issues carried over from tameioV2 (fixed by design; verify when the owning code lands)
| ID | Issue | Fix | Status |
|---|---|---|---|
| H1 | Greedy envelope reports shortfall when an exact combination exists (50 + 3×20 for 60€) | fixed in core (planEnvelope); UI wiring in Plan 2 | fixed — exact planEnvelope in Φάκελος sheet |
| H2 | Envelope logic duplicated, reads totals back from DOM text | single `planEnvelope`, fed `evaluateTotals` | fixed — one planEnvelope fed by deriveClosing |
| M1 | Reset clears date, leaves stale tare/Φάκελος state | Plan 2 | fixed — resetInputs keeps staff/date/mode |
| M2 | Φάκελος result stale after edits | Plan 2 | fixed — modal sheet reads live derived state |
| M3 | `"5-3"` read as 5; negatives accepted | fixed in core (parseAmount/sanitizeAmountInput); UI wiring in Plan 2 | fixed — sanitize on input + deriveClosing validation |
| L1 | Expense descriptions injected via innerHTML | React text rendering (Plan 2) | fixed — React text rendering, no innerHTML |

## Core findings (Plan 1 review)
Whole-branch review of `src/core` for safety against configs/closings read back as JSON (jsonb).
Continues the severity scheme above (H1, H2, M1–M3, L1).

| ID | Issue | Fix | Status |
|---|---|---|---|
| H3 | `validateConfig` assumed a well-typed `ShopConfig`; a malformed JSON-parsed config (wrong primitive types, missing arrays, bad ref kinds) could throw a `TypeError` instead of reporting errors | `validateConfig(config: unknown)`, structural checks first, new `bad_shape`/`bad_label` codes, `isShopConfig` guard | fixed — config JSON validation (F1) |
| H4 | `evaluateTotals` trusted `ClosingInputs` shape; bad counts/amounts (negative, fractional, NaN, string) from JSON could produce wrong or `NaN` totals silently | `validateClosingInputs` (`bad_count`/`bad_amount`/`too_many_expenses`), `ClosingInputsInvalidError`, called from `evaluateTotals` after `validateConfig` | fixed — closing inputs validation (F2) |
| H5 | `planEnvelope`'s exact DP allocates `O(n·T)` memory/time with no upper bound; a very large or attacker-supplied target could exhaust memory or hang | `MAX_UNITS` (400 000, ≈20 000€ at 5c units) caps the DP; above it, largest denominations are pre-taken greedily first, then the exact DP runs on the bounded remainder (best-effort above ~20 000€) | fixed — envelope size cap (F3) |
| L2 | No schema/version identifier on stored shapes; a future format change would have no way to distinguish old rows from new | `schema: 1` added to `ShopConfig` and `ClosingInputs`, required by both validators | fixed — schema version (F6) |
| L3 | `core-purity.test.ts` only matched `from '...'`/`import('...')` specifiers and used a string-prefix containment check that a sibling directory (e.g. `src/core-x`) could satisfy without truly being inside `src/core` | Also scans bare side-effect `import '...'` and `require(...)`; containment now via `relative()`/`isAbsolute()`. Verified manually with two probe files (removed after) | fixed — purity test gaps (F5) |
| L4 | `joinJuicePreset` was a plain mutable object; any consumer could mutate the shared shop preset in place | `deepFreeze()` (local to `presets.ts`) freezes it and every nested array/object recursively; kept the exported type as `ShopConfig` (not `Readonly`/`DeepReadonly`) since that would break callers expecting mutable array fields | fixed — mutable preset (F5) |
| L5 | Dev dependencies (TypeScript 7, Vitest 5) are on unpinned new majors | `package-lock.json` + `npm ci` in CI protect against silent upgrades; still worth pinning explicitly later | open |
| L6 | `CHANNEL_TYPES` order (`cash_extra, card, delivery, noncash_other`) is arbitrary and drives default-totals term order and any future channel-type picker UI | Fix together with the Plan 2/4 channel-type picker, once the UI dictates the natural order | open |
| L7 | Missing edge-case tests: `maxExpenses` 0/30 boundaries, a 3-level `totalOrder` dependency chain, a frequency tie-break case in `suggestExpenseDescriptions` | Add when the owning feature (Plan 2 config UI / suggestions UI) lands and exercises these paths for real | open |
| L8 | `evaluateTotals` calls `totalOrder` a second time after `validateConfig` already checked for cycles; its `if (!order.ok) throw` branch is unreachable in practice | Kept deliberately — TS needs the second `totalOrder` call itself (not just the throw) to get `order.order`, and the `.ok` narrowing to read `.order` safely | open (by design) |
| L9 | `presets.ts`'s `euros()` converts float literals (e.g. `6.3`) to cents with `Math.round(v * 100)`; float rounding could in principle round the wrong way | Moot: the hardcoded supplier list and `euros()` were removed (see M4) | closed — no longer applies |
| M4 | Expense suggestions came from a hardcoded supplier list (Join Juice's V2 `EXPENSE_HISTORY` in the preset, `seedSuppliers` in every config) — wrong for a product, since supplier names differ per shop | Removed `seedSuppliers` from `ShopConfig`, validation and the preset. New `buildSupplierHistory(pastExpenses)` learns per shop from submitted expense lines (grouping ignores case/accents/spaces/final sigma, most recent spelling shown, 30 most recent amounts per supplier). Wiring: Plan 2 local submissions, Plan 5 `expense_suggestion_data` | fixed in core; wiring in Plans 2 and 5 |
| L10 | `formatKg` (tare.ts) is undefined/wraps for negative `grams` | `netWeightGrams` already returns `null` for any negative result, so `formatKg` never receives one in practice; unreachable via the current call path | open |
| L11 | ΚΕΡΜΑΤΑ (`cash_extra` channel type) counts toward ΜΕΤΡΗΤΑ (`cash`) but is never in the counted till, so Φάκελος (fed by `cash`) can report a shortfall equal to the ΚΕΡΜΑΤΑ amount even when the till is exact | This is tameioV2's existing behaviour, reproduced intentionally for parity; revisit the ΚΕΡΜΑΤΑ/Φάκελος relationship once Plan 2's UI defines how it should be presented | open — V2 behaviour, revisit with the owner app (Plan 4) |
| L12 | Φάκελος shortfall subtitle wording (P1) | Now shows what goes in plus the target ("70,00€ σε 2 κομμάτια · στόχος 80,00€") instead of pairing the target with the actual piece count | fixed — Φάκελος subtitle in Plan 2 register UI |
| M5 | `validateConfig` did not detect duplicate tare product names (P2) | Rejects duplicate names since they'd get identical labels in Αποβάρα | fixed — duplicate tare product names check |
| M6 | Staff screen rows and rename handling (P3) | Rows keyed by name (an unfinished rename survived removing another row); empty renames are ignored; the ⋯ menu closes on Escape/outside tap | fixed — staff screen row keying and rename logic |
| L13 | Suggestion chips touch target size (P4) | Raised from system default to 44px for reliable tapping | fixed — suggestion chips 44px touch targets |

## Final-review fix wave (Plan 2)
Whole-branch review after all 14 Plan 2 tasks landed. Continues the severity scheme above.

| ID | Issue | Fix | Status |
|---|---|---|---|
| H6 | `saveSubmission` reported `'duplicate'` (treated as a successful save) for any id collision, even when the stored inputs differed — a closing that reused a stale/colliding draft id was silently discarded, losing data | Compares inputs: same id + same inputs → `'duplicate'` (idempotent retry); same id + different inputs → `'conflict'`, nothing written. `RegisterScreen` retries once under a fresh id on `'conflict'` | fixed — data-loss bug (F1) |
| M7 | Error hint text sat visually next to an invalid field but was never programmatically associated with it, so a screen reader announced "invalid" without saying why | `AmountField` takes `describedBy`; `CountCard`/`ChannelsCard`/`ExpensesCard` id their error hint and wire `aria-describedby` | fixed — a11y (F2) |
| M8 | `.field` `min-height` was 40px, below the 44px minimum touch target for a phone-first app | Raised to 44px | fixed — a11y (F3) |
| M9 | Sheets had no visible close control and never moved focus on open/close, stranding keyboard and screen-reader users | `Sheet` adds a ✕ "Κλείσιμο" button, focuses the dialog on mount, restores the previously focused element on unmount | fixed — a11y (F4) |
| L14 | Importing the unsplit `@fontsource/inter/{weight}.css` pulled in every unicode-range subset (cyrillic, vietnamese, etc.), bloating the font payload on a slow iOS connection during share | Import only the `greek-*`/`latin-*` subsets for weights 400/500/600/700 | partially fixed — fonts (F5); pre-rendering the share image itself was deferred (see below) |
| L15 | F5 also proposed pre-rendering the share image ahead of time to reduce iOS share fragility further | Deferred until a real-iPhone test shows Web Share / `html-to-image` actually failing there — no evidence yet it's needed | open — revisit after real-phone test |
| L16 | A tab left open overnight keeps a stale in-memory business date / draft: nothing re-checks "is this still today" or expires the draft while the app stays open (only `DRAFT_TTL_MS` on reload) | Needs a running-app staleness check, not just a load-time one | open — revisit in Plan 5 |
| L17 | `saveDraft` failures (e.g. storage quota) are silent — no UI notice, unlike `saveSubmission`'s explicit failed-save alert | Not yet designed | open — add a draft-save failure notice |
| L18 | `RegisterScreen.save()` treats any non-`'failed'` result as success, so if the retry after a `'conflict'` also hit `'conflict'` the form would reset and report "saved" with nothing stored | Needs two `crypto.randomUUID()` collisions in a row — negligible; tighten the guard to `saved \| duplicate` when Plan 5 moves saving to the server RPC | open — Plan 5 |

## Database findings (Plan 3 review)
Whole-branch review of Supabase schema, RLS policies, and RPCs for security. Continues the severity scheme above.

| ID | Issue | Fix | Status |
|---|---|---|---|
| M10 | Security tests for an anonymous session carrying an owner's id, and for a paired phone, only checked some tables — no assertion that other sensitive tables were empty | Widened so each asserts zero rows on shops, shop_configs, staff, devices and closings (supabase/tests/010) | fixed — table coverage in RLS tests |
| M11 | Internal helpers `private.is_anonymous` / `require_owner` / `check_config` / `check_pin` were callable by any signed-in user — unnecessary exposure (no side effects found) | Revoked (migration 20260929000002b); only `private.is_shop_owner` stays callable because row-level security policies need it | fixed — internal helper revoke |
| L19 | `set_staff_pin` gives the same `not_owner` answer for a non-existent and a foreign staff id — no way to probe ids, but the absence of a test left this susceptible to regression | Pinned by test T7b in supabase/tests/020; also T11 proves the helper revoke | fixed — no-existence-oracle test |
| H7 | `publish_config` with a null expected version skipped the version check (`v_current <> null` is null, never true), so it silently overwrote whatever version was current | Null now raises `version_conflict` (migration 20260929000005); test T3b in 020 | fixed — null version guard |
| M12 | `"schema":"1"` (a string) passed the config/inputs checks because `->>` reads both as the text `1` | `check_config`, `inputs_shape_ok` and the `shop_configs` CHECK compare `-> 'schema'` with `'1'::jsonb`; tests T2c (020) and T12 (040) | fixed — schema is a JSON number |
| L20 | `business_date` was unbounded, so a far-future closing would pin its suggestions forever | `submit_closing` returns `bad_inputs` outside [today−7, today+1]; `expense_suggestion_data` ignores dates after today+1; test T12 (040) | fixed — business-date bounds |
| L21 | Huge JSON bodies are parsed before the 64 KB size check | Needs an API-gateway body limit | open — Plan 5 |
| L22 | Dashboard "Exposed schemas" must be only `public`, `graphql_public` (never `private`) | Check in the dashboard before Plan 5 deploy | open — Plan 5 |
| L23 | Overlong shop/staff names fail with raw CHECK messages | Plan 4 UI validates 80 (shop) / 40 (staff) chars before calling | open — Plan 4 |
| L24 | The `unique_violation` handler in `create_staff` isn't scoped to the name constraint | Only one unique constraint can fire today; scope it if another is added | open |
| L25 | PIN hashes use bcrypt cost 8 | A 4-digit PIN is brute-forceable offline at any cost; the lockout is the real defence | open — accepted |
| L26 | Expired pairing codes are never deleted | Add a cleanup (cron or on create) | open |
| L27 | Lockout history isn't kept, so an owner can't see a slow brute force | Consider a `lockout_count` in Plan 5 | open — Plan 5 |
| L28 | A retry after the owner changed a staff member's PIN/active flag returns an error although the closing was stored | Plan 5 UX: treat as "maybe saved", show history check | open — Plan 5 |
| L29 | Protection of the read-only (GET RPC) path relies on `FOR UPDATE` in `check_staff_pin` (documented in the migration; no SQL test possible) | Plan 5: HTTP-level lockout test incl. GET and `Prefer: tx=rollback` | open — Plan 5 |

### Open decisions for Plan 4
- Shop rename: there is no update grant on `shops.name` — add one or an RPC.
- Unlock a staff member without changing the PIN (today only `set_staff_pin` clears a lockout).
- Telling "revoked" from "not paired" on the phone: a `device_status()` RPC, or document `verify_staff_pin(null, null)`.
- Device label in closing history: `closings.device_user_id` has no FK to `devices`.

## Tests
Vitest, `tests/` — all import real `src/core` functions:
money (incl. `centsToPlain` negatives), denominations, config (validation, cycles, defaults, JSON-shaped
unknown input, `isShopConfig`), formula (evaluation, stale inputs, invalid config, `validateClosingInputs`,
`ClosingInputsInvalidError`), presets (V2 parity, deep-freeze), envelope (greedy trap, shortfall, non-5c
targets, 20 000€ timing, NaN/negative/fractional counts, bounded search above MAX_UNITS), suggestions
(ranking, learning from submissions: grouping, recency, 30-amount cap, malformed entries, new shop empty),
tare, core purity (side-effect imports, `require()`, directory escape).
UI (jsdom + Testing Library): primitives, counting cards, expenses + learned suggestions, Φάκελος, Υποβολή/share, staff/date/menu/theme, Αποβάρα, coin calculator, end-to-end register flows (V2 parity, mode switch, blocking, thousands separator, submit once + reset + learning, storage failure, draft restore, corrupt draft, no-storage notice, navigation).
Database: supabase/tests 010–040 (RLS, owner functions, pairing/PIN lockout, submit/idempotency/suggestions) — run against the dev project, all passing.

CI (GitHub Actions: `npm ci` → typecheck → test on Node 22) ran green on GitHub for `b281da3` —
https://github.com/DGc0des/Tameio4All/actions/runs/36388814893
CI now runs the production build (`npm run build`) as well, after test.

## Not verified
- Plan 2 on a real phone: layout, Web Share with files (iOS Safari / Android Chrome), camera/gallery
  picker for the Z photo, html-to-image output quality, dark mode, safe-area insets.
- A full closing entered in both V2 and Tameio4All at the till, compared line by line.
- Vercel deploy URL (set up by the owner; see README).
- Production Supabase project not created yet; anonymous sign-ins not yet enabled in the dashboard
  (needed before Plan 4); migrations applied via the connector, so remote migration versions are
  timestamps chosen by Supabase, not the file names.
