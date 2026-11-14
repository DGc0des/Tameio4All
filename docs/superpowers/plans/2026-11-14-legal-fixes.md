# Legal Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding in `LEGAL_FINDINGS_2026-11-14.md` (LG1–LG11) so the product can be offered to a paying shop.

**Architecture:** Two parts. Part A is paperwork only Dimitris can do (ownership letter, sub-processor DPAs, business registration, lawyer review); nothing in the code depends on it except the provider details. Part B is code: a database migration that adds erasure and deletion (one server function per action, all owner-only), a small `legal` area in the app that is the single source of the legal texts, and repository hygiene (neutral test preset, third-party notices).

**Tech Stack:** TypeScript strict, React 19, Vite, Vitest + Testing Library, Supabase (Postgres 17, RLS, `security definer` functions, `pg_cron`), Vercel static hosting.

**Spec:** `LEGAL_FINDINGS_2026-11-14.md` (repo root). Read it with this plan.

## Global Constraints

- `npm test` and `npm run typecheck` pass before every commit.
- Code and comments English, UI text Greek.
- Owner screens call the server only through `OwnerApi`; UI tests use `tests/features/owner/fakeApi.ts`.
- Every new function in `public`: `security definer`, `set search_path = ''`, `revoke all … from public, anon`, `grant execute … to authenticated`. Identity only from `auth.uid()` / `auth.jwt()`.
- Owner functions answer "not yours" and "does not exist" the same way: `not_owner`, errcode `42501`.
- A new server error string needs a case in `mapError` (`src/data/remote/errors.ts`) and a Greek message in `ownerErrorMessage` (`src/features/owner/model/messages.ts`).
- `closings` stays append-only: no task updates or deletes single closing rows. Rows disappear only when their whole shop is deleted.
- Lock order device → staff in any function that locks both.
- SQL tests: one rolled-back transaction per file, failure message starts with the test id; track **written** and **applied** separately in `PROJECT_STATUS.md`.
- Updating `CLAUDE.md` / `PROJECT_STATUS.md` / `LEGAL_FINDINGS_2026-11-14.md` (the Status column) is the last step of each task, not a later pass.

## Inputs needed from Dimitris before Task 5

Task 5 is blocked until these exist. Do not invent them and do not ship placeholders.

| Input | Used in |
|---|---|
| Provider legal name, postal address, contact email, VAT number (or «δεν έχει εκδοθεί ακόμη») | `src/features/legal/provider.ts` |
| Email for privacy requests and breach reports (may be the same) | privacy page, DPA, breach procedure |
| Answer on LG4: was tameioV2 written as an employee / on the shop's instructions, or independently? | Part A1 |

## Review Focus

1. A cashier is erased while signed in on a phone with typing in progress → the next write answers `session_invalid`, the phone goes to the sign-in screen, nothing crashes. (Task 3, T4)
2. A cashier with expense lines in today's open closing is erased → another cashier can still submit that closing; the erased author's lines stay valid. (Task 3, T5)
3. A shop is deleted while a phone is joined to it → `device_context()` answers `not_a_device`; the phone lands on the entry screen. (Task 3, T8)
4. Signup submitted with the Enter key while the terms box is unchecked → blocked with a message, `api.signUp` not called. (Task 5)
5. A cashier opens the privacy link from the sign-in screen and comes back → the phone area was never unmounted; a mid-typing register keeps its text. (Task 5)

---

## Part A — actions outside the code (Dimitris)

No code task waits for these, except the inputs table above. Tick them in `LEGAL_FINDINGS_2026-11-14.md` as they are done.

