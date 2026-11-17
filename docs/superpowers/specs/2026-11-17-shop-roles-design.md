# Stage 6 — shop roles: store manager and accountant

Status: design, 2026-11-17. Not built.

## Why

Today a shop has exactly one office-side person, the owner (`shops.owner_id`). Everything on `#/owner` is
all-or-nothing: whoever has the owner's login can change how the till closes, delete cashiers forever or
delete the shop. Real shops have two more people who need part of that:

- a **store manager**, who runs the day: watches and fixes today's closing, corrects past closings, hires and
  lets go of cashiers, manages the phones — but must not change how the closing works;
- an **accountant**, who only needs to read the closing history.

Sharing the owner's password is the workaround this replaces. Success: the owner invites each person by email,
each signs in with their own account, sees only what their role allows, and history shows who changed what.

## Goals

- Two new per-shop roles, `manager` and `accountant`, next to the existing owner.
- The owner invites a person to one shop with a role; the person accepts with their own email account.
- Each role sees only its tabs and can only call its functions. **The database enforces it**; the UI only
  mirrors it.
- Corrections and live edits by a manager are attributed to that person by name, not «Ιδιοκτήτης».
- The owner can see, change the role of, and remove members; removal takes effect at once.

## Non-goals

- More roles or a custom permission editor. Two fixed roles.
- Transferring ownership, or several owners per shop. `shops.owner_id` stays the single owner.
- Members inviting other members.
- Cashier (phone) changes. Staff, PINs, store link, phone gate: untouched.
- A new `addedBy` kind in `ClosingInputs` (see «Attribution»).

## Anti-goals (a failure even if it "works")

- A role check that exists only in the UI. Every owner function and every table policy must check the role.
- An accountant who can change anything, including through a direct table update (`voided_at`, staff `name`,
  device `label`) or a realtime broadcast.
- A manager who can reach «Ρυθμίσεις» actions by calling the RPCs by hand (`publish_config`, `set_closing_plan`,
  `set_day_change_time`, shop rename, `owner_delete_shop`, `owner_erase_staff`).
- A removed member keeping write access until their token expires.

## Permission matrix (decided)

| Area / action | Owner | Manager | Accountant |
|---|---|---|---|
| Shop list (`ShopsScreen`): see the shop | ✓ | ✓ | ✓ |
| «Σήμερα»: view, edit live fields, «Καταχώρηση αλλαγών» | ✓ | ✓ | — |
| «Ιστορικό»: week, day, versions, breakdown | ✓ | ✓ | ✓ (read-only) |
| «Ιστορικό»: «Διόρθωση», «Επαναφορά» | ✓ | ✓ | — |
| «Προσωπικό»: list, add, rename, activate/deactivate, set PIN, unlock | ✓ | ✓ | — |
| «Προσωπικό»: «Οριστική διαγραφή» | ✓ | — | — |
| «Συσκευές»: store link/QR/code, «Νέος σύνδεσμος», device list, label, «Αφαίρεση» | ✓ | ✓ | — |
| «Ρυθμίσεις» (config, closing plan, day-change time, shop name, `DangerZoneCard`) | ✓ | — | — |
| Members: invite, change role, remove, list | ✓ | — | — |
| Create own shops, delete own account | ✓ | ✓ | ✓ (any account; unrelated to membership) |

## Function → role map

Every owner-side function today calls `private.require_owner(shop)` or relies on a policy calling
`private.is_shop_owner(shop)`. Stage 6 keeps both names meaning *owner only* and adds role helpers:

- `private.shop_role(shop) returns text` — `'owner'` | `'manager'` | `'accountant'` | null for the caller
  (`auth.uid()`, non-anonymous only, like `is_shop_owner`). Owner = `shops.owner_id`; otherwise the caller's live
  `shop_members` row.
