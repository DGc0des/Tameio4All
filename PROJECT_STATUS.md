# Project Status

## Stages
- [x] Plan 1 — day zero + `src/core`
- [ ] Plan 2 — register UI on local preset (code complete; pending real-phone test + Vercel URL)
- [x] Plan 3 — Supabase schema, RLS, RPCs (dev project)
- [ ] Plan 4a — owner app: auth, shop, settings + formula builder, staff/PIN, pairing codes, devices (code complete; pending the manual end-to-end check on the dev project)
- [ ] Plan 4b / stage 1 — phone side (pair, server config + staff, PIN sign-in, server submit, business day, day-change setting; LOCAL_SHOP removed): code complete; pending the manual two-browser check (see Not verified)
- [ ] Stage 2 — live shared closing (open closing per day, per-field LWW writes, offline replay, realtime broadcast + presence, revision-checked submit, owner «Σήμερα» tab): code complete; SQL 010–090 pass on dev; pending the real-device checks (see Not verified)
- [ ] Plan 5 — closings, history, suggestions, PWA, deploy

## Product decisions
- 2026-11-07: Αποβάρα removed from the register (menu item, `#/tare` route, TareScreen). `tareItems`
  stays in `ShopConfig`, the owner settings section and `src/core/tare.ts`, but nothing on the phone
  uses it. Bring it back or remove the field fully later; removing it fully needs a `schema` bump.

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
| L23 | Overlong shop/staff names fail with raw CHECK messages | Plan 4 UI validates 80 (shop) / 40 (staff) chars before calling | fixed — owner app checks 80/40/60 before calling (limits.ts) |
| L24 | The `unique_violation` handler in `create_staff` isn't scoped to the name constraint | Only one unique constraint can fire today; scope it if another is added | open |
| L25 | PIN hashes use bcrypt cost 8 | A 4-digit PIN is brute-forceable offline at any cost; the lockout is the real defence | open — accepted |
| L26 | Expired pairing codes are never deleted | Add a cleanup (cron or on create) | fixed — create_pairing_code deletes the shop's expired/used codes (migration 20260929000006) |
| L27 | Lockout history isn't kept, so an owner can't see a slow brute force | Consider a `lockout_count` in Plan 5 | open — Plan 5 |
| L28 | A retry after the owner changed a staff member's PIN/active flag returns an error although the closing was stored | Plan 5 UX: treat as "maybe saved", show history check | open — Plan 5 |
| L29 | Protection of the read-only (GET RPC) path relies on `FOR UPDATE` in `check_staff_pin` (documented in the migration; no SQL test possible) | Plan 5: HTTP-level lockout test incl. GET and `Prefer: tx=rollback` | open — Plan 5 |

### Open decisions for Plan 4
- Shop rename: there is no update grant on `shops.name` — add one or an RPC. → done (grant + policy).
- Unlock a staff member without changing the PIN (today only `set_staff_pin` clears a lockout). → done (`unlock_staff`).
- Telling "revoked" from "not paired" on the phone: a `device_status()` RPC, or document `verify_staff_pin(null, null)`. → moved to Plan 4b.
- Device label in closing history: `closings.device_user_id` has no FK to `devices`. → moved to Plan 5.

## Stage 1 findings (phone sign-in + server submit)
Whole-stage review round by round (Tasks 1-8). Continues the severity scheme above. Fixed items keep their "why".

