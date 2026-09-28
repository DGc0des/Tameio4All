# Tameio4All Plan 2 — Register UI (local) — design

Parent spec: `2026-09-28-tameio4all-v1-design.md` (build order step 2: "Register UI running on local
`joinJuicePreset` — V2 parity on a phone"). This document fixes the decisions that spec left open.

## Goal

The screen staff use at the till: count the cash, log expenses and other income, see the totals,
get the Φάκελος breakdown, **submit** the closing, and share a summary image — on a phone, deployed
to a live URL. No server yet: the shop config is the Join Juice preset and everything is stored on
the device. Built only on the tested `src/core`; no money logic in the UI.

## Decisions (agreed 2026-09-28)

- **Fresh design, not V2's look.** Direction chosen in the visual companion: *soft cards* layout with
  *paper-and-ink* colours, then cleaned up (no dividers/borders/type tags, sentence-case headings,
  one filled button, light bottom bar).
- **Staff names:** an editable list stored on the device (DEV ONLY; replaced by server staff + PIN in
  Plan 4). No names in code.
- **Deploy:** static build on Vercel from GitHub; Plan 2 ends with a live URL tested on a real phone.
- **€ / # mode:** a full-width segmented control under the title ("€ Ποσό | # Κομμάτια"), applying
  to notes and coins. In **€ mode** the field shows only the typed amount (no piece count beside it).
  In **# mode** a small grey euro value is shown beside each count. Switching converts typed values
  (`convertEntry`).

## Screens

**Register (main, single scrolling page)**
1. Header: title "Κλείσιμο ταμείου"; line below: date · staff name — tapping opens a bottom sheet to
   pick the staff member and the business date. A `⋯` menu (top right): Αποβάρα, Προσωπικό, Θέμα
   (light/dark/system).
2. Mode switch (€ Ποσό | # Κομμάτια).
3. Card "Χαρτονομίσματα" (total in header) — one row per enabled note: label, input.
4. Card "Κέρματα" — same for coins.
5. Card "Έξοδα" (total in header) — rows of *description + amount*, added with "+ Έξοδο" up to
   `config.maxExpenses`, removable. Suggestion chips appear under a row's amount while its
   description is empty; tapping a chip fills it; leaving the amount field auto-fills when exactly
   one supplier matches (`exactExpenseMatch`) — V2 behaviour.
6. Card "Άλλα ποσά" — one row per config channel (label + amount). `cash_extra` channels get a 🧮
   button opening the **coin calculator** sheet (sum several batches → writes the channel amount).
7. Card "Σύνοψη" — ΤΑΜΕΙΟ and the envelope total (ΜΕΤΡΗΤΑ) prominent; every other total with
   `showInSummary` under "Περισσότερα ▾".
8. **Bottom bar (always visible):** envelope-total label + amount, text button **Φάκελος**, filled
   button **Υποβολή**.

**Φάκελος sheet:** "Φάκελος", "<amount> σε N κομμάτια", plain list `100€ × 3`…, status line
("✓ Ακριβές ποσό" green, or "Λείπουν X€" amber), "Τι μένει στο ταμείο ▸" expands remaining counts.
Any edit to the form closes the sheet (fixes V2 M2 — can't go stale). Zero/negative cash → "Δεν
υπάρχουν μετρητά για φάκελο".

**Υποβολή sheet:** read-only summary (staff, date, totals with `showInShare`, each expense, non-zero
channels, notes/coins left after the envelope, cash_extra amount) = the **share card**; optional
Z photo — "Φωτογραφία Ζ" button opens the camera or gallery (`<input type=file accept=image/* capture>`); the photo is attached to the share only and never stored; buttons **Υποβολή** (save) and, after saving, **Κοινοποίηση**
(share image + photo via Web Share API, download fallback). After a successful save the form resets
(inputs only — staff and date kept, fixes V2 M1) and a toast confirms.

**Αποβάρα:** list of `config.tareItems`, each with its own weight input and net result
(`netWeightGrams`/`formatKg`). Hidden from the menu when the config has no tare items.

**Προσωπικό (DEV ONLY):** add / rename / remove staff names on this device.

**Blocking rules:** Φάκελος and Υποβολή are disabled-with-reason while any field is invalid; the
reason lists the fields ("Λάθος τιμή: 10€, WOLT"). A staff member must be picked before Υποβολή.

## Visual tokens

Font: Inter (self-hosted via `@fontsource/inter`, Greek subset, tabular numbers). Radius: cards 20,
fields 10, buttons 12, sheets 24 (top). Spacing base 4.

| Token | Light | Dark |
|---|---|---|
| `--bg` | #F4F1EA | #151412 |
| `--surface` | #FFFDF9 | #1F1D1A |
| `--field` | #F4F1EA | #2A2723 |
| `--ink` | #1D1B17 | #F1EDE4 |
| `--muted` | #8A8376 | #9B9486 |
| `--faint` | #B0A99B | #6E685E |
| `--line` | #E9E3D6 | #2E2B26 |
| `--accent` | #2F6B4F | #6FBF95 |
| `--accent-ink` | #FFFFFF | #0F1A14 |
| `--accent-soft` | #EDF3EF | #1D2A23 |
| `--danger` | #B3261E | #F2877F |
| `--danger-soft` | #FBECEA | #3A1F1D |
| `--warn` | #9A6200 | #E6B566 |

Amounts display in Greek format (`1.855,20€`) via a new core `formatEuro(cents)`; inputs accept
comma or dot (`sanitizeAmountInput`). Touch targets ≥ 44px; visible focus rings; `inputmode`
decimal/numeric; respects `prefers-reduced-motion`.

## Architecture

```
src/core/                     (Plan 1, pure) + formatEuro
src/app/                      App shell, hash routes, theme, error boundary, local shop
  shop.ts                     LOCAL_SHOP = { id: 'local', name, config: joinJuicePreset }  (DEV ONLY)
src/data/local/               the ONE place that touches localStorage
  storage.ts                  safe get/set JSON (try/catch, never throws)
  drafts.ts, submissions.ts, staff.ts, prefs.ts
src/features/register/        draft model + UI
  draft.ts                    pure: Draft type, reducer, actions (no React)
  derive.ts                   pure: deriveClosing(config, draft) → inputs, fieldErrors, totals, envelope
  components…                 cards, rows, sheets, bottom bar
src/features/tare/, src/features/staff/
tests/                        core tests (Plan 1) + tests for draft/derive/data + UI integration (jsdom)
```

- **Draft** holds raw typed text (`entries`, `channels`, `expenses[{id, description, amountText}]`),
  `mode`, `staffName`, `businessDate` (YYYY-MM-DD), and `id` (UUID created when the draft starts).
  `deriveClosing` is the only bridge from text to money: it uses `entryToCount`/`parseAmount`, marks
  invalid fields, builds `ClosingInputs` from the valid ones, then calls `evaluateTotals` and
  `planEnvelope`. UI never parses or adds money itself.
- **Persistence:** draft autosaved (debounced 300 ms, and on `pagehide`), expires after 10 h (V2).
  Keys are namespaced `tameio4all:v1:<shopId>:…`. Storage failures (private mode, quota) never break
  the form — it keeps working in memory and shows a one-time notice.
- **Submission record:** `{ id: draft.id, shopId, staffName, businessDate, submittedAt, inputs }`.
  Saving is idempotent by `id` (double-tap/retry stores once). The Z photo is never stored — not on
  the device, not on the server; it only rides along with the share.
- **Suggestions learn from submissions:** history = every stored submission's expenses as
  `{description, cents, date: businessDate}` → `buildSupplierHistory`.
- **Share image:** the Υποβολή sheet's summary card rendered to PNG with `html-to-image`.
- **Routing:** tiny hash router (`#/`, `#/tare`, `#/staff`) — no router dependency.
- **Error boundary** around the app with a Greek "κάτι πήγε στραβά — ανανέωση" screen; the draft
  survives because it is already saved.

## Testing

- Pure (Vitest, node): `draft.ts` reducer, `derive.ts` (V2 parity through the UI path, invalid
  fields excluded and reported, mode conversion), local data modules (with an in-memory storage),
  `formatEuro`.
- UI integration (Vitest + jsdom + Testing Library), a handful of flows: type amounts → totals;
  switch €/# converts; invalid field blocks Φάκελος/Υποβολή with reason; Φάκελος exact for the
  50 + 3×20 case; Υποβολή saves once and resets inputs but keeps staff/date; a later expense row
  offers a chip learned from the previous submission.
- Real device: deployed URL on a phone at the till, full closing compared with V2 side by side.
- Not covered by automated tests: visual layout, Web Share on real devices, html-to-image output.

## Out of scope (later plans)

Server, auth, pairing, PIN (Plans 3–4); owner history, cross-device suggestions,
PWA install/offline (Plan 5); configurable shop setup UI (Plan 4).

## DEV ONLY items introduced

- `src/app/shop.ts` LOCAL_SHOP (Join Juice preset as the only shop) — remove in Plan 4.
- Προσωπικό screen / local staff list — remove in Plan 4 (server staff + PIN).
