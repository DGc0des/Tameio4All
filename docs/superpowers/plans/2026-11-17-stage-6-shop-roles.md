# Shop Roles (Stage 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner invite a store manager and an accountant by email link, to one or several of their shops, each seeing and doing only what their role allows, with corrections attributed to the real person.

**Architecture:** A new `shop_members` table (function access only) holds per-shop roles. `private.shop_role(shop)` answers `'owner'|'manager'|'accountant'|null` for the caller; `private.require_role(shop, roles)` guards functions; table and realtime policies call `shop_role`. Owner-only paths keep `require_owner`/`is_shop_owner`. Office-side names come from `private.office_name(shop, uid)` in SQL only. The client reads the role per shop from `my_shops()` and filters tabs/actions with a pure role model; the UI is a mirror, never the guard.

**Tech Stack:** Postgres (Supabase, security-definer functions, RLS, Realtime), TypeScript strict, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-shop-roles-design.md` — read it first. Also read the root `CLAUDE.md` «Invariants», «Live shared closing» (one write path, presence, queue per author) and «Closing history» (`closing_version_json`, `owner_save_closing`).

## Global Constraints

- Roles are exactly `'manager'` and `'accountant'` (members); `'owner'` is `shops.owner_id`, never a `shop_members` row. Cross-file: SQL checks ↔ `ShopRole`/`isShopRole` in `src/features/owner/model/roles.ts`.
- Permission matrix and function → role map: verbatim from the spec. Unauthorized = `not_owner` (42501), the same as "doesn't exist".
- Invite token: 32 characters of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, regex `^[A-HJ-NP-Z2-9]{32}$`, produced only in SQL (`private.new_invite_token`), stored only as sha256 hex; checked by `parseInviteToken` (`src/app/inviteToken.ts`). Cross-file invariant.
- Invite route: `#/owner/invite/<token>` (under the owner area so it reuses its sign-in screens). Link = `<origin+pathname>#/owner/invite/<token>`.
- Invite expiry 7 days; member cap 20 live rows (pending + accepted, not removed) per shop; `display_name` 1–40 chars trimmed; email trimmed + lower-cased, must match `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- Tombstone name: `Διαγραμμένος συνεργάτης <first 8 hex of member_uid without dashes>`, produced only in SQL.
- Fallback office name «Ιδιοκτήτης» stays for the shop owner.
- New server error strings: `too_many_members`, `already_member`, `already_owner`, `bad_member`, `invite_invalid`, `invite_expired`, `invite_wrong_email`, `invite_unconfirmed` (all raised with errcode 22023). Each needs a `mapError` case and a Greek `ownerErrorMessage` (copy in Task 4).
- Every new/re-created function: `security definer`, `set search_path = ''`, `revoke all … from public, anon`, `grant execute … to authenticated` (private helpers: also revoke from `authenticated`, except `private.shop_role`, which policies call). A changed signature = `drop function` of the old one first.
- No email is sent by the server: no Edge Function, no SMTP, no new CSP origin.
- Greek copy below is fixed; code/comments in English. `npm test` and `npm run typecheck` pass before every commit. Commit style `feat(db): …`, `feat(owner): …`.
- Migrations are written in Tasks 1–2 and applied to dev only in Task 8 (via the Supabase connector, project `fstfuhogvsdaiwpfdmep`). Until then SQL tests are «written, not run».

## Review Focus

1. A manager or accountant calls an owner-only RPC (or a direct table update) by hand → `not_owner`, nothing changed. (Task 1, T3–T5 enumerate every function and table write per role.)
2. A member is removed while signed in with «Σήμερα» open → the next write fails `not_owner`, realtime join is refused; history still shows their name on old corrections. (Task 1 T7; Task 2 T3)
3. Someone opens an invite while signed in with a different email, or with an unconfirmed email, or after it expired / was reissued → a clear Greek message, nothing accepted. (Task 1 T6; Task 6 InviteScreen tests)
4. A brand-new invitee has no account: opens the link → signs up → confirms by email → lands on the invite, not on an empty shop list. (Task 6 OwnerApp pending-invite test)
5. Owner and manager share one browser and both leave unsent «Σήμερα» edits → each person's edits go out only under their own login. (Task 5 TodayScreen queue-author test)

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/20261117000003_shop_roles.sql` | new: `shop_members`, role helpers, member functions, `my_shops`, policies, re-created role-guarded functions, realtime topic, account-deletion tombstone |
| `supabase/migrations/20261117000004_office_names.sql` | new: `private.office_name`, names in versions / fields / broadcasts / `last_submit` |
| `supabase/tests/190_shop_roles.sql`, `200_office_names.sql`, `README.md` | new SQL tests + README paragraph |
| `src/features/owner/model/roles.ts` | new, pure: roles, tab filter, capabilities, labels |
| `src/app/inviteToken.ts` | new, pure: token parse/format, link, mailto |
| `src/app/router.ts` | `{ name: 'invite'; token: string \| null }` route |
| `src/data/local/pendingInvite.ts` | new: the invite token kept across sign-up |
| `src/data/remote/ownerApi.ts`, `owner.ts`, `errors.ts` | `ShopRow.role/myName`, `SessionInfo.userId`, member + invite methods, errors |
| `src/features/owner/model/messages.ts` | Greek messages for the new errors |
| `src/features/owner/ShopsScreen.tsx`, `ShopLayout.tsx`, `OwnerStaffScreen.tsx`, `history/ClosingView.tsx`, `history/DayScreen.tsx`, `TodayScreen.tsx`, `todayWriter.ts` | role-aware UI, office queue author, presence name |
| `src/features/owner/settings/MembersCard.tsx`, `settings/SettingsScreen.tsx` | new «Συνεργάτες» card |
| `src/features/owner/InviteScreen.tsx`, `OwnerApp.tsx` | accept flow, pending invite after sign-up |
| `tests/features/owner/fakeApi.ts` | follows the interface |
| `CLAUDE.md`, `PROJECT_STATUS.md`, `project-notes/*` | last step (Task 8) |