| ID | Issue | Fix | Status |
|---|---|---|---|
| H8 | `submit_closing` checked the business day before the idempotency key, so a retry whose first response was lost across the day change errored (`wrong_day`) on an already stored closing | Key lookup now runs before the day check (migration `20261107215127_submit_retry_before_day_check`); test T9 in 070 | fixed — but only a fresh same-device session re-sending the old key reaches it; the stage-1 client cannot (see L48) |
| H9 | After `signed_in` from offline, or after `wrong_day`/`session_invalid`, the gate kept a stale cached context (old business date, session `shopId` `''`) | One reload path: gate re-enters `loading` and re-runs `context()` when offline / date or shop mismatch / those server errors (also clears the stored session) | fixed |
| M13 | Register reused the idempotency key after a successful submit, so a deliberate resubmit would collapse into the old row | Key kept only for unacknowledged attempts; dropped after success | fixed |
| M14 | Dev project had migration `session_submit_inputs_fix` applied without a repo file (drift) | Repo file `20261107214213_session_submit_inputs_fix.sql` added with dev's exact version and name (idempotent create-or-replace); the idempotency fix ships as a separate later migration. Dev history versions are Supabase-chosen timestamps, not the plan's file names | fixed - note: replaying from the repo reproduces dev's history |
| L30 | Concurrent sign-ins of two staff on one phone could leave two live sessions | Lock the devices row before revoking in `staff_sign_in` | open |
| L31 | `set_day_change_time(null)` raises a raw not-null error instead of a named one | Add a named error + map it | open |
| L32 | No SQL test that phones cannot call `private.staff_session` | Add to 060 | open |
| L33 | Day-change time inside a DST gap/overlap resolves by Postgres default | Decide a rule if a shop picks 03:xx | open |
| L34 | Re-pairing a phone to another shop leaves old-shop sessions unrevoked (unusable, untested) | Revoke on re-pair + test | open |
| L35 | Owner-kind author with a non-uuid id relies on OR short-circuit before the uuid cast | Make the guard explicit | open |
| L36 | Schema-2 cents only checked as a number in SQL (not integer / non-negative) | Tighten SQL and keep the TS validator in step | open |
| L37 | No SQL tests for a deactivated-staff author or an owner author with an id | Add to 070 | open |
| L38 | Draft `isAuthor` accepts staff id `''` (validator needs non-empty), so `evaluateTotals` could throw on such a stored draft | Draft `isAuthor` now requires a non-empty staff id, the same rule as `validateClosingInputs` (a stored draft that breaks it is discarded on load); test in draft.test | fixed — final-review wave |
| L39 | `deriveClosing` does not guard expense id > 64 chars | Guard or cap id length | open |
| L40 | `submitBlockReason` keeps an unused `draft` param; old unauthored lines still block submit | Clean up signature; decide migration of old drafts | open |
| L41 | `suggestionData` `Number(cents)` may yield NaN on a malformed row | Rows whose cents is not a safe non-negative integer (NaN, null, `''`, fractional, negative, huge) are skipped in `device.ts`; test in deviceApi.test | fixed — final-review wave |
| L42 | Postgres 42501 not raised as `not_a_device_session` maps to `unknown`; PGRST/session-code branches of `mapDeviceError` and `getSupabase` memoisation untested | 42501 → `not_a_device` (device functions are granted to `authenticated` only, so an anon caller gets 42501); PGRST301/303 and session-code branches now tested | fixed except `getSupabase` memoisation (still untested) |
| L43 | Gate shows non-network `load_failed` as offline; `config_mismatch` is a gate no-op (manual reload needed); reload briefly shows «Φόρτωση…» and unmounts sign-in/register (drafts persisted) | load_failed distinguished (see H10). Still open: RELOAD on config_mismatch; the «Φόρτωση…» flash on reload | partly fixed |
| L44 | Revoked-phone test does not assert `clearCachedContext`; `phoneLocal` lacks a `clearCachedContext` test | Add assertions | open |
| L45 | Unconfigured screen shows env var names to cashiers; PairScreen owner-confirm persists if the code is edited | Hide names behind dev flag; reset confirm on edit | open |
| L46 | `CashierSheet` lives in `HeaderMenu.tsx`; dead fallback `?? newId()` in submit | Move / remove | open |
| L47 | Day-change settings screen: error test asserts only truthy text; load-error/retry and disabled-when-unchanged untested; loading state not a Card; `formKey` remount drops a typed time; import order | Add tests, polish | open |

## Final-review fix wave (stage 1)
Whole-branch review after all 8 stage-1 tasks. Continues the severity scheme above.

