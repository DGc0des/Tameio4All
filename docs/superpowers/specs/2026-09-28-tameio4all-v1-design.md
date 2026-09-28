# Tameio4All — design (v1: configurable core + accounts + closing history)

## Context

`tameioV2` (`~/Desktop/vs_code_projects/tameioV2`) is a vanilla-JS cash-closing tool in daily use at
Join Juice. Everything shop-specific is hardcoded: staff names (`index.html:22-25`), the 1000€ float
(`script.js:547`), WOLT/EFOOD/myPos/Eurobank IDs and formulas (`script.js:545-563`), the supplier
history (`expense-suggestions.js`), tare products (`apovara.js`). Closings only exist as a shared PNG.

Goal: turn it into a **product other shops can adopt and later pay for**. Agreed decisions:
- v1 = configurable closing core + owner accounts/shops + stored closing history. **Billing later.**
- Web app / installable PWA + Supabase.
- Calculation = **typed channels** with defaults, plus an owner-editable **+/− term formula builder**
  (no free-text expressions, no eval).
- Staff sign in on a **paired shop device with name + 4-digit PIN** (no staff emails).
- Extras in v1: expense suggestions (learned from the shop's own history), Αποβάρα, coin calculator,
  receipt/Z photo stored with the closing.
- Greek UI, EUR only, mobile-first. Not in v1: billing, expected-sales/Z difference, multi-currency,
  English UI, background offline sync queue.

Known V2 bugs fixed by design: H1 greedy envelope misses exact solutions, H2 duplicated envelope logic
reading totals back from DOM text, M1 reset wipes date / leaves stale state, M2 stale Φάκελος result,
M3 `"5-3"` and negatives accepted, L1 descriptions injected via innerHTML.

## Stack & repo layout (`~/Desktop/vs_code_projects/Tameio4All`, currently empty)

Vite + React + TypeScript (`strict`) + React Router + `vite-plugin-pwa`, Supabase (Auth, Postgres, RLS,
Storage, RPCs), Vitest. Static deploy (Vercel). No Next.js — there is no server code; all privileged
logic lives in Postgres RPCs.

```
src/core/        pure TS, no React/DOM/Supabase imports (lint-enforced) — all money logic
  money.ts         parse/format; integer cents everywhere
  denominations.ts EUR set, amount↔count, multiple-of validation
  config.ts        ShopConfig types, validate(), defaultTotals(channels), joinJuicePreset
  formula.ts       evaluate totals: resolve refs, topo-sort, cycle detection
  envelope.ts      exact bounded change-making (replaces greedy)
  suggestions.ts   port of exactExpenseMatch / suggestExpenseDescriptions
  tare.ts          port of netWeight
src/data/        Supabase client + typed queries/RPC wrappers (the one mutation path)
src/features/    register/, owner/, pairing/  (UI only; calls core + data)
supabase/migrations/  schema, RLS, RPCs;  supabase/tests/ RLS tests
```

## Core model (`src/core`)

**ShopConfig** (jsonb, versioned):
- `floatCents`, `denominations` (enabled subset of 500…0.05). Staff are NOT in the config — they live in the `staff` table (PINs must stay server-side)
- `channels: {id, label, type}` where type ∈ `card | delivery | noncash_other | cash_extra`
  (ΚΕΡΜΑΤΑ = `cash_extra`; WOLT = `delivery`; myPos = `card`)
- `totals: {id, label, terms: {sign: +1|-1, ref}[], showInSummary, showInShare}`
  with `ref` ∈ `counted | float | expenses | channel:<id> | type:<type> | total:<id>`
- `envelopeTotalId` (which total Φάκελος fills — default ΜΕΤΡΗΤΑ), `maxExpenses`, `tareItems`
- No supplier list in the config or the code (revised 2026-09-28): supplier names differ per shop,
  so expense suggestions are **learned from each shop's own submissions** (see below).

**Expense suggestions (learned):** `buildSupplierHistory(pastExpenses)` turns the expense lines of a
shop's submitted closings (`{description, cents, date}`) into per-supplier amount lists; the existing
`suggestExpenseDescriptions` / `exactExpenseMatch` rank from it. Spellings are grouped ignoring case,
accents, extra spaces and final sigma; the most recent spelling is shown; blank/zero lines are
skipped; each supplier keeps only its **30 most recent** amounts so old prices fade out. A new shop
starts with no suggestions. Every Υποβολή teaches: Plan 2 learns from the device's own submitted
closings (local), Plan 5 from `expense_suggestion_data` (all devices of the shop).

**Defaults from channel types** (`defaultTotals`): ΤΑΜΕΙΟ = counted + all channels + expenses;
ΜΕΤΡΗΤΑ = ΤΑΜΕΙΟ − float − expenses − card − delivery − noncash_other. Owner edits/adds totals
in the builder. `validate()` rejects unknown refs, cycles, missing envelope total.

**joinJuicePreset** reproduces V2 exactly (incl. ΜΕΤΡΗΤΑ LIM = ΜΕΤΡΗΤΑ + expenses,
ΕΣΟΔΑ LIM = ΜΕΤΡΗΤΑ + expenses + card) — used as the parity test and as the first real shop.

**Envelope**: bounded change-making over 5-cent units with a feasibility table, reconstructed
largest-denomination-first → exact whenever possible (60€ from 1×50 + 3×20 → 3×20); otherwise the
closest amount under target plus "Λείπουν". One function, used by both Φάκελος and Στέλνω, fed the
computed totals — never DOM text.

## Data & security (Supabase)

Tables (RLS on, default deny):
- `shops(id, owner_id → auth.uid, name)` — owner may have several (schema only; minimal UI)
- `shop_configs(id, shop_id, version, config jsonb)` — **insert-only, versioned**; published via
  RPC `publish_config(shop_id, expected_version, config)` (version guard → conflict error, no
  last-write-wins between two owner tabs)
- `staff(id, shop_id, name, pin_hash, active, failed_attempts, locked_until)` — `pin_hash`
  (pgcrypto bcrypt) never selectable by anyone; devices read a `staff_public` view (id, name)
- `devices(user_id pk, shop_id, label, revoked_at)` — the device is a Supabase **anonymous auth user**
- `pairing_codes(code_hash, shop_id, expires_at, used_at)` — 8-char code, 10-min expiry, single use
- `closings(id, shop_id, staff_id, device_user_id, config_id, business_date, inputs jsonb,
  idempotency_key, receipt_path, voided_at, created_at)` — unique `(shop_id, idempotency_key)`

RPCs (security definer, all identity from `auth.uid()`, never from payload):
- `redeem_pairing_code(code)` → binds current anon user to the shop
- `verify_staff_pin(staff_id, pin)` (UX) and `submit_closing(staff_id, pin, config_id, business_date,
  inputs, idempotency_key)` — re-verifies device→shop, staff active, PIN; 5 failures → 15-min lockout
- `expense_suggestion_data(shop_id)` → only (description, amount, business_date) triples from the
  shop's non-voided closings of the last 180 days, so a staff device never reads full closing
  history; fed to `buildSupplierHistory`

**Trust rule:** closings store **raw inputs only** (counts, expenses, channel amounts) + the exact
`config_id`. Totals are never stored; the owner's view recomputes them with `src/core`. Staff can't
fake a total, old closings keep the formulas they were made with, and the math lives in one language.

Owner: full access to own shops' rows; may set `voided_at` on a closing (closings otherwise immutable).
Storage: private bucket `receipts/{shop_id}/{closing_id}.jpg`; device may insert into its shop's
path only, owner may read. Client downsizes the photo before upload.

## Screens

- **Owner** (email auth): sign up → create shop → setup wizard (float, denominations, channels,
  staff + PINs, tare items) → formula builder (+/− terms, live preview with sample
  numbers) → pair device (show code) → history list (date range, staff, each summary total) →
  closing detail (same layout as Στέλνω + receipt + void).
- **Register device**: enter pairing code once → pick staff + PIN → V2 flow (amount/count modes,
  expenses with suggestions, channels, coin calculator, live totals, Φάκελος, Στέλνω) →
  **Υποβολή** (saves closing + receipt) → optional share image (html2canvas, as V2).
  Draft autosaved per shop in localStorage (V2 behaviour, 10h expiry); submit failure keeps the
  draft and shows retry; idempotency key makes retries/double taps safe. Reset clears inputs only
  (not date/staff), and any edit hides a stale Φάκελος.

## Build order (each ends working + tested)

0. Day zero: `git init`, `.gitignore`, `.env.example` (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`), strict TS, Vitest, CI (GitHub Actions: typecheck + test),
   `CLAUDE.md`, `PROJECT_STATUS.md`, `README.md`. Env vars registered in Vercel on day one.
1. `src/core` + tests (no UI).
2. Register UI running on local `joinJuicePreset` — V2 parity on a phone.
3. Supabase migrations: schema, RLS, RPCs, storage policies + RLS tests.
4. Owner auth, shop setup, formula builder, staff/PIN, device pairing.
5. Submit closings, receipt upload, history list/detail, suggestions from history.
6. PWA install/icons, global error boundary + offline/retry screen, deploy, real-device test at
   Join Juice alongside V2 for a few days.

## Verification

- **Unit (Vitest, importing `src/core`, never re-implementing it):** money parsing (commas, `"5-3"`,
  negatives rejected); denomination multiples in both modes; formula evaluation, unknown refs,
  cycles; `defaultTotals` per channel type; **V2 parity** — a table of real V2 inputs whose
  ΤΑΜΕΙΟ/ΜΕΤΡΗΤΑ/LIM figures must match V2's formulas to the cent; envelope (50+3×20 case, exact vs
  shortfall, zero/negative cash); suggestion ranking and exact-match ambiguity; tare edge cases.
- **Database:** run migrations on local Supabase (`supabase start`), then RLS tests: device can't
  read `pin_hash`, other shops, or closings; can't submit for another shop or with a wrong PIN;
  lockout triggers after 5 failures; duplicate idempotency key inserts once; stale
  `publish_config` is rejected. Run `get_advisors` on the hosted project after applying.
- **End-to-end on real hardware:** owner creates shop on desktop, pairs a phone over the deployed
  URL (not localhost), staff closes a till, owner sees the closing with matching totals and receipt.
  Compare several real closings against V2 side-by-side.
- `PROJECT_STATUS.md` records explicitly what is not covered (UI components untested; PL/pgSQL
  logic covered only by the SQL tests, not Vitest).

## Next step after approval

Write this as `docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md` in the repo (after
`git init`), you review it, then a step-by-step implementation plan (writing-plans) for the build order.
