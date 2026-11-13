# Security findings — 2026-11-14

Audit of branch `fix/review-2026-11-11` at `c940354`. All of these are **open**; nothing was changed.
IDs continue the scheme in `PROJECT_STATUS.md` (last used: H22, M38, L92).

**How it was checked:** every file in `supabase/migrations/` was read, and the function grants, table
grants, RLS flags and policies were compared with the live dev project (`fstfuhogvsdaiwpfdmep`) — they
match. Supabase security advisors were run. `src/` was scanned for HTML injection sinks; `npm audit
--omit=dev` reports 0 vulnerabilities.

**Who can do this:** almost everything below needs the store link / QR. Every cashier who ever opened
it has it, so does anyone who photographed the printed QR, and a former employee keeps it until
«Νέος σύνδεσμος» is pressed. Without the link, an anonymous or foreign account gets nothing.

## Summary

| ID | Severity | Issue | Who can exploit it |
|---|---|---|---|
| H23 | High | Expense history readable without a PIN | Anyone with the store link |
| H24 | High | 4-digit PIN guessable in days | Anyone with the store link |
| M39 | Medium | Every cashier can be kept locked out | Anyone with the store link |
| M40 | Medium | A cashier can attribute an expense to a colleague | Signed-in cashier |
| M41 | Medium | No limit on shops, staff or config versions | Any signed-up owner account |
| M42 | Medium | No limit on fields in a live closing | Signed-in cashier |
| L93 | Low | `verify_staff_pin` leftover still callable | Anyone with the store link |
| L94 | Low | Leaked-password protection is off | — (dashboard setting) |
| L95 | Low | No Content-Security-Policy at the host | — (hardening) |

---

## H23 — Expense history readable without a PIN

**Where:** `public.expense_suggestion_data()` — latest body in
`supabase/migrations/20261111000001_closing_versions.sql`; called from `src/data/remote/device.ts`
(`suggestionData`).

**Problem:** the function only checks that the caller has a `devices` row
(`d.user_id = auth.uid() and d.revoked_at is null`). It takes no staff token. Anyone with the store
link can sign in anonymously, call `join_shop`, then call the RPC directly and get 180 days of the
shop's expense descriptions and amounts (supplier names, what was paid, on which day). The sign-in
screen hides this in the UI, but the server does not enforce it — this contradicts the rule «a phone
in a store with nobody signed in renders only the sign-in screen (no register fields, no amounts)».

**Fix:**
- New migration: drop `expense_suggestion_data()` and create `expense_suggestion_data(p_token text)`
  that calls `private.staff_session(p_token)` first and returns nothing (or the session error) when it
  fails. Keep the `seq desc` current-version rule unchanged.
- `revoke … from public, anon` and `grant execute … to authenticated` for the new signature.
- Client: `DeviceApi.suggestionData` passes the staff token (`deviceApi.ts`, `device.ts`, the fake in
  tests).
- SQL test: a joined phone with no staff session gets no rows; with a live session it gets them.

**Related, decide separately:** `device_context()` and `list_staff()` also need only the link. They
return the shop name, the full config and the active staff names. That is needed to show the sign-in
screen, so it is by design, but it is what a link holder can see.

## H24 — 4-digit PIN guessable in days

**Where:** `private.check_staff_pin` (latest body in
`supabase/migrations/20260929000005_hardening.sql`), reached through `staff_sign_in` and
`verify_staff_pin`.

**Problem:** the lockout is 5 wrong tries → 15 minutes, per cashier, and the counter is reset to 0 when
the lock starts. That allows 480 guesses a day per cashier: all 10 000 PINs in about 21 days, about 10
on average, and sooner when several cashiers are attacked in parallel. A quieter variant never locks
anyone: the counter also resets on every correct sign-in and never decays, so an attacker gets 4 free
guesses between each real sign-in. A cracked PIN lets the attacker read and edit today's live closing
and submit closings as that cashier.

**Fix (in order of value):**
- Escalating lock time: keep a count of consecutive locks and double the duration (15 min → 30 → 1 h
  → … capped), reset only by a correct PIN or by the owner's `unlock_staff`.
- A per-device attempt limit (see M39) so guesses cannot be spread quietly.
- Show the owner failed attempts / locks in «Προσωπικό» (the columns `failed_attempts`,
  `locked_until` are already readable by the owner).
- Consider 6-digit PINs: `private.check_pin`, the regex inside `check_staff_pin`, and the client PIN
  inputs all carry the `^[0-9]{4}$` rule (cross-file — change together).

## M39 — Every cashier can be kept locked out

**Where:** same function as H24.

**Problem:** the failure counter belongs to the cashier, not to the phone that guessed. Anyone with the
store link can send 5 wrong PINs per cashier every 15 minutes and keep the whole shop unable to sign
in. The owner can unlock, but the attacker re-locks immediately; only rotating the link stops it.