- [ ] **A1 (LG4) Ownership of tameioV2.** Get a one-page signed statement from the shop's owner: the tool was written by Dimitris Gkrezios on his own initiative, all rights in it belong to him, the shop has a free licence to keep using it. If it was written as part of the job or on instructions, ask a lawyer first: under Law 2121/1993 Art. 40 the economic rights may already be the employer's and need a written transfer. Keep the PDF outside the repo.
- [ ] **A2 (LG3) Sub-processor agreements.** Supabase: request and sign its DPA from the organisation's legal documents in the dashboard. Vercel: confirm the plan allows commercial use (the Hobby plan is for non-commercial projects — check the current terms) and that its DPA applies to the account. Save both PDFs outside the repo and note the dates in `docs/legal/processing-record.md` (Task 7).
- [ ] **A3 (LG10) Name check.** Search TMview and the Greek trademark register for the commercial name before any marketing.
- [ ] **A4 (LG11) Before the first invoice.** Business registration (tax office start of activity), invoicing through myDATA, VAT. Not needed for a free pilot; needed before billing ships.
- [ ] **A5 Lawyer review.** Give a Greek lawyer the four pages from Task 5 (privacy, terms, DPA, staff notice) and A1. After the review, apply the changes and do the "remove draft banner" step of Task 5's DEV ONLY entry.
- [ ] **A6 Dev database check.** Confirm whether project `fstfuhogvsdaiwpfdmep` holds a real shop's data. If yes, LG1–LG3 are live obligations today: prioritise Tasks 3–5 and A2.

---

## Part B — code

### File map

| File | Responsibility |
|---|---|
| `src/core/presets.ts` | rename the preset (Task 1) |
| `tests/repo/noRealShop.test.ts` | no real business name in `src/`, `tests/`, `supabase/` (Task 1) |
| `scripts/third-party-notices.mjs` → `public/THIRD_PARTY_NOTICES.txt` | generator and its generated output (Task 2) |
| `supabase/migrations/20261115000001_erasure.sql`, `supabase/tests/160_erasure.sql` | erasure, deletion, purge job (Task 3) |
| `src/data/remote/ownerApi.ts`, `owner.ts`, `errors.ts`, `src/features/owner/model/messages.ts` | three new `OwnerApi` methods + one error (Task 4) |
| `src/features/owner/OwnerStaffScreen.tsx`, `settings/DangerZoneCard.tsx`, `ShopsScreen.tsx` | the three confirmations (Task 4) |
| `src/features/legal/` (`LegalEntry.tsx`, `pages/*.tsx`, `provider.ts`, `version.ts`) | the legal area; single source of the legal texts (Task 5) |
| `src/app/router.ts`, `src/app/App.tsx` | `legal` area routing (Task 5) |
| `docs/legal/breach-procedure.md`, `docs/legal/processing-record.md` | internal procedures (Task 6) |

---

### Task 1: Neutral test preset (LG8)

**Files:**
- Modify: `src/core/presets.ts`, every test importing `joinJuicePreset` or using the shop name `'Join Juice'`, `docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md` (lines 4–5: "a real shop" instead of the name)
- Create: `tests/repo/noRealShop.test.ts`

