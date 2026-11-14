# Record of processing activities (GDPR Art. 30)

Internal. Keep it in step with the privacy page and the DPA (plan `2026-11-14-legal-fixes` Task 5): a change to what
is stored, where, or for how long changes all three.

Provider (controller / processor): not yet filled in — `PROVIDER` in `src/features/legal/provider.ts` (Task 5).

## As controller — owner accounts

| Item | Entry |
|---|---|
| Purpose | Sign-in to the owner area; contact about the service and security incidents |
| Legal basis | Contract (Art. 6(1)(b)) |
| Data subjects | Shop owners (and whoever they share the owner login with) |
| Data | Email, password hash, sign-in sessions (Supabase Auth, `auth.users` / `auth.sessions`) |
| Recipients | Supabase (hosting, auth) |
| Transfers outside the EU | None planned: database in `eu-west-1` (Ireland). Supabase/Vercel sub-processor terms to be checked (A2) |
| Retention | Until the owner deletes the account («Διαγραφή λογαριασμού»); backups age out on Supabase's schedule |
| Security | See "Security measures" below |

## As processor — for each shop

| Item | Entry |
|---|---|
| Controller | The shop (its owner account) |
| Purpose | The shop's daily cash closing: shared live closing, submitted closings, corrections, history |
| Data subjects | The shop's cashiers; third parties named in free-text expense descriptions |
| Data | Cashier name, PIN hash, failed-attempt and lock state (`staff`, `device_staff_trust`); which fields and expense lines each cashier wrote, which closings they submitted, sign-in sessions (`open_closing_fields`, `closings`, `staff_sessions`); device label, last use, last cashier (`devices`); expense descriptions (`closings.inputs`, `open_closing_fields`) |
| On the device only | Theme, staff session token, cached closing, unsent edits (browser localStorage; no cookies, no tracking) |
| Sub-processors | Supabase (database, auth, realtime; project `fstfuhogvsdaiwpfdmep`, `eu-west-1`) — DPA: pending A2. Vercel (static hosting of the app; serves no personal data, the store key stays in the URL hash) — DPA and commercial-use plan: pending A2 |
| Retention | As long as the shop exists; «Διαγραφή καταστήματος» deletes everything of it at once. Staff sign-in sessions: 90 days. Anonymous phone identities with no store and no use: 30 days (daily job `purge_stale`). An erased cashier keeps a tombstone row with a placeholder name and no PIN. Realtime broadcast copies: until Supabase drops the partition (days) |
| Security | See below |

## Security measures

- PINs hashed (bcrypt), 6 digits, escalating lockout; staff session tokens stored only as sha256.
- Row-level security on every table; phones have no table access (server functions only); every function
  `security definer` with an empty `search_path`; identity only from the auth token.
- Encrypted transport (HTTPS); CSP and security headers from `vercel.json`; no third-party scripts.
- Database in the EU (`eu-west-1`).
- The Z photo is never stored.

## Changes

| Date | Change |
|---|---|
| 2026-11-14 | First version (legal review LG3/LG7) |