---

### Task 1: Database — members, roles, guards

**Files:**
- Create: `supabase/migrations/20261117000003_shop_roles.sql`
- Create: `supabase/tests/190_shop_roles.sql`
- Modify: `supabase/tests/README.md` (one paragraph for `190`; test users: member M `…c1`, member N `…c2`)

**Interfaces:**
- Produces (SQL, used by Task 2 and the client in Task 4):
  - table `public.shop_members(id uuid pk, shop_id uuid → shops on delete cascade, invite_id uuid not null, email text null, display_name text not null check 1..40 trimmed, role text check in ('manager','accountant'), invite_token_hash text null, invited_at timestamptz, invite_expires_at timestamptz, user_id uuid null → auth.users on delete set null, member_uid uuid null (no FK), accepted_at timestamptz null, removed_at timestamptz null)`; partial unique indexes `(shop_id, email) where removed_at is null` and `(shop_id, user_id) where removed_at is null and user_id is not null`; index on `invite_token_hash`, on `member_uid`. RLS on, `revoke all from public, anon, authenticated`.
  - `private.shop_role(p_shop uuid) returns text` — null for anonymous/no caller; `'owner'` if `shops.owner_id = auth.uid()`; else the role of the caller's row with `user_id = auth.uid() and removed_at is null and accepted_at is not null`. Stable, executable by `authenticated`.
  - `private.require_role(p_shop uuid, p_roles text[]) returns void` — raises `not_owner` 42501 unless `shop_role(p_shop) = any(p_roles)`.
  - `private.new_invite_token() returns text` — like `private.new_join_key` (same alphabet), 32 chars from 32 random bytes.
  - `public.my_shops() returns table (id uuid, name text, role text, my_name text)` — every shop where the caller has a role, ordered by `shops.created_at`; `my_name` = «Ιδιοκτήτης» for the owner, the member's `display_name` otherwise.
  - `public.owner_invite_member(p_shops uuid[], p_email text, p_name text, p_role text) returns text` (the raw token).
  - `public.owner_list_members(p_shop uuid) returns table (id uuid, email text, display_name text, role text, status text, invite_expires_at timestamptz, accepted_at timestamptz)` — live rows only; `status` in `'pending'|'expired'|'active'`; ordered pending first, then `display_name`.
  - `public.owner_set_member_role(p_member uuid, p_role text) returns void`
  - `public.owner_remove_member(p_member uuid) returns void`
  - `public.owner_reissue_invite(p_member uuid) returns text` — pending/expired rows only (an accepted row → `invite_invalid`); new token, new `invite_id`, expiry reset to now + 7 days.
  - `public.invite_info(p_token text) returns jsonb` `{shops:[{id,name}], role, display_name, email, expires_at}` — non-anonymous caller; unknown/used/removed → `invite_invalid`; expired → `invite_expired`. No email check here (the screen shows whom it is for).
  - `public.accept_shop_invite(p_token text) returns uuid[]` (shop ids accepted).

