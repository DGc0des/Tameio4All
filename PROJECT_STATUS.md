# Project Status

## Stages
- [ ] Plan 1 — day zero + `src/core`
- [ ] Plan 2 — register UI on local preset
- [ ] Plan 3 — Supabase schema, RLS, RPCs
- [ ] Plan 4 — owner app + device pairing
- [ ] Plan 5 — closings, history, suggestions, PWA, deploy

## Issues carried over from tameioV2 (fixed by design; verify when the owning code lands)
| ID | Issue | Fix | Status |
|---|---|---|---|
| H1 | Greedy envelope reports shortfall when an exact combination exists (50 + 3×20 for 60€) | `planEnvelope` bounded change-making | open |
| H2 | Envelope logic duplicated, reads totals back from DOM text | single `planEnvelope`, fed `evaluateTotals` | open |
| M1 | Reset clears date, leaves stale tare/Φάκελος state | Plan 2 | open |
| M2 | Φάκελος result stale after edits | Plan 2 | open |
| M3 | `"5-3"` read as 5; negatives accepted | `parseAmount` / `sanitizeAmountInput` | open |
| L1 | Expense descriptions injected via innerHTML | React text rendering (Plan 2) | open |

## Tests
(filled as modules land)

## Not verified
- Nothing runs in a browser yet.