**Interfaces:**
- Produces: `export const juiceBarPreset: ShopConfig` (same value as today's `joinJuicePreset`; channel ids and labels unchanged — the parity tests depend on them).

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo/noRealShop.test.ts — walks src/, tests/, supabase/ (skipping this file) with node:fs
it('names no real business in shipped code, tests or SQL', () => {
  expect(filesMatching(/join\s*juice/i)).toEqual([]);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/repo/noRealShop.test.ts` — FAIL listing `src/core/presets.ts` and four test files.
- [ ] **Step 3:** Rename `joinJuicePreset` → `juiceBarPreset` everywhere; test shop names `'Join Juice'` → `'Δοκιμαστικό'`; the preset's doc comment becomes "A juice bar with two delivery platforms and two card terminals — the parity fixture for tameioV2's formulas."
- [ ] **Step 4:** `npm test && npm run typecheck` — PASS.
- [ ] **Step 5:** Mark LG8 `fixed` in `LEGAL_FINDINGS_2026-11-14.md` with the note "git history and older plan documents still contain the name: rewrite history or start a fresh repository before making the repo public". Commit: `chore: neutral parity preset, no real shop name in code (LG8)`.

---

### Task 2: Third-party notices (LG9)

**Files:**
- Create: `scripts/third-party-notices.mjs`, `public/THIRD_PARTY_NOTICES.txt` (generated), `tests/repo/thirdPartyNotices.test.ts`
- Modify: `package.json` (script `"notices": "node scripts/third-party-notices.mjs"`)

**Interfaces:**
- Produces: `/THIRD_PARTY_NOTICES.txt` served from the site root (Vite copies `public/`). Task 5 links to it.

- [ ] **Step 1: Write the failing test**

```ts
it('lists every runtime dependency with its licence', () => {
  const text = readFileSync('public/THIRD_PARTY_NOTICES.txt', 'utf8');
  for (const name of Object.keys(pkg.dependencies)) expect(text).toContain(`\n${name}@`);
  expect(text.startsWith('GENERATED by scripts/third-party-notices.mjs')).toBe(true);
});
```

- [ ] **Step 2:** Run it — FAIL (file missing).
- [ ] **Step 3:** Write the generator: for each key of `dependencies` in `package.json`, read `node_modules/<name>/package.json` (`version`, `license`) and the first file matching `LICENSE*`/`LICENCE*` in that folder; emit `<name>@<version> — <license>` followed by the licence text. First line of the output: `GENERATED by scripts/third-party-notices.mjs — do not edit; run "npm run notices".` A dependency with no licence file makes the script exit 1 naming it.
- [ ] **Step 4:** `npm run notices && npm test` — PASS. Check the file is not caught by `.gitignore`.
- [ ] **Step 5:** Mark LG9 `fixed` (note: transitive dependencies bundled into the build are not listed; only direct runtime dependencies). Commit: `chore: generated third-party notices (LG9)`.

---

### Task 3: Erasure, deletion and purge in the database (LG2, closes L81)

**Files:**
- Create: `supabase/migrations/20261115000001_erasure.sql`, `supabase/tests/160_erasure.sql`
- Modify: `supabase/tests/README.md` (one line for `160`), `CLAUDE.md`, `PROJECT_STATUS.md`

**Interfaces:**
- Produces (all `returns void`, all raise `not_owner` 42501 for a shop/staff that is not the caller's or does not exist):
  - `public.owner_erase_staff(p_staff_id uuid)`
  - `public.owner_delete_shop(p_shop_id uuid, p_confirm_name text)` — also raises `confirm_mismatch` (22023) when `btrim(p_confirm_name)` is not exactly the shop's name (case-sensitive)
  - `public.owner_delete_account()` — raises `not_owner` for an anonymous (phone) session
  - column `public.staff.erased_at timestamptz` (null = not erased), selectable by `authenticated` like the other staff columns
  - `private.delete_shop(p_shop_id uuid)` and `private.purge_stale()` — no client execute

**Decisions the SQL must implement:**

*Erase a cashier.* The row is kept (closings reference it; `closings` is append-only) and stripped of everything personal:
- `name` = `'Διαγραμμένος υπάλληλος ' || left(id::text, 8)`, `pin_hash` = null, `active` = false, `failed_attempts` = 0, `locked_until` = null, `lock_level` = 0, `erased_at` = now().
- Delete the cashier's `staff_sessions` and `device_staff_trust` rows; set `devices.last_staff_id` to null where it points to them.
- Any copy of the old name stored as text is rewritten to the placeholder. Read the `last_submit` object written by `submit_closing` (latest body: `20261114000002_submit_lines_live_only.sql`) and rewrite its `staff_name` for this cashier in every `open_closings` row of the shop. T3 below is the proof: after the call the old name appears nowhere in the shop's rows.
- Calling it again on an erased row changes nothing and raises nothing.
- An erased row can never be renamed or re-activated: recreate the owner UPDATE policy on `public.staff` (find its name in `20260929000001`…`20260929000006`) with `erased_at is null` added to both `using` and `with check`; `set_staff_pin` and `unlock_staff` raise `not_owner` for an erased row.
- Accepted: an erased row still counts toward the 100-staff cap (`too_many_staff`). Free-text expense descriptions inside old closings are not scanned.

*Delete a shop.* `private.delete_shop`: collect the shop's `devices.user_id`, `delete from public.shops` (cascades to configs, staff, devices, sessions, trust rows, join key, open closings and fields, closings), then delete those collected users from `auth.users` where `is_anonymous`. `closings.staff_id`, `closings.config_id` and `open_closings.config_id` have no cascade of their own; the delete must still succeed in one statement (T6 proves it).

*Delete an account.* `private.delete_shop` for each of the caller's shops, then `delete from auth.users where id = auth.uid()`.

*Purge job.* `create extension if not exists pg_cron`; schedule `private.purge_stale()` daily at 03:30 UTC under the job name `purge_stale`. It deletes `staff_sessions` older than 90 days, and anonymous `auth.users` that have no `devices` row and no auth session refreshed in the last 30 days. Check the real column names of `auth.sessions` in `information_schema.columns` on the dev project before writing that predicate.

- [ ] **Step 1: Privilege probe (do this before writing anything else).** On dev, inside a transaction that ends in `rollback`, create a throwaway `security definer` function that deletes one throwaway row from `auth.users` and call it as `authenticated`. If Postgres refuses the delete, **stop and report**: account and device-user deletion then need an Edge Function with the service-role key, which is a different design.

- [ ] **Step 2: Write `supabase/tests/160_erasure.sql`** (owner A `…a1`, owner B `…b1`, phones `…d1`, `…d2`; 6-digit PINs), one block per id:

| Id | Asserts |
|---|---|
| T1 | owner B and a phone calling `owner_erase_staff` on A's cashier → `not_owner`; a random uuid → `not_owner` |
| T2 | after erase: `name` is the placeholder, `pin_hash` null, `active` false, `erased_at` set, no `staff_sessions`/`device_staff_trust` rows, `devices.last_staff_id` null; second call is a no-op |
| T3 | the old name appears in no `text`/`jsonb` column of `staff`, `open_closings`, `open_closing_fields`, `closings` for the shop (cast each row to text and search) |
| T4 | a token issued before the erase: `set_closing_field` and `submit_closing` return `session_invalid`; `staff_sign_in` with the old PIN returns `pin_not_set` or `staff_not_found`, never `ok` |
| T5 | cashier X adds an expense line, X is erased, cashier Y submits the closing → `ok:true`; `owner_get_closing_day` shows the placeholder as that version's line author name |
| T6 | `owner_delete_shop` with the wrong name → `confirm_mismatch`, nothing deleted; with surrounding spaces → deleted; shop with submitted closings, corrections, an open closing and two config versions → every table has zero rows for the shop id |
| T7 | the shop's anonymous `auth.users` rows are gone; owner A's own `auth.users` row and owner A's other shop are untouched |
| T8 | a phone of the deleted shop: `device_context()` answers `not_a_device` (42501 or `{ok:false}` — the same shape it gives an unpaired phone today) |
| T9 | `owner_delete_account` as a phone → `not_owner`; as owner A → no `shops` rows of A, no `auth.users` row of A, owner B's data untouched |
| T10 | an erased row: direct `update public.staff set name/active` as the owner changes 0 rows; `set_staff_pin`/`unlock_staff` → `not_owner` |
| T11 | `private.purge_stale()` (called as the migration owner): a 91-day-old session is deleted and an 89-day-old one kept; an anonymous user with a `devices` row is kept |
| T12 | grants: `anon` cannot execute the three public functions; `authenticated` cannot execute `private.delete_shop` / `private.purge_stale` |

- [ ] **Step 3:** Run `160` on dev before the migration — FAIL at T1 with "function public.owner_erase_staff does not exist".
- [ ] **Step 4:** Write the migration to the decisions above. Each public function takes the shop's row `for update` first, so it serialises with `create_staff`/`join_shop`.
- [ ] **Step 5:** Apply the migration to dev and run `160`, then re-run `020`, `060`, `110`, `140`, `150` (they touch `staff`) — all finish without error.
- [ ] **Step 6: Docs.** `CLAUDE.md` Invariants: an "Erasure" bullet stating the placeholder rule, that erased rows are permanent tombstones, that `closings` rows leave only with their shop, the `purge_stale` job and its two rules, and the cross-file invariant "the placeholder text is produced only in SQL; the client never builds it". `PROJECT_STATUS.md`: mark L81 fixed; record `160` as written + applied. `LEGAL_FINDINGS`: LG2 stays `open` until Task 4.
- [ ] **Step 7:** Commit: `feat(db): erase a cashier, delete a shop or an account, daily purge (LG2, L81)`.

---

### Task 4: Deletion in the owner app (LG2)

**Files:**
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/data/remote/errors.ts`, `src/features/owner/model/messages.ts`, `src/features/owner/OwnerStaffScreen.tsx`, `src/features/owner/settings/SettingsScreen.tsx`, `src/features/owner/ShopsScreen.tsx`, `tests/features/owner/fakeApi.ts`
- Create: `src/features/owner/settings/DangerZoneCard.tsx`
- Test: `tests/features/owner/staff.test.tsx`, `settings.test.tsx`, `shops.test.tsx`, `messages.test.ts`, `tests/data/ownerApi.test.ts`, `tests/data/remoteErrors.test.ts`

**Interfaces:**
- Consumes: the three functions and `staff.erased_at` from Task 3.
- Produces on `OwnerApi`:
  - `eraseStaff(staffId: string): Promise<Result<void>>` → rpc `owner_erase_staff` `{ p_staff_id }`
  - `deleteShop(shopId: string, confirmName: string): Promise<Result<void>>` → rpc `owner_delete_shop` `{ p_shop_id, p_confirm_name }`
  - `deleteAccount(): Promise<Result<void>>` → rpc `owner_delete_account`, then `client.auth.signOut()` on success
  - `OwnerError` gains `{ code: 'confirm_mismatch' }`; message «Το όνομα δεν ταιριάζει. Γράψε το ακριβώς όπως φαίνεται.»
  - `listStaff` adds `.is('erased_at', null)` — erased cashiers never appear in «Προσωπικό».

**Fixed copy:**

| Where | Text |
|---|---|
| Staff row button | «Οριστική διαγραφή» |
| Staff confirm sheet | «Οριστική διαγραφή του/της {name}; Το όνομα και το PIN σβήνονται και δεν επανέρχονται. Τα κλεισίματα που υπέβαλε μένουν στο ιστορικό ως «Διαγραμμένος υπάλληλος».» — buttons «Διαγραφή» / «Άκυρο» |
| Settings card title | «Διαγραφή καταστήματος» |
| Settings card body | «Σβήνονται οριστικά το κατάστημα, το προσωπικό, οι συσκευές και όλα τα κλεισίματα. Γράψε το όνομα του καταστήματος για επιβεβαίωση.» |
| Shops screen link | «Διαγραφή λογαριασμού» |
| Account confirm sheet | «Σβήνονται οριστικά ο λογαριασμός σου και όλα τα καταστήματά σου. Γράψε το email σου για επιβεβαίωση.» |

- [ ] **Step 1: Write the failing tests**

```ts
// tests/data/ownerApi.test.ts
it('eraseStaff / deleteShop / deleteAccount call the right functions', …)   // rpc names + parameter names as in Interfaces
it('listStaff asks only for rows that are not erased', …)                    // .is('erased_at', null)
// tests/data/remoteErrors.test.ts
expect(mapError({ message: 'confirm_mismatch' })).toEqual({ code: 'confirm_mismatch' });
// tests/features/owner/staff.test.tsx
it('erases a cashier only after the confirmation sheet', …)   // click «Οριστική διαγραφή» → eraseStaff not called; click «Διαγραφή» → called once with the id; list reloaded
// tests/features/owner/settings.test.tsx
it('enables shop deletion only when the typed name matches', …) // button disabled until input === shop name; then deleteShop(shopId, name) and navigate({ name: 'shops' })
it('shows the server message when the name no longer matches', …) // fake returns confirm_mismatch → the Greek message, no navigation
// tests/features/owner/shops.test.tsx
it('deletes the account only after the email is typed', …)      // deleteAccount called once; then onSignOut called
```

- [ ] **Step 2:** Run the six files — FAIL (`eraseStaff is not a function`, missing buttons).
- [ ] **Step 3:** Implement to the Interfaces and copy above. Confirmations use the existing `Sheet` (it portals to `<body>`; do not put a fixed overlay inside a glass panel). `DangerZoneCard` is the last card of `SettingsScreen` and takes `{ api, shopId, shopName, navigate }`. After a successful shop deletion, remove that shop's cached snapshot and its pending edits through `src/data/local/openClosing.ts` (add `clearShop(store, shopId)` there if no such function exists; it is the only code allowed to touch localStorage). `ShopsScreen` needs the signed-in email: take it from `api.session()`.
- [ ] **Step 4:** `npm test && npm run typecheck` — PASS.
- [ ] **Step 5: Manual check on dev** (a throwaway owner account): create a shop and a cashier, submit one closing from a phone, erase the cashier, open «Ιστορικό» (the version shows «Διαγραμμένος υπάλληλος …»), delete the shop while the phone is open (the phone lands on the entry screen), delete the account (the login screen appears and the email can sign up again).
- [ ] **Step 6: Docs.** `CLAUDE.md`: add the three methods to the owner-area description and `confirm_mismatch` to the owner error list. `LEGAL_FINDINGS`: LG2 `fixed`, with the note "no time-based deletion of closings: they live as long as the shop; the retention period is stated in the DPA". Record the manual check (done / not done) under "Not verified" in `PROJECT_STATUS.md`.
- [ ] **Step 7:** Commit: `feat(owner): erase a cashier, delete a shop, delete the account (LG2)`.

---

### Task 5: Legal area — privacy, terms, DPA, staff notice (LG1, LG3, LG5, LG6)

**Files:**
- Create: `src/features/legal/LegalEntry.tsx` (default export, lazy-loaded), `src/features/legal/pages/Privacy.tsx`, `Terms.tsx`, `Dpa.tsx`, `StaffNotice.tsx`, `src/features/legal/provider.ts`, `src/features/legal/version.ts`, `tests/features/legal/legal.test.tsx`
- Modify: `src/app/router.ts`, `src/app/App.tsx`, `src/features/owner/AuthScreens.tsx`, `src/features/owner/ShopsScreen.tsx`, `src/features/owner/OwnerStaffScreen.tsx`, `src/features/phone/JoinScreen.tsx`, `src/features/phone/SignInScreen.tsx`, `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `tests/features/owner/fakeApi.ts`, `tests/app/ownerRouter.test.ts`, `tests/app/app.test.tsx`, `tests/features/owner/auth.test.tsx`, `CLAUDE.md`

**Interfaces:**
- Consumes: `/THIRD_PARTY_NOTICES.txt` (Task 2); the inputs table at the top.
- Produces:
  - `export type LegalPage = 'privacy' | 'terms' | 'dpa' | 'staff'`
  - `AppRoute` gains `{ area: 'legal'; page: LegalPage }`; `parseAppRoute('#/legal/<page>')` returns it; an unknown page falls back to `privacy`; `legalHash(page: LegalPage): string` returns `'#/legal/<page>'`
  - `export const PROVIDER: { name: string; address: string; email: string; privacyEmail: string; vat: string }` (`provider.ts`)
  - `export const LEGAL_VERSION = '2026-11-15'` and `export const LEGAL_DRAFT = true` (`version.ts`)
  - `OwnerApi.signUp(email, password, redirectTo, termsVersion: string)` — sent as `options.data.terms_version`

**Decisions:**
- The four pages are the **only** copy of the legal texts (no Markdown twin in `docs/`). Each page renders `PROVIDER` and `LEGAL_VERSION`; nothing is hard-coded twice.
- While `LEGAL_DRAFT` is true every legal page shows a banner «Προσχέδιο — δεν έχει ελεγχθεί από νομικό». This is a DEV ONLY item: add it to the register in `CLAUDE.md` (what: draft banner; where: `src/features/legal/version.ts`; remove when: lawyer review A5 is applied).
- The DPA is accepted together with the terms at signup (click-through), so a shop never has to sign a separate paper.
- The terms acceptance stored in user metadata is evidence, not access control: nothing on the server reads it.
- The phone area stays mounted (hidden) while a legal page is shown, exactly as it does for the owner area.
- A terms change later bumps `LEGAL_VERSION`; re-acceptance by existing owners is out of scope here.

**Content each page must contain** (Greek, plain language, second person):

| Page | Sections |
|---|---|
| `privacy` | Who we are (`PROVIDER`) · Our role: controller for owner accounts, processor for everything a shop enters · What we hold (the personal-data table of `LEGAL_FINDINGS`, as prose) · Why and on what legal basis (contract; the shop's legitimate interest for staff data) · Where it is stored (Supabase, Ireland, EU) and who else touches it (Supabase, Vercel) · How long (as long as the shop exists; sign-in sessions 90 days; unused phone identities 30 days) · What stays on the device (theme, session, cached closing, unsent edits — no cookies, no tracking) · Your rights and how to use them (owner: delete from the app; staff: ask the shop owner, or `PROVIDER.privacyEmail`) · Complaint to the Hellenic Data Protection Authority · Link to `/THIRD_PARTY_NOTICES.txt` |
| `terms` | The service · Accounts and the owner's responsibility for PINs and the store link · **Not a fiscal device**: not a cash register under tax law, not a tax or accounting record, does not replace the Z report or myDATA · Totals are computed from what the staff type; the owner checks them · Availability (no uptime promise in the free period) · Liability cap (direct damage only, limited to the fees paid in the last 12 months; nothing limits liability for intent or gross negligence) · Ending the service: deletion from the app, data erased with the shop · Changes to the terms · Greek law, courts of Thessaloniki · The DPA is part of these terms |
| `dpa` | GDPR Art. 28 items: subject, duration, nature and purpose · data categories and data subjects · processing only on the shop's instructions (the app's functions are the instructions) · confidentiality · security measures (hashed PINs, row-level security, EU hosting, encrypted transport) · sub-processors (Supabase, Vercel) with notice of changes and a right to object · help with data-subject requests · breach notice to the shop without undue delay, at most 48 hours · deletion at the end (shop deletion erases everything; backups age out) · audit by documentation on request |
| `staff` | For cashiers, short: what the app records about you (name, which amounts and expense lines you typed, when you submitted, which phone) · who sees it (the shop owner) · it is the shop's tool: the shop is responsible and is the one to ask · how to ask for correction or deletion · link to `privacy` |

- [ ] **Step 1: Write the failing tests**

```ts
// tests/app/ownerRouter.test.ts
expect(parseAppRoute('#/legal/terms')).toEqual({ area: 'legal', page: 'terms' });
expect(parseAppRoute('#/legal/nope')).toEqual({ area: 'legal', page: 'privacy' });
expect(legalHash('dpa')).toBe('#/legal/dpa');
// tests/features/legal/legal.test.tsx
it.each(['privacy', 'terms', 'dpa', 'staff'] as const)('%s shows the provider and the version', …) // PROVIDER.name and LEGAL_VERSION in the document
it('terms say the app is not a fiscal device', …)        // text «δεν αντικαθιστά» present
it('no provider field is empty or a placeholder', () => {
  for (const v of Object.values(PROVIDER)) expect(v).not.toMatch(/^\s*$|TODO|XXX|example\.com/i);
});
// tests/features/owner/auth.test.tsx
it('does not sign up while the terms box is unchecked', …) // fill valid fields, press Enter in the form → message «Χρειάζεται να αποδεχτείς τους Όρους χρήσης.», api.signUp not called
it('sends the accepted terms version', …)                  // check the box, submit → signUp(email, password, redirect, LEGAL_VERSION)
it('links to the terms and the privacy page', …)           // two links with href '#/legal/terms' and '#/legal/privacy'
// tests/app/app.test.tsx
it('keeps the register text while a legal page is open', …) // type in a box, open #/legal/staff, go back to #/ → the text is still there
// phone screens (tests/features/phone/phoneApp.test.tsx)
it('join and sign-in screens link to the staff notice', …)  // link «Απόρρητο» with href '#/legal/staff'
```

- [ ] **Step 2:** Run them — FAIL (`legalHash` missing, no checkbox).
- [ ] **Step 3:** Implement the route and `LegalEntry` (header with a back link to where the reader came from: `#/owner` if the previous hash was in the owner area, else `#/`; a row of links to the other three pages; the draft banner).
- [ ] **Step 4:** Write the four pages to the content table, filling `provider.ts` from the inputs. Stop here if an input is missing.
- [ ] **Step 5:** Signup: a required checkbox labelled «Συμφωνώ με τους Όρους χρήσης και την Πολιτική απορρήτου» (both names are links, `target` unchanged so they stay in the app); `signUp` passes `LEGAL_VERSION`. `ShopsScreen` footer: links «Όροι χρήσης» · «Απόρρητο». `OwnerStaffScreen`: a note above the list — «Ενημέρωσε το προσωπικό ότι η εφαρμογή καταγράφει ποιος καταχωρεί τι.» with the link «Ενημέρωση προσωπικού» (`#/legal/staff`). `JoinScreen` and `SignInScreen`: a link «Απόρρητο» next to the existing owner link.
- [ ] **Step 6:** `npm test && npm run typecheck && npm run build` — PASS; the legal area is its own lazy chunk in the build output.
- [ ] **Step 7: Docs.** `CLAUDE.md`: Architecture bullet for `src/features/legal/`; Invariants: "the legal texts live only in `src/features/legal/pages/`; a change that alters what data is stored, where, or for how long needs the privacy page and the DPA updated in the same commit and `LEGAL_VERSION` bumped" (cross-file invariant); the DEV ONLY register row. `README.md`: one line on where the legal pages are. `LEGAL_FINDINGS`: LG1, LG5, LG6 → `fixed (draft, pending lawyer review A5)`; LG3 → `fixed in the app; sub-processor DPAs pending A2`.
- [ ] **Step 8:** Commit: `feat(legal): privacy, terms, DPA and staff notice; terms accepted at signup (LG1, LG3, LG5, LG6)`.

---

### Task 6: Internal procedures (LG7, LG3 record)

**Files:**
- Create: `docs/legal/breach-procedure.md`, `docs/legal/processing-record.md`
- Modify: `LEGAL_FINDINGS_2026-11-14.md`, `PROJECT_STATUS.md`

No code, no test cycle; the deliverable is two short documents a reviewer can read in five minutes.

- [ ] **Step 1: `breach-procedure.md`** (one page): what counts as a breach (someone outside a shop read or changed its data; a leaked service-role key or database password; a lost backup) · first hour: rotate the affected keys in Supabase, «Νέος σύνδεσμος» for affected shops, note the time of discovery · within 48 hours: email every affected shop owner from `PROVIDER.privacyEmail` with what happened, which data, what we did, what they should do (they have 72 hours from when they learn of it to notify the Hellenic DPA) · our own notification to the DPA when owner account data is affected · a log table (date, what, who was told, when) kept in this file · **data-subject requests**: answered within 30 days; access/export is done by us with SQL on request (no export button exists — accepted gap); erasure through the app's own functions.
- [ ] **Step 2: `processing-record.md`** (GDPR Art. 30, one table per role): as controller — owner accounts (email, password hash; purpose; retention: until account deletion); as processor — per shop (data categories from `LEGAL_FINDINGS`; sub-processors Supabase `eu-west-1` and Vercel with the DPA dates from A2, left as "pending A2" until signed; retention rules from Task 3).
- [ ] **Step 3:** `LEGAL_FINDINGS`: LG7 `fixed`. `PROJECT_STATUS.md`: add a "Legal review 2026-11-14" section listing LG1–LG11 with their final status and one line each on the *why*, plus under "Not verified": lawyer review (A5), sub-processor DPAs (A2), ownership letter (A1), the Task 4 manual check if it was skipped, behaviour of a phone whose anonymous identity was purged after 30 idle days.
- [ ] **Step 4:** Commit: `docs: breach procedure, processing record, legal status (LG7)`.

---

## What this plan does not do

- **LG4, LG10, LG11** are Part A only; no code closes them.
- No data-export button and no automatic deletion of old closings (both stated as accepted gaps above).
- No re-acceptance flow when the terms change.
- No cookie banner (nothing needs one; the privacy page explains the local storage).

## Order

Tasks 1 and 2 are independent and small. Task 3 → Task 4 (4 consumes 3). Task 5 needs the inputs table and Task 2. Task 6 last. Part A runs in parallel from day one; A1 first.
