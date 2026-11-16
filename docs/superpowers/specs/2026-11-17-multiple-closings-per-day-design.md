# Multiple closings per day — design (stage 5)

Date: 2026-11-17. Status: agreed in chat with the owner of the project; items marked **(my call)** were
decided by the author of this document and not discussed.

## Why

A shop that is open 24 hours closes the till at every shift change, 3 or 4 times a day. At the handover both
cashiers count together. Today the app allows exactly one closing per shop per business day
(`open_closings unique (shop_id, business_date)`), so such a shop cannot use it.

## What the owner chooses

Two settings per shop, in «Ρυθμίσεις»:

1. **Closings per day**: 1 to 6 (default 1). **(my call: the upper limit 6)**
2. **What happens to the cash at each closing** (only asked when the number is above 1):
   - `separate` — the cash leaves the till. Each closing starts from empty boxes with only the float in the
     drawer, and has its own count, expenses, card/delivery amounts and Φάκελος. The day's result is the
     **sum** of its closings.
   - `running` — the cash stays in the drawer. Each closing is a checkpoint of the day so far: the whole drawer
     is counted, card/delivery amounts are the day's totals so far, expenses keep adding up. The day's result
     is the **last** closing.

A shop with 1 closing per day behaves exactly as today.

## Model

- A business day has closings numbered 1..N (`closing_no`). They are numbered, not tied to clock times; the UI
  calls them «1ο κλείσιμο», «2ο κλείσιμο», ….
- Each closing is its own open closing (fields, revision, last submit) and its own version log in `closings`.
  Everything that today is keyed by (shop, business date) becomes keyed by (shop, business date, closing_no).
- **The live closing** of a shop is the highest-numbered closing of its business date. Phones and the owner's
  «Σήμερα» always show the live closing. Every other closing is frozen for the register and is changed only
  by an owner correction in «Ιστορικό».
- **Starting the next closing is an explicit action** by a signed-in cashier («Έναρξη 2ου κλεισίματος», with a
  confirmation), not automatic on Υποβολή. **(my call)** Reason: a cashier must still be able to fix a mistake
  and submit again; an automatic start would freeze the closing at the first Υποβολή.
  It is allowed only when the live closing is submitted and has not changed since, and its number is below the
  day's planned number.
- When the next closing starts:
  - `separate`: it starts empty.
  - `running`: the visible expense lines (with description, amount and author) are copied into it; count boxes
    and channel boxes start empty, because both must be read again at the checkpoint. **(my call)**
- **The day's plan is pinned when the day's first closing is created**: number of closings, cash mode and the
  config. Later closings of that day copy them. A settings change takes effect from the next day that starts.
  **(my call**, same rule as the day-change time and the config pin.)
- Fewer closings than planned is fine (history shows «2 από 3»). More than planned is not possible; the owner
  raises the number for the following days.
- A new business day always starts at closing 1, whatever happened yesterday.

## History

- Week view: one card per day as today. A day with a plan above 1 (or more than one closing) shows the day's
  result and «2 από 3 κλεισίματα».
- Day result: `running` → the totals of the highest-numbered submitted closing. `separate` → the sum per total
  of all submitted closings; shown only when every submitted closing is readable and they share one config,
  otherwise «—» (the closings themselves are still listed).
- Day screen: for a day with more than one closing, a day-result card and a selector «1ο · 2ο · 3ο»; the
  selected closing shows what a day shows today (versions, breakdown, Φάκελος, Διόρθωση, Επαναφορά).
- Corrections work per closing. The rule «today's versions come only from the live closing» applies to the
  live closing only; an earlier closing of today is corrected like a past day.
- Expense suggestions: a `running` day contributes only its last closing (its lines repeat in every
  checkpoint); a `separate` day contributes every closing.

## Non-goals

- No clock times or schedules for closings, no automatic start.
- The owner cannot start the next closing from «Σήμερα» (a cashier does it on the phone).
- No change to the formulas (`evaluateTotals`), the config schema or the Φάκελος logic. In `running` mode the
  Φάκελος sheet stays available at every checkpoint.
- No per-shift cashier assignment and no per-shift «what this shift took in» figure in `running` mode.

## Anti-goals

- An edit typed for one closing must never be written into another one.
- An existing shop (1 closing per day) must see no difference, and its stored history must read the same.
- No second write path: phones still write through `set_closing_field` / `submit_closing`, owners through
  `owner_set_closing_field` / `owner_save_closing`.

## Constraints

- Totals are never stored or computed in SQL; the day sum is computed in the pure history model from
  `evaluateTotals` results.
- Phone functions return `{ok:false,error}` for expected failures; owner functions raise or return as their
  neighbours do.
- The new function arguments default to closing 1, so a phone running an older build keeps working in a
  1-closing shop.
- The history payload shapes change: the migration and the client that reads them ship together.
- `maxExpenses` (0..30) stays per closing; in `running` mode it therefore limits the whole day.