- `private.require_role(shop, roles text[])` — raises `not_owner` (42501) when the caller's role is not in the
  list. Same error as today, so "not yours", "doesn't exist" and "not allowed for your role" stay
  indistinguishable to a probe. (Builder's call whether the UI needs a distinct `not_allowed`; see open items.)
- `private.can_use_shop_topic` is extended: owner or manager may use `shop:<id>` (accountants have no live view).

| Function / table path | Allowed roles |
|---|---|
| `publish_config`, `set_closing_plan`, `set_day_change_time`, `owner_delete_shop`, `owner_erase_staff`, shop rename (`shops` update policy) | owner |
| `create_staff`, `set_staff_pin`, `unlock_staff`, `staff` update policy (name, active) | owner, manager |
| `owner_get_join_key`, `owner_rotate_join_key`, `owner_list_devices`, `owner_remove_device`, `devices` update policy (label) | owner, manager |
| `owner_get_open_closing`, `owner_set_closing_field` | owner, manager |
| `owner_save_closing` | owner, manager |
| `owner_list_closings`, `owner_get_closing_day` | owner, manager, accountant |
| `closings` update policy (`voided_at`) | owner |
| New member functions (below) | owner |
| `create_shop`, `owner_delete_account` | any signed-in non-anonymous user (unchanged) |

Table read policies (`shops`, `shop_configs`, `staff`, `devices`, `closings`): `shops` readable by any role (the
shop list needs name + role); `staff`, `devices` by owner and manager; `shop_configs` by owner and manager (the
accountant's history payloads already carry their configs); `closings` by owner only unless the builder finds a
client read that needs it (history goes through the RPCs). Builder must grep every `client.from(` in
`src/data/remote/owner.ts` and give each a policy matching the matrix.

The `is_shop_owner` name stays for the owner-only paths; every place that should now also accept a manager or
accountant switches to `shop_role`/`require_role` explicitly. **No function keeps calling `is_shop_owner` where
the matrix says otherwise** — the SQL test enumerates them (see Testing).

## Data model

`shop_members` (new): `id`, `shop_id` (→ shops, cascade), `user_id` (→ auth.users, null until accepted),
`email` (lower-cased, as invited), `display_name` (1–40 chars, typed by the owner at invite), `role`
(`'manager' | 'accountant'`), `invited_at`, `invite_token_hash` (sha256, like staff session tokens),
`invite_expires_at` (invited_at + 7 days), `accepted_at`, `removed_at`. RLS on, no client table access; read
and write only through functions.

- One live (not removed) row per `(shop_id, lower(email))`, and per `(shop_id, user_id)` once accepted.
- The owner cannot be a member of their own shop (`already_owner`).
- Removal sets `removed_at`; access ends at once (every function re-checks for a live row; realtime join
  re-checks via `can_use_shop_topic`). The row and its `user_id` stay so history keeps the name.
- **Name lifetime (my call).** Attribution is keyed by a permanent `member_uid uuid` column (no foreign key, never
  cleared), separate from the access link. `display_name` is fixed at invite (no rename). A person re-invited after
  removal gets a new row; their attributions use the newest row of that uid in the shop. When a member deletes their
  account, `owner_delete_account` first turns each of their rows into a tombstone like staff erasure (LG2):
  `display_name` «Διαγραμμένος συνεργάτης <first 8 hex of member_uid>», `email` cleared, `removed_at` set. The
  placeholder is produced only in SQL. `user_id` → auth.users is `on delete set null`; `member_uid` keeps the link.
  Deleting the shop removes its member rows (cascade) with everything else.
- Cap: 20 live member rows (pending + accepted) per shop, `too_many_members` (22023), under a shop lock, like the
  stage-4 caps.

## Invite flow

1. Owner, on a new «Συνεργάτες» card (in «Ρυθμίσεις», since it is owner-only), enters name, email and role →
   `owner_invite_member(shop, email, name, role)` → returns the raw invite token once (only its hash is stored).
2. The app builds the invite link `<origin+pathname>#/invite/<token>` and shows it with copy / share / a
   `mailto:` button prefilled with the shop name and the link. **No email is sent by the server** (decided by the
   user: the owner sends the link, like the store link).
3. The invitee opens the link. If not signed in: the existing login/sign-up screens (email confirmation as
   today), then back to the invite route. Signed in: «Πρόσκληση στο κατάστημα X ως Υπεύθυνος/Λογιστής» →
   «Αποδοχή» → `accept_shop_invite(token)`.
4. `accept_shop_invite` checks: non-anonymous session, token hash matches a live, unexpired, unaccepted row,
   **and the session's email (`auth.jwt() ->> 'email'`) equals the invited email** (case-insensitive). Then sets
   `user_id`, `accepted_at`, clears the token. Errors: `invite_invalid` (unknown, used, removed),
   `invite_expired`, `invite_wrong_email` («Η πρόσκληση είναι για άλλο email»). It also requires the auth user's
   `email_confirmed_at` to be set (read from `auth.users` in the definer function), so the email match means
   something even if dashboard email confirmation is off (`invite_unconfirmed`).
5. Owner sees members with status (Σε αναμονή / Ενεργός), can «Αλλαγή ρόλου» (`owner_set_member_role`),
   «Αφαίρεση» (`owner_remove_member`), and «Νέος σύνδεσμος» for a pending invite (re-mints the token, resets
   expiry).

The shared-browser rule applies unchanged: opening an invite in a browser holding a paired phone's anonymous
session goes through the same confirmation as the owner login.

## Owner app changes

- `ShopsScreen`: lists shops where the caller has any role (new `my_shops()` RPC or the `shops` policy plus a role
  lookup; builder's call), with a role badge for non-owned shops («Υπεύθυνος», «Λογιστής»). «Νέο κατάστημα» and
  «Διαγραφή λογαριασμού» stay for everyone.
- `ShopLayout`: tabs filtered by role. Manager: «Σήμερα» · «Ιστορικό» · «Προσωπικό» · «Συσκευές». Accountant:
  «Ιστορικό» only. A bare shop route lands on the first allowed tab (owner still «Ρυθμίσεις»); a route to a
  forbidden tab redirects to the first allowed one.
- «Προσωπικό» hides «Οριστική διαγραφή» for a manager. `ClosingView` hides «Διόρθωση»/«Επαναφορά» for an
  accountant. Everything else reuses existing screens.
- Role comes from the server (shop list / a `shop_role` read), never from the URL or local storage. The same read
  returns the caller's display name for «Σήμερα» presence (replaces the `OWNER_PRESENCE_NAME` constant for members).
- **Pending-edit queue per person (my call).** «Σήμερα» queues today under the single author `OWNER_QUEUE_AUTHOR =
  'owner'`. With several office-side people in one browser, one person's unsent edits would go out under another's
  login. The queue author becomes `office:<auth uid>`; stored `'owner'` items are dropped on upgrade (same rule as
  pre-tagging items).
- `OwnerApi` gains member methods and a role read; `fakeApi.ts` grows a role so UI tests can render each role.

## Attribution

- Corrections: `closings.corrected_by` already stores the writer's `auth.uid()`. `author_name` in
  `private.closing_version_json` becomes: the member's `display_name` (kept after removal) if `corrected_by` is a
  member of the shop, else «Ιδιοκτήτης». Same rule for `last_submit.staff_name` and `updated_by_name` in
  `write_closing_field` / snapshots / broadcasts (`updated_by_owner` already holds the uid).
- Presence name in «Σήμερα»: the member's display name instead of «Ιδιοκτήτης».
- Expense lines a manager adds stay `addedBy: {kind:'owner'}` — meaning "added from the office side". This avoids
  a `ClosingInputs` schema bump and its SQL twin. The person is still recorded on the field row
  (`updated_by_owner`) and on the correction row. (My call.)
- Cross-file invariant: «Ιδιοκτήτης» and member names are produced only in SQL; the client never builds them.

## Errors

New server strings, each with a `mapError` case and a Greek `ownerErrorMessage` (CLAUDE.md rule):
`too_many_members`, `already_member`, `already_owner`, `bad_member` (bad email/name/role), `invite_invalid`,
`invite_expired`, `invite_wrong_email`, `invite_unconfirmed`. Wording is the builder's, in the existing tone.

## Constraints (existing invariants that apply)

- Every new function: `security definer`, `search_path = ''`, `revoke … from public, anon`, execute for
  `authenticated`. Identity only from `auth.uid()`/`auth.jwt()`.
- Owner screens never call supabase directly — only `OwnerApi`.
- New migration(s) go to dev `fstfuhogvsdaiwpfdmep` through the connector; the client that needs them ships with
  them.
- Update `CLAUDE.md` (architecture + invariants: role helpers, the matrix as a cross-file invariant with
  `ShopLayout`'s tab filter, role strings in SQL ↔ TS) and `PROJECT_STATUS.md` as the last step.

## Testing

- SQL test `190_shop_roles.sql` (one rolled-back transaction): for each of owner / manager / accountant /
  removed member / pending invitee / stranger, call **every** owner-side function and table write in the map and
  assert allowed or `not_owner`. Invite accept: wrong email, expired, reused, removed. Removal cuts access in the
  same session. Attribution names in version JSON and broadcasts. Realtime topic check for each role.
- Re-run the SQL tests touching owner functions (020, 050, 100, 110, 120, 160, 170, 180).
- Vitest: pure tab-filter/role model, invite route parsing (anchored token regex), `mapError` cases, UI tests per
  role with `fakeApi`.

## Left to the builder

Migration split, exact token format (reuse the join-key alphabet or a longer random token), the `my_shops` shape,
member card layout and Greek copy, whether pending invites are purged by the existing `purge_stale` job.

## Decided after review

- Email delivery: the owner sends the invite link (copy / share / mailto). No Edge Function, no SMTP, no
  service-role key.