| ID | Issue | Fix | Status |
|---|---|---|---|
| H10 | A browser with no auth session but a cached context was stuck: owner signs in on the paired browser (unpairs it) then out; on reload `device_context` ran as anon → 42501 → `unknown` → the gate showed the previous cashier's register "offline", and «Αλλαγή ατόμου» could never reach pairing. A fresh browser hit the same path (→ «Δεν υπάρχει σύνδεση») | `PhoneApp` load calls `session()` first: `null` → `loaded ctx:null` → pairing, stored session + cached context cleared. 42501 → `not_a_device`. Only `network` falls back to the cache; any other failure is the new `load_error` gate (message + «Δοκίμασε ξανά», no cached register). Tests in gate/phoneApp/deviceErrors | fixed |
| H11 | An offline register never came back online: nothing re-ran `context()`, so Υποβολή stayed disabled until a manual page reload | Gate `retry` event moves offline states (and `load_error`) to `loading`, the one reload path. Triggered by the `online` event, the page becoming visible (only while offline), and a «Δοκίμασε ξανά» button on the «Εκτός σύνδεσης» banner. The register's draft is flushed as it unmounts (M15). Tests in gate/phoneApp | fixed |
| H12 | A day change silently deleted the typed, unsubmitted draft (`loadDraft` removed any draft of another date) | `loadDraft` moves it to a per-shop `unsent` key (latest only) and the register shows once «Η ημέρα άλλαξε πριν υποβληθεί το κλείσιμο της DD/MM. Ενημέρωσε τον ιδιοκτήτη.». A draft exactly as the server last acknowledged it (`markDraftSubmitted`) is dropped silently — otherwise every normal day (submit, keep the draft, next morning) would raise a false alarm. The owner cannot read the unsent draft yet (Plan 5). Tests in local/app | fixed |
| M15 | `useDraftAutosave` dropped the pending 300 ms save when the register unmounted (sign-out is covered by `persistDraft`, but a gate reload or unpair was not) | The hook flushes a pending save on unmount; test in useDraftAutosave.test | fixed |
| L48 | CLAUDE.md claimed the repeat-before-`wrong_day` path (H8) covers a retry lost across the day change; the stage-1 client cannot reach it — its previous-day token is `session_invalid` first, and the key is forgotten with the register. 070 T9 actually simulates a fresh same-device session re-sending yesterday's key | Doc-only: CLAUDE.md and the T9 comment corrected, no SQL change. User-visible mitigation: the H12 notice (the closing is kept aside and the cashier tells the owner) | open — accepted for stage 1; revisit with Plan 5 history/owner edits |

## Residual fixes (stage 1, after the final-review wave)

