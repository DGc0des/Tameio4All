# Legal findings — 2026-11-14

Code-based review of the repository for potential legal issues. **This is not legal advice.** The IP and
contract items (LG4, LG3, LG6) need a Greek lawyer before the first paying shop.

**Verdict: fine as a private dev project, not ready to sell.** The code handles security well, but almost
all the legal scaffolding around a SaaS that stores other businesses' staff data is missing.

IDs use the prefix `LG` so they do not collide with the C/H/M/L ids in `PROJECT_STATUS.md`.

## Findings

| ID | Sev | Issue | Evidence | What to do | Status |
|---|---|---|---|---|---|
| LG1 | **H** | No privacy notice, terms of use or provider identity anywhere | Signup (`src/features/owner/AuthScreens.tsx`) takes email + password with no notice or link; no legal pages in the repo | Add a privacy notice (GDPR Art. 13), B2B terms and provider details (name, address, contact, VAT number), linked from signup and the phone entry screen | open |
| LG2 | **H** | No way to delete anything | No function to delete an account, shop, staff member or closing; staff can only be deactivated; `closings.staff_id` references `staff` without cascade, so a cashier who ever submitted cannot be removed; anonymous device users are never deleted (L81 in `PROJECT_STATUS.md`, open) | Add account/shop deletion, staff erasure (anonymise the name, keep the row) and a retention period for old closings (GDPR Art. 5(1)(e), Art. 17) | open |
| LG3 | **H** | No data processing agreements | We are a processor for each shop (cashier names, who typed what, device last use, expense text); Supabase and Vercel are our sub-processors | Sign a DPA with each shop (GDPR Art. 28), accept the Supabase and Vercel DPAs, list them in the privacy notice | open |
| LG4 | **H** | Ownership of the original tool is undocumented | The v1 spec says tameioV2 is "in daily use at Join Juice"; `src/core/presets.ts` "reproduces tameioV2 exactly" | If V2 was built as an employee or on the employer's instructions, Greek copyright law (Law 2121/1993, Art. 40) gives the employer the economic rights by default. Get a short written confirmation that the rights are the author's | open |
| LG5 | **M** | Employee monitoring | Per-cashier authorship of every field and expense line, PIN lockouts, last cashier per device, full version history | The duty to inform staff is the shop owner's, but the terms/DPA should say so and the onboarding should remind them | open |
| LG6 | **M** | No liability limit and no "not a fiscal record" statement | The app computes totals and the Φάκελος, and the owner can file corrections | The terms should cap liability and state that the app is not a fiscal cash register, tax record or myDATA substitute | open |
| LG7 | **M** | No breach procedure | Nothing documented | One page: who is notified and how fast (owners without undue delay; they have 72 h to the authority) | open |
| LG8 | **M** | A real business's details are in the repo | The v1 spec and the tests name Join Juice with its float, channels and formulas (`joinJuicePreset`) | Rename to a neutral preset before sharing the repo with anyone. It is imported only by tests, not by `src` | open |
| LG9 | **L** | No third-party notices | All six runtime dependencies are MIT or OFL-1.1 (`@fontsource/inter` OFL-1.1; `@supabase/supabase-js`, `html-to-image`, `qrcode-generator`, `react`, `react-dom` MIT), which require keeping the copyright notice | Ship a `THIRD_PARTY_NOTICES` file | open |
| LG10 | **L** | Brand names and product name | WOLT / EFOOD / myPos / Eurobank appear only in the test preset and a comment in `src/core/config.ts`; «Ταμείο» is generic | Check the trademark register before choosing a commercial name | open |
| LG11 | **L now, H at billing** | Selling needs a registered business | v1 spec: "Billing later" | Before charging: business registration, invoicing, VAT | open |

## Already in good shape

- **Data location:** the Supabase project (`fstfuhogvsdaiwpfdmep`) is in `eu-west-1` (Ireland), so the
  database stays in the EU.
- **No tracking:** no analytics, telemetry or third-party scripts. Fonts are self-hosted and the CSP in
  `vercel.json` allows only Supabase.
- **No cookie banner needed:** localStorage holds only theme, session and the closing cache, which are
  strictly necessary. They still belong in the privacy notice.
- **Data minimisation:** staff have no email, PINs are hashed, the Z photo is never stored, and the store
  key stays in the URL hash (it never reaches the hosting server).

## Personal data the app holds (for the privacy notice and the DPA)

| Whose | What | Where |
|---|---|---|
| Shop owner | Email, password (held by Supabase Auth) | `auth.users` |
| Cashier | Name, PIN hash, failed-attempt and lock state | `staff`, `device_staff_trust` |
| Cashier | Which fields and expense lines they wrote, which closings they submitted, sign-in sessions | `open_closing_fields`, `closings`, `staff_sessions` |
| Cashier / phone | Device label, last use, last cashier | `devices` |
| Third parties | Free-text expense descriptions (may name a supplier who is a natural person) | `closings.inputs`, `open_closing_fields` |
| Everyone | Theme, staff session, cached closing, pending edits | Browser localStorage only |

## Not checked

- Whether the dev database already holds a real shop's data. If Join Juice uses it today, LG1–LG3 apply
  now, not at launch.
- The employment or contract terms under which tameioV2 was written.
- Supabase backup and log retention, and the Vercel account's region and log settings.
- Transitive dependency licences (only the six runtime dependencies were read).

## Suggested order

1. **LG4** — it decides whether this can be sold at all.
2. **LG2** — the only item that needs schema work.
3. **LG1, LG3, LG6** — the documents (privacy notice, terms, DPA), written together.
4. **LG5, LG7, LG8** — short texts and one rename.
5. **LG9, LG10, LG11** — before launch / before billing.
