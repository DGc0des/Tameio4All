# Tameio4All

Configurable, sellable version of tameioV2 (cash-register closing). Design:
`docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md`. Plans: `docs/superpowers/plans/`.

## Architecture
- `src/core/` — pure TypeScript money logic. No packages, no DOM, no Supabase. Every UI and
  report computes through these functions. Enforced by `tests/core-purity.test.ts`.
- (Plan 2+) `src/features/` UI, `src/data/` Supabase access (the one mutation path),
  `supabase/migrations/` schema + RLS + RPCs.

## Invariants
- Money is integer cents everywhere in core. Parse with `parseAmount`, show with `formatCents`.
- Totals are computed only by `evaluateTotals(config, inputs)`. Closings will store raw inputs +
  `config_id`, never totals (staff cannot fake a total; old closings keep their formulas).
- Shop configs are immutable versions; a new version is a new row.
- A config must pass `validateConfig` before use; `evaluateTotals` throws `ConfigInvalidError` otherwise.
- Envelope (Φάκελος) is computed only by `planEnvelope`, fed computed totals — never UI text.
- Staff/PINs are never part of `ShopConfig` (server-side table only).

## Conventions
- Code/comments English, UI Greek. Tests in `tests/`, importing real core functions.
- `npm test`, `npm run typecheck` must pass before every commit.

## DEV ONLY register
(none)