**Fix:**
- Add failure tracking per device (`devices.failed_attempts`, `devices.locked_until`, or a small
  table) and lock the *device* after N wrong PINs across all cashiers.
- Keep a cashier-level lock only as a much higher backstop, so one hostile phone cannot lock a person
  for everyone else.
- Must still return `{ok:false,error}` and never raise (a raise rolls back the counter).

## M40 — A cashier can attribute an expense to a colleague

**Where:** `public.submit_closing` (latest body in
`supabase/migrations/20261111000003_today_save_and_submit_revision.sql`), the first expense check.

**Problem:** an expense whose id is **not** an `e:<id>` field of today's open closing falls back to the
stage-1 rule: `addedBy` may be any staff member of the shop. A signed-in cashier can call the RPC
directly with an invented line marked as added by someone else (staff ids come from `list_staff`).
Since stage 2 every real line comes from the live closing, so this fallback is no longer needed.

**Fix:**
- After the lock and the revision check, reject (`bad_inputs`) any expense whose id has no `e:<id>`
  field in the open closing, and any whose field is `removed`.
- Remove the stage-1 fallback branch.
- Update the cross-file invariant text in `CLAUDE.md` («for an id with no `e:<id>` field the stage-1
  rule applies») in the same commit; add a case to `supabase/tests/090_live_submit.sql`.

**Known, accepted, not fixed by this:** the server does not prove that the submitted numbers equal the
live fields (text → cents parsing lives in TypeScript only). A cashier can still submit different
amounts than what is on screen under their own name.

## M41 — No limit on shops, staff or config versions

**Where:** `create_shop`, `create_staff`, `publish_config`.

**Problem:** any signed-up owner account can call these without limit. `publish_config` stores up to
64 KB per version, so a few thousand calls fill the database for every shop on the project.

**Fix:** caps enforced in SQL, each with its own error string (which then needs a `mapError` case and a
Greek `ownerErrorMessage`):
- shops per owner (e.g. 10),
- staff rows per shop (e.g. 50),
- config versions per shop per day (e.g. 50), or a total cap with pruning of versions no closing
  references.
- Also confirm in the Supabase dashboard that email confirmation is required for sign-up, so accounts
  cannot be created in bulk.

## M42 — No limit on fields in a live closing

**Where:** `private.write_closing_field` (latest body in
`supabase/migrations/20261108000003_live_fixes.sql`).

**Problem:** `d:<cents>` and `c:<channelId>` keys are checked only against the key regex, not against
the pinned config, and removed expense lines are never counted (the `maxExpenses` cap counts visible
lines only). A signed-in cashier can write an unlimited number of 200-character fields. The snapshot
grows until that day's register stops loading for the whole shop.

**Fix:**
- Accept `d:<cents>` only when the denomination exists in the pinned config, and `c:<id>` only when the
  channel exists.
- Cap the total number of `e:<id>` lines per closing including removed ones (e.g. `maxExpenses × 5`),
  or cap the total field rows per closing.
- Reject with `bad_field` / `too_many_expenses`, which the sync engine already handles.

## L93 — `verify_staff_pin` leftover still callable

**Where:** `public.verify_staff_pin(uuid, text)`, created in
`supabase/migrations/20260929000003_device_functions.sql`, never dropped; not used anywhere in `src/`.

**Problem:** a second PIN-checking entry point. It shares the lockout counter, so it adds no extra
guesses today, but any change to H24/M39 would have to cover it too.

**Fix:** `drop function public.verify_staff_pin(uuid, text);` in the H24/M39 migration, and remove it
from the `CLAUDE.md` line about functions that never raise.

## L94 — Leaked-password protection is off

**Where:** Supabase Auth settings (advisor warning).

**Fix:** enable it in the dashboard:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## L95 — No Content-Security-Policy at the host

**Where:** hosting configuration (no headers file in the repo).

**Problem:** the owner's refresh token and the staff token are kept in localStorage. No HTML injection
sink was found in `src/`, so there is no known way in, but a CSP is the backstop if one appears.

**Fix:** set response headers at the host: `Content-Security-Policy` (`default-src 'self'`;
`connect-src` for the Supabase URL incl. `wss:`; `img-src 'self' data: blob:`), plus
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.

---

## Not verified

- None of the attacks was executed; H23, H24, M39, M40, M42 are from reading the SQL and confirming
  the live function list and grants.
- Supabase dashboard settings: email confirmation, anonymous sign-in rate limits / captcha, redirect
  allow-list.
- The production host and its headers.
- The live check was against the dev project only.

## What held up (no action)

- RLS on every table; `anon` has no access; phones have no direct table access.
- Every `private.*` helper is revoked except `is_shop_owner` and `can_use_shop_topic`.
- Owner functions authorize from `auth.uid()` and answer `not_owner` for foreign and unknown ids alike.
- Clients can insert only `presence` rows into `realtime.messages`; they cannot forge `field` or
  `submitted` broadcasts.
- No secrets in tracked files; `.env` is gitignored.