| ID | Issue | Fix | Status |
|---|---|---|---|
| H13 | An offline paired phone whose stored access token had expired was unpaired and its caches wiped: auth-js `getSession` refreshes an expired token first and, when the refresh fails (offline), returns `{session:null, error}` while the refresh token stays stored; `device.ts` read only `data`, so `PhoneApp` took it as "no auth session" → `loaded ctx:null` → pairing, stored staff session + cached context cleared. Next morning, offline, the cashier lost the register | `DeviceApi.session()` now returns `DResult<{anonymous} \| null>`: `ok` + `null` only when getSession succeeded with no session; a returned or thrown error is a failure ("couldn't tell", mapped by `mapDeviceError`). `PhoneApp` load unpairs only on definite no-session; a failed lookup falls through to `context()` (offline → cached register). `pair` returns the lookup error instead of signing in anonymously over a session it could not identify (could be an owner's). Tests in deviceApi/phoneApp | fixed |
| L49 | An empty, never-typed draft left over from the previous day raised the day-change notice («Η ημέρα άλλαξε…») — a false alarm every morning a register was opened and not used | `loadDraft` drops silently a stale draft whose entries, channels and expense fields are all empty/whitespace (it also does not replace an already kept-aside draft). Test in local.test | fixed |

## Stage 2 findings (live shared closing)
Whole-stage review task by task (Tasks 1-8) plus the Task 9 verification run. Continues the severity scheme above. Fixed items keep their "why".

| ID | Issue | Fix | Status |
|---|---|---|---|
| H14 | `closing_field_ok` treated a NULL predicate as valid and accepted extra properties, so a crafted value could bypass the expense cap and store arbitrary JSON | Strict exact-key-set check that never returns NULL (migration `20261108000001b_open_closing_validation`); T4b in 080 | fixed |
| H15 | Clients could insert any row into `realtime.messages` for their shop topic, so a phone could forge a `field`/`submitted` broadcast | Insert policy restricted to `extension = 'presence'`; field/submitted broadcasts only come from `realtime.send` inside the definer functions (R7) | fixed — exercised on dev in 080 once partitions existed (see M16) |
| H16 | Un-removing an expense line skipped the `maxExpenses` check (inverted condition), so the cap could be exceeded | Fixed in `20261108000001c_open_closing_unremove_cap`; T5/T7 un-remove cases in 080 | fixed |
| H17 | Any owner-added expense line blocked every phone submit (`bad_inputs`: the stage-1 rule allowed only staff authors) | `submit_closing` accepts an expense `addedBy` equal to the stored author of its `e:<id>` field (owner or staff); migration `20261108000002b_live_submit_owner_lines`; T9 in 090 (R10) | fixed |
| H18 | A persisted pending edit with `baseVersion = null` replayed after a remount skipped the stale check and silently overwrote a newer value | Persisted null-base items get a base from the reloaded snapshot before replay | fixed |
| H19 | `openShopChannel` reused a dying same-topic channel on close→reopen (StrictMode), then hung or left the channel offline | Wait for the old channel to leave (3 s give-up, then retire it); one live channel per shop is a documented caller rule | fixed |
| H20 | A halted engine (error the gate ignores) left the cashier stuck with no retry and a misleading «Χρειάζεται σύνδεση» | `restart()` on `useLiveClosing`; accurate reason text; presence pill a11y | fixed |
| M16 | Realtime broadcast and the presence-only insert policy were never exercised against a real Realtime project: on dev the 080/090 broadcast and policy blocks were SKIPPED (no `realtime.messages` partitions). Partitions now exist (5 daily partitions, 2026-11-09…13) and 080/090 ran them for real on 2026-11-10 (message counts, payloads, forged-broadcast refused, presence accepted). A real WebSocket client subscribing to the private channel has still never run | Needs the real-device check below. Partitions are created and expired (3 days) by the Realtime service; if the service is idle for days `realtime.send` only logs a WARNING and a skipped-on-partition run would hide it | open |
| M17 | Pending-edit queue, snapshot and entry mode are shared between owner and phone in one browser (same `openClosing` keys per shop) | Acceptable (same shop, same day); documented in CLAUDE.md. Revisit if one browser is used for both roles often | open |
| M18 | `d:`/`c:` keys are not checked against the pinned config server-side, and removed expense lines are unbounded, so a hostile cashier could grow the snapshot | Bound field count / check against config in a later migration | open |
| M19 | `(config->>'maxExpenses')::int` can raise on a bad config; `open_closing_for` on a shop with no config raises a not-null error instead of `{ok:false}` | Guard both; configs are validated on publish so this needs a hand-edited row | open |
| L50 | Network retry in the sync engine is a fixed 3 s with no backoff | Add backoff + jitter | open |
| L51 | The submit revision proves the client saw the latest fields, not that `p_inputs` equals the merged fields (same trust as stage 1) | Server could recompute inputs from the fields; deferred | open |
| L52 | Owner Greek error message is carried in `DeviceError.unknown.detail` and `TodayScreen` shows `detail` raw; toast/banner/retry logic is duplicated in `TodayScreen` instead of a shared hook | Typed owner error code; extract a hook | open |
| L53 | SQL tests: 090 T5 `(r->>'repeat')::boolean` NULL-skips if `repeat` is missing; no test that refused `draft_changed`/`config_mismatch` leaves `last_submit` untouched; no stale test on a not-yet-existing key; the anon check runs as postgres with an anon JWT; 090 T9 variable `nikos_a` holds Ελένη's id; no `num_nonnulls(updated_by_staff, updated_by_owner) = 1` check | Tighten when the tests are next touched | open |
| L54 | Same-key retry of an owner-line submit after the day changed returns `bad_inputs` instead of `repeat` (the author check runs before the new day's closing has the line). The client never re-sends an old-day key (its token is `session_invalid` first) | Move the key lookup before the author check | open |
| L55 | `applyServerField` ignoring an older field does not advance the local revision (heals through `draft_changed`); `isExpenseMeta` is stricter than SQL on `addedBy`; `loadSnapshot` accepts `config: null` (validated elsewhere) | Align the guards | open |
| L56 | Edits typed between `wrong_day` and the resync are tagged with the old date and dropped with the offline notice; `SubmitSheet` follow mode enables the button before the `draft_changed` resync lands (self-healing extra `draft_changed`); no `connecting` state between a channel error and rejoin | UI polish | open |
| L57 | The spin guard in `openShopChannel` (3 own removals) falls back to reusing a registered channel — only after 3 server leave errors or a contract violation | Accept | open |
| L58 | Stage-1 local keys `draft`, `draft-submitted`, `unsent` linger on devices (nothing reads them) | Optional one-time cleanup | open |
| L59 | An old-day draft that stage 1 kept aside under `unsent` is no longer surfaced; the stranded text stays in storage only (R14) | Accepted: the live closing replaced it | open |
| L60 | The owner Today view has no suggestion history (empty suggestions) | Fetch an owner-side history later | open |

## Tests
Vitest, `tests/` — all import real `src/core` functions:
money (incl. `centsToPlain` negatives), denominations, config (validation, cycles, defaults, JSON-shaped
unknown input, `isShopConfig`), formula (evaluation, stale inputs, invalid config, `validateClosingInputs`,
`ClosingInputsInvalidError`), presets (V2 parity, deep-freeze), envelope (greedy trap, shortfall, non-5c
targets, 20 000€ timing, NaN/negative/fractional counts, bounded search above MAX_UNITS), suggestions
(ranking, learning from submissions: grouping, recency, 30-amount cap, malformed entries, new shop empty),
tare, core purity (side-effect imports, `require()`, directory escape).
UI (jsdom + Testing Library): primitives, counting cards, expenses + learned suggestions, Φάκελος, Υποβολή/share, staff/date/menu/theme, Αποβάρα, coin calculator, end-to-end register flows (V2 parity, mode switch, blocking, thousands separator, submit once + reset + learning, storage failure, draft restore, corrupt draft, no-storage notice, navigation), owner area wiring (menu entry, lazy load, email-link redirect to #/owner).
Owner model — pure, no supabase-js loaded (`tests/app/ownerRouter.test.ts`, `tests/data/ownerApi.test.ts`, `tests/data/ownerLocal.test.ts`, `tests/data/remoteErrors.test.ts`, `tests/features/owner/{model,messages,preview,settingsDraft}.test.ts`): settings reducer, terms, preview, limits, pairing, messages, `mapError`, owner API parameter names, owner drafts, auth storage.
Owner UI (`tests/features/owner/*.test.tsx`, jsdom + Testing Library against `fakeApi.ts`, never loads supabase-js): auth + link errors, shops, new shop, settings publish/conflict/draft, formula builder + preview, staff, devices + pairing countdown.
Database: supabase/tests 010–090 (RLS, owner functions, pairing/PIN lockout, submit/idempotency/suggestions, owner app, staff sessions + business date + day change, session submit + schema 2, open closing (per-field LWW/stale, strict shapes, expense authors + cap, owner variants, realtime topic authorization incl. revoked phone/deactivated cashier, no direct table access), live submit (revision check, pinned config, `last_submit`, owner-authored lines)) — all nine run whole against the dev project on 2026-11-10 after the stage-2 migrations, all passing (each ends in ROLLBACK). On that run `realtime.messages` had daily partitions, so the 080 T2/I2 and 090 T8 broadcast/policy blocks executed instead of skipping (they raise a NOTICE and skip when no partition exists). `list_migrations` shows all five stage-2 migrations applied on dev.
Live closing (pure, no supabase-js): `tests/features/register/live/*` (field model + key regex, merge, sync engine: queue/replay/stale/wrong_day/halt/restart), `tests/data/liveRemote.test.ts` (shape-checked parsers, channel wrapper against a stub), `tests/data/openClosing.test.ts` (local storage), register + owner «Σήμερα» flows against fakes.
Phone: gate reducer, phone local storage, DeviceApi mapping, sign-in/pair screens, register submit flow, owner day-change screen (`tests/features/phone/*`, `tests/data/*`, `tests/features/owner/*`) — `npm test` 580/580 on 53 files, `npm run typecheck` clean, `npm run build` ok (2026-11-10, stage-2 branch `stage-2-live-closing`). A run overlapping a sleeping machine once showed 21 timeout failures; re-run, 580/580 in 3.3 s of test time.

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
- Plan 4a's manual end-to-end check (Task 14 Step 5) has not been run: Supabase dashboard redirect
  setup (Site URL, redirect URL allow-list, Confirm email), sign-up/confirm/reset email links
  including the same-browser PKCE rule, building out the Join Juice shop (float, channels, ΜΕΤΡΗΤΑ/
  ΕΣΟΔΑ totals, preview vs V2 numbers, publish, staff + PINs, pairing code), and the two-tab publish
  conflict dialog. Needs the human owner against the dev project (`fstfuhogvsdaiwpfdmep`).
- Owner UI on a real phone.
- The anonymous-session (paired phone) warning on owner sign-in, against a real paired phone — Plan 4b.
- Supabase free-tier auth email rate limits under real use.
- Stage 1 (phone sign-in + server submit) end-to-end in a real browser pair, NOT run. Needs the user:
  1. Supabase dashboard (project `fstfuhogvsdaiwpfdmep`) -> Authentication -> Providers (Sign In / Providers) -> enable **Anonymous sign-ins**. Not done by the agent; without it pairing fails.
  2. `npm run dev`. Browser profile 1: sign in as owner at `#/owner`, create/open the shop, add staff ΜΑΡΙΑ with a PIN, create a pairing code.
  3. Browser profile 2 (a clean profile, no owner session): open the app, enter the code, sign in as ΜΑΡΙΑ with the PIN, fill a closing, submit.
  4. In the SQL editor: `select inputs, business_date, staff_id from public.closings order by created_at desc limit 2;` -> inputs has `schema: 2` and each expense has `id` and `addedBy {kind:'staff', id}`.
  5. Submit again (reopen the submit sheet) -> a second row exists.
  6. Sign out on the phone -> only the sign-in screen is shown (no register fields). Also check a wrong PIN x5 locks the cashier.
  7. Owner settings: set the day-change time -> the screen shows «Ισχύει από» (the first day it applies); the phone's next load keeps today's date until then.
  8. Live PostgREST error codes (`invalid_code`, `not_a_device_session`, 42501 for a browser without an auth session) as mapped by `mapDeviceError` were never seen against the real API.
  9. Shared browser: on the paired browser (profile 2), sign in as owner at `#/owner` (confirm the unpairing warning), then sign out; reload the app -> the pairing screen (not the old cashier's register, not «Εκτός σύνδεσης»).
  10. Offline return: with the register open, go offline (devtools) and reload -> «Εκτός σύνδεσης», Υποβολή disabled; go online -> the banner disappears without a manual reload and Υποβολή works.
  11. H13 against real auth-js: a paired phone left closed past its access-token expiry (~1 h), opened in airplane mode -> the cached register with «Εκτός σύνδεσης», not the pairing screen; back online -> live register. Only covered by fakes/stubs so far.
- Stage 1 on real phones: iOS Safari / Android Chrome pairing and sign-in, offline cached context on a real device, the sign-in screen with the on-screen keyboard.
- Stage 1 SQL tests were pasted into `execute_sql` with comment lines stripped (content otherwise identical); they ran as the connector's role, as the README describes.
- Stage 2 (live shared closing), NOT run on real devices. Needs the user:
  1. Supabase dashboard (project `fstfuhogvsdaiwpfdmep`) -> Realtime -> Settings: confirm Realtime is enabled and that **Allow public access** is off (the channel is private; off is fine) — nothing was changed by the agent. Authorization is on by default; the policies on `realtime.messages` are in the stage-2 migrations. Partitions exist on dev (created by the Realtime service); no dashboard toggle is needed for them.
  2. Two real phones (two paired devices, two cashiers) plus the owner browser on «Σήμερα»: type into the same box at the same time — last write wins, the other phone/owner sees the value arrive, the presence pills show who is on.
  3. Airplane-mode edit and reconnect: type on a phone offline, restore the network -> the edit lands once (queue replay); type the same box on another device meanwhile -> `stale` adopts the server value.
  4. Private-channel auth for an anonymous phone session: a paired phone with a signed-in cashier subscribes to `shop:<id>` (join must succeed); after sign-out / device revocation it must lose the channel. Only the SQL helper (`can_use_shop_topic`) and the policies were exercised, never a real WebSocket join.
  5. Presence on dev: tags appear and disappear on join/leave (the insert policy allows only `presence`; if Realtime needs another `extension` value for presence the tags break — R7).
  6. Cheap Android phone: `backdrop-filter` blur + realtime updates while typing (jank, battery), and the on-screen keyboard.
  7. Submit from two phones around the same time: the second gets `draft_changed`, reviews, resubmits; `last_submit` and the `submitted` broadcast show on the other devices.
  8. A new shop day while a phone is open: edits of the old day are dropped with the notice, the register reloads onto the new day.
- Realtime partitions are created by the Realtime service, not by us: if it is idle for days (free tier), `realtime.send` would only WARN and broadcasts would silently stop until traffic recreates them. Not observed; re-check with the 080 skip NOTICE (`select count(*) from pg_inherits where inhparent = 'realtime.messages'::regclass`).