- [ ] **Step 1: Write `190_shop_roles.sql`** (format of `180`: one transaction, ends in `ROLLBACK`; failures raise `'T<n> …'`). Setup: owner A `…a1` with shops A1, A2 (`create_shop`), owner B `…b1` with shop B; users M `…c1` (`m@test.local`, `email_confirmed_at` now), N `…c2` (`n@test.local`, `email_confirmed_at` null), stranger `…51`; staff ΜΑΡΙΑ in A1; phone `…d1` joined to A1. Cases:
  - T1 invite: A invites `M@Test.local ` as manager to `{A1, A2}` → token matches `^[A-HJ-NP-Z2-9]{32}$`; two rows, same `invite_id`, email `m@test.local`, `invite_token_hash` = sha256 hex of the token, raw token in no column. Including shop B in the array → `not_owner`, zero rows created. Bad role / empty name / 41-char name / `not-an-email` → `bad_member`. Same email again for A1 → `already_member`. A inviting `a1@test.local` → `already_owner`. 21st live row in A1 → `too_many_members`.
  - T2 `invite_info` as M → both shop names, role `manager`; as anon phone `…d1` → `not_owner`; with a random token → `invite_invalid`.
  - T3 before accepting, M calls `owner_list_closings(A1)` → `not_owner`. Accept as N (other email) → `invite_wrong_email`; as M with `email_confirmed_at` null (set it null as postgres, then back) → `invite_unconfirmed`; as M → returns both shop ids; rows have `user_id = member_uid = M`, `accepted_at` set, `invite_token_hash` null; accepting again → `invite_invalid`. `shop_role` as M = `manager` for A1/A2, null for B. `my_shops()` as M → A1, A2 with role `manager`, `my_name` = the invited name.
  - T4 manager M on A1, each must succeed: `create_staff`, `set_staff_pin`, `unlock_staff`, direct `update staff set name/active`, `owner_get_join_key`, `owner_rotate_join_key`, `owner_list_devices`, direct `update devices set label`, `owner_remove_device`, `owner_get_open_closing`, `owner_set_closing_field`, `owner_list_closings`, `owner_get_closing_day`, `owner_save_closing` (a past-day correction, reuse `110`'s setup pattern), `select` on `staff`, `devices`, `shop_configs`, `shops` of A1; `private.can_use_shop_topic('shop:'||A1)` true. Each must raise `not_owner` or change 0 rows: `publish_config`, `set_closing_plan`, `set_day_change_time`, `update shops set name`, `owner_delete_shop`, `owner_erase_staff`, `update closings set voided_at`, `select` on `closings`, all member functions on A1.
  - T5 accountant: A sets M's role on A2 to `accountant` (`owner_set_member_role`). On A2 only `owner_list_closings`, `owner_get_closing_day` and `select` on `shops` succeed; every T4 call → `not_owner` / 0 rows / no rows read; `can_use_shop_topic` false.
  - T6 expiry and reissue: an invite for `n@test.local` back-dated past `invite_expires_at` (as postgres) → `invite_info`/accept `invite_expired`, `owner_list_members` status `expired`; `owner_reissue_invite` → old token `invite_invalid`, new one accepted by N after confirming N's email.
  - T7 removal: A removes M from A1 → as M, `owner_set_closing_field(A1, …)` → `not_owner`, `can_use_shop_topic` false, `my_shops` no longer lists A1 but still A2; the row keeps `member_uid` and `display_name`. M can be re-invited to A1 (new row).
  - T8 account deletion: as M, `owner_delete_account()` → every row with `member_uid = M` has `display_name` `Διαγραμμένος συνεργάτης ` || first 8 hex of M without dashes, `email` null, `removed_at` set, `user_id` null; shops A1/A2 untouched.
  - T9 grants: `anon` has no execute on any new function; `authenticated` has none on `private.require_role`/`private.new_invite_token`, has it on `private.shop_role`; no client privilege on `shop_members`.

- [ ] **Step 2: Write the migration.** Order: table + indexes + RLS/revokes → `shop_role`, `require_role`, `new_invite_token` → member functions → `my_shops` → policies → re-created functions → `can_use_shop_topic` → `owner_delete_account`. Rules the tests don't spell out:
  - `owner_invite_member`: `require_owner` on every shop of `p_shops` (empty/null array → `bad_member`, duplicates collapsed), then lock each shop row `for no key update` in id order, check cap and uniqueness per shop, insert one row per shop with one `invite_id` and one token hash. `already_owner` when the email equals the caller's `auth.users.email`.
  - `accept_shop_invite`: read `email` and `email_confirmed_at` from `auth.users where id = auth.uid()` (never the JWT). Check order: non-anonymous → token found among live rows (`invite_invalid`) → not expired (`invite_expired`) → email confirmed (`invite_unconfirmed`) → email matches (`invite_wrong_email`) → for each row: if the caller owns that shop → mark removed; if the caller already has a live accepted row in that shop → mark this row removed; else set `user_id`, `member_uid`, `accepted_at`, clear the hash. Return the accepted shop ids; if none were accepted, raise `already_member`.
  - `owner_set_member_role` / `owner_remove_member` / `owner_reissue_invite`: look up the row's shop (missing or removed → `not_owner`), then `require_owner`.
  - Policies (drop + create): `shops_owner_read` → `private.shop_role(id) is not null`; `configs_owner_read` → `shop_role(shop_id) in ('owner','manager')`; `staff_owner_read`, `devices_owner_read`, `devices_owner_update` → same; `staff_owner_update` → `erased_at is null and shop_role(shop_id) in ('owner','manager')` both sides. `shops_owner_update`, `closings_owner_read`, `closings_owner_update` unchanged.
  - Re-created functions: copy each latest body unchanged except the guard line → `perform private.require_role(<shop>, array['owner','manager'])`: `create_staff` (`20261114000004_owner_caps`), `set_staff_pin` (`20261115000001_erasure`), `unlock_staff` (`…erasure`), `owner_get_join_key`, `owner_rotate_join_key`, `owner_list_devices`, `owner_remove_device` (`20261112000001_store_join_keys`), `owner_get_open_closing` (`20261108000001_open_closings`), `owner_set_closing_field` and `owner_save_closing` (latest: `20261117000001_multi_closing` / `20261117000002_multi_closing_history`); `owner_list_closings`, `owner_get_closing_day` (`…multi_closing_history`) with `array['owner','manager','accountant']`. Before copying, confirm the latest body with `grep -n "function public.<name>" supabase/migrations/*.sql | tail -1`. Signatures do not change, so `create or replace` and the existing grants stand.
  - `can_use_shop_topic`: replace `if private.is_shop_owner(v_shop)` with `if private.shop_role(v_shop) in ('owner','manager')`.
  - `owner_delete_account` (body from `…erasure`): before `delete from auth.users`, tombstone every `shop_members` row with `member_uid = v_uid`.

- [ ] **Step 3: Self-check without a database.** Read the migration against every T-case and against the matrix in the spec; `grep -c "require_owner" supabase/migrations/20261117000003_shop_roles.sql` should count only the owner-only member functions.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261117000003_shop_roles.sql supabase/tests/190_shop_roles.sql supabase/tests/README.md
git commit -m "feat(db): shop members with manager and accountant roles"
```

### Task 2: Database — office names

**Files:**
- Create: `supabase/migrations/20261117000004_office_names.sql`
- Create: `supabase/tests/200_office_names.sql`
- Modify: `supabase/tests/README.md`

**Interfaces:**
- Consumes: `shop_members` (Task 1).
- Produces: `private.office_name(p_shop uuid, p_uid uuid) returns text` = `display_name` of the row with `shop_id = p_shop and member_uid = p_uid` with the latest `accepted_at` (removed rows included), else «Ιδιοκτήτης». No client execute. Payload shapes unchanged (only the name strings change).

- [ ] **Step 1: Write `200_office_names.sql`.** Shop A with member M (manager, «Νίκος») and cashier ΜΑΡΙΑ:
  - T1 M writes a field through `owner_set_closing_field` → the stored field's `updated_by_name` in `owner_get_open_closing` is «Νίκος»; owner A writes another → «Ιδιοκτήτης»; ΜΑΡΙΑ's → «ΜΑΡΙΑ».
  - T2 after ΜΑΡΙΑ submits, M saves the live closing via `owner_save_closing` → `last_submit.staff_name` «Νίκος»; the new version's `author_name` in `owner_get_closing_day` «Νίκος»; an owner correction's «Ιδιοκτήτης».
  - T3 A removes M → the version still shows «Νίκος»; after M deletes the account → `Διαγραμμένος συνεργάτης <8 hex>`.
  - T4 re-invited as «Νίκος Π.» and accepted → his old and new versions show «Νίκος Π.» (latest row wins).
  - T5 the `field` broadcast payload's `updated_by_name` (read from `realtime.messages` as postgres, like `080`) is «Νίκος».
- [ ] **Step 2: Write the migration.** `private.closing_version_json` (from `20261111000001_closing_versions`): `author_name` = staff name when `c.staff_id` is set, else `private.office_name(c.shop_id, c.corrected_by)`. `private.closing_snapshot` (from `20261117000001_multi_closing`): `coalesce(st.name, private.office_name(oc.shop_id, f.updated_by_owner))`. `private.write_closing_field` (same file): the returned/broadcast `updated_by_name` when `p_staff is null` = `office_name(p_shop, p_owner)`, and the `current` of a `stale` answer likewise. `owner_save_closing` (from `…0002_multi_closing_history`): `last_submit.staff_name` = `office_name(p_shop_id, auth.uid())`. Copy each body whole, change only those expressions, keep the Task 1 guard in `owner_save_closing`.
- [ ] **Step 3: Commit** `feat(db): office-side names in history, fields and last submit`.

### Task 3: Pure role model, invite token, route, pending invite

**Files:**
- Create: `src/features/owner/model/roles.ts`, `src/app/inviteToken.ts`, `src/data/local/pendingInvite.ts`
- Modify: `src/app/router.ts`
- Test: `tests/features/owner/roles.test.ts`, `tests/app/inviteToken.test.ts`, `tests/app/router.test.ts` (extend), `tests/data/local/pendingInvite.test.ts`

**Interfaces:**
- Produces:
  - `type ShopRole = 'owner' | 'manager' | 'accountant'`; `type MemberRole = Exclude<ShopRole, 'owner'>`; `isShopRole(x: unknown): x is ShopRole`; `isMemberRole(x: unknown): x is MemberRole`.
  - `allowedTabs(role: ShopRole): readonly ShopTab[]` — owner: today, history, settings, staff, devices; manager: today, history, staff, devices; accountant: history.
  - `landingTab(role: ShopRole): ShopTab` — owner `'settings'`, manager `'today'`, accountant `'history'`.
  - `can(role: ShopRole, action: 'eraseStaff' | 'correct' | 'manageMembers' | 'editShop'): boolean` — `eraseStaff`/`manageMembers`/`editShop`: owner only; `correct`: owner, manager.
  - `ROLE_LABEL: Record<MemberRole, string>` = `{ manager: 'Υπεύθυνος καταστήματος', accountant: 'Λογιστής' }`.
  - `INVITE_TOKEN_RE = /^[A-HJ-NP-Z2-9]{32}$/`; `parseInviteToken(s: string): string | null` (trim, upper-case, same Greek look-alike mapping as `parseJoinKey` — reuse its mapping helper, export it from `joinKey.ts` if private); `inviteLink(base: string, token: string): string` → `${base}#/owner/invite/${token}`; `inviteMailto(email: string, shopNames: string[], role: MemberRole, link: string): string` → `mailto:` + encoded email, subject «Πρόσκληση στο Tameio4All», body `Σε προσκαλώ ως ${ROLE_LABEL[role]} στο κατάστημα: ${shopNames.join(', ')}.\n\nΆνοιξε τον σύνδεσμο και συνδέσου με αυτό το email:\n${link}` (all via `encodeURIComponent`).
  - Router: `OwnerRoute` gains `{ name: 'invite'; token: string | null }`; `parseOwnerRoute('/invite/<x>')` → token via `parseInviteToken` (malformed → `null`); `ownerHash` round-trips a valid token.
  - `loadPendingInvite(store): string | null`, `savePendingInvite(store, token): boolean`, `clearPendingInvite(store): void` — key `tameio4all:v1:pending-invite`, value re-checked with `parseInviteToken` on load, failure-safe like `phone.ts`.

- [ ] **Step 1: Write the failing tests.** `roles.test.ts`: the three `allowedTabs` lists and `landingTab` values above; `can('manager','eraseStaff') === false`, `can('manager','correct') === true`, `can('accountant','correct') === false`; `isShopRole('owner')` true, `isMemberRole('owner')` false, `isShopRole('admin')` false. `inviteToken.test.ts`: a 32-char token round-trips, 31/33 chars → null, lower-case accepted, `O`/`0`/`1`/`I` rejected, Greek `Α` → `A`; `inviteLink('https://x.app/', T)` → `'https://x.app/#/owner/invite/' + T`; `inviteMailto` starts with `mailto:m%40test.gr?subject=` and its decoded body contains the link and «Λογιστής». Router: `#/owner/invite/<T>` → `{name:'invite', token:T}`, `#/owner/invite/bad` → `{name:'invite', token:null}`, `#/owner/invite/<T>/x` → `{name:'shops'}`. Pending invite: save/load/clear, a junk stored value → null, a throwing store → null/false.
- [ ] **Step 2: Run** `npx vitest run tests/features/owner/roles.test.ts tests/app/inviteToken.test.ts tests/app/router.test.ts tests/data/local/pendingInvite.test.ts` — expected FAIL (modules missing).
- [ ] **Step 3: Implement** the modules with the signatures above (`roles.ts` imports nothing but `ShopTab`).
- [ ] **Step 4: Run** the same command — PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat(owner): role model, invite token and route`.

### Task 4: OwnerApi — roles, members, invites, errors

**Files:**
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/data/remote/errors.ts`, `src/features/owner/model/messages.ts`, `tests/features/owner/fakeApi.ts`
- Test: `tests/data/remote/errors.test.ts` (or the existing `mapError` test file — find it with `grep -rln mapError tests`), `tests/features/owner/messages.test.ts`

**Interfaces:**
- Consumes: SQL functions from Task 1; `ShopRole`, `MemberRole`, `isShopRole`, `isMemberRole`, `parseInviteToken` (Task 3).
- Produces:
  - `SessionInfo.userId: string | null` (from `session.user.id`).
  - `ShopRow` = `{ id: string; name: string; role: ShopRole; myName: string }`; `listShops()` calls `rpc('my_shops')`, drops rows with an unknown role.
  - `MemberRow` = `{ id: string; email: string | null; displayName: string; role: MemberRole; status: 'pending' | 'expired' | 'active'; expiresAt: string | null; acceptedAt: string | null }`.
  - `InviteInfo` = `{ shops: { id: string; name: string }[]; role: MemberRole; displayName: string; email: string; expiresAt: string }`.
  - New `OwnerApi` methods: `inviteMember(shopIds: string[], email: string, name: string, role: MemberRole): Promise<Result<string>>` (token through `parseInviteToken`, else `bad_response`); `listMembers(shopId): Promise<Result<MemberRow[]>>`; `setMemberRole(memberId, role): Promise<Result<void>>`; `removeMember(memberId): Promise<Result<void>>`; `reissueInvite(memberId): Promise<Result<string>>`; `inviteInfo(token): Promise<Result<InviteInfo>>`; `acceptInvite(token): Promise<Result<string[]>>`.
  - `OwnerError` gains the eight codes of the Global Constraints (no payload).
  - `fakeApi`: `session` adds `userId: 'owner-uid'`; `listShops` default stays `[]`; new methods default to `ok` values (`'A'.repeat(32)` for tokens, `[]` lists, a fixed `InviteInfo`).

- [ ] **Step 1: Write the failing tests.** `mapError({ message: c })` returns `{ code: c }` for each of the eight codes. `ownerErrorMessage` returns exactly:
  - `too_many_members` «Έφτασες το όριο των 20 συνεργατών σε αυτό το κατάστημα.»
  - `already_member` «Αυτό το email έχει ήδη πρόσβαση ή πρόσκληση σε αυτό το κατάστημα.»
  - `already_owner` «Είσαι ο ιδιοκτήτης αυτού του καταστήματος.»
  - `bad_member` «Έλεγξε το όνομα, το email και τον ρόλο.»
  - `invite_invalid` «Η πρόσκληση δεν ισχύει πια. Ζήτα νέα από τον ιδιοκτήτη.»
  - `invite_expired` «Η πρόσκληση έληξε. Ζήτα νέα από τον ιδιοκτήτη.»
  - `invite_wrong_email` «Η πρόσκληση είναι για άλλο email. Συνδέσου με το email της πρόσκλησης.»
  - `invite_unconfirmed` «Επιβεβαίωσε πρώτα το email σου από το μήνυμα που σου στείλαμε.»
- [ ] **Step 2: Run** those test files — FAIL.
- [ ] **Step 3: Implement** the types, `mapError` cases (add to the `return { code: message }` group), messages, the `owner.ts` methods (RPC args `p_shops`, `p_email`, `p_name`, `p_role`, `p_shop`, `p_member`, `p_token`; parse rows structurally, a malformed row → dropped for lists, `bad_response` for single values), and `fakeApi`. Fix every compile error from the `ShopRow` change in tests by adding `role: 'owner', myName: 'Ιδιοκτήτης'` to fixture rows.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(owner): member and invite API`.

### Task 5: Role-aware owner screens

**Files:**
- Modify: `src/features/owner/ShopsScreen.tsx`, `ShopLayout.tsx`, `OwnerStaffScreen.tsx`, `history/DayScreen.tsx`, `history/ClosingView.tsx`, `TodayScreen.tsx`, `todayWriter.ts`, `OwnerApp.tsx` (pass `userId`)
- Test: `tests/features/owner/shops.test.tsx`, `staff.test.tsx`, `today.test.tsx`, `history/*` (extend), new `tests/features/owner/shopLayout.test.tsx`

**Interfaces:**
- Consumes: `ShopRow.role/myName`, `SessionInfo.userId` (Task 4); `allowedTabs`, `landingTab`, `can`, `ROLE_LABEL` (Task 3).
- Produces: `ShopLayout` prop `userId: string | null`; `OwnerStaffScreen` prop `role: ShopRole`; `DayScreen`/`ClosingView` prop `canCorrect: boolean`; `TodayScreen` props `me: { name: string; id: string }`; `createTodayWriter(api, shopId, presenceName: string)`; `officeQueueAuthor(userId: string): string` → `` `office:${userId}` `` (in `todayWriter.ts`).

- [ ] **Step 1: Write the failing tests.**
  - Shops: a list with an owned shop and a manager shop shows the badge «Υπεύθυνος καταστήματος» only on the second; «Διαγραφή λογαριασμού» clears local data only of shops with role `owner`.
  - ShopLayout (render with `fakeApi` whose `listShops` returns the shop with each role): manager sees exactly the tabs «Σήμερα», «Ιστορικό», «Προσωπικό», «Συσκευές» and no rename (✎) button; accountant sees only «Ιστορικό»; a manager on `tab: 'settings'` is navigated (replace) to `today`; an accountant on `tab: 'staff'` to `history`; owner unchanged (five tabs, rename shown).
  - Staff: with `role: 'manager'` there is no «Οριστική διαγραφή» button; owner still has it.
  - ClosingView/DayScreen: with `canCorrect: false` a past closing shows neither «Διόρθωση» nor «Επαναφορά αυτής της έκδοσης»; with `true` both as today.
  - Today: with `me = { name: 'Νίκος', id: 'office:u1' }`, `api.live` is called with `{ name: 'Νίκος' }`; pending edits stored under `office:u2` are not sent (assert `setTodayField` not called for them).
- [ ] **Step 2: Run** the touched test files — FAIL.
- [ ] **Step 3: Implement.** ShopLayout keeps `role`/`myName` from the `listShops` row it already loads; filters `TABS` by `allowedTabs(role)`; if `tab` is not allowed, `navigate({name:'shop', shopId, tab: landingTab(role)}, {replace:true})` and render nothing until then; shows ✎ only when `can(role,'editShop')`; passes `me = { name: myName, id: officeQueueAuthor(userId ?? 'unknown') }` (memoized) to `TodayScreen`, `role` to staff, `canCorrect = can(role,'correct')` to `DayScreen`. ClosingView: `editable = canCorrect && !isLive` gates both buttons; keep the live-closing notice for owner/manager only. Remove the `OWNER` constant from TodayScreen; keep `OWNER_PRESENCE_NAME` only if still used, else delete it. Owner's old `'owner'` queue items stay hidden and are dropped by `savePending` after their day (note in `CLAUDE.md`, Task 8).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(owner): tabs and actions by role`.

### Task 6: Members card and invite acceptance

**Files:**
- Create: `src/features/owner/settings/MembersCard.tsx`, `src/features/owner/InviteScreen.tsx`
- Modify: `src/features/owner/settings/SettingsScreen.tsx` (card before `DangerZoneCard`), `src/features/owner/OwnerApp.tsx`
- Test: `tests/features/owner/members.test.tsx`, `tests/features/owner/invite.test.tsx`

**Interfaces:**
- Consumes: `inviteMember`, `listMembers`, `setMemberRole`, `removeMember`, `reissueInvite`, `inviteInfo`, `acceptInvite`, `listShops` (Task 4); `inviteLink`, `inviteMailto`, `ROLE_LABEL` (Task 3); `loadPendingInvite`/`savePendingInvite`/`clearPendingInvite` (Task 3); `redirectBase` (already an `OwnerApp` prop, pass it to `SettingsScreen` → `MembersCard`).
- Produces: `MembersCard({ api, shopId, shopName, redirectBase })`; `InviteScreen({ api, token, store, navigate })`.

- [ ] **Step 1: Write the failing tests.**
  - MembersCard: title «Συνεργάτες»; lists members with role label and status «Σε αναμονή» / «Έληξε» / «Ενεργός»; the form (fields «Όνομα», «Email», role choice «Υπεύθυνος καταστήματος» / «Λογιστής», a checkbox per owned shop — rows of `listShops` with role `owner` — current shop pre-checked; submit «Πρόσκληση») calls `inviteMember([current, other], 'm@test.gr', 'Νίκος', 'accountant')`; on success it shows the link from `inviteLink(redirectBase, token)` with «Αντιγραφή συνδέσμου», «Κοινοποίηση» (only when `navigator.share` exists) and «Αποστολή με email» (an `<a href>` equal to `inviteMailto(...)`) and the hint «Ο σύνδεσμος ισχύει 7 ημέρες. Στείλ' τον μόνο σε αυτό το άτομο.»; «Αφαίρεση» asks «Αφαίρεση του/της Νίκος; Χάνει αμέσως την πρόσβαση σε αυτό το κατάστημα.» then calls `removeMember`; «Αλλαγή ρόλου» calls `setMemberRole`; a pending/expired row offers «Νέος σύνδεσμος» → `reissueInvite` → shows the new link; an `already_member` failure shows its Greek message.
  - InviteScreen: shows «Πρόσκληση» with the shop names and «ως Λογιστής» from `inviteInfo`, plus «για m@test.gr»; «Αποδοχή» → `acceptInvite(token)` → `clearPendingInvite` and navigate to `shops`; «Όχι τώρα» → clear + `shops`; `invite_wrong_email` / `invite_expired` / `invite_invalid` / `invite_unconfirmed` show their messages (expired/invalid also clear the pending token); `token: null` shows «Ο σύνδεσμος πρόσκλησης δεν είναι σωστός.».
  - OwnerApp: route `invite` with no session saves the pending token and renders the login screen (still offering «Δημιουργία λογαριασμού»); with a session renders InviteScreen; after a `signup` redirect exchange, a stored pending token navigates to `{name:'invite', token}` instead of `shops`.
- [ ] **Step 2: Run** the two new test files — FAIL.
- [ ] **Step 3: Implement.** Reuse `StoreLinkCard`'s copy/share/fallback pattern (extract a small shared `LinkActions` component only if it removes duplication cleanly). Validate the form client-side with `checkName(name, 40)` and the email regex of the Global Constraints before calling (server stays the guard). In `OwnerApp`, `case 'invite'`: if `owner` → `<InviteScreen …/>`, else save pending + `login`. In the redirect effect, replace `navigate({name:'shops'})` for `kind === 'signup'` with the pending-invite route when one is stored.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(owner): invite collaborators and accept invites`.

### Task 7: Whole-branch check

- [ ] **Step 1:** `npm test`, `npm run typecheck`, `npm run build` — all pass (if `.claude/worktrees` exists, run Vitest with `--exclude '.claude/**'`).
- [ ] **Step 2:** `grep -rn "is_shop_owner\|require_owner" supabase/migrations/20261117000003_shop_roles.sql` — every hit is on an owner-only path from the matrix.
- [ ] **Step 3:** `grep -rn "from('" src/data/remote/owner.ts` — each table read/update is allowed for the roles whose screens call it (manager: staff, devices; owner: shops update, shop_configs). Fix gaps in Task 1's policies.

### Task 8: Apply to dev, run SQL tests, docs

- [ ] **Step 1:** Apply `20261117000003_shop_roles` then `20261117000004_office_names` to dev with the Supabase connector (`apply_migration`; byte-identical to the repo files). Dry-run each first inside `begin; … rollback;` with `execute_sql`.
- [ ] **Step 2:** Run `190`, `200` and re-run `010`, `020`, `050`, `080`, `100`, `110`, `120`, `160`, `170`, `180` (each pasted whole, with a final `select 'ok'` marker). Record pass/fail per file; a failure stops the task.
- [ ] **Step 3:** `get_advisors` (security + performance); note new findings.
- [ ] **Step 4:** Docs: `CLAUDE.md` — a «Shop roles (stage 6)» section: `shop_members`, `shop_role`/`require_role` (and `private.shop_role` added to the client-executable `private.*` exceptions), the function → role map as a cross-file invariant with `allowedTabs`/`can`, role strings, the invite token format and route, `office_name` as the only producer of office names, the tombstone text, queue author `office:<uid>`, the eight error strings; update the `src/features/owner/` architecture bullet (tabs by role, «Συνεργάτες»). `PROJECT_STATUS.md`: stage 6 entry with «Not verified» (real invite by email on a phone, sign-up + confirm round trip, two people in one browser, manager on a real phone with «Σήμερα» open while removed). `project-notes/session-log.md` + `index.md`.
- [ ] **Step 5: Commit** `docs: stage 6 shop roles applied to dev`.
