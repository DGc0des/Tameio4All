# Project Status

## Stages
- [x] Plan 1 — day zero + `src/core`
- [ ] Plan 2 — register UI on local preset
- [ ] Plan 3 — Supabase schema, RLS, RPCs
- [ ] Plan 4 — owner app + device pairing
- [ ] Plan 5 — closings, history, suggestions, PWA, deploy

## Issues carried over from tameioV2 (fixed by design; verify when the owning code lands)
| ID | Issue | Fix | Status |
|---|---|---|---|
| H1 | Greedy envelope reports shortfall when an exact combination exists (50 + 3×20 for 60€) | fixed in core (planEnvelope); UI wiring in Plan 2 | open |
| H2 | Envelope logic duplicated, reads totals back from DOM text | single `planEnvelope`, fed `evaluateTotals` | open |
| M1 | Reset clears date, leaves stale tare/Φάκελος state | Plan 2 | open |
| M2 | Φάκελος result stale after edits | Plan 2 | open |
| M3 | `"5-3"` read as 5; negatives accepted | fixed in core (parseAmount/sanitizeAmountInput); UI wiring in Plan 2 | open |
| L1 | Expense descriptions injected via innerHTML | React text rendering (Plan 2) | open |

## Tests
Vitest, `tests/` — all import real `src/core` functions:
money (incl. `centsToPlain` negatives), denominations, config (validation, cycles, defaults), formula (evaluation, stale inputs,
invalid config), presets (V2 parity), envelope (greedy trap, shortfall, non-5c targets, 20 000€
timing), suggestions, tare, core purity.

## Not verified
- Nothing runs in a browser yet; no UI exists.
- V2 parity figures are hand-computed from V2's formulas (V2 is DOM-bound and can't run headless).
- CI workflow is written but has not run: the repo has no GitHub remote yet.
- Core purity rule was widened: core imports must be relative and resolve inside `src/core` (recursive scan), not only `./`.
- Dev dependencies are on new majors (TypeScript 7, Vitest 5); Node 22.12+ required.
