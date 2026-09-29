# Tameio4All

Configurable, sellable version of tameioV2 (cash-register closing). Design:
`docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md`. Plans: `docs/superpowers/plans/`.

## Architecture
- `src/core/` — pure TypeScript money logic. No packages, no DOM, no Supabase. Every UI and
  report computes through these functions. The purity rule is enforced by
  `tests/core-purity.test.ts` (a Vitest check, not a linter).
- `src/features/register/draft.ts` + `derive.ts` — the register's pure model: the draft holds raw
  typed text; `deriveClosing(config, draft)` is the only bridge from text to money.
- `src/data/local/` — the only code that touches localStorage (drafts, submissions, staff, theme).
  Every call is failure-safe; `pickStore()` falls back to memory when storage is unavailable.
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
- Cross-file invariant: the closing `inputs` shape is defined by `ClosingInputs` (src/core) AND
  checked by `private.inputs_shape_ok` (SQL). Bumping `schema` or changing the shape needs a new
  migration updating that check, or phones' submissions will be refused as `bad_inputs`.
- `verify_staff_pin` / `submit_closing` return `{ok:false,error}` for expected failures — never raise
  there (a raise rolls back the PIN lockout counter).
- Owner functions report "not yours" and "doesn't exist" the same way (`not_owner`), so ids can't be
  probed; there is no `staff_not_found` error from owner functions (only phone functions return
  `staff_not_found`).
- Internal `private.*` helpers are not callable by clients, except `private.is_shop_owner` (row-level
  security policies need it).
- A revoked phone stays revoked until an owner gives it a fresh pairing code; redeeming one re-pairs it
  (possibly to another shop). That's intended.
- A non-UUID id sent to any function fails with a Postgres type error before the function runs (nothing
  is changed).

## Conventions
- Code/comments English, UI Greek. Tests in `tests/`, importing real core functions.
- `npm test`, `npm run typecheck` must pass before every commit.

## DEV ONLY register
| What | Where | Remove when |
|---|---|---|
| `LOCAL_SHOP` — Join Juice preset as the only shop | `src/app/shop.ts` | Plan 4 (owner setup) |
| Device-local staff list + Προσωπικό screen | `src/data/local/staff.ts`, `src/features/staff/StaffScreen.tsx` | Plan 4 (server staff + PIN) |
