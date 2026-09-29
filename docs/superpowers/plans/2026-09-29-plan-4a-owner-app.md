# Tameio4All Plan 4a — owner app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner signs up with email + password, creates a shop, edits and publishes its settings (float, denominations, channels, +/− formula builder with live preview, tare), manages staff + PINs, and generates pairing codes / revokes devices — against the dev Supabase project.

**Architecture:** Same Vite/React app; the owner area lives under `#/owner/…` and is lazy-loaded. `src/data/remote/` is the only code importing supabase-js; `owner.ts` is the one path for owner writes and returns `Result<T>` with a closed `OwnerError` union. Owner logic that needs no React (settings reducer, term labels, preview, limits, pairing, messages) lives in `src/features/owner/model/` and is tested with Vitest; screens receive an injected `OwnerApi`, so UI tests use a fake and never load supabase-js.

**Tech Stack:** React 19, TypeScript (strict), Vite 8, Vitest 5 + Testing Library (jsdom), `@supabase/supabase-js` 2.x (PKCE auth), Supabase Postgres (connector: `apply_migration`, `execute_sql`, `get_advisors`).

**Spec:** `docs/superpowers/specs/2026-09-29-plan-4a-owner-app-design.md` (parents: `2026-09-28-tameio4all-v1-design.md`, `2026-09-29-plan-3-supabase-design.md`)

## Global Constraints

- Code and comments in English; every user-visible string in Greek.
- Money is integer cents; text → cents only via `parseAmount` (core); display only via `formatEuro`. Components never add money — totals come from `evaluateTotals` (via `previewTotals`).
- Only `src/data/local/*` touches localStorage; only `src/data/remote/*` imports `@supabase/supabase-js`. Tests never import `src/data/remote/client.ts` or `src/features/owner/OwnerEntry.tsx`.
- Every owner write goes through `OwnerApi` (`src/data/remote/owner.ts`); screens never call supabase directly.
- Supabase auth: `flowType: 'pkce'`, `detectSessionInUrl: false`, `storageKey: 'tameio4all:v1:auth'`, storage = failure-safe adapter over the app `KeyValueStore`.
- Names: shop 1–80, staff 1–40, device label 0–60 characters (trimmed, counted in code points). PIN `^[0-9]{4}$`. Password ≥ 8 characters.
- `publish_config` conflicts are never retried automatically.
- Every async action settles its busy flag on every branch (success, error, thrown).
- 44px minimum touch targets; inputs have an accessible name (`aria-label`).
- Database: project `fstfuhogvsdaiwpfdmep` (dev) only; new functions `security definer` + `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`; SQL tests end in `ROLLBACK`; `get_advisors(security)` has no ERROR after the migration.
- `npm run typecheck` and `npm test` pass before every commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Email link opened in another browser / expired / already used** → a clear «Ο σύνδεσμος δεν λειτούργησε» screen with ways forward, never a spinner or blank page — pinned in Task 8 (`link error` test).
2. **Owner session expires mid-edit** → publishing shows «Η σύνδεση έληξε», the unpublished settings draft is still in local storage — pinned in Task 10 (`session expired keeps draft` test).
3. **Settings on the server that fail `validateConfig`** (hand-edited, older app) → the editor still opens (shows the errors) or, if structurally broken, starts from a blank config with a notice; it never crashes — pinned in Task 10.
4. **Greek names at the length limit / whitespace-only / emoji** → 40 Greek letters accepted, 41 refused, `'   '` refused, an emoji counts as one character — pinned in Task 3.
5. **Network drop during any action** → busy cleared, «Δεν υπάρχει σύνδεση» shown, button usable again — pinned in Task 12 (`network failure` test) and Task 5 (`mapError`).

---

## File Structure

```
supabase/migrations/20260929000006_owner_app.sql   shop rename grant+policy, unlock_staff, pairing-code cleanup
supabase/tests/050_owner_app.sql                   SQL security tests for the above

src/app/router.ts             + OwnerRoute, AppRoute, parseAppRoute, ownerHash, useHash (useRoute removed in Task 14)
src/app/authRedirect.ts       parseAuthRedirect(search), authRedirectUrl(base, kind)
src/app/App.tsx               area switch (register | owner), lazy owner area, auth-redirect hop
src/app/theme.css             + owner-area classes

src/data/local/authStorage.ts failure-safe storage adapter for supabase auth
src/data/local/ownerDrafts.ts unpublished settings draft per shop
src/data/remote/errors.ts     OwnerError union + mapError(unknown)
src/data/remote/ownerApi.ts   OwnerApi interface + row types + Result<T> (types only)
src/data/remote/owner.ts      createOwnerApi(client): OwnerApi — the one owner mutation path
src/data/remote/client.ts     createSupabase(store): SupabaseClient | null

src/features/owner/model/limits.ts        name/label/PIN/email/password checks
src/features/owner/model/pairing.ts       code formatting, countdown math
src/features/owner/model/time.ts          lock state, clock/date formatting
src/features/owner/model/firstSetup.ts    buildFirstConfig
src/features/owner/model/terms.ts         channel-type labels, term labels/options, formula text
src/features/owner/model/settingsDraft.ts applySettings reducer, isEditableConfig
src/features/owner/model/messages.ts      ConfigError/OwnerError/NameProblem → Greek
src/features/owner/model/preview.ts       previewTotals(config, sample)

src/features/owner/useAction.ts       busy/error state for one async action
src/features/owner/OwnerUi.tsx        OwnerHeader, ErrorText, Go
src/features/owner/OwnerApp.tsx       session gate, auth redirect exchange, route switch
src/features/owner/OwnerEntry.tsx     default export for React.lazy; builds the real OwnerApi
src/features/owner/AuthScreens.tsx    Login, Signup, Forgot, Reset, LinkError, AnonymousWarning
src/features/owner/ShopsScreen.tsx
src/features/owner/NewShopScreen.tsx
src/features/owner/ShopLayout.tsx     shop header (rename), tabs, sign out
src/features/owner/settings/SettingsScreen.tsx
src/features/owner/settings/GeneralSection.tsx
src/features/owner/settings/ChannelsSection.tsx
src/features/owner/settings/TareSection.tsx
src/features/owner/settings/TotalsSection.tsx
src/features/owner/settings/PreviewCard.tsx
src/features/owner/OwnerStaffScreen.tsx
src/features/owner/DevicesScreen.tsx

tests/app/ownerRouter.test.ts, tests/app/authRedirect.test.ts
tests/data/ownerLocal.test.ts, tests/data/remoteErrors.test.ts, tests/data/ownerApi.test.ts
tests/features/owner/fakeApi.ts (helper), model.test.ts, settingsDraft.test.ts, preview.test.ts,
  messages.test.ts, auth.test.tsx, shops.test.tsx, settings.test.tsx, totals.test.tsx,
  staff.test.tsx, devices.test.tsx
tests/app/app.test.tsx        + owner-area routing tests
```

---

### Task 1: Database — shop rename, `unlock_staff`, pairing-code cleanup

**Files:**
- Create: `supabase/migrations/20260929000006_owner_app.sql`
- Create: `supabase/tests/050_owner_app.sql`

**Interfaces:**
- Consumes: Plan 3 schema, `private.is_shop_owner`, `private.require_owner`, `public.create_pairing_code(uuid)`.
- Produces: `update (name)` on `public.shops` for owners; `public.unlock_staff(p_staff_id uuid) returns void`; `create_pairing_code` deletes that shop's expired/used codes first.

- [ ] **Step 1: Write the test file** `supabase/tests/050_owner_app.sql`

```sql
-- 050 — owner app support: shop rename, unlock_staff, pairing-code cleanup. One transaction, ends in ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's1@test.local', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true, now(), now());

-- Owner B: a shop of their own
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_b', public.create_shop('Shop B', '{"schema":1}')::text, true);
reset role;

-- Owner A: shop + staff member
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select set_config('t.shop_a', public.create_shop('Shop A', '{"schema":1}')::text, true);
select set_config('t.staff_a', public.create_staff(current_setting('t.shop_a')::uuid, 'ΜΑΡΙΑ', '1234')::text, true);

-- T1 owner A renames their own shop
do $$ declare n int; begin
  update public.shops set name = 'Join Juice Καλαμαριά' where id = current_setting('t.shop_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'T1 own rename changed % rows', n; end if;
end $$;

-- T2 owner A cannot rename owner B's shop (row is invisible → 0 rows)
do $$ declare n int; begin
  update public.shops set name = 'hijacked' where id = current_setting('t.shop_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T2 renamed a foreign shop'; end if;
end $$;

-- T3 an 81-character name is refused by the CHECK
do $$ begin
  begin update public.shops set name = repeat('α', 81) where id = current_setting('t.shop_a')::uuid;
  exception when check_violation then return; end;
  raise exception 'T3 81-char name accepted';
end $$;

-- T4 owner_id is not updatable (column grant is name only)
do $$ begin
  begin update public.shops set owner_id = '00000000-0000-0000-0000-0000000000b1' where id = current_setting('t.shop_a')::uuid;
  exception when insufficient_privilege then return; end;
  raise exception 'T4 owner_id was updatable';
end $$;
reset role;

-- Lock ΜΑΡΙΑ directly (as the table owner) for the unlock tests
update public.staff set failed_attempts = 3, locked_until = now() + interval '15 minutes' where id = current_setting('t.staff_a')::uuid;

-- T5 owner B cannot unlock A's staff; a missing id answers the same way
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
do $$ begin
  begin perform public.unlock_staff(current_setting('t.staff_a')::uuid);
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T5 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T5 owner B unlocked A''s staff';
end $$;
do $$ begin
  begin perform public.unlock_staff('00000000-0000-0000-0000-00000000ffff');
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T5b wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T5b missing id did not answer not_owner';
end $$;
reset role;

-- T6 an anonymous phone session cannot unlock staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
do $$ begin
  begin perform public.unlock_staff(current_setting('t.staff_a')::uuid);
  exception when others then if sqlerrm not like '%not_owner%' then raise exception 'T6 wrong error: %', sqlerrm; end if; return; end;
  raise exception 'T6 phone unlocked staff';
end $$;
reset role;

-- T7 owner A unlocks without touching the PIN
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.unlock_staff(current_setting('t.staff_a')::uuid);
reset role;
do $$ begin
  if (select failed_attempts = 0 and locked_until is null and extensions.crypt('1234', pin_hash) = pin_hash
      from public.staff where id = current_setting('t.staff_a')::uuid) is not true then
    raise exception 'T7 not unlocked or PIN changed';
  end if;
end $$;

-- T8 anon role cannot execute unlock_staff
set local role anon;
do $$ begin
  begin perform public.unlock_staff(current_setting('t.staff_a')::uuid); exception when insufficient_privilege then return; end;
  raise exception 'T8 anon can execute unlock_staff';
end $$;
reset role;

-- T9 creating a code deletes this shop's expired and used codes, not other shops' codes
insert into public.pairing_codes (code_hash, shop_id, created_by, expires_at, used_at) values
  ('t9-expired-a', current_setting('t.shop_a')::uuid, '00000000-0000-0000-0000-0000000000a1', now() - interval '1 minute', null),
  ('t9-used-a',    current_setting('t.shop_a')::uuid, '00000000-0000-0000-0000-0000000000a1', now() + interval '5 minutes', now()),
  ('t9-live-a',    current_setting('t.shop_a')::uuid, '00000000-0000-0000-0000-0000000000a1', now() + interval '5 minutes', null),
  ('t9-expired-b', current_setting('t.shop_b')::uuid, '00000000-0000-0000-0000-0000000000b1', now() - interval '1 minute', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select public.create_pairing_code(current_setting('t.shop_a')::uuid);
reset role;
do $$ begin
  if exists (select 1 from public.pairing_codes where code_hash in ('t9-expired-a', 't9-used-a')) then raise exception 'T9 stale codes of A kept'; end if;
  if not exists (select 1 from public.pairing_codes where code_hash = 't9-live-a') then raise exception 'T9 live code of A deleted'; end if;
  if not exists (select 1 from public.pairing_codes where code_hash = 't9-expired-b') then raise exception 'T9 code of B deleted'; end if;
  if (select count(*) from public.pairing_codes where shop_id = current_setting('t.shop_a')::uuid) <> 2 then raise exception 'T9 new code missing'; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it before the migration to see it fail**

Run with the Supabase connector: `execute_sql(project_id: "fstfuhogvsdaiwpfdmep", query: <contents of 050_owner_app.sql>)`.
Expected: error `T1 own rename changed 0 rows` (or `permission denied for table shops`) — rename isn't allowed yet.

- [ ] **Step 3: Write the migration** `supabase/migrations/20260929000006_owner_app.sql`

```sql
-- Plan 4a: owner app support — shop rename, unlock staff without a PIN change, pairing-code cleanup.

-- Owners may rename their own shops (the length CHECK on shops.name still applies).
grant update (name) on public.shops to authenticated;
create policy shops_owner_update on public.shops for update to authenticated
  using (private.is_shop_owner(id)) with check (private.is_shop_owner(id));

-- Clears a lockout without changing the PIN. Missing and foreign ids both answer not_owner,
-- so staff ids can't be probed.
create function public.unlock_staff(p_staff_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  update public.staff set failed_attempts = 0, locked_until = null where id = p_staff_id;
end $$;
revoke all on function public.unlock_staff(uuid) from public, anon;
grant execute on function public.unlock_staff(uuid) to authenticated;

-- Same as before, but first deletes this shop's expired or used codes (they can never be redeemed).
create or replace function public.create_pairing_code(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  perform private.require_owner(p_shop_id);
  delete from public.pairing_codes where shop_id = p_shop_id and (used_at is not null or expires_at < now());
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.pairing_codes (code_hash, shop_id, created_by, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), p_shop_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end $$;
revoke all on function public.create_pairing_code(uuid) from public, anon;
grant execute on function public.create_pairing_code(uuid) to authenticated;
```

- [ ] **Step 4: Apply the migration**

`apply_migration(project_id: "fstfuhogvsdaiwpfdmep", name: "owner_app", query: <file contents>)`. Expected: success.

- [ ] **Step 5: Run 050 and re-run 010–040**

`execute_sql` with each of `supabase/tests/010_tables_rls.sql`, `020_owner_functions.sql`, `030_device_functions.sql`, `040_closings.sql`, `050_owner_app.sql`. Expected: all succeed (no exception).

- [ ] **Step 6: Advisors**

`get_advisors(project_id: "fstfuhogvsdaiwpfdmep", type: "security")`. Expected: no ERROR-level findings (WARN about leaked-password protection / anonymous sign-ins is pre-existing and acceptable; note any new one in the commit message).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929000006_owner_app.sql supabase/tests/050_owner_app.sql
git commit -m "feat(db): shop rename, unlock_staff, pairing-code cleanup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Owner routes and auth-redirect parsing

**Files:**
- Modify: `src/app/router.ts`
- Create: `src/app/authRedirect.ts`
- Test: `tests/app/ownerRouter.test.ts`, `tests/app/authRedirect.test.ts`

**Interfaces:**
- Produces:
  - `type ShopTab = 'settings' | 'staff' | 'devices'`
  - `type OwnerRoute = {name:'login'} | {name:'signup'} | {name:'forgot'} | {name:'reset'} | {name:'shops'} | {name:'new'} | {name:'shop'; shopId: string; tab: ShopTab}`
  - `type AppRoute = {area:'register'; route: Route} | {area:'owner'; route: OwnerRoute}`
  - `parseOwnerRoute(rest: string): OwnerRoute`, `parseAppRoute(hash: string): AppRoute`, `ownerHash(route: OwnerRoute): string`
  - `useHash(): [string, (hash: string, opts?: { replace?: boolean }) => void]`
  - `type AuthRedirect = {kind:'signup'|'recovery'; code: string} | {kind:'error'; description: string}`
  - `parseAuthRedirect(search: string): AuthRedirect | null`, `authRedirectUrl(base: string, kind: 'signup'|'recovery'): string`

- [ ] **Step 1: Write the failing tests**

`tests/app/ownerRouter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ownerHash, parseAppRoute, parseOwnerRoute, type OwnerRoute } from '../../src/app/router';

const ID = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';

describe('owner routes', () => {
  it('parses every owner route', () => {
    expect(parseOwnerRoute('')).toEqual({ name: 'shops' });
    expect(parseOwnerRoute('/')).toEqual({ name: 'shops' });
    expect(parseOwnerRoute('/login')).toEqual({ name: 'login' });
    expect(parseOwnerRoute('/signup')).toEqual({ name: 'signup' });
    expect(parseOwnerRoute('/forgot')).toEqual({ name: 'forgot' });
    expect(parseOwnerRoute('/reset')).toEqual({ name: 'reset' });
    expect(parseOwnerRoute('/new')).toEqual({ name: 'new' });
    expect(parseOwnerRoute(`/shop/${ID}/staff`)).toEqual({ name: 'shop', shopId: ID, tab: 'staff' });
    expect(parseOwnerRoute(`/shop/${ID}`)).toEqual({ name: 'shop', shopId: ID, tab: 'settings' });
    expect(parseOwnerRoute(`/shop/${ID.toUpperCase()}/devices`)).toEqual({ name: 'shop', shopId: ID, tab: 'devices' });
  });

  it('falls back to the shops list for malformed owner paths', () => {
    expect(parseOwnerRoute('/shop/not-a-uuid/settings')).toEqual({ name: 'shops' });
    expect(parseOwnerRoute(`/shop/${ID}/nope`)).toEqual({ name: 'shops' });
    expect(parseOwnerRoute('/whatever')).toEqual({ name: 'shops' });
  });

  it('round-trips through ownerHash', () => {
    const routes: OwnerRoute[] = [
      { name: 'login' }, { name: 'signup' }, { name: 'forgot' }, { name: 'reset' }, { name: 'shops' }, { name: 'new' },
      { name: 'shop', shopId: ID, tab: 'settings' }, { name: 'shop', shopId: ID, tab: 'devices' },
    ];
    for (const r of routes) expect(parseAppRoute(ownerHash(r))).toEqual({ area: 'owner', route: r });
  });

  it('splits register and owner areas', () => {
    expect(parseAppRoute('')).toEqual({ area: 'register', route: 'register' });
    expect(parseAppRoute('#/tare')).toEqual({ area: 'register', route: 'tare' });
    expect(parseAppRoute('#/owner')).toEqual({ area: 'owner', route: { name: 'shops' } });
    expect(parseAppRoute('#/ownerx')).toEqual({ area: 'register', route: 'register' });
  });
});
```

`tests/app/authRedirect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { authRedirectUrl, parseAuthRedirect } from '../../src/app/authRedirect';

describe('auth redirect', () => {
  it('reads signup and recovery codes', () => {
    expect(parseAuthRedirect('?auth=signup&code=abc')).toEqual({ kind: 'signup', code: 'abc' });
    expect(parseAuthRedirect('?code=xyz&auth=recovery')).toEqual({ kind: 'recovery', code: 'xyz' });
  });

  it('reports errors and missing codes', () => {
    expect(parseAuthRedirect('?auth=recovery&error=access_denied&error_description=Email+link+is+invalid+or+has+expired'))
      .toEqual({ kind: 'error', description: 'Email link is invalid or has expired' });
    expect(parseAuthRedirect('?auth=signup')).toEqual({ kind: 'error', description: 'missing code' });
  });

  it('ignores unrelated query strings', () => {
    expect(parseAuthRedirect('')).toBeNull();
    expect(parseAuthRedirect('?code=abc')).toBeNull();
    expect(parseAuthRedirect('?auth=other&code=abc')).toBeNull();
  });

  it('builds the email redirect URL', () => {
    expect(authRedirectUrl('https://tameio.app/', 'recovery')).toBe('https://tameio.app/?auth=recovery');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/app/ownerRouter.test.ts tests/app/authRedirect.test.ts`
Expected: FAIL — `parseOwnerRoute`/`authRedirect` not exported / module not found.

- [ ] **Step 3: Implement**

Append to `src/app/router.ts` (keep `Route`, `parseRoute`, `routeHash`, `useRoute` unchanged for now):

```ts
export type ShopTab = 'settings' | 'staff' | 'devices';

export type OwnerRoute =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'forgot' }
  | { name: 'reset' }
  | { name: 'shops' }
  | { name: 'new' }
  | { name: 'shop'; shopId: string; tab: ShopTab };

export type AppRoute = { area: 'register'; route: Route } | { area: 'owner'; route: OwnerRoute };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOP_TABS: readonly ShopTab[] = ['settings', 'staff', 'devices'];
const OWNER_PREFIX = '#/owner';

/** `rest` is what follows `#/owner`. Anything malformed lands on the shops list. */
export function parseOwnerRoute(rest: string): OwnerRoute {
  const parts = rest.split('/').filter((p) => p !== '');
  const [first, id, tab] = parts;
  if (parts.length === 1 && (first === 'login' || first === 'signup' || first === 'forgot' || first === 'reset' || first === 'new')) {
    return { name: first };
  }
  if (first === 'shop' && id !== undefined && parts.length <= 3) {
    const shopId = id.toLowerCase();
    const shopTab = tab ?? 'settings';
    if (UUID_RE.test(shopId) && (SHOP_TABS as readonly string[]).includes(shopTab)) {
      return { name: 'shop', shopId, tab: shopTab as ShopTab };
    }
  }
  return { name: 'shops' };
}

export function parseAppRoute(hash: string): AppRoute {
  if (hash === OWNER_PREFIX || hash.startsWith(`${OWNER_PREFIX}/`)) {
    return { area: 'owner', route: parseOwnerRoute(hash.slice(OWNER_PREFIX.length)) };
  }
  return { area: 'register', route: parseRoute(hash) };
}

export function ownerHash(route: OwnerRoute): string {
  if (route.name === 'shops') return OWNER_PREFIX;
  if (route.name === 'shop') return `${OWNER_PREFIX}/shop/${route.shopId}/${route.tab}`;
  return `${OWNER_PREFIX}/${route.name}`;
}

/** The current location hash; the setter can replace the history entry (redirects, auto-open). */
export function useHash(): [string, (hash: string, opts?: { replace?: boolean }) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = useCallback((next: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', next);
    else window.location.hash = next;
    setHash(next);
  }, []);
  return [hash, go];
}
```

`src/app/authRedirect.ts`:

```ts
/**
 * Supabase PKCE email links (confirm sign-up, reset password) come back as `?auth=<kind>&code=…`.
 * The query string never collides with the hash router. `auth` is ours: set in authRedirectUrl.
 */
export type AuthRedirect = { kind: 'signup' | 'recovery'; code: string } | { kind: 'error'; description: string };

export function parseAuthRedirect(search: string): AuthRedirect | null {
  const p = new URLSearchParams(search);
  const kind = p.get('auth');
  if (kind !== 'signup' && kind !== 'recovery') return null;
  const error = p.get('error_description') ?? p.get('error');
  if (error) return { kind: 'error', description: error };
  const code = p.get('code');
  if (!code) return { kind: 'error', description: 'missing code' };
  return { kind, code };
}

/** `base` is origin + pathname of the app, e.g. `https://tameio.app/`. */
export function authRedirectUrl(base: string, kind: 'signup' | 'recovery'): string {
  return `${base}?auth=${kind}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/app && npm run typecheck`
Expected: PASS (existing `routerTheme.test.ts` still passes).

- [ ] **Step 5: Commit**

```bash
git add src/app/router.ts src/app/authRedirect.ts tests/app/ownerRouter.test.ts tests/app/authRedirect.test.ts
git commit -m "feat(app): owner routes and auth-redirect parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure owner helpers — limits, pairing, time, first setup

**Files:**
- Create: `src/features/owner/model/limits.ts`, `pairing.ts`, `time.ts`, `firstSetup.ts`
- Test: `tests/features/owner/model.test.ts`

**Interfaces:**
- Consumes: `newShopConfig`, `ChannelType`, `ShopConfig` (core/config), `Cents` (core/money).
- Produces:
  - `SHOP_NAME_MAX = 80`, `STAFF_NAME_MAX = 40`, `DEVICE_LABEL_MAX = 60`, `PASSWORD_MIN = 8`
  - `type NameProblem = 'empty' | 'too_long'`
  - `checkName(raw: string, max: number): {ok:true; value:string} | {ok:false; problem:NameProblem}`
  - `checkLabel(raw: string, max: number): {ok:true; value:string} | {ok:false; problem:'too_long'}`
  - `isPin(s: string): boolean`, `isEmail(s: string): boolean`
  - `PAIRING_TTL_SECONDS = 600`, `formatPairingCode(code: string): string`, `secondsLeft(expiresAtMs: number, nowMs: number): number`, `formatCountdown(seconds: number): string`
  - `isLocked(lockedUntil: string | null, nowMs: number): boolean`, `formatClock(iso: string): string`, `formatDate(iso: string): string`
  - `interface FirstSetupChannel { label: string; type: ChannelType }`, `buildFirstConfig(input: { floatCents: Cents; channels: FirstSetupChannel[] }): ShopConfig`

- [ ] **Step 1: Write the failing tests** `tests/features/owner/model.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../../src/core/config';
import { evaluateTotals, type ClosingInputs } from '../../../src/core/formula';
import { joinJuicePreset } from '../../../src/core/presets';
import { buildFirstConfig } from '../../../src/features/owner/model/firstSetup';
import { checkLabel, checkName, isEmail, isPin, STAFF_NAME_MAX } from '../../../src/features/owner/model/limits';
import { formatCountdown, formatPairingCode, secondsLeft } from '../../../src/features/owner/model/pairing';
import { formatClock, formatDate, isLocked } from '../../../src/features/owner/model/time';

describe('limits', () => {
  it('trims names and enforces the limit in characters (Greek, emoji)', () => {
    expect(checkName('  ΜΑΡΙΑ  ', STAFF_NAME_MAX)).toEqual({ ok: true, value: 'ΜΑΡΙΑ' });
    expect(checkName('α'.repeat(40), 40)).toEqual({ ok: true, value: 'α'.repeat(40) });
    expect(checkName('α'.repeat(41), 40)).toEqual({ ok: false, problem: 'too_long' });
    expect(checkName('😀'.repeat(40), 40).ok).toBe(true);
    expect(checkName('   ', 40)).toEqual({ ok: false, problem: 'empty' });
  });

  it('allows empty labels but not long ones', () => {
    expect(checkLabel('  ', 60)).toEqual({ ok: true, value: '' });
    expect(checkLabel('x'.repeat(61), 60)).toEqual({ ok: false, problem: 'too_long' });
  });

  it('checks PINs and emails', () => {
    expect(isPin('0123')).toBe(true);
    expect(isPin('123')).toBe(false);
    expect(isPin('12a4')).toBe(false);
    expect(isPin('١٢٣٤')).toBe(false);
    expect(isEmail('owner@shop.gr')).toBe(true);
    expect(isEmail('owner@shop')).toBe(false);
    expect(isEmail(' owner@shop.gr')).toBe(false);
  });
});

describe('pairing', () => {
  it('groups the code and counts down', () => {
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(formatPairingCode('ABC')).toBe('ABC');
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 20_000)).toBe(0);
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(5)).toBe('0:05');
  });
});

describe('time', () => {
  it('knows when a lock is still active', () => {
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked('2026-09-29T10:05:00Z', now)).toBe(true);
    expect(isLocked('2026-09-29T09:55:00Z', now)).toBe(false);
    expect(isLocked('garbage', now)).toBe(false);
  });

  it('formats clock and date in Greek style', () => {
    const iso = new Date(2026, 8, 29, 9, 5).toISOString();
    expect(formatClock(iso)).toBe('09:05');
    expect(formatDate(iso)).toBe('29/09/2026');
  });
});

describe('buildFirstConfig', () => {
  it('builds a valid config whose ΤΑΜΕΙΟ/ΜΕΤΡΗΤΑ match the Join Juice preset', () => {
    const config = buildFirstConfig({
      floatCents: joinJuicePreset.floatCents,
      channels: joinJuicePreset.channels.map((c) => ({ label: `  ${c.label} `, type: c.type })),
    });
    expect(validateConfig(config)).toEqual([]);
    expect(config.channels.map((c) => c.label)).toEqual(joinJuicePreset.channels.map((c) => c.label));

    const amounts = [15000, 4560, 2310, 31025, 8840];
    const inputsFor = (ids: string[]): ClosingInputs => ({
      schema: 1,
      counts: { '10000': 5, '5000': 6, '500': 7 },
      channelCents: Object.fromEntries(ids.map((id, i) => [id, amounts[i] ?? 0])),
      expenses: [{ description: 'x', cents: 1250 }],
    });
    const mine = evaluateTotals(config, inputsFor(config.channels.map((c) => c.id)));
    const preset = evaluateTotals(joinJuicePreset, inputsFor(joinJuicePreset.channels.map((c) => c.id)));
    expect(mine.tameio).toBe(preset.tameio);
    expect(mine.cash).toBe(preset.cash);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/model.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/features/owner/model/limits.ts`:

```ts
/** Limits mirror the database CHECKs (shops.name 1–80, staff.name 1–40, devices.label ≤ 60). */
export const SHOP_NAME_MAX = 80;
export const STAFF_NAME_MAX = 40;
export const DEVICE_LABEL_MAX = 60;
export const PASSWORD_MIN = 8;

export type NameProblem = 'empty' | 'too_long';

/** Postgres char_length counts code points, so count them the same way (not UTF-16 units). */
const length = (s: string): number => [...s].length;

export function checkName(raw: string, max: number): { ok: true; value: string } | { ok: false; problem: NameProblem } {
  const value = raw.trim();
  if (value === '') return { ok: false, problem: 'empty' };
  if (length(value) > max) return { ok: false, problem: 'too_long' };
  return { ok: true, value };
}

export function checkLabel(raw: string, max: number): { ok: true; value: string } | { ok: false; problem: 'too_long' } {
  const value = raw.trim();
  return length(value) > max ? { ok: false, problem: 'too_long' } : { ok: true, value };
}

export const isPin = (s: string): boolean => /^[0-9]{4}$/.test(s);
export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
```

`src/features/owner/model/pairing.ts`:

```ts
/** Server-side lifetime of a pairing code (create_pairing_code: now() + 10 minutes). */
export const PAIRING_TTL_SECONDS = 600;

/** 'ABCDEFGH' → 'ABCD-EFGH' for reading aloud; other lengths are shown as they are. */
export function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function secondsLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
```

`src/features/owner/model/time.ts`:

```ts
export function isLocked(lockedUntil: string | null, nowMs: number): boolean {
  if (lockedUntil === null) return false;
  const t = Date.parse(lockedUntil);
  return Number.isFinite(t) && t > nowMs;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local time HH:MM. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date DD/MM/YYYY. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
```

`src/features/owner/model/firstSetup.ts`:

```ts
import { newShopConfig, type ChannelType, type ShopConfig } from '../../../core/config';
import type { Cents } from '../../../core/money';

export interface FirstSetupChannel {
  label: string;
  type: ChannelType;
}

/**
 * The config a new shop starts with. Totals are core's defaultTotals(): they reference channel
 * *types*, so ΤΑΜΕΙΟ/ΜΕΤΡΗΤΑ are right for any channels without per-channel edits.
 */
export function buildFirstConfig(input: { floatCents: Cents; channels: FirstSetupChannel[] }): ShopConfig {
  return {
    ...newShopConfig(),
    floatCents: input.floatCents,
    channels: input.channels.map((c, i) => ({ id: `ch_${i + 1}`, label: c.label.trim(), type: c.type })),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/features/owner/model.test.ts && npm run typecheck`
Expected: PASS. (If `formatClock`/`formatDate` fail only because of the machine timezone, the test builds the ISO from local time on purpose — check the implementation uses local getters.)

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/model tests/features/owner/model.test.ts
git commit -m "feat(owner): limits, pairing, time and first-setup helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Settings reducer and term labels

**Files:**
- Create: `src/features/owner/model/terms.ts`, `src/features/owner/model/settingsDraft.ts`
- Test: `tests/features/owner/settingsDraft.test.ts`

**Interfaces:**
- Consumes: `ShopConfig`, `TermRef`, `Term`, `TotalDef`, `ChannelType`, `CHANNEL_TYPES`, `validateConfig`, `plus`, `minus` (core/config); `EUR_DENOMINATIONS` (core/denominations).
- Produces:
  - `CHANNEL_TYPE_LABELS: Record<ChannelType, string>`
  - `termKey(ref: TermRef): string`, `termLabel(config: ShopConfig, ref: TermRef): string`
  - `interface TermOption { key: string; label: string; ref: TermRef }`, `termOptions(config: ShopConfig, forTotalId: string): TermOption[]`
  - `formulaText(config: ShopConfig, total: TotalDef): string`
  - `type SettingsAction` (below), `interface ApplyResult { config: ShopConfig; blockedBy: string[] }`
  - `applySettings(config: ShopConfig, action: SettingsAction): ApplyResult`
  - `isEditableConfig(x: unknown): x is ShopConfig`
  - `nextId(prefix: string, taken: ReadonlySet<string>): string`

- [ ] **Step 1: Write the failing tests** `tests/features/owner/settingsDraft.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { minus, newShopConfig, plus, validateConfig, type ShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { applySettings, isEditableConfig, nextId, type SettingsAction } from '../../../src/features/owner/model/settingsDraft';
import { formulaText, termLabel, termOptions } from '../../../src/features/owner/model/terms';

const jj = (): ShopConfig => structuredClone(joinJuicePreset) as ShopConfig;
const apply = (c: ShopConfig, ...actions: SettingsAction[]) =>
  actions.reduce((acc, a) => applySettings(acc, a).config, c);

describe('applySettings', () => {
  it('edits general settings and keeps denominations in EUR order', () => {
    let c = apply(newShopConfig(), { type: 'setFloat', cents: 50000 }, { type: 'setMaxExpenses', value: 12 });
    expect(c.floatCents).toBe(50000);
    expect(c.maxExpenses).toBe(12);
    c = apply(c, { type: 'toggleDenomination', cents: 20000 });
    expect(c.denominations[0]).toBe(20000);
    c = apply(c, { type: 'toggleDenomination', cents: 20000 });
    expect(c.denominations.includes(20000)).toBe(false);
    expect(validateConfig(c)).toEqual([]);
  });

  it('adds channels with fresh ids and renames/retypes them', () => {
    let c = apply(newShopConfig(), { type: 'addChannel', label: 'WOLT', channelType: 'delivery' }, { type: 'addChannel', label: 'POS', channelType: 'card' });
    expect(c.channels.map((ch) => ch.id)).toEqual(['ch_1', 'ch_2']);
    c = apply(c, { type: 'renameChannel', id: 'ch_2', label: 'myPos' }, { type: 'setChannelType', id: 'ch_2', channelType: 'noncash_other' });
    expect(c.channels[1]).toEqual({ id: 'ch_2', label: 'myPos', type: 'noncash_other' });
    expect(validateConfig(c)).toEqual([]);
  });

  it('refuses to remove a channel a total refers to, naming that total', () => {
    const c = apply(jj(), { type: 'addTotal', label: 'WOLT ΜΟΝΟ' });
    const withTerm = apply(c, { type: 'addTerm', totalId: 't_1', term: plus({ kind: 'channel', id: 'wolt' }) });
    const r = applySettings(withTerm, { type: 'removeChannel', id: 'wolt' });
    expect(r.blockedBy).toEqual(['WOLT ΜΟΝΟ']);
    expect(r.config).toBe(withTerm);
    expect(applySettings(jj(), { type: 'removeChannel', id: 'wolt' }).blockedBy).toEqual([]);
  });

  it('refuses to remove a total used by another total or by Φάκελος', () => {
    expect(applySettings(jj(), { type: 'removeTotal', id: 'tameio' }).blockedBy).toEqual(['ΜΕΤΡΗΤΑ']);
    expect(applySettings(jj(), { type: 'removeTotal', id: 'cash' }).blockedBy).toEqual(['ΜΕΤΡΗΤΑ LIM', 'ΕΣΟΔΑ LIM', 'Φάκελος']);
    const r = applySettings(jj(), { type: 'removeTotal', id: 'income_lim' });
    expect(r.blockedBy).toEqual([]);
    expect(r.config.totals.some((t) => t.id === 'income_lim')).toBe(false);
  });

  it('edits terms: add, flip, remove; flags; reorder', () => {
    let c = apply(newShopConfig(), { type: 'addTotal', label: 'ΤΕΣΤ' });
    c = apply(c, { type: 'addTerm', totalId: 't_1', term: plus({ kind: 'counted' }) }, { type: 'addTerm', totalId: 't_1', term: minus({ kind: 'float' }) });
    c = apply(c, { type: 'flipTerm', totalId: 't_1', index: 1 });
    expect(c.totals.find((t) => t.id === 't_1')?.terms).toEqual([plus({ kind: 'counted' }), plus({ kind: 'float' })]);
    c = apply(c, { type: 'removeTerm', totalId: 't_1', index: 0 }, { type: 'setTotalFlag', id: 't_1', flag: 'showInShare', value: false });
    const t = c.totals.find((x) => x.id === 't_1');
    expect(t?.terms).toEqual([plus({ kind: 'float' })]);
    expect(t?.showInShare).toBe(false);
    c = apply(c, { type: 'moveTotal', id: 't_1', delta: -1 });
    expect(c.totals.map((x) => x.id)).toEqual(['tameio', 'expenses_total', 't_1', 'cash']);
    expect(apply(c, { type: 'moveTotal', id: 'tameio', delta: -1 })).toEqual(c);
  });

  it('edits tare items; out-of-range indexes change nothing', () => {
    let c = apply(newShopConfig(), { type: 'addTare', name: 'Σολομός', tareGrams: 360 });
    c = apply(c, { type: 'updateTare', index: 0, tareGrams: 260 }, { type: 'updateTare', index: 5, name: 'x' });
    expect(c.tareItems).toEqual([{ name: 'Σολομός', tareGrams: 260 }]);
    expect(apply(c, { type: 'removeTare', index: 0 }).tareItems).toEqual([]);
  });

  it('does not mutate the input config', () => {
    const c = newShopConfig();
    const before = structuredClone(c);
    apply(c, { type: 'addChannel', label: 'X', channelType: 'card' }, { type: 'setFloat', cents: 1 });
    expect(c).toEqual(before);
  });
});

describe('nextId / isEditableConfig', () => {
  it('picks the smallest free id', () => {
    expect(nextId('ch', new Set(['ch_1', 'ch_3']))).toBe('ch_2');
  });

  it('accepts content errors but not structural ones', () => {
    const emptyLabel = { ...newShopConfig(), channels: [{ id: 'ch_1', label: '', type: 'card' }] };
    expect(isEditableConfig(emptyLabel)).toBe(true);
    expect(isEditableConfig({ schema: 1 })).toBe(false);
    expect(isEditableConfig(null)).toBe(false);
  });
});

describe('terms', () => {
  it('labels refs in Greek and lists options without the total itself', () => {
    const c = jj();
    expect(termLabel(c, { kind: 'channel', id: 'wolt' })).toBe('WOLT');
    expect(termLabel(c, { kind: 'type', type: 'card' })).toBe('Όλες οι κάρτες');
    expect(termLabel(c, { kind: 'total', id: 'nope' })).toBe('(δεν υπάρχει)');
    const keys = termOptions(c, 'cash').map((o) => o.key);
    expect(keys).toContain('counted');
    expect(keys).toContain('channel:wolt');
    expect(keys).toContain('total:tameio');
    expect(keys).not.toContain('total:cash');
  });

  it('writes a formula line', () => {
    const c = jj();
    const cash = c.totals.find((t) => t.id === 'cash');
    if (!cash) throw new Error('preset has cash');
    expect(formulaText(c, cash)).toBe('ΤΑΜΕΙΟ − Αρχικό ταμείο − Έξοδα − Όλες οι κάρτες − Όλα τα delivery − Όλα τα άλλα μη μετρητά');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/settingsDraft.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/features/owner/model/terms.ts`:

```ts
import { CHANNEL_TYPES, type ChannelType, type ShopConfig, type TermRef, type TotalDef } from '../../../core/config';

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  cash_extra: 'Μετρητά εκτός ταμείου',
  card: 'Κάρτα',
  delivery: 'Delivery',
  noncash_other: 'Άλλο (όχι μετρητά)',
};

const TYPE_GROUP_LABELS: Record<ChannelType, string> = {
  cash_extra: 'Όλα τα μετρητά εκτός ταμείου',
  card: 'Όλες οι κάρτες',
  delivery: 'Όλα τα delivery',
  noncash_other: 'Όλα τα άλλα μη μετρητά',
};

export function termKey(ref: TermRef): string {
  switch (ref.kind) {
    case 'counted':
    case 'float':
    case 'expenses':
      return ref.kind;
    case 'channel':
      return `channel:${ref.id}`;
    case 'type':
      return `type:${ref.type}`;
    case 'total':
      return `total:${ref.id}`;
  }
}

export function termLabel(config: ShopConfig, ref: TermRef): string {
  switch (ref.kind) {
    case 'counted':
      return 'Μετρημένα';
    case 'float':
      return 'Αρχικό ταμείο';
    case 'expenses':
      return 'Έξοδα';
    case 'channel':
      return config.channels.find((c) => c.id === ref.id)?.label ?? '(δεν υπάρχει)';
    case 'type':
      return TYPE_GROUP_LABELS[ref.type];
    case 'total':
      return config.totals.find((t) => t.id === ref.id)?.label ?? '(δεν υπάρχει)';
  }
}

export interface TermOption {
  key: string;
  label: string;
  ref: TermRef;
}

/** Everything a total can add or subtract; excludes the total itself (other cycles are reported by validateConfig). */
export function termOptions(config: ShopConfig, forTotalId: string): TermOption[] {
  const refs: TermRef[] = [
    { kind: 'counted' },
    { kind: 'float' },
    { kind: 'expenses' },
    ...config.channels.map((c): TermRef => ({ kind: 'channel', id: c.id })),
    ...CHANNEL_TYPES.map((type): TermRef => ({ kind: 'type', type })),
    ...config.totals.filter((t) => t.id !== forTotalId).map((t): TermRef => ({ kind: 'total', id: t.id })),
  ];
  return refs.map((ref) => ({ key: termKey(ref), label: termLabel(config, ref), ref }));
}

/** "ΤΑΜΕΙΟ − Αρχικό ταμείο − Έξοδα" — the first term shows its sign only when it is a minus. */
export function formulaText(config: ShopConfig, total: TotalDef): string {
  if (total.terms.length === 0) return '0';
  return total.terms
    .map((t, i) => {
      const label = termLabel(config, t.ref);
      if (i === 0) return t.sign === 1 ? label : `− ${label}`;
      return `${t.sign === 1 ? '+' : '−'} ${label}`;
    })
    .join(' ');
}
```

`src/features/owner/model/settingsDraft.ts`:

```ts
import { validateConfig, type ChannelType, type ShopConfig, type Term, type TotalDef } from '../../../core/config';
import { EUR_DENOMINATIONS } from '../../../core/denominations';
import type { Cents } from '../../../core/money';

export type SettingsAction =
  | { type: 'setFloat'; cents: Cents }
  | { type: 'toggleDenomination'; cents: Cents }
  | { type: 'setMaxExpenses'; value: number }
  | { type: 'setEnvelopeTotal'; id: string }
  | { type: 'addChannel'; label: string; channelType: ChannelType }
  | { type: 'renameChannel'; id: string; label: string }
  | { type: 'setChannelType'; id: string; channelType: ChannelType }
  | { type: 'removeChannel'; id: string }
  | { type: 'addTotal'; label: string }
  | { type: 'renameTotal'; id: string; label: string }
  | { type: 'removeTotal'; id: string }
  | { type: 'moveTotal'; id: string; delta: -1 | 1 }
  | { type: 'setTotalFlag'; id: string; flag: 'showInSummary' | 'showInShare'; value: boolean }
  | { type: 'addTerm'; totalId: string; term: Term }
  | { type: 'removeTerm'; totalId: string; index: number }
  | { type: 'flipTerm'; totalId: string; index: number }
  | { type: 'addTare'; name: string; tareGrams: number }
  | { type: 'updateTare'; index: number; name?: string; tareGrams?: number }
  | { type: 'removeTare'; index: number };

/** `blockedBy` non-empty ⇒ the action was refused and `config` is the input, unchanged. */
export interface ApplyResult {
  config: ShopConfig;
  blockedBy: string[];
}

export function nextId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Structurally a ShopConfig (content errors such as an empty label are allowed while editing). */
export function isEditableConfig(x: unknown): x is ShopConfig {
  return validateConfig(x).every((e) => e.code !== 'bad_shape');
}

const flip = (term: Term): Term => ({ ...term, sign: term.sign === 1 ? -1 : 1 });
const usesChannel = (t: TotalDef, id: string): boolean => t.terms.some((x) => x.ref.kind === 'channel' && x.ref.id === id);
const usesTotal = (t: TotalDef, id: string): boolean => t.terms.some((x) => x.ref.kind === 'total' && x.ref.id === id);

/** Pure: never mutates `config`. Refuses removals that would leave dangling references. */
export function applySettings(config: ShopConfig, action: SettingsAction): ApplyResult {
  const ok = (next: ShopConfig): ApplyResult => ({ config: next, blockedBy: [] });
  const mapTotal = (id: string, f: (t: TotalDef) => TotalDef): ApplyResult =>
    ok({ ...config, totals: config.totals.map((t) => (t.id === id ? f(t) : t)) });

  switch (action.type) {
    case 'setFloat':
      return ok({ ...config, floatCents: action.cents });
    case 'toggleDenomination': {
      const on = config.denominations.includes(action.cents);
      const denominations = on
        ? config.denominations.filter((d) => d !== action.cents)
        : EUR_DENOMINATIONS.filter((d) => d === action.cents || config.denominations.includes(d));
      return ok({ ...config, denominations });
    }
    case 'setMaxExpenses':
      return ok({ ...config, maxExpenses: action.value });
    case 'setEnvelopeTotal':
      return ok({ ...config, envelopeTotalId: action.id });
    case 'addChannel': {
      const id = nextId('ch', new Set(config.channels.map((c) => c.id)));
      return ok({ ...config, channels: [...config.channels, { id, label: action.label, type: action.channelType }] });
    }
    case 'renameChannel':
      return ok({ ...config, channels: config.channels.map((c) => (c.id === action.id ? { ...c, label: action.label } : c)) });
    case 'setChannelType':
      return ok({ ...config, channels: config.channels.map((c) => (c.id === action.id ? { ...c, type: action.channelType } : c)) });
    case 'removeChannel': {
      const users = config.totals.filter((t) => usesChannel(t, action.id)).map((t) => t.label);
      if (users.length > 0) return { config, blockedBy: users };
      return ok({ ...config, channels: config.channels.filter((c) => c.id !== action.id) });
    }
    case 'addTotal': {
      const id = nextId('t', new Set(config.totals.map((t) => t.id)));
      const total: TotalDef = { id, label: action.label, terms: [], showInSummary: true, showInShare: true };
      return ok({ ...config, totals: [...config.totals, total] });
    }
    case 'renameTotal':
      return mapTotal(action.id, (t) => ({ ...t, label: action.label }));
    case 'removeTotal': {
      const users = config.totals.filter((t) => t.id !== action.id && usesTotal(t, action.id)).map((t) => t.label);
      if (config.envelopeTotalId === action.id) users.push('Φάκελος');
      if (users.length > 0) return { config, blockedBy: users };
      return ok({ ...config, totals: config.totals.filter((t) => t.id !== action.id) });
    }
    case 'moveTotal': {
      const i = config.totals.findIndex((t) => t.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= config.totals.length) return ok(config);
      const totals = [...config.totals];
      const a = totals[i];
      const b = totals[j];
      if (a === undefined || b === undefined) return ok(config);
      totals[i] = b;
      totals[j] = a;
      return ok({ ...config, totals });
    }
    case 'setTotalFlag':
      return mapTotal(action.id, (t) => ({ ...t, [action.flag]: action.value }));
    case 'addTerm':
      return mapTotal(action.totalId, (t) => ({ ...t, terms: [...t.terms, action.term] }));
    case 'removeTerm':
      return mapTotal(action.totalId, (t) => ({ ...t, terms: t.terms.filter((_, i) => i !== action.index) }));
    case 'flipTerm':
      return mapTotal(action.totalId, (t) => ({ ...t, terms: t.terms.map((x, i) => (i === action.index ? flip(x) : x)) }));
    case 'addTare':
      return ok({ ...config, tareItems: [...config.tareItems, { name: action.name, tareGrams: action.tareGrams }] });
    case 'updateTare':
      return ok({
        ...config,
        tareItems: config.tareItems.map((item, i) =>
          i === action.index
            ? { name: action.name ?? item.name, tareGrams: action.tareGrams ?? item.tareGrams }
            : item,
        ),
      });
    case 'removeTare':
      return ok({ ...config, tareItems: config.tareItems.filter((_, i) => i !== action.index) });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/features/owner/settingsDraft.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/model/terms.ts src/features/owner/model/settingsDraft.ts tests/features/owner/settingsDraft.test.ts
git commit -m "feat(owner): settings reducer and formula term labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Error mapping and Greek messages

**Files:**
- Create: `src/data/remote/errors.ts`, `src/features/owner/model/messages.ts`
- Test: `tests/data/remoteErrors.test.ts`, `tests/features/owner/messages.test.ts`

**Interfaces:**
- Consumes: `ConfigError`, `ConfigErrorCode`, `ShopConfig` (core/config); `NameProblem` (Task 3).
- Produces:
  - `type OwnerError = {code:'not_owner'} | {code:'version_conflict'; currentVersion: number | null} | {code:'staff_name_taken'} | {code:'bad_pin_format'} | {code:'bad_config'} | {code:'bad_name'} | {code:'invalid_credentials'} | {code:'email_not_confirmed'} | {code:'email_taken'} | {code:'weak_password'} | {code:'rate_limited'} | {code:'link_invalid'} | {code:'session_expired'} | {code:'network'} | {code:'unknown'; detail: string}`
  - `mapError(err: unknown): OwnerError`
  - `ownerErrorMessage(e: OwnerError): string`, `configErrorMessage(e: ConfigError, config: ShopConfig): string`
  - `type SettingsSection = 'general' | 'channels' | 'totals' | 'tare'`, `configErrorSection(e: ConfigError): SettingsSection`
  - `nameProblemMessage(p: NameProblem, max: number): string`

- [ ] **Step 1: Write the failing tests**

`tests/data/remoteErrors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapError } from '../../src/data/remote/errors';

describe('mapError', () => {
  it('maps server function errors by message', () => {
    expect(mapError({ message: 'not_owner', code: '42501' })).toEqual({ code: 'not_owner' });
    expect(mapError({ message: 'staff_name_taken', code: '23505' })).toEqual({ code: 'staff_name_taken' });
    expect(mapError({ message: 'bad_pin_format', code: '22023' })).toEqual({ code: 'bad_pin_format' });
    expect(mapError({ message: 'bad_config', code: '22023' })).toEqual({ code: 'bad_config' });
    expect(mapError({ message: 'version_conflict', code: 'P0001', details: 'current version is 7' }))
      .toEqual({ code: 'version_conflict', currentVersion: 7 });
    expect(mapError({ message: 'version_conflict', code: 'P0001', details: null }))
      .toEqual({ code: 'version_conflict', currentVersion: null });
  });

  it('maps direct-update constraint errors', () => {
    expect(mapError({ message: 'duplicate key value violates unique constraint "staff_shop_name_uidx"', code: '23505' }))
      .toEqual({ code: 'staff_name_taken' });
    expect(mapError({ message: 'new row violates check constraint "staff_name_check"', code: '23514' }))
      .toEqual({ code: 'bad_name' });
  });

  it('maps auth errors by code', () => {
    expect(mapError({ name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials' })).toEqual({ code: 'invalid_credentials' });
    expect(mapError({ name: 'AuthApiError', code: 'email_not_confirmed', message: '' })).toEqual({ code: 'email_not_confirmed' });
    expect(mapError({ name: 'AuthApiError', code: 'user_already_exists', message: '' })).toEqual({ code: 'email_taken' });
    expect(mapError({ name: 'AuthWeakPasswordError', code: 'weak_password', message: '' })).toEqual({ code: 'weak_password' });
    expect(mapError({ name: 'AuthApiError', code: 'over_email_send_rate_limit', message: '' })).toEqual({ code: 'rate_limited' });
    expect(mapError({ code: 'PGRST303', message: 'JWT expired' })).toEqual({ code: 'session_expired' });
  });

  it('recognises network failures', () => {
    expect(mapError(new TypeError('Failed to fetch'))).toEqual({ code: 'network' });
    expect(mapError({ message: 'TypeError: Load failed', code: '' })).toEqual({ code: 'network' });
    expect(mapError({ name: 'AuthRetryableFetchError', message: '' })).toEqual({ code: 'network' });
  });

  it('never throws on foreign input', () => {
    expect(mapError(undefined)).toEqual({ code: 'unknown', detail: 'undefined' });
    expect(mapError('boom')).toEqual({ code: 'unknown', detail: 'boom' });
    expect(mapError({ message: 'something else' })).toEqual({ code: 'unknown', detail: 'something else' });
  });
});
```

`tests/features/owner/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ConfigErrorCode } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import type { OwnerError } from '../../../src/data/remote/errors';
import { configErrorMessage, configErrorSection, nameProblemMessage, ownerErrorMessage } from '../../../src/features/owner/model/messages';

// Record<…, true> makes the compiler fail if a code is added without a message test.
const CONFIG_CODES: Record<ConfigErrorCode, true> = {
  bad_shape: true, bad_float: true, bad_denomination: true, bad_max_expenses: true, bad_id: true, bad_label: true,
  duplicate_id: true, unknown_channel: true, unknown_total: true, cycle: true, missing_envelope_total: true, bad_tare: true,
};
const OWNER_ERRORS: Record<OwnerError['code'], OwnerError> = {
  not_owner: { code: 'not_owner' }, version_conflict: { code: 'version_conflict', currentVersion: 3 },
  staff_name_taken: { code: 'staff_name_taken' }, bad_pin_format: { code: 'bad_pin_format' }, bad_config: { code: 'bad_config' },
  bad_name: { code: 'bad_name' }, invalid_credentials: { code: 'invalid_credentials' }, email_not_confirmed: { code: 'email_not_confirmed' },
  email_taken: { code: 'email_taken' }, weak_password: { code: 'weak_password' }, rate_limited: { code: 'rate_limited' },
  link_invalid: { code: 'link_invalid' }, session_expired: { code: 'session_expired' }, network: { code: 'network' },
  unknown: { code: 'unknown', detail: 'x' },
};
const greek = /[Ͱ-Ͽ]/;

describe('messages', () => {
  it('has a Greek message for every config error code', () => {
    for (const code of Object.keys(CONFIG_CODES) as ConfigErrorCode[]) {
      expect(configErrorMessage({ code, detail: 'channel: ch_1' }, joinJuicePreset)).toMatch(greek);
    }
  });

  it('names totals in a cycle by label', () => {
    expect(configErrorMessage({ code: 'cycle', detail: 'cash → tameio → cash' }, joinJuicePreset)).toContain('ΜΕΤΡΗΤΑ → ΤΑΜΕΙΟ → ΜΕΤΡΗΤΑ');
  });

  it('places errors in their section', () => {
    expect(configErrorSection({ code: 'bad_label', detail: 'channel: ch_1' })).toBe('channels');
    expect(configErrorSection({ code: 'bad_label', detail: 'total: t_1' })).toBe('totals');
    expect(configErrorSection({ code: 'cycle', detail: '' })).toBe('totals');
    expect(configErrorSection({ code: 'bad_tare', detail: '' })).toBe('tare');
    expect(configErrorSection({ code: 'bad_float', detail: '' })).toBe('general');
  });

  it('has a Greek message for every owner error', () => {
    for (const e of Object.values(OWNER_ERRORS)) expect(ownerErrorMessage(e)).toMatch(greek);
    expect(ownerErrorMessage({ code: 'version_conflict', currentVersion: 3 })).toContain('3');
  });

  it('explains name problems', () => {
    expect(nameProblemMessage('empty', 40)).toMatch(greek);
    expect(nameProblemMessage('too_long', 40)).toContain('40');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/data/remoteErrors.test.ts tests/features/owner/messages.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/data/remote/errors.ts`:

```ts
/**
 * Every failure an owner action can report. Server functions raise these codes as the error
 * message (Plan 3 migrations); Auth errors carry a `code`. A new server error needs a case here
 * and a Greek message in features/owner/model/messages.ts.
 */
export type OwnerError =
  | { code: 'not_owner' }
  | { code: 'version_conflict'; currentVersion: number | null }
  | { code: 'staff_name_taken' }
  | { code: 'bad_pin_format' }
  | { code: 'bad_config' }
  | { code: 'bad_name' }
  | { code: 'invalid_credentials' }
  | { code: 'email_not_confirmed' }
  | { code: 'email_taken' }
  | { code: 'weak_password' }
  | { code: 'rate_limited' }
  | { code: 'link_invalid' }
  | { code: 'session_expired' }
  | { code: 'network' }
  | { code: 'unknown'; detail: string };

const NETWORK_RE = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Never throws, whatever it is given. */
export function mapError(err: unknown): OwnerError {
  if (typeof err !== 'object' || err === null) return { code: 'unknown', detail: String(err) };
  const e = err as Record<string, unknown>;
  const message = str(e.message);
  const code = str(e.code);
  const name = str(e.name);

  if (name === 'AuthRetryableFetchError' || NETWORK_RE.test(message)) return { code: 'network' };
  if (message === 'version_conflict') {
    const m = /current version is (\d+)/.exec(str(e.details));
    return { code: 'version_conflict', currentVersion: m?.[1] !== undefined ? Number(m[1]) : null };
  }
  if (message === 'not_owner' || message === 'staff_name_taken' || message === 'bad_pin_format' || message === 'bad_config') {
    return { code: message };
  }
  switch (code) {
    case '23505': // unique name index on a direct staff rename
      return { code: 'staff_name_taken' };
    case '23514': // length CHECK on a direct rename
      return { code: 'bad_name' };
    case 'PGRST301':
    case 'PGRST303':
    case 'session_not_found':
    case 'refresh_token_not_found':
      return { code: 'session_expired' };
    case 'invalid_credentials':
      return { code: 'invalid_credentials' };
    case 'email_not_confirmed':
      return { code: 'email_not_confirmed' };
    case 'user_already_exists':
    case 'email_exists':
      return { code: 'email_taken' };
    case 'weak_password':
      return { code: 'weak_password' };
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return { code: 'rate_limited' };
  }
  return { code: 'unknown', detail: message || code || name || 'error' };
}
```

`src/features/owner/model/messages.ts`:

```ts
import type { ConfigError, ShopConfig } from '../../../core/config';
import type { OwnerError } from '../../../data/remote/errors';
import type { NameProblem } from './limits';

export type SettingsSection = 'general' | 'channels' | 'totals' | 'tare';

export function ownerErrorMessage(e: OwnerError): string {
  switch (e.code) {
    case 'not_owner':
      return 'Δεν βρέθηκε ή δεν σου ανήκει.';
    case 'version_conflict':
      return e.currentVersion === null
        ? 'Οι ρυθμίσεις άλλαξαν από αλλού.'
        : `Οι ρυθμίσεις άλλαξαν από αλλού (έκδοση ${e.currentVersion}).`;
    case 'staff_name_taken':
      return 'Υπάρχει ήδη άτομο με αυτό το όνομα.';
    case 'bad_pin_format':
      return 'Το PIN πρέπει να είναι 4 ψηφία.';
    case 'bad_config':
      return 'Ο διακομιστής απέρριψε τις ρυθμίσεις.';
    case 'bad_name':
      return 'Το όνομα είναι κενό ή πολύ μεγάλο.';
    case 'invalid_credentials':
      return 'Λάθος email ή κωδικός.';
    case 'email_not_confirmed':
      return 'Επιβεβαίωσε πρώτα το email σου (δες τα εισερχόμενα).';
    case 'email_taken':
      return 'Υπάρχει ήδη λογαριασμός με αυτό το email.';
    case 'weak_password':
      return 'Ο κωδικός είναι πολύ αδύναμος. Διάλεξε μεγαλύτερο.';
    case 'rate_limited':
      return 'Πολλές προσπάθειες. Δοκίμασε ξανά σε λίγα λεπτά.';
    case 'link_invalid':
      return 'Ο σύνδεσμος δεν λειτούργησε.';
    case 'session_expired':
      return 'Η σύνδεση έληξε. Συνδέσου ξανά — οι αλλαγές σου κρατήθηκαν.';
    case 'network':
      return 'Δεν υπάρχει σύνδεση. Δοκίμασε ξανά.';
    case 'unknown':
      return `Κάτι πήγε στραβά (${e.detail}).`;
  }
}

const totalLabel = (config: ShopConfig, id: string): string => config.totals.find((t) => t.id === id)?.label ?? id;

export function configErrorMessage(e: ConfigError, config: ShopConfig): string {
  switch (e.code) {
    case 'bad_shape':
      return 'Οι ρυθμίσεις έχουν λάθος μορφή.';
    case 'bad_float':
      return 'Το αρχικό ταμείο πρέπει να είναι ποσό ≥ 0.';
    case 'bad_denomination':
      return 'Μη έγκυρο χαρτονόμισμα ή κέρμα.';
    case 'bad_max_expenses':
      return 'Τα έξοδα ανά κλείσιμο πρέπει να είναι από 0 έως 30.';
    case 'bad_id':
    case 'duplicate_id':
      return 'Εσωτερικό σφάλμα αναγνωριστικού — σβήσε και ξαναπρόσθεσε το στοιχείο.';
    case 'bad_label':
      return 'Κάθε κανάλι και κάθε σύνολο χρειάζεται όνομα.';
    case 'unknown_channel':
      return 'Ένα σύνολο χρησιμοποιεί κανάλι που δεν υπάρχει πια.';
    case 'unknown_total':
      return 'Ένα σύνολο χρησιμοποιεί σύνολο που δεν υπάρχει πια.';
    case 'cycle':
      return `Κυκλική αναφορά: ${e.detail.split(' → ').map((id) => totalLabel(config, id)).join(' → ')}.`;
    case 'missing_envelope_total':
      return 'Διάλεξε ποιο σύνολο γεμίζει ο Φάκελος.';
    case 'bad_tare':
      return 'Κάθε προϊόν αποβάρας χρειάζεται μοναδικό όνομα και γραμμάρια ≥ 0.';
  }
}

export function configErrorSection(e: ConfigError): SettingsSection {
  switch (e.code) {
    case 'bad_id':
    case 'duplicate_id':
    case 'bad_label':
      return e.detail.startsWith('channel') ? 'channels' : 'totals';
    case 'unknown_channel':
    case 'unknown_total':
    case 'cycle':
      return 'totals';
    case 'bad_tare':
      return 'tare';
    default:
      return 'general';
  }
}

export function nameProblemMessage(p: NameProblem, max: number): string {
  return p === 'empty' ? 'Γράψε ένα όνομα.' : `Έως ${max} χαρακτήρες.`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/data/remoteErrors.test.ts tests/features/owner/messages.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/remote/errors.ts src/features/owner/model/messages.ts tests/data/remoteErrors.test.ts tests/features/owner/messages.test.ts
git commit -m "feat(owner): error mapping and Greek messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings preview

**Files:**
- Create: `src/features/owner/model/preview.ts`
- Test: `tests/features/owner/preview.test.ts`

**Interfaces:**
- Consumes: `evaluateTotals`, `ClosingInputs` (core/formula); `parseAmount`, `Cents` (core/money); `validateConfig`, `ShopConfig` (core/config).
- Produces:
  - `interface PreviewSample { counted: string; expenses: string; channels: Record<string, string> }`
  - `type PreviewResult = { ok: true; totals: { id: string; label: string; cents: Cents }[] } | { ok: false; reason: 'invalid_config' } | { ok: false; reason: 'bad_sample'; fields: string[] }`
  - `previewTotals(config: ShopConfig, sample: PreviewSample): PreviewResult` — `fields` holds `'counted'`, `'expenses'` or a channel id.

- [ ] **Step 1: Write the failing test** `tests/features/owner/preview.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { newShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { previewTotals } from '../../../src/features/owner/model/preview';

describe('previewTotals', () => {
  it('evaluates the configured totals on sample amounts', () => {
    const r = previewTotals(joinJuicePreset, { counted: '1500', expenses: '20,30', channels: { mypos: '310.25', wolt: '' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = Object.fromEntries(r.totals.map((t) => [t.id, t.cents]));
    expect(byId.tameio).toBe(150000 + 31025 + 2030);
    expect(byId.cash).toBe(150000 + 31025 + 2030 - 100000 - 2030 - 31025);
    expect(r.totals[0]?.label).toBe('ΤΑΜΕΙΟ');
  });

  it('reports unusable sample fields instead of guessing', () => {
    expect(previewTotals(joinJuicePreset, { counted: '10.02', expenses: 'x', channels: { wolt: '-5' } }))
      .toEqual({ ok: false, reason: 'bad_sample', fields: ['counted', 'wolt', 'expenses'] });
  });

  it('needs expenses allowed when an expense amount is given', () => {
    const c = { ...newShopConfig(), maxExpenses: 0 };
    expect(previewTotals(c, { counted: '', expenses: '5', channels: {} })).toEqual({ ok: false, reason: 'bad_sample', fields: ['expenses'] });
  });

  it('says the config is invalid rather than throwing', () => {
    const broken = { ...newShopConfig(), envelopeTotalId: 'nope' };
    expect(previewTotals(broken, { counted: '', expenses: '', channels: {} })).toEqual({ ok: false, reason: 'invalid_config' });
  });

  it('empty samples evaluate as zero', () => {
    const r = previewTotals(newShopConfig(), { counted: '', expenses: '', channels: {} });
    expect(r.ok && r.totals.every((t) => t.cents === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/features/owner/preview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/features/owner/model/preview.ts`

```ts
import { validateConfig, type ShopConfig } from '../../../core/config';
import { evaluateTotals, type ClosingInputs } from '../../../core/formula';
import { parseAmount, type Cents } from '../../../core/money';

export interface PreviewSample {
  /** Total counted in the till, as typed. */
  counted: string;
  /** Total expenses, as typed. */
  expenses: string;
  /** Amount per channel id, as typed. */
  channels: Record<string, string>;
}

export type PreviewResult =
  | { ok: true; totals: { id: string; label: string; cents: Cents }[] }
  | { ok: false; reason: 'invalid_config' }
  | { ok: false; reason: 'bad_sample'; fields: string[] };

/** Empty → 0; anything parseAmount refuses → null. */
const amountOrZero = (raw: string): Cents | null => {
  if (raw.trim() === '') return 0;
  const r = parseAmount(raw);
  return r.ok ? r.value : null;
};

/**
 * The formula builder's live preview. Counted money is expressed as pieces of the smallest enabled
 * denomination, so it must be a multiple of it. All maths goes through evaluateTotals.
 */
export function previewTotals(config: ShopConfig, sample: PreviewSample): PreviewResult {
  if (validateConfig(config).length > 0) return { ok: false, reason: 'invalid_config' };
  const bad: string[] = [];

  const counted = amountOrZero(sample.counted);
  const smallest = config.denominations.length > 0 ? Math.min(...config.denominations) : null;
  let counts: Record<string, number> = {};
  if (counted === null || (counted > 0 && (smallest === null || counted % smallest !== 0))) bad.push('counted');
  else if (counted > 0 && smallest !== null) counts = { [String(smallest)]: counted / smallest };

  const channelCents: Record<string, Cents> = {};
  for (const ch of config.channels) {
    const v = amountOrZero(sample.channels[ch.id] ?? '');
    if (v === null) bad.push(ch.id);
    else channelCents[ch.id] = v;
  }

  const expenses = amountOrZero(sample.expenses);
  if (expenses === null || (expenses > 0 && config.maxExpenses < 1)) bad.push('expenses');

  if (bad.length > 0) return { ok: false, reason: 'bad_sample', fields: bad };

  const inputs: ClosingInputs = {
    schema: 1,
    counts,
    channelCents,
    expenses: expenses !== null && expenses > 0 ? [{ description: 'Δείγμα', cents: expenses }] : [],
  };
  const values = evaluateTotals(config, inputs);
  return { ok: true, totals: config.totals.map((t) => ({ id: t.id, label: t.label, cents: values[t.id] ?? 0 })) };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/features/owner/preview.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/model/preview.ts tests/features/owner/preview.test.ts
git commit -m "feat(owner): formula preview through evaluateTotals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Local owner storage, OwnerApi, supabase client

**Files:**
- Create: `src/data/local/authStorage.ts`, `src/data/local/ownerDrafts.ts`, `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `src/data/remote/client.ts`, `src/env.d.ts`
- Modify: `package.json` / `package-lock.json` (dependency)
- Test: `tests/data/ownerLocal.test.ts`, `tests/data/ownerApi.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `readJson`, `writeJson`, `removeKey`, `shopKey` (data/local/storage); `isEditableConfig` (Task 4); `mapError`, `OwnerError` (Task 5); `ShopConfig` (core).
- Produces:
  - `AUTH_STORAGE_KEY = 'tameio4all:v1:auth'`, `authStorage(store: KeyValueStore): KeyValueStore`
  - `interface OwnerDraft { config: ShopConfig; baseVersion: number; savedAt: number }`
  - `loadOwnerDraft(store, shopId): OwnerDraft | null`, `saveOwnerDraft(store, shopId, draft: OwnerDraft): boolean`, `clearOwnerDraft(store, shopId): void`
  - `ownerApi.ts`: `type Result<T> = {ok:true; data:T} | {ok:false; error:OwnerError}`; `SessionInfo {email: string | null; anonymous: boolean}`; `ShopRow {id; name}`; `ConfigRow {id: string; version: number; config: unknown}`; `StaffRow {id; name; active: boolean; lockedUntil: string | null}`; `DeviceRow {userId; label; createdAt: string; revokedAt: string | null}`; `interface OwnerApi` (below)
  - `createOwnerApi(client: SupabaseClient): OwnerApi`
  - `createSupabase(store: KeyValueStore): SupabaseClient | null`

- [ ] **Step 1: Install the dependency**

Run: `npm install @supabase/supabase-js@^2.117.2`
Expected: added to `dependencies`, lockfile updated.

- [ ] **Step 2: Write the failing tests**

`tests/data/ownerLocal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newShopConfig } from '../../src/core/config';
import { AUTH_STORAGE_KEY, authStorage } from '../../src/data/local/authStorage';
import { clearOwnerDraft, loadOwnerDraft, saveOwnerDraft } from '../../src/data/local/ownerDrafts';
import { memoryStore, shopKey, type KeyValueStore } from '../../src/data/local/storage';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

describe('authStorage', () => {
  it('passes through to the store and never throws', () => {
    const s = memoryStore();
    const a = authStorage(s);
    a.setItem(AUTH_STORAGE_KEY, 'tok');
    expect(s.getItem(AUTH_STORAGE_KEY)).toBe('tok');
    a.removeItem(AUTH_STORAGE_KEY);
    expect(a.getItem(AUTH_STORAGE_KEY)).toBeNull();
    const t = authStorage(throwing);
    expect(() => t.setItem('k', 'v')).not.toThrow();
    expect(t.getItem('k')).toBeNull();
    expect(() => t.removeItem('k')).not.toThrow();
  });
});

describe('owner drafts', () => {
  it('round-trips per shop', () => {
    const s = memoryStore();
    const draft = { config: newShopConfig(), baseVersion: 3, savedAt: 1 };
    expect(saveOwnerDraft(s, 'shop-a', draft)).toBe(true);
    expect(loadOwnerDraft(s, 'shop-a')).toEqual(draft);
    expect(loadOwnerDraft(s, 'shop-b')).toBeNull();
    clearOwnerDraft(s, 'shop-a');
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
  });

  it('drops corrupt or structurally broken drafts', () => {
    const s = memoryStore();
    s.setItem(shopKey('shop-a', 'owner-draft'), '{{{');
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
    s.setItem(shopKey('shop-a', 'owner-draft'), JSON.stringify({ config: { schema: 1 }, baseVersion: 1, savedAt: 1 }));
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
    s.setItem(shopKey('shop-a', 'owner-draft'), JSON.stringify({ config: newShopConfig(), baseVersion: '1', savedAt: 1 }));
    expect(loadOwnerDraft(s, 'shop-a')).toBeNull();
  });

  it('survives a store that throws', () => {
    expect(saveOwnerDraft(throwing, 'x', { config: newShopConfig(), baseVersion: 1, savedAt: 1 })).toBe(false);
    expect(loadOwnerDraft(throwing, 'x')).toBeNull();
    expect(() => clearOwnerDraft(throwing, 'x')).not.toThrow();
  });
});
```

`tests/data/ownerApi.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { newShopConfig } from '../../src/core/config';
import { createOwnerApi } from '../../src/data/remote/owner';

type Reply = { data: unknown; error: unknown };

/** Records every call; `from(...)` returns a chainable builder that resolves to `reply`. */
function fake(reply: Reply, authReply: Reply = { data: {}, error: null }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'eq', 'order', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: Reply) => unknown) => resolve(reply);
  const client = {
    rpc: (...args: unknown[]) => {
      calls.push(['rpc', ...args]);
      return Promise.resolve(reply);
    },
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
    auth: {
      exchangeCodeForSession: () => Promise.resolve(authReply),
      signInWithPassword: () => Promise.resolve(authReply),
    },
  };
  return { api: createOwnerApi(client as unknown as SupabaseClient), calls };
}

describe('createOwnerApi', () => {
  it('calls publish_config with the server parameter names', async () => {
    const { api, calls } = fake({ data: 4, error: null });
    const config = newShopConfig();
    expect(await api.publishConfig('s1', 3, config)).toEqual({ ok: true, data: 4 });
    expect(calls).toEqual([['rpc', 'publish_config', { p_shop_id: 's1', p_expected_version: 3, p_config: config }]]);
  });

  it('maps a version conflict', async () => {
    const { api } = fake({ data: null, error: { message: 'version_conflict', details: 'current version is 5', code: 'P0001' } });
    expect(await api.publishConfig('s1', 3, newShopConfig())).toEqual({ ok: false, error: { code: 'version_conflict', currentVersion: 5 } });
  });

  it('uses the right parameter names for every owner function', async () => {
    const { api, calls } = fake({ data: 'x', error: null });
    await api.createShop('Shop', newShopConfig());
    await api.createStaff('s1', 'ΜΑΡΙΑ', '1234');
    await api.setStaffPin('st1', '9876');
    await api.unlockStaff('st1');
    await api.createPairingCode('s1');
    expect(calls.map((c) => [c[1], Object.keys(c[2] as object)])).toEqual([
      ['create_shop', ['p_name', 'p_config']],
      ['create_staff', ['p_shop_id', 'p_name', 'p_pin']],
      ['set_staff_pin', ['p_staff_id', 'p_pin']],
      ['unlock_staff', ['p_staff_id']],
      ['create_pairing_code', ['p_shop_id']],
    ]);
  });

  it('reports a direct update that changed no row as not_owner', async () => {
    const { api } = fake({ data: [], error: null });
    expect(await api.renameShop('s1', 'X')).toEqual({ ok: false, error: { code: 'not_owner' } });
    expect(await api.updateDevice('u1', { revoke: true })).toEqual({ ok: false, error: { code: 'not_owner' } });
  });

  it('lists staff without ever selecting pin_hash', async () => {
    const { api, calls } = fake({ data: [{ id: 'a', name: 'ΜΑΡΙΑ', active: true, locked_until: null }], error: null });
    expect(await api.listStaff('s1')).toEqual({ ok: true, data: [{ id: 'a', name: 'ΜΑΡΙΑ', active: true, lockedUntil: null }] });
    const select = calls.find((c) => c[0] === 'select');
    expect(String(select?.[1])).not.toContain('pin_hash');
  });

  it('returns the latest config row or null', async () => {
    expect(await fake({ data: [{ id: 'c', version: 2, config: {} }], error: null }).api.latestConfig('s1'))
      .toEqual({ ok: true, data: { id: 'c', version: 2, config: {} } });
    expect(await fake({ data: [], error: null }).api.latestConfig('s1')).toEqual({ ok: true, data: null });
  });

  it('turns a failed code exchange into link_invalid, but keeps network errors', async () => {
    const bad = fake({ data: null, error: null }, { data: {}, error: { name: 'AuthApiError', code: 'bad_code_verifier', message: 'x' } });
    expect(await bad.api.exchangeCode('c')).toEqual({ ok: false, error: { code: 'link_invalid' } });
    const offline = fake({ data: null, error: null }, { data: {}, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
    expect(await offline.api.exchangeCode('c')).toEqual({ ok: false, error: { code: 'network' } });
  });

  it('maps a thrown fetch to network', async () => {
    const { api } = fake({ data: null, error: null });
    const throwing = createOwnerApi({ rpc: () => Promise.reject(new TypeError('Failed to fetch')) } as unknown as SupabaseClient);
    expect(await throwing.unlockStaff('x')).toEqual({ ok: false, error: { code: 'network' } });
    expect(api).toBeTruthy();
  });
});
```

(The only supabase import here is `import type`, which is erased; supabase-js is never loaded by the test.)

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run tests/data/ownerLocal.test.ts tests/data/ownerApi.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`src/data/local/authStorage.ts`:

```ts
import { removeKey, type KeyValueStore } from './storage';

/** supabase-js keeps the session (and the PKCE code verifier) under this key prefix. */
export const AUTH_STORAGE_KEY = 'tameio4all:v1:auth';

/** Failure-safe storage for supabase auth: a refused write means "signed out after reload", never a crash. */
export function authStorage(store: KeyValueStore): KeyValueStore {
  return {
    getItem: (key) => {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        store.setItem(key, value);
      } catch {
        // storage full or blocked: the session lives in memory until the tab closes
      }
    },
    removeItem: (key) => removeKey(store, key),
  };
}
```

`src/data/local/ownerDrafts.ts`:

```ts
import type { ShopConfig } from '../../core/config';
import { isEditableConfig } from '../../features/owner/model/settingsDraft';
import { readJson, removeKey, shopKey, writeJson, type KeyValueStore } from './storage';

/** Unpublished settings edits of one shop, with the server version they started from. */
export interface OwnerDraft {
  config: ShopConfig;
  baseVersion: number;
  savedAt: number;
}

const key = (shopId: string): string => shopKey(shopId, 'owner-draft');

export function loadOwnerDraft(store: KeyValueStore, shopId: string): OwnerDraft | null {
  const saved = readJson(store, key(shopId));
  if (typeof saved !== 'object' || saved === null) return null;
  const s = saved as Record<string, unknown>;
  if (!isEditableConfig(s.config) || !Number.isInteger(s.baseVersion) || typeof s.savedAt !== 'number') {
    removeKey(store, key(shopId));
    return null;
  }
  return { config: s.config, baseVersion: s.baseVersion as number, savedAt: s.savedAt };
}

export function saveOwnerDraft(store: KeyValueStore, shopId: string, draft: OwnerDraft): boolean {
  return writeJson(store, key(shopId), draft);
}

export function clearOwnerDraft(store: KeyValueStore, shopId: string): void {
  removeKey(store, key(shopId));
}
```

`src/data/remote/ownerApi.ts`:

```ts
import type { ShopConfig } from '../../core/config';
import type { OwnerError } from './errors';

export type Result<T> = { ok: true; data: T } | { ok: false; error: OwnerError };

export interface SessionInfo {
  email: string | null;
  /** true for a paired phone's session — an owner sign-in in this browser would unpair it. */
  anonymous: boolean;
}

export interface ShopRow {
  id: string;
  name: string;
}

export interface ConfigRow {
  id: string;
  version: number;
  /** Untrusted jsonb — check with isShopConfig / isEditableConfig before use. */
  config: unknown;
}

export interface StaffRow {
  id: string;
  name: string;
  active: boolean;
  lockedUntil: string | null;
}

export interface DeviceRow {
  userId: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Everything the owner app does with the server. Screens receive this; tests pass a fake. */
export interface OwnerApi {
  session(): Promise<SessionInfo | null>;
  onAuthChange(cb: (session: SessionInfo | null) => void): () => void;
  signIn(email: string, password: string): Promise<Result<void>>;
  signUp(email: string, password: string, redirectTo: string): Promise<Result<void>>;
  sendReset(email: string, redirectTo: string): Promise<Result<void>>;
  exchangeCode(code: string): Promise<Result<void>>;
  updatePassword(password: string): Promise<Result<void>>;
  signOut(): Promise<void>;
  listShops(): Promise<Result<ShopRow[]>>;
  createShop(name: string, config: ShopConfig): Promise<Result<string>>;
  renameShop(shopId: string, name: string): Promise<Result<void>>;
  latestConfig(shopId: string): Promise<Result<ConfigRow | null>>;
  publishConfig(shopId: string, expectedVersion: number, config: ShopConfig): Promise<Result<number>>;
  listStaff(shopId: string): Promise<Result<StaffRow[]>>;
  createStaff(shopId: string, name: string, pin: string): Promise<Result<string>>;
  setStaffPin(staffId: string, pin: string): Promise<Result<void>>;
  unlockStaff(staffId: string): Promise<Result<void>>;
  updateStaff(staffId: string, patch: { name?: string; active?: boolean }): Promise<Result<void>>;
  createPairingCode(shopId: string): Promise<Result<string>>;
  listDevices(shopId: string): Promise<Result<DeviceRow[]>>;
  updateDevice(userId: string, patch: { label?: string; revoke?: true }): Promise<Result<void>>;
}
```

`src/data/remote/owner.ts`:

```ts
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { mapError } from './errors';
import type { DeviceRow, OwnerApi, Result, SessionInfo, StaffRow } from './ownerApi';

/** Awaits a supabase call; never throws — errors (returned or thrown) become OwnerError. */
async function run<T>(call: PromiseLike<{ data: T; error: unknown }>): Promise<Result<T>> {
  try {
    const { data, error } = await call;
    return error ? { ok: false, error: mapError(error) } : { ok: true, data };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

const done = (r: Result<unknown>): Result<void> => (r.ok ? { ok: true, data: undefined } : r);

/** RLS hides rows the caller doesn't own, so an update that touched nothing means "not yours". */
const oneRow = (r: Result<unknown[] | null>): Result<void> =>
  !r.ok ? r : (r.data?.length ?? 0) > 0 ? { ok: true, data: undefined } : { ok: false, error: { code: 'not_owner' } };

const toInfo = (s: Session | null): SessionInfo | null =>
  s ? { email: s.user.email ?? null, anonymous: s.user.is_anonymous === true } : null;

/** The one path for owner reads and writes. */
export function createOwnerApi(client: SupabaseClient): OwnerApi {
  return {
    async session() {
      try {
        const { data } = await client.auth.getSession();
        return toInfo(data.session);
      } catch {
        return null;
      }
    },
    onAuthChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, s) => cb(toInfo(s)));
      return () => data.subscription.unsubscribe();
    },
    signIn: async (email, password) => done(await run(client.auth.signInWithPassword({ email, password }))),
    signUp: async (email, password, redirectTo) =>
      done(await run(client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }))),
    sendReset: async (email, redirectTo) => done(await run(client.auth.resetPasswordForEmail(email, { redirectTo }))),
    async exchangeCode(code) {
      const r = await run(client.auth.exchangeCodeForSession(code));
      if (r.ok) return { ok: true, data: undefined };
      return r.error.code === 'network' ? r : { ok: false, error: { code: 'link_invalid' } };
    },
    updatePassword: async (password) => done(await run(client.auth.updateUser({ password }))),
    async signOut() {
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        // scope 'local' clears the stored session even when the server can't be reached
      }
    },
    listShops: () => run(client.from('shops').select('id, name').order('created_at')),
    createShop: (name, config) => run(client.rpc('create_shop', { p_name: name, p_config: config })),
    renameShop: async (shopId, name) => oneRow(await run(client.from('shops').update({ name }).eq('id', shopId).select('id'))),
    async latestConfig(shopId) {
      const r = await run(
        client.from('shop_configs').select('id, version, config').eq('shop_id', shopId).order('version', { ascending: false }).limit(1),
      );
      return r.ok ? { ok: true, data: (r.data as ConfigRowRaw[] | null)?.[0] ?? null } : r;
    },
    publishConfig: (shopId, expectedVersion, config) =>
      run(client.rpc('publish_config', { p_shop_id: shopId, p_expected_version: expectedVersion, p_config: config })),
    async listStaff(shopId) {
      const r = await run(client.from('staff').select('id, name, active, locked_until').eq('shop_id', shopId).order('name'));
      if (!r.ok) return r;
      const rows = (r.data ?? []) as { id: string; name: string; active: boolean; locked_until: string | null }[];
      return { ok: true, data: rows.map((s): StaffRow => ({ id: s.id, name: s.name, active: s.active, lockedUntil: s.locked_until })) };
    },
    createStaff: (shopId, name, pin) => run(client.rpc('create_staff', { p_shop_id: shopId, p_name: name, p_pin: pin })),
    setStaffPin: async (staffId, pin) => done(await run(client.rpc('set_staff_pin', { p_staff_id: staffId, p_pin: pin }))),
    unlockStaff: async (staffId) => done(await run(client.rpc('unlock_staff', { p_staff_id: staffId }))),
    updateStaff: async (staffId, patch) => oneRow(await run(client.from('staff').update(patch).eq('id', staffId).select('id'))),
    createPairingCode: (shopId) => run(client.rpc('create_pairing_code', { p_shop_id: shopId })),
    async listDevices(shopId) {
      const r = await run(
        client.from('devices').select('user_id, label, created_at, revoked_at').eq('shop_id', shopId).order('created_at', { ascending: false }),
      );
      if (!r.ok) return r;
      const rows = (r.data ?? []) as { user_id: string; label: string; created_at: string; revoked_at: string | null }[];
      return {
        ok: true,
        data: rows.map((d): DeviceRow => ({ userId: d.user_id, label: d.label, createdAt: d.created_at, revokedAt: d.revoked_at })),
      };
    },
    async updateDevice(userId, patch) {
      const values: { label?: string; revoked_at?: string } = {};
      if (patch.label !== undefined) values.label = patch.label;
      if (patch.revoke) values.revoked_at = new Date().toISOString();
      return oneRow(await run(client.from('devices').update(values).eq('user_id', userId).select('user_id')));
    },
  };
}

type ConfigRowRaw = { id: string; version: number; config: unknown };
```

`src/data/remote/client.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, authStorage } from '../local/authStorage';
import type { KeyValueStore } from '../local/storage';

/**
 * null when the env vars are missing (e.g. not registered in Vercel) — the owner area then says so
 * instead of crashing at import time. PKCE keeps auth codes in the query string (the hash is the
 * router's); detectSessionInUrl is off because OwnerApp exchanges the code itself, exactly once.
 */
export function createSupabase(store: KeyValueStore): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage: authStorage(store),
      storageKey: AUTH_STORAGE_KEY,
    },
  });
}
```

`src/env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/data && npm run typecheck`
Expected: PASS. If `run(client.auth.…)` fails to typecheck because the auth response union doesn't match `{ data: T; error: unknown }`, wrap the call: `run(client.auth.signInWithPassword({ email, password }) as PromiseLike<{ data: unknown; error: unknown }>)` — the behaviour is the same.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/env.d.ts src/data tests/data/ownerLocal.test.ts tests/data/ownerApi.test.ts
git commit -m "feat(data): owner API over supabase-js, auth storage, owner drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Owner shell, auth screens, redirect exchange

**Files:**
- Create: `src/features/owner/useAction.ts`, `src/features/owner/OwnerUi.tsx`, `src/features/owner/AuthScreens.tsx`, `src/features/owner/OwnerApp.tsx`, `src/features/owner/OwnerEntry.tsx`
- Create (placeholders filled by Tasks 9–13): see Step 3 — `OwnerApp` renders `ShopsScreen`, `NewShopScreen`, `ShopLayout`, which this task creates as minimal stubs so the shell compiles.
- Modify: `src/app/theme.css` (owner classes)
- Test: `tests/features/owner/fakeApi.ts`, `tests/features/owner/auth.test.tsx`

**Interfaces:**
- Consumes: `OwnerApi`, `Result`, `SessionInfo` (Task 7); `OwnerRoute` (Task 2); `AuthRedirect`, `authRedirectUrl` (Task 2); `ownerErrorMessage` (Task 5); `isEmail`, `PASSWORD_MIN` (Task 3); `mapError` (Task 5).
- Produces:
  - `useAction(): { state: ActionState; busy: boolean; run<T>(fn: () => Promise<Result<T>>): Promise<Result<T>>; fail(message: string): void; clear(): void }`, `type ActionState = {status:'idle'} | {status:'busy'} | {status:'error'; message: string}`
  - `OwnerHeader({ title, onBack?, right? })`, `ErrorText({ state })`, `Go({ to, navigate })`
  - `type OwnerNavigate = (route: OwnerRoute, opts?: { replace?: boolean }) => void`
  - `interface OwnerAppProps { route: OwnerRoute; navigate: OwnerNavigate; api: OwnerApi | null; store: KeyValueStore; now?: () => Date; redirect?: AuthRedirect | null; onRedirectHandled?: () => void; redirectBase: string; onExit: () => void }`
  - `OwnerApp(props: OwnerAppProps)`; `OwnerEntry` default export: `(props: Omit<OwnerAppProps, 'api'>) => JSX.Element`
  - Stubs with final signatures (implemented in later tasks):
    - `ShopsScreen({ api, navigate, autoOpen, onLoaded, onSignOut }: { api: OwnerApi; navigate: OwnerNavigate; autoOpen: boolean; onLoaded: () => void; onSignOut: () => void })`
    - `NewShopScreen({ api, navigate }: { api: OwnerApi; navigate: OwnerNavigate })`
    - `ShopLayout({ api, shopId, tab, navigate, store, now, email, onSignOut }: { api: OwnerApi; shopId: string; tab: ShopTab; navigate: OwnerNavigate; store: KeyValueStore; now: () => Date; email: string | null; onSignOut: () => void })`

- [ ] **Step 1: Add the fake API helper** `tests/features/owner/fakeApi.ts`

```ts
import { vi } from 'vitest';
import type { OwnerApi, Result } from '../../../src/data/remote/ownerApi';

export const ok = <T,>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });
export const fail = <T,>(error: Extract<Result<T>, { ok: false }>['error']): Promise<Result<T>> =>
  Promise.resolve({ ok: false, error });

/** A signed-in owner with one empty shop unless overridden. Every method is a vi.fn. */
export function fakeApi(overrides: Partial<OwnerApi> = {}): OwnerApi {
  const base: OwnerApi = {
    session: vi.fn(() => Promise.resolve({ email: 'owner@test.gr', anonymous: false })),
    onAuthChange: vi.fn(() => () => {}),
    signIn: vi.fn(() => ok(undefined)),
    signUp: vi.fn(() => ok(undefined)),
    sendReset: vi.fn(() => ok(undefined)),
    exchangeCode: vi.fn(() => ok(undefined)),
    updatePassword: vi.fn(() => ok(undefined)),
    signOut: vi.fn(() => Promise.resolve()),
    listShops: vi.fn(() => ok([])),
    createShop: vi.fn(() => ok('11111111-1111-4111-8111-111111111111')),
    renameShop: vi.fn(() => ok(undefined)),
    latestConfig: vi.fn(() => ok(null)),
    publishConfig: vi.fn(() => ok(2)),
    listStaff: vi.fn(() => ok([])),
    createStaff: vi.fn(() => ok('staff-1')),
    setStaffPin: vi.fn(() => ok(undefined)),
    unlockStaff: vi.fn(() => ok(undefined)),
    updateStaff: vi.fn(() => ok(undefined)),
    createPairingCode: vi.fn(() => ok('ABCDEFGH')),
    listDevices: vi.fn(() => ok([])),
    updateDevice: vi.fn(() => ok(undefined)),
  };
  return { ...base, ...overrides };
}
```

- [ ] **Step 2: Write the failing UI tests** `tests/features/owner/auth.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerRoute } from '../../../src/app/router';
import { memoryStore } from '../../../src/data/local/storage';
import type { OwnerApi } from '../../../src/data/remote/ownerApi';
import { OwnerApp } from '../../../src/features/owner/OwnerApp';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);

const signedOut = (o: Partial<OwnerApi> = {}) => fakeApi({ session: vi.fn(() => Promise.resolve(null)), ...o });

function start(route: OwnerRoute, api: OwnerApi | null, extra: Partial<Parameters<typeof OwnerApp>[0]> = {}) {
  const navigate = vi.fn();
  render(
    <OwnerApp route={route} navigate={navigate} api={api} store={memoryStore()} redirectBase="https://tameio.app/" onExit={vi.fn()} {...extra} />,
  );
  return navigate;
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('OwnerApp gate', () => {
  it('explains a missing server configuration', () => {
    start({ name: 'shops' }, null);
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy();
  });

  it('shows the login form in place of a protected route when signed out', async () => {
    start({ name: 'shops' }, signedOut());
    expect(await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' })).toBeTruthy();
  });

  it('sends a signed-in owner from the login route to the shops list', async () => {
    const navigate = start({ name: 'login' }, fakeApi());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
  });
});

describe('login', () => {
  it('validates, signs in, and re-reads the session', async () => {
    const session = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ email: 'owner@test.gr', anonymous: false });
    const api = signedOut({ session });
    const navigate = start({ name: 'login' }, api);
    await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' });
    type('Email', 'nope');
    type('Κωδικός', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    expect(screen.getByRole('alert').textContent).toContain('έγκυρο email');
    expect(api.signIn).not.toHaveBeenCalled();
    type('Email', 'owner@test.gr');
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
    expect(api.signIn).toHaveBeenCalledWith('owner@test.gr', 'secret123');
  });

  it('shows the server error and re-enables the button', async () => {
    start({ name: 'login' }, signedOut({ signIn: vi.fn(() => fail({ code: 'invalid_credentials' })) }));
    await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' });
    type('Email', 'owner@test.gr');
    type('Κωδικός', 'wrongpass');
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Λάθος email ή κωδικός');
    expect((screen.getByRole('button', { name: 'Σύνδεση' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('requires confirmation before replacing a paired-phone session', async () => {
    const api = signedOut({ session: vi.fn(() => Promise.resolve({ email: null, anonymous: true })) });
    start({ name: 'login' }, api);
    expect(await screen.findByText(/συνδεδεμένη ως ταμείο/)).toBeTruthy();
    type('Email', 'owner@test.gr');
    type('Κωδικός', 'secret123');
    expect((screen.getByRole('button', { name: 'Σύνδεση' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Κατάλαβα, να αποσυνδεθεί το ταμείο'));
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    await waitFor(() => expect(api.signIn).toHaveBeenCalled());
  });
});

describe('signup / forgot / reset', () => {
  it('signs up with the confirm-email redirect and says to check the inbox', async () => {
    const api = signedOut();
    start({ name: 'signup' }, api);
    await screen.findByRole('heading', { name: 'Νέος λογαριασμός' });
    type('Email', 'owner@test.gr');
    type('Κωδικός', 'short');
    type('Επανάληψη κωδικού', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία λογαριασμού' }));
    expect(screen.getByRole('alert').textContent).toContain('8');
    type('Κωδικός', 'longenough');
    type('Επανάληψη κωδικού', 'longenough');
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία λογαριασμού' }));
    expect(await screen.findByText(/owner@test.gr/)).toBeTruthy();
    expect(api.signUp).toHaveBeenCalledWith('owner@test.gr', 'longenough', 'https://tameio.app/?auth=signup');
  });

  it('sends a reset link', async () => {
    const api = signedOut();
    start({ name: 'forgot' }, api);
    await screen.findByRole('heading', { name: 'Ξέχασα τον κωδικό' });
    type('Email', 'owner@test.gr');
    fireEvent.click(screen.getByRole('button', { name: 'Αποστολή συνδέσμου' }));
    expect(await screen.findByText(/Αν υπάρχει λογαριασμός/)).toBeTruthy();
    expect(api.sendReset).toHaveBeenCalledWith('owner@test.gr', 'https://tameio.app/?auth=recovery');
  });

  it('reset without a session explains the link problem', async () => {
    start({ name: 'reset' }, signedOut());
    expect(await screen.findByText(/Ο σύνδεσμος δεν λειτούργησε/)).toBeTruthy();
  });

  it('sets a new password when the recovery session exists', async () => {
    const api = fakeApi();
    const navigate = start({ name: 'reset' }, api);
    await screen.findByRole('heading', { name: 'Νέος κωδικός' });
    type('Νέος κωδικός', 'newpassword');
    type('Επανάληψη κωδικού', 'newpassword');
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
    expect(api.updatePassword).toHaveBeenCalledWith('newpassword');
  });
});

describe('email link redirect', () => {
  it('exchanges a recovery code once and opens the reset screen', async () => {
    const api = fakeApi();
    const onRedirectHandled = vi.fn();
    const navigate = start({ name: 'shops' }, api, { redirect: { kind: 'recovery', code: 'abc' }, onRedirectHandled });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'reset' }, { replace: true }));
    expect(api.exchangeCode).toHaveBeenCalledTimes(1);
    expect(onRedirectHandled).toHaveBeenCalled();
  });

  it('link error: a failed exchange shows a way forward, not a spinner', async () => {
    const api = signedOut({ exchangeCode: vi.fn(() => fail({ code: 'link_invalid' })) });
    const navigate = start({ name: 'shops' }, api, { redirect: { kind: 'signup', code: 'used' } });
    expect(await screen.findByText(/Ο σύνδεσμος δεν λειτούργησε/)).toBeTruthy();
    expect(screen.getByText(/στη συσκευή και τον browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Νέος σύνδεσμος' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'forgot' });
    expect(api.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('an error redirect (expired link) shows the same screen without calling the server', async () => {
    const api = signedOut();
    start({ name: 'shops' }, api, { redirect: { kind: 'error', description: 'expired' } });
    expect(await screen.findByText(/Ο σύνδεσμος δεν λειτούργησε/)).toBeTruthy();
    expect(api.exchangeCode).not.toHaveBeenCalled();
  });
});

describe('sign out', () => {
  it('is reachable from the shops screen', async () => {
    const api = fakeApi({ listShops: vi.fn(() => ok([])) });
    const navigate = start({ name: 'shops' }, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Αποσύνδεση' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'login' }, { replace: true }));
    expect(api.signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run tests/features/owner/auth.test.tsx`
Expected: FAIL — `OwnerApp` not found.

- [ ] **Step 4: Implement**

Append to `src/app/theme.css`:

```css
/* Owner area */
.form { display: flex; flex-direction: column; gap: 10px; }
.text-field { width: 100%; min-height: 44px; background: var(--field); border: 0; border-radius: 10px; padding: 8px 12px; font-size: 16px; color: var(--ink); }
.text-field[aria-invalid='true'] { background: var(--danger-soft); }
.select { min-height: 44px; background: var(--field); border: 0; border-radius: 10px; padding: 8px 10px; font-size: 15px; color: var(--ink); }
.form-error { margin: 8px 0 0; font-size: 14px; color: var(--danger); }
.form-ok { margin: 8px 0 0; font-size: 14px; color: var(--accent); }
.check { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; }
.check input { width: 22px; height: 22px; }
.tabs { display: flex; gap: 4px; margin: 0 12px; background: var(--field); border-radius: 12px; padding: 4px; }
.tabs button { flex: 1; border: 0; background: transparent; min-height: 44px; border-radius: 9px; font-size: 14px; color: var(--muted); }
.tabs button[aria-current='page'] { background: var(--surface); color: var(--ink); font-weight: 650; }
.pair-code { margin: 8px 0; font-size: 34px; font-weight: 700; letter-spacing: 0.08em; text-align: center; font-variant-numeric: tabular-nums; }
.term { display: flex; align-items: center; gap: 6px; min-height: 44px; }
.term .sign { min-width: 44px; min-height: 44px; border: 0; border-radius: 10px; background: var(--field); font-size: 18px; font-weight: 700; color: var(--ink); }
.formula { margin: 2px 0 6px; font-size: 13px; color: var(--muted); }
.publish-bar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--surface); box-shadow: 0 -1px 0 var(--line); }
.publish-bar p { flex: 1; margin: 0; font-size: 13px; color: var(--muted); }
```

`src/features/owner/useAction.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { mapError } from '../../data/remote/errors';
import type { Result } from '../../data/remote/ownerApi';
import { ownerErrorMessage } from './model/messages';

export type ActionState = { status: 'idle' } | { status: 'busy' } | { status: 'error'; message: string };

/** One async action's state. Every branch — success, error result, thrown — settles `busy`. */
export function useAction() {
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    setState({ status: 'busy' });
    let result: Result<T>;
    try {
      result = await fn();
    } catch (e) {
      result = { ok: false, error: mapError(e) };
    }
    if (mounted.current) {
      setState(result.ok ? { status: 'idle' } : { status: 'error', message: ownerErrorMessage(result.error) });
    }
    return result;
  }, []);
  const fail = useCallback((message: string) => setState({ status: 'error', message }), []);
  const clear = useCallback(() => setState({ status: 'idle' }), []);

  return { state, busy: state.status === 'busy', run, fail, clear };
}
```

`src/features/owner/OwnerUi.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import type { OwnerRoute } from '../../app/router';
import type { ActionState } from './useAction';

export type OwnerNavigate = (route: OwnerRoute, opts?: { replace?: boolean }) => void;

export function OwnerHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="top">
      {onBack ? (
        <button type="button" className="icon-btn" aria-label="Πίσω" onClick={onBack}>
          ←
        </button>
      ) : (
        <span />
      )}
      <h1>{title}</h1>
      {right ?? <span />}
    </header>
  );
}

export function ErrorText({ state }: { state: ActionState }) {
  if (state.status !== 'error') return null;
  return (
    <p className="form-error" role="alert">
      {state.message}
    </p>
  );
}

/** Declarative redirect: replaces the history entry once rendered. */
export function Go({ to, navigate }: { to: OwnerRoute; navigate: OwnerNavigate }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return null;
}
```

`src/features/owner/AuthScreens.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { authRedirectUrl } from '../../app/authRedirect';
import type { OwnerApi, SessionInfo } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { isEmail, PASSWORD_MIN } from './model/limits';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

/** A paired phone is an anonymous session; signing in here would silently unpair it. */
function AnonymousWarning({ confirmed, onChange }: { confirmed: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="notice" role="note">
      <p>Αυτή η συσκευή είναι συνδεδεμένη ως ταμείο — αν συνδεθείς ως ιδιοκτήτης θα αποσυνδεθεί από το κατάστημα.</p>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} />
        Κατάλαβα, να αποσυνδεθεί το ταμείο
      </label>
    </div>
  );
}

interface AuthProps {
  api: OwnerApi;
  session: SessionInfo | null;
  navigate: OwnerNavigate;
}

export function LoginScreen({ api, session, navigate, onSignedIn }: AuthProps & { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const action = useAction();
  const phone = session?.anonymous === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email.trim())) return action.fail('Γράψε ένα έγκυρο email.');
    if (password === '') return action.fail('Γράψε τον κωδικό σου.');
    const r = await action.run(() => api.signIn(email.trim(), password));
    if (r.ok) onSignedIn();
  };

  return (
    <div className="app">
      <OwnerHeader title="Σύνδεση ιδιοκτήτη" />
      <main className="page">
        {phone && <AnonymousWarning confirmed={confirmed} onChange={setConfirmed} />}
        <Card>
          <form className="form" onSubmit={submit} noValidate>
            <input className="text-field" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="text-field" aria-label="Κωδικός" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={action.busy || (phone && !confirmed)}>
              Σύνδεση
            </button>
            <ErrorText state={action.state} />
          </form>
        </Card>
        <button type="button" className="link" onClick={() => navigate({ name: 'signup' })}>
          Νέος λογαριασμός
        </button>{' '}
        <button type="button" className="link" onClick={() => navigate({ name: 'forgot' })}>
          Ξέχασα τον κωδικό
        </button>
      </main>
    </div>
  );
}

export function SignupScreen({ api, session, navigate, redirectBase }: AuthProps & { redirectBase: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const action = useAction();
  const phone = session?.anonymous === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!isEmail(address)) return action.fail('Γράψε ένα έγκυρο email.');
    if (password.length < PASSWORD_MIN) return action.fail(`Ο κωδικός θέλει τουλάχιστον ${PASSWORD_MIN} χαρακτήρες.`);
    if (password !== repeat) return action.fail('Οι δύο κωδικοί δεν ταιριάζουν.');
    const r = await action.run(() => api.signUp(address, password, authRedirectUrl(redirectBase, 'signup')));
    if (r.ok) setSentTo(address);
  };

  return (
    <div className="app">
      <OwnerHeader title="Νέος λογαριασμός" onBack={() => navigate({ name: 'login' })} />
      <main className="page">
        {sentTo !== null ? (
          <Card>
            <p className="form-ok">
              Σου στείλαμε email επιβεβαίωσης στο {sentTo}. Άνοιξε τον σύνδεσμο σε αυτή τη συσκευή και σε αυτόν τον browser.
            </p>
          </Card>
        ) : (
          <>
            {phone && <AnonymousWarning confirmed={confirmed} onChange={setConfirmed} />}
            <Card>
              <form className="form" onSubmit={submit} noValidate>
                <input className="text-field" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input className="text-field" aria-label="Κωδικός" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <input className="text-field" aria-label="Επανάληψη κωδικού" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
                <button type="submit" className="btn btn-primary" disabled={action.busy || (phone && !confirmed)}>
                  Δημιουργία λογαριασμού
                </button>
                <ErrorText state={action.state} />
              </form>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

export function ForgotScreen({ api, navigate, redirectBase }: Omit<AuthProps, 'session'> & { redirectBase: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email.trim())) return action.fail('Γράψε ένα έγκυρο email.');
    const r = await action.run(() => api.sendReset(email.trim(), authRedirectUrl(redirectBase, 'recovery')));
    if (r.ok) setSent(true);
  };

  return (
    <div className="app">
      <OwnerHeader title="Ξέχασα τον κωδικό" onBack={() => navigate({ name: 'login' })} />
      <main className="page">
        <Card>
          {sent ? (
            <p className="form-ok">Αν υπάρχει λογαριασμός με αυτό το email, στάλθηκε σύνδεσμος. Άνοιξέ τον σε αυτή τη συσκευή.</p>
          ) : (
            <form className="form" onSubmit={submit} noValidate>
              <input className="text-field" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="submit" className="btn btn-primary" disabled={action.busy}>
                Αποστολή συνδέσμου
              </button>
              <ErrorText state={action.state} />
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}

export function ResetScreen({ api, navigate }: Omit<AuthProps, 'session'>) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return action.fail(`Ο κωδικός θέλει τουλάχιστον ${PASSWORD_MIN} χαρακτήρες.`);
    if (password !== repeat) return action.fail('Οι δύο κωδικοί δεν ταιριάζουν.');
    const r = await action.run(() => api.updatePassword(password));
    if (r.ok) navigate({ name: 'shops' }, { replace: true });
  };

  return (
    <div className="app">
      <OwnerHeader title="Νέος κωδικός" />
      <main className="page">
        <Card>
          <form className="form" onSubmit={submit} noValidate>
            <input className="text-field" aria-label="Νέος κωδικός" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="text-field" aria-label="Επανάληψη κωδικού" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={action.busy}>
              Αποθήκευση
            </button>
            <ErrorText state={action.state} />
          </form>
        </Card>
      </main>
    </div>
  );
}

export function LinkErrorScreen({ onLogin, onResend }: { onLogin: () => void; onResend: () => void }) {
  return (
    <div className="app">
      <OwnerHeader title="Σύνδεσμος email" />
      <main className="page">
        <Card>
          <p>Ο σύνδεσμος δεν λειτούργησε.</p>
          <p className="notice-soft">
            Μπορεί να έληξε ή να χρησιμοποιήθηκε ήδη. Άνοιξέ τον στη συσκευή και τον browser όπου τον ζήτησες, ή ζήτησε νέο.
          </p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={onLogin}>
              Σύνδεση
            </button>
            <button type="button" className="btn btn-primary" onClick={onResend}>
              Νέος σύνδεσμος
            </button>
          </div>
        </Card>
      </main>
    </div>
  );
}
```

`src/features/owner/OwnerApp.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthRedirect } from '../../app/authRedirect';
import type { OwnerRoute } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi, Result, SessionInfo } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { ForgotScreen, LinkErrorScreen, LoginScreen, ResetScreen, SignupScreen } from './AuthScreens';
import { NewShopScreen } from './NewShopScreen';
import { Go, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { ShopLayout } from './ShopLayout';
import { ShopsScreen } from './ShopsScreen';

export interface OwnerAppProps {
  route: OwnerRoute;
  navigate: OwnerNavigate;
  api: OwnerApi | null;
  store: KeyValueStore;
  now?: () => Date;
  /** Parsed `?auth=…` of an email link, if the app was opened from one. */
  redirect?: AuthRedirect | null;
  /** Strips `?auth=…&code=…` from the address bar. */
  onRedirectHandled?: () => void;
  /** origin + pathname, used to build email-link redirect URLs. */
  redirectBase: string;
  onExit: () => void;
}

const systemNow = (): Date => new Date();

export function OwnerApp(props: OwnerAppProps) {
  if (props.api === null) {
    return (
      <div className="app">
        <OwnerHeader title="Διαχείριση" onBack={props.onExit} />
        <main className="page">
          <Card>
            <p>
              Η σύνδεση με τον διακομιστή δεν έχει ρυθμιστεί (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
            </p>
          </Card>
        </main>
      </div>
    );
  }
  return <ConnectedOwnerApp {...props} api={props.api} />;
}

function ConnectedOwnerApp({ route, navigate, api, store, now = systemNow, redirect = null, onRedirectHandled, redirectBase }: OwnerAppProps & { api: OwnerApi }) {
  const [session, setSession] = useState<SessionInfo | null | 'loading'>('loading');
  const [linkError, setLinkError] = useState(false);
  // Shared across StrictMode's double effect run so the one-time code is exchanged exactly once.
  const exchange = useRef<Promise<Result<void>> | null>(null);
  const autoOpen = useRef(true);

  const refresh = useCallback(async () => setSession(await api.session()), [api]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = api.onAuthChange((s) => {
      if (!cancelled) setSession(s);
    });
    void (async () => {
      if (redirect !== null) {
        onRedirectHandled?.();
        if (redirect.kind === 'error') {
          setLinkError(true);
        } else {
          exchange.current ??= api.exchangeCode(redirect.code);
          const r = await exchange.current;
          if (cancelled) return;
          if (!r.ok) setLinkError(true);
          else navigate(redirect.kind === 'recovery' ? { name: 'reset' } : { name: 'shops' }, { replace: true });
        }
      }
      const s = await api.session();
      if (!cancelled) setSession(s);
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Runs once per mount: the redirect is read from the URL at start-up only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null);
    navigate({ name: 'login' }, { replace: true });
  }, [api, navigate]);

  if (linkError) {
    return (
      <LinkErrorScreen
        onLogin={() => {
          setLinkError(false);
          navigate({ name: 'login' });
        }}
        onResend={() => {
          setLinkError(false);
          navigate({ name: 'forgot' });
        }}
      />
    );
  }
  if (session === 'loading') {
    return (
      <div className="app">
        <main className="page">
          <p className="notice-soft">Φόρτωση…</p>
        </main>
      </div>
    );
  }

  const owner = session !== null && !session.anonymous ? session : null;
  const login = <LoginScreen api={api} session={session} navigate={navigate} onSignedIn={() => void refresh()} />;

  switch (route.name) {
    case 'login':
      return owner ? <Go to={{ name: 'shops' }} navigate={navigate} /> : login;
    case 'signup':
      return owner ? <Go to={{ name: 'shops' }} navigate={navigate} /> : <SignupScreen api={api} session={session} navigate={navigate} redirectBase={redirectBase} />;
    case 'forgot':
      return <ForgotScreen api={api} navigate={navigate} redirectBase={redirectBase} />;
    case 'reset':
      return owner ? (
        <ResetScreen api={api} navigate={navigate} />
      ) : (
        <LinkErrorScreen onLogin={() => navigate({ name: 'login' })} onResend={() => navigate({ name: 'forgot' })} />
      );
    case 'shops':
      if (!owner) return login;
      return (
        <ShopsScreen
          api={api}
          navigate={navigate}
          autoOpen={autoOpen.current}
          onLoaded={() => {
            autoOpen.current = false;
          }}
          onSignOut={() => void signOut()}
        />
      );
    case 'new':
      return owner ? <NewShopScreen api={api} navigate={navigate} /> : login;
    case 'shop':
      if (!owner) return login;
      autoOpen.current = false;
      return (
        <ShopLayout
          api={api}
          shopId={route.shopId}
          tab={route.tab}
          navigate={navigate}
          store={store}
          now={now}
          email={owner.email}
          onSignOut={() => void signOut()}
        />
      );
  }
}
```

Note: `ShopsScreen` gets an extra `onSignOut: () => void` prop — include it in the stub signature below and in Task 9.

Stubs so the shell compiles (Tasks 9 and 10 replace their bodies — keep the prop signatures):

`src/features/owner/ShopsScreen.tsx`:

```tsx
import type { OwnerApi } from '../../data/remote/ownerApi';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

export function ShopsScreen({ onSignOut }: { api: OwnerApi; navigate: OwnerNavigate; autoOpen: boolean; onLoaded: () => void; onSignOut: () => void }) {
  return (
    <div className="app">
      <OwnerHeader title="Καταστήματα" right={<button type="button" className="link" onClick={onSignOut}>Αποσύνδεση</button>} />
    </div>
  );
}
```

`src/features/owner/NewShopScreen.tsx`:

```tsx
import type { OwnerApi } from '../../data/remote/ownerApi';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

export function NewShopScreen(_: { api: OwnerApi; navigate: OwnerNavigate }) {
  return <OwnerHeader title="Νέο κατάστημα" />;
}
```

`src/features/owner/ShopLayout.tsx`:

```tsx
import type { ShopTab } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

export interface ShopLayoutProps {
  api: OwnerApi;
  shopId: string;
  tab: ShopTab;
  navigate: OwnerNavigate;
  store: KeyValueStore;
  now: () => Date;
  email: string | null;
  onSignOut: () => void;
}

export function ShopLayout(_: ShopLayoutProps) {
  return <OwnerHeader title="Κατάστημα" />;
}
```

`src/features/owner/OwnerEntry.tsx`:

```tsx
import { useState } from 'react';
import { createOwnerApi } from '../../data/remote/owner';
import { createSupabase } from '../../data/remote/client';
import { OwnerApp, type OwnerAppProps } from './OwnerApp';

/** Lazy-loaded entry: the only place the real supabase client is created. Never imported by tests. */
export default function OwnerEntry(props: Omit<OwnerAppProps, 'api'>) {
  const [api] = useState(() => {
    const client = createSupabase(props.store);
    return client ? createOwnerApi(client) : null;
  });
  return <OwnerApp {...props} api={api} />;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/features/owner/auth.test.tsx && npm run typecheck`
Expected: PASS. (The `// eslint-disable-next-line` comment is harmless — the repo has no ESLint; drop it if you prefer.)

- [ ] **Step 6: Commit**

```bash
git add src/app/theme.css src/features/owner tests/features/owner/fakeApi.ts tests/features/owner/auth.test.tsx
git commit -m "feat(owner): session gate, email/password auth screens, PKCE link exchange

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Shops list, new shop, shop header with rename and tabs

**Files:**
- Modify: `src/features/owner/ShopsScreen.tsx`, `src/features/owner/NewShopScreen.tsx`, `src/features/owner/ShopLayout.tsx` (replace stubs)
- Test: `tests/features/owner/shops.test.tsx`

**Interfaces:**
- Consumes: `OwnerApi`, `ShopRow` (Task 7); `buildFirstConfig`, `FirstSetupChannel` (Task 3); `CHANNEL_TYPE_LABELS` (Task 4); `checkName`, `SHOP_NAME_MAX` (Task 3); `nameProblemMessage` (Task 5); `parseAmount` (core); `CHANNEL_TYPES`, `validateConfig` (core); `useAction`, `ErrorText`, `OwnerHeader` (Task 8).
- Produces: the three screens with the Task 8 signatures. `ShopLayout` renders the tab body: for this task, `settings` → `<p>` placeholder «Ρυθμίσεις», `staff`/`devices` likewise; Tasks 10, 12, 13 swap in `SettingsScreen`, `OwnerStaffScreen`, `DevicesScreen` with props `{ api, shopId, store, now }`.

- [ ] **Step 1: Write the failing tests** `tests/features/owner/shops.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateConfig, type ShopConfig } from '../../../src/core/config';
import { memoryStore } from '../../../src/data/local/storage';
import { NewShopScreen } from '../../../src/features/owner/NewShopScreen';
import { ShopLayout } from '../../../src/features/owner/ShopLayout';
import { ShopsScreen } from '../../../src/features/owner/ShopsScreen';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ShopsScreen', () => {
  it('auto-opens the only shop on first load', async () => {
    const navigate = vi.fn();
    const onLoaded = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Join Juice' }])) })} navigate={navigate} autoOpen onLoaded={onLoaded} onSignOut={vi.fn()} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: A, tab: 'settings' }, { replace: true }));
    expect(onLoaded).toHaveBeenCalled();
  });

  it('lists several shops and offers a new one', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α' }, { id: B, name: 'Β' }])) })} navigate={navigate} autoOpen onLoaded={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Β' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: B, tab: 'settings' });
    fireEvent.click(screen.getByRole('button', { name: '+ Νέο κατάστημα' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'new' });
  });

  it('does not auto-open when coming back to the list', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α' }])) })} navigate={navigate} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole('button', { name: 'Α' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a load error with retry', async () => {
    const listShops = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok([]));
    render(<ShopsScreen api={fakeApi({ listShops })} navigate={vi.fn()} autoOpen onLoaded={vi.fn()} onSignOut={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByText(/Δεν έχεις ακόμα κατάστημα/)).toBeTruthy();
  });
});

describe('NewShopScreen', () => {
  it('creates a valid config from name, float and channels', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    render(<NewShopScreen api={api} navigate={navigate} />);
    type('Όνομα καταστήματος', '  Join Juice ');
    type('Αρχικό ταμείο (€)', '1000');
    fireEvent.click(screen.getByRole('button', { name: '+ Κανάλι' }));
    type('Όνομα καναλιού 1', 'WOLT');
    fireEvent.change(screen.getByLabelText('Είδος καναλιού 1'), { target: { value: 'delivery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: '11111111-1111-4111-8111-111111111111', tab: 'settings' }, { replace: true }));
    const [name, config] = (api.createShop as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ShopConfig];
    expect(name).toBe('Join Juice');
    expect(config.floatCents).toBe(100000);
    expect(config.channels).toEqual([{ id: 'ch_1', label: 'WOLT', type: 'delivery' }]);
    expect(validateConfig(config)).toEqual([]);
  });

  it('refuses an empty name, a bad float and an unnamed channel before calling the server', () => {
    const api = fakeApi();
    render(<NewShopScreen api={api} navigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(screen.getByRole('alert').textContent).toContain('όνομα');
    type('Όνομα καταστήματος', 'X');
    type('Αρχικό ταμείο (€)', '5-3');
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(screen.getByRole('alert').textContent).toContain('ταμείο');
    type('Αρχικό ταμείο (€)', '');
    fireEvent.click(screen.getByRole('button', { name: '+ Κανάλι' }));
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(screen.getByRole('alert').textContent).toContain('κανάλι');
    expect(api.createShop).not.toHaveBeenCalled();
  });
});

describe('ShopLayout', () => {
  it('shows the shop name, renames it, and switches tabs', async () => {
    const api = fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Join Juice' }])) });
    const navigate = vi.fn();
    render(<ShopLayout api={api} shopId={A} tab="settings" navigate={navigate} store={memoryStore()} now={() => new Date()} email="o@t.gr" onSignOut={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Join Juice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Μετονομασία καταστήματος' }));
    type('Νέο όνομα καταστήματος', 'Join Juice 2');
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    expect(await screen.findByRole('heading', { name: 'Join Juice 2' })).toBeTruthy();
    expect(api.renameShop).toHaveBeenCalledWith(A, 'Join Juice 2');
    fireEvent.click(screen.getByRole('button', { name: 'Προσωπικό' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: A, tab: 'staff' });
  });

  it('says so when the shop is not found', async () => {
    render(<ShopLayout api={fakeApi()} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email={null} onSignOut={vi.fn()} />);
    expect(await screen.findByText(/Το κατάστημα δεν βρέθηκε/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/shops.test.tsx`
Expected: FAIL — stubs render nothing useful.

- [ ] **Step 3: Implement**

`src/features/owner/ShopsScreen.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { OwnerApi, ShopRow } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { ownerErrorMessage } from './model/messages';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

interface Props {
  api: OwnerApi;
  navigate: OwnerNavigate;
  /** true only for the first list load after sign-in — opening a single shop straight away. */
  autoOpen: boolean;
  onLoaded: () => void;
  onSignOut: () => void;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; shops: ShopRow[] };

export function ShopsScreen({ api, navigate, autoOpen, onLoaded, onSignOut }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void api.listShops().then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      setLoad({ status: 'ready', shops: r.data });
      const only = r.data.length === 1 ? r.data[0] : undefined;
      if (autoOpen && only) navigate({ name: 'shop', shopId: only.id, tab: 'settings' }, { replace: true });
      onLoaded();
    });
    return () => {
      cancelled = true;
    };
    // autoOpen/onLoaded are read at load time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, attempt]);

  return (
    <div className="app">
      <OwnerHeader
        title="Καταστήματα"
        right={
          <button type="button" className="link" onClick={onSignOut}>
            Αποσύνδεση
          </button>
        }
      />
      <main className="page">
        {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
        {load.status === 'error' && (
          <Card>
            <p className="form-error" role="alert">
              {load.message}
            </p>
            <button type="button" className="btn btn-text" onClick={retry}>
              Ξανά
            </button>
          </Card>
        )}
        {load.status === 'ready' && (
          <Card>
            {load.shops.length === 0 && <p className="notice-soft">Δεν έχεις ακόμα κατάστημα.</p>}
            {load.shops.map((s) => (
              <button key={s.id} type="button" className="choice wide" onClick={() => navigate({ name: 'shop', shopId: s.id, tab: 'settings' })}>
                {s.name}
              </button>
            ))}
            <button type="button" className="btn btn-primary wide" onClick={() => navigate({ name: 'new' })}>
              + Νέο κατάστημα
            </button>
          </Card>
        )}
      </main>
    </div>
  );
}
```

`src/features/owner/NewShopScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { CHANNEL_TYPES, validateConfig, type ChannelType } from '../../core/config';
import { parseAmount } from '../../core/money';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { buildFirstConfig, type FirstSetupChannel } from './model/firstSetup';
import { checkName, SHOP_NAME_MAX } from './model/limits';
import { nameProblemMessage } from './model/messages';
import { CHANNEL_TYPE_LABELS } from './model/terms';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

export function NewShopScreen({ api, navigate }: { api: OwnerApi; navigate: OwnerNavigate }) {
  const [name, setName] = useState('');
  const [float, setFloat] = useState('');
  const [channels, setChannels] = useState<FirstSetupChannel[]>([]);
  const action = useAction();

  const setChannel = (i: number, patch: Partial<FirstSetupChannel>) =>
    setChannels(channels.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(name, SHOP_NAME_MAX);
    if (!n.ok) return action.fail(`Όνομα καταστήματος: ${nameProblemMessage(n.problem, SHOP_NAME_MAX)}`);
    const f = float.trim() === '' ? { ok: true as const, value: 0 } : parseAmount(float);
    if (!f.ok) return action.fail('Το αρχικό ταμείο πρέπει να είναι ποσό, π.χ. 1000 ή 150,50.');
    if (channels.some((c) => c.label.trim() === '')) return action.fail('Δώσε όνομα σε κάθε κανάλι ή αφαίρεσέ το.');
    const config = buildFirstConfig({ floatCents: f.value, channels });
    if (validateConfig(config).length > 0) return action.fail('Οι ρυθμίσεις δεν είναι έγκυρες.');
    const r = await action.run(() => api.createShop(n.value, config));
    if (r.ok) navigate({ name: 'shop', shopId: r.data, tab: 'settings' }, { replace: true });
  };

  return (
    <div className="app">
      <OwnerHeader title="Νέο κατάστημα" onBack={() => navigate({ name: 'shops' })} />
      <main className="page">
        <form className="form" onSubmit={submit} noValidate>
          <Card title="Βασικά">
            <input className="text-field" aria-label="Όνομα καταστήματος" placeholder="Όνομα καταστήματος" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="row">
              <span className="row-label">Αρχικό ταμείο (€)</span>
              <input className="field" aria-label="Αρχικό ταμείο (€)" inputMode="decimal" placeholder="0" value={float} onChange={(e) => setFloat(e.target.value)} />
            </div>
          </Card>
          <Card title="Κανάλια πληρωμής">
            <p className="notice-soft">Κάρτες, πλατφόρμες delivery, κέρματα εκτός ταμείου. Αλλάζουν αργότερα από τις Ρυθμίσεις.</p>
            {channels.map((c, i) => (
              <div className="row" key={i}>
                <input className="field text" aria-label={`Όνομα καναλιού ${i + 1}`} value={c.label} onChange={(e) => setChannel(i, { label: e.target.value })} />
                <select className="select" aria-label={`Είδος καναλιού ${i + 1}`} value={c.type} onChange={(e) => setChannel(i, { type: e.target.value as ChannelType })}>
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CHANNEL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" aria-label={`Αφαίρεση καναλιού ${i + 1}`} onClick={() => setChannels(channels.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-text" onClick={() => setChannels([...channels, { label: '', type: 'card' }])}>
              + Κανάλι
            </button>
          </Card>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            Δημιουργία
          </button>
          <ErrorText state={action.state} />
        </form>
      </main>
    </div>
  );
}
```

`src/features/owner/ShopLayout.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import type { ShopTab } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { checkName, SHOP_NAME_MAX } from './model/limits';
import { nameProblemMessage, ownerErrorMessage } from './model/messages';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

export interface ShopLayoutProps {
  api: OwnerApi;
  shopId: string;
  tab: ShopTab;
  navigate: OwnerNavigate;
  store: KeyValueStore;
  now: () => Date;
  email: string | null;
  onSignOut: () => void;
}

const TABS: { tab: ShopTab; label: string }[] = [
  { tab: 'settings', label: 'Ρυθμίσεις' },
  { tab: 'staff', label: 'Προσωπικό' },
  { tab: 'devices', label: 'Συσκευές' },
];

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'missing' } | { status: 'ready'; name: string };

export function ShopLayout({ api, shopId, tab, navigate, store, now, email, onSignOut }: ShopLayoutProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const rename = useAction();

  useEffect(() => {
    let cancelled = false;
    void api.listShops().then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      const shop = r.data.find((s) => s.id === shopId);
      setLoad(shop ? { status: 'ready', name: shop.name } : { status: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [api, shopId]);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(draftName, SHOP_NAME_MAX);
    if (!n.ok) return rename.fail(nameProblemMessage(n.problem, SHOP_NAME_MAX));
    const r = await rename.run(() => api.renameShop(shopId, n.value));
    if (r.ok) {
      setLoad({ status: 'ready', name: n.value });
      setRenaming(false);
    }
  };

  const back = () => navigate({ name: 'shops' });
  if (load.status !== 'ready') {
    return (
      <div className="app">
        <OwnerHeader title="Κατάστημα" onBack={back} />
        <main className="page">
          {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
          {load.status === 'missing' && <p className="notice-soft">Το κατάστημα δεν βρέθηκε.</p>}
          {load.status === 'error' && (
            <p className="form-error" role="alert">
              {load.message}
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <OwnerHeader
        title={load.name}
        onBack={back}
        right={
          <button
            type="button"
            className="icon-btn"
            aria-label="Μετονομασία καταστήματος"
            onClick={() => {
              setDraftName(load.name);
              setRenaming(true);
            }}
          >
            ✎
          </button>
        }
      />
      {renaming && (
        <Card>
          <form className="form" onSubmit={saveName} noValidate>
            <input className="text-field" aria-label="Νέο όνομα καταστήματος" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <div className="sheet-actions">
              <button type="button" className="btn btn-text" onClick={() => setRenaming(false)}>
                Άκυρο
              </button>
              <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={rename.busy}>
                Αποθήκευση
              </button>
            </div>
            <ErrorText state={rename.state} />
          </form>
        </Card>
      )}
      <nav className="tabs" aria-label="Ενότητες καταστήματος">
        {TABS.map((t) => (
          <button key={t.tab} type="button" aria-current={t.tab === tab ? 'page' : undefined} onClick={() => navigate({ name: 'shop', shopId, tab: t.tab })}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page">
        <TabBody tab={tab} api={api} shopId={shopId} store={store} now={now} />
      </main>
      <footer className="notice-soft" style={{ padding: '0 12px 16px' }}>
        {email ?? ''}{' '}
        <button type="button" className="link" onClick={onSignOut}>
          Αποσύνδεση
        </button>
      </footer>
    </div>
  );
}

/** Tasks 10, 12 and 13 replace these placeholders with the real screens. */
function TabBody({ tab }: { tab: ShopTab; api: OwnerApi; shopId: string; store: KeyValueStore; now: () => Date }) {
  return <p className="notice-soft">{TABS.find((t) => t.tab === tab)?.label}</p>;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/features/owner && npm run typecheck`
Expected: PASS (auth tests still pass — ShopsScreen keeps its sign-out button).

- [ ] **Step 5: Commit**

```bash
git add src/features/owner tests/features/owner/shops.test.tsx
git commit -m "feat(owner): shops list, new shop, shop header with rename and tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Settings screen — load, draft, publish, conflict; general/channels/tare sections

**Files:**
- Create: `src/features/owner/settings/SettingsScreen.tsx`, `GeneralSection.tsx`, `ChannelsSection.tsx`, `TareSection.tsx`
- Modify: `src/features/owner/ShopLayout.tsx` (`TabBody`: settings → `SettingsScreen`)
- Test: `tests/features/owner/settings.test.tsx`

**Interfaces:**
- Consumes: `applySettings`, `SettingsAction`, `isEditableConfig` (Task 4); `configErrorMessage`, `configErrorSection`, `ownerErrorMessage`, `SettingsSection` (Task 5); `loadOwnerDraft`, `saveOwnerDraft`, `clearOwnerDraft` (Task 7); `OwnerApi` (Task 7); `validateConfig`, `isShopConfig`, `newShopConfig`, `CHANNEL_TYPES`, `ChannelType`, `ShopConfig` (core); `EUR_DENOMINATIONS`, `denomLabel` (core/denominations); `parseAmount`, `centsToPlain` (core/money); `CHANNEL_TYPE_LABELS` (Task 4); `Sheet` (ui); `useAction`, `ErrorText` (Task 8).
- Produces:
  - `SettingsScreen({ api, shopId, store, now }: { api: OwnerApi; shopId: string; store: KeyValueStore; now: () => Date })`
  - `interface SectionProps { config: ShopConfig; dispatch: (a: SettingsAction) => void; errors: string[] }` (exported from `GeneralSection.tsx`, used by all sections incl. Task 11's `TotalsSection`)
  - Section components: `GeneralSection`, `ChannelsSection`, `TareSection` (props `SectionProps`)

- [ ] **Step 1: Write the failing tests** `tests/features/owner/settings.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newShopConfig, type ShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { loadOwnerDraft, saveOwnerDraft } from '../../../src/data/local/ownerDrafts';
import { memoryStore, type KeyValueStore } from '../../../src/data/local/storage';
import type { OwnerApi } from '../../../src/data/remote/ownerApi';
import { SettingsScreen } from '../../../src/features/owner/settings/SettingsScreen';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date(2026, 8, 29, 12, 0);
const jj = (): ShopConfig => structuredClone(joinJuicePreset) as ShopConfig;
const serverAt = (version: number, config: unknown = jj()) => vi.fn(() => ok({ id: `c${version}`, version, config }));
const publishButton = () => screen.getByRole('button', { name: 'Δημοσίευση' }) as HTMLButtonElement;

function start(api: OwnerApi, store: KeyValueStore = memoryStore()) {
  render(<SettingsScreen api={api} shopId={SHOP} store={store} now={NOW} />);
  return store;
}

describe('SettingsScreen', () => {
  it('loads the latest version; nothing to publish until something changes', async () => {
    start(fakeApi({ latestConfig: serverAt(3) }));
    expect(await screen.findByText(/Έκδοση 3/)).toBeTruthy();
    expect(publishButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    expect(publishButton().disabled).toBe(false);
  });

  it('publishes with the base version and clears the local draft', async () => {
    const api = fakeApi({ latestConfig: serverAt(3), publishConfig: vi.fn(() => ok(4)) });
    const store = start(api);
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    expect(loadOwnerDraft(store, SHOP)?.config.floatCents).toBe(50000);
    fireEvent.click(publishButton());
    expect(await screen.findByText(/Δημοσιεύτηκε η έκδοση 4/)).toBeTruthy();
    const [, version, config] = (api.publishConfig as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number, ShopConfig];
    expect(version).toBe(3);
    expect(config.floatCents).toBe(50000);
    expect(loadOwnerDraft(store, SHOP)).toBeNull();
  });

  it('blocks publishing while the config is invalid and says where', async () => {
    start(fakeApi({ latestConfig: serverAt(1) }));
    await screen.findByText(/Έκδοση 1/);
    fireEvent.change(screen.getByLabelText('Όνομα καναλιού WOLT'), { target: { value: '' } });
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByRole('region', { name: 'Κανάλια' }).textContent).toContain('χρειάζεται όνομα');
  });

  it('refuses to delete a channel a total uses', async () => {
    const config = jj();
    config.totals.push({ id: 't_1', label: 'ΜΟΝΟ WOLT', terms: [{ sign: 1, ref: { kind: 'channel', id: 'wolt' } }], showInSummary: true, showInShare: true });
    start(fakeApi({ latestConfig: serverAt(1, config) }));
    await screen.findByText(/Έκδοση 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση WOLT' }));
    expect(screen.getByText(/χρησιμοποιείται στο ΜΟΝΟ WOLT/)).toBeTruthy();
    expect(screen.getByLabelText('Όνομα καναλιού WOLT')).toBeTruthy();
  });

  it('conflict → «Φόρτωση νέας» discards the draft and shows the new version', async () => {
    const latestConfig = vi.fn().mockReturnValueOnce(ok({ id: 'c3', version: 3, config: jj() })).mockReturnValue(ok({ id: 'c5', version: 5, config: jj() }));
    const api = fakeApi({ latestConfig, publishConfig: vi.fn(() => fail({ code: 'version_conflict', currentVersion: 5 })) });
    const store = start(api);
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    expect(await screen.findByRole('dialog', { name: 'Οι ρυθμίσεις άλλαξαν' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Φόρτωση νέας' }));
    expect(await screen.findByText(/Έκδοση 5/)).toBeTruthy();
    expect(loadOwnerDraft(store, SHOP)).toBeNull();
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe('1000');
  });

  it('conflict → «Δημοσίευση πάνω της» republishes on the current version', async () => {
    const publishConfig = vi.fn().mockReturnValueOnce(fail({ code: 'version_conflict', currentVersion: 5 })).mockReturnValue(ok(6));
    start(fakeApi({ latestConfig: serverAt(3), publishConfig }));
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Δημοσίευση πάνω της' }));
    expect(await screen.findByText(/Δημοσιεύτηκε η έκδοση 6/)).toBeTruthy();
    expect(publishConfig.mock.calls[1]?.[1]).toBe(5);
  });

  it('session expired keeps draft: the error is shown and the edit is still stored', async () => {
    const api = fakeApi({ latestConfig: serverAt(3), publishConfig: vi.fn(() => fail({ code: 'session_expired' })) });
    const store = start(api);
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Η σύνδεση έληξε');
    expect(loadOwnerDraft(store, SHOP)?.config.floatCents).toBe(50000);
  });

  it('continues a same-version draft silently; offers an older-version draft', async () => {
    const store = memoryStore();
    saveOwnerDraft(store, SHOP, { config: { ...jj(), floatCents: 777 }, baseVersion: 3, savedAt: 1 });
    start(fakeApi({ latestConfig: serverAt(3) }), store);
    await screen.findByText(/Έκδοση 3/);
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe('7.77');
    cleanup();

    const older = memoryStore();
    saveOwnerDraft(older, SHOP, { config: { ...jj(), floatCents: 777 }, baseVersion: 2, savedAt: 1 });
    start(fakeApi({ latestConfig: serverAt(3) }), older);
    expect(await screen.findByText(/πρόχειρο από την έκδοση 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Απόρριψη' }));
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe('1000');
    expect(loadOwnerDraft(older, SHOP)).toBeNull();
  });

  it('opens a server config that fails validation, and starts blank from a broken one', async () => {
    start(fakeApi({ latestConfig: serverAt(2, { ...jj(), envelopeTotalId: 'gone' }) }));
    await screen.findByText(/Έκδοση 2/);
    expect(screen.getByText(/Διάλεξε ποιο σύνολο γεμίζει ο Φάκελος/)).toBeTruthy();
    cleanup();

    start(fakeApi({ latestConfig: serverAt(2, { schema: 1, junk: true }) }));
    expect(await screen.findByText(/δεν μπόρεσαν να διαβαστούν/)).toBeTruthy();
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe(String(newShopConfig().floatCents));
  });

  it('shows a load error with retry', async () => {
    const latestConfig = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok({ id: 'c1', version: 1, config: jj() }));
    start(fakeApi({ latestConfig }));
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByText(/Έκδοση 1/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/settings.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sections**

`src/features/owner/settings/GeneralSection.tsx`:

```tsx
import { useState } from 'react';
import type { ShopConfig } from '../../../core/config';
import { denomLabel, EUR_DENOMINATIONS } from '../../../core/denominations';
import { centsToPlain, parseAmount } from '../../../core/money';
import { Card } from '../../../ui/Card';
import type { SettingsAction } from '../model/settingsDraft';

export interface SectionProps {
  config: ShopConfig;
  dispatch: (action: SettingsAction) => void;
  /** Greek messages of the validation errors that belong to this section. */
  errors: string[];
}

export function SectionErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="form-error">
      {errors.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

export function GeneralSection({ config, dispatch, errors }: SectionProps) {
  const [floatText, setFloatText] = useState(() => centsToPlain(config.floatCents));
  const floatParsed = floatText.trim() === '' ? { ok: true as const, value: 0 } : parseAmount(floatText);

  return (
    <Card title="Γενικά">
      <div className="row">
        <span className="row-label">Αρχικό ταμείο (€)</span>
        <input
          className="field"
          aria-label="Αρχικό ταμείο (€)"
          aria-invalid={!floatParsed.ok || undefined}
          inputMode="decimal"
          value={floatText}
          onChange={(e) => {
            setFloatText(e.target.value);
            const p = e.target.value.trim() === '' ? { ok: true as const, value: 0 } : parseAmount(e.target.value);
            if (p.ok) dispatch({ type: 'setFloat', cents: p.value });
          }}
        />
      </div>
      {!floatParsed.ok && <p className="row-hint err">Γράψε ποσό, π.χ. 1000 ή 150,50.</p>}

      <p className="row-label">Χαρτονομίσματα και κέρματα στο ταμείο</p>
      <div className="chips">
        {EUR_DENOMINATIONS.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={config.denominations.includes(d)} onClick={() => dispatch({ type: 'toggleDenomination', cents: d })}>
            {denomLabel(d)}
          </button>
        ))}
      </div>

      <div className="row">
        <span className="row-label">Έξοδα ανά κλείσιμο (0–30)</span>
        <input
          className="field"
          aria-label="Έξοδα ανά κλείσιμο"
          inputMode="numeric"
          value={String(config.maxExpenses)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isInteger(v)) dispatch({ type: 'setMaxExpenses', value: v });
          }}
        />
      </div>

      <div className="row">
        <span className="row-label">Ο Φάκελος γεμίζει το</span>
        <select className="select" aria-label="Σύνολο Φακέλου" value={config.envelopeTotalId} onChange={(e) => dispatch({ type: 'setEnvelopeTotal', id: e.target.value })}>
          {!config.totals.some((t) => t.id === config.envelopeTotalId) && <option value={config.envelopeTotalId}>—</option>}
          {config.totals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <SectionErrors errors={errors} />
    </Card>
  );
}
```

`src/features/owner/settings/ChannelsSection.tsx`:

```tsx
import { CHANNEL_TYPES, type ChannelType } from '../../../core/config';
import { Card } from '../../../ui/Card';
import { CHANNEL_TYPE_LABELS } from '../model/terms';
import { SectionErrors, type SectionProps } from './GeneralSection';

export function ChannelsSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Κανάλια">
      {config.channels.map((c) => (
        <div className="row" key={c.id}>
          <input className="field text" aria-label={`Όνομα καναλιού ${c.label}`} value={c.label} onChange={(e) => dispatch({ type: 'renameChannel', id: c.id, label: e.target.value })} />
          <select className="select" aria-label={`Είδος ${c.label}`} value={c.type} onChange={(e) => dispatch({ type: 'setChannelType', id: c.id, channelType: e.target.value as ChannelType })}>
            {CHANNEL_TYPES.map((t) => (
              <option key={t} value={t}>
                {CHANNEL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button type="button" className="icon-btn" aria-label={`Αφαίρεση ${c.label}`} onClick={() => dispatch({ type: 'removeChannel', id: c.id })}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addChannel', label: 'Νέο κανάλι', channelType: 'card' })}>
        + Κανάλι
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
```

Note: the channel name input's `aria-label` uses the *current* label; after typing, the label changes — tests look it up once per step, which is fine. Keys are ids, so focus is kept while typing.

`src/features/owner/settings/TareSection.tsx`:

```tsx
import { Card } from '../../../ui/Card';
import { SectionErrors, type SectionProps } from './GeneralSection';

export function TareSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Αποβάρα">
      {config.tareItems.map((item, i) => (
        <div className="row" key={i}>
          <input className="field text" aria-label={`Προϊόν αποβάρας ${i + 1}`} value={item.name} onChange={(e) => dispatch({ type: 'updateTare', index: i, name: e.target.value })} />
          <input
            className="field"
            aria-label={`Γραμμάρια ${i + 1}`}
            inputMode="numeric"
            value={String(item.tareGrams)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isInteger(v)) dispatch({ type: 'updateTare', index: i, tareGrams: v });
            }}
          />
          <button type="button" className="icon-btn" aria-label={`Αφαίρεση προϊόντος ${i + 1}`} onClick={() => dispatch({ type: 'removeTare', index: i })}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addTare', name: '', tareGrams: 0 })}>
        + Προϊόν
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
```

- [ ] **Step 4: Implement the screen** `src/features/owner/settings/SettingsScreen.tsx`

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isShopConfig, newShopConfig, validateConfig, type ShopConfig } from '../../../core/config';
import { clearOwnerDraft, loadOwnerDraft, saveOwnerDraft, type OwnerDraft } from '../../../data/local/ownerDrafts';
import type { KeyValueStore } from '../../../data/local/storage';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { Sheet } from '../../../ui/Sheet';
import { configErrorMessage, configErrorSection, ownerErrorMessage, type SettingsSection } from '../model/messages';
import { applySettings, isEditableConfig, type SettingsAction } from '../model/settingsDraft';
import { ErrorText } from '../OwnerUi';
import { useAction } from '../useAction';
import { ChannelsSection } from './ChannelsSection';
import { GeneralSection } from './GeneralSection';
import { TareSection } from './TareSection';

interface Props {
  api: OwnerApi;
  shopId: string;
  store: KeyValueStore;
  now: () => Date;
}

interface Server {
  version: number;
  /** null when the stored config is structurally unreadable. */
  config: ShopConfig | null;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; server: Server };

const same = (a: ShopConfig | null, b: ShopConfig): boolean => a !== null && JSON.stringify(a) === JSON.stringify(b);

export function SettingsScreen({ api, shopId, store, now }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<{ config: ShopConfig; baseVersion: number } | null>(null);
  const [offer, setOffer] = useState<OwnerDraft | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [conflict, setConflict] = useState<number | null | undefined>(undefined);
  const [published, setPublished] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const publish = useAction();

  const startFrom = useCallback((server: Server) => {
    setDraft({ config: server.config ?? newShopConfig(), baseVersion: server.version });
    setFormKey((k) => k + 1);
  }, []);

  const fetchLatest = useCallback(async (): Promise<Server | null> => {
    const r = await api.latestConfig(shopId);
    if (!r.ok) {
      setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      return null;
    }
    const version = r.data?.version ?? 0;
    const raw = r.data?.config;
    const server: Server = { version, config: r.data === null ? newShopConfig() : isEditableConfig(raw) ? raw : null };
    setLoad({ status: 'ready', server });
    return server;
  }, [api, shopId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void fetchLatest().then((server) => {
      if (cancelled || server === null) return;
      const saved = loadOwnerDraft(store, shopId);
      if (saved && saved.baseVersion === server.version) {
        setDraft({ config: saved.config, baseVersion: saved.baseVersion });
        setFormKey((k) => k + 1);
      } else {
        startFrom(server);
        if (saved && !same(server.config, saved.config)) setOffer(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLatest, store, shopId, startFrom, attempt]);

  const server = load.status === 'ready' ? load.server : null;
  const errors = useMemo(() => (draft ? validateConfig(draft.config) : []), [draft]);
  const dirty = draft !== null && server !== null && !same(server.config, draft.config);

  const dispatch = (action: SettingsAction) => {
    if (!draft) return;
    const r = applySettings(draft.config, action);
    setBlocked(r.blockedBy);
    setPublished(null);
    if (r.blockedBy.length > 0) return;
    const next = { config: r.config, baseVersion: draft.baseVersion };
    setDraft(next);
    if (server && same(server.config, r.config)) clearOwnerDraft(store, shopId);
    else saveOwnerDraft(store, shopId, { ...next, savedAt: now().getTime() });
  };

  const doPublish = async (baseVersion: number) => {
    if (!draft) return;
    const config = draft.config;
    const r = await publish.run(() => api.publishConfig(shopId, baseVersion, config));
    if (r.ok) {
      setLoad({ status: 'ready', server: { version: r.data, config } });
      setDraft({ config, baseVersion: r.data });
      clearOwnerDraft(store, shopId);
      setPublished(r.data);
      setConflict(undefined);
    } else if (r.error.code === 'version_conflict') {
      publish.clear();
      setConflict(r.error.currentVersion);
    }
  };

  const loadNewer = async () => {
    setConflict(undefined);
    const latest = await fetchLatest();
    if (latest) {
      clearOwnerDraft(store, shopId);
      startFrom(latest);
    }
  };

  const overwrite = async () => {
    let version = conflict;
    if (version === null || version === undefined) {
      const r = await api.latestConfig(shopId);
      version = r.ok ? (r.data?.version ?? 0) : null;
      if (version === null) return publish.fail('Δεν βρέθηκε η τρέχουσα έκδοση. Δοκίμασε ξανά.');
    }
    setConflict(undefined);
    if (draft) saveOwnerDraft(store, shopId, { config: draft.config, baseVersion: version, savedAt: now().getTime() });
    await doPublish(version);
  };

  if (load.status === 'loading' || (load.status === 'ready' && draft === null)) return <p className="notice-soft">Φόρτωση…</p>;
  if (load.status === 'error') {
    return (
      <Card>
        <p className="form-error" role="alert">
          {load.message}
        </p>
        <button type="button" className="btn btn-text" onClick={() => setAttempt((n) => n + 1)}>
          Ξανά
        </button>
      </Card>
    );
  }
  if (!draft || !server) return null;

  const bySection = (s: SettingsSection): string[] =>
    [...new Set(errors.filter((e) => configErrorSection(e) === s).map((e) => configErrorMessage(e, draft.config)))];
  const sectionProps = (s: SettingsSection) => ({ config: draft.config, dispatch, errors: bySection(s) });

  return (
    <div key={formKey}>
      <p className="notice-soft">
        Έκδοση {server.version}
        {dirty ? ' · μη δημοσιευμένες αλλαγές' : ''}
      </p>
      {server.config === null && (
        <p className="notice" role="note">
          Οι αποθηκευμένες ρυθμίσεις δεν μπόρεσαν να διαβαστούν — ξεκινάς από κενές. Η δημοσίευση τις αντικαθιστά.
        </p>
      )}
      {offer && (
        <Card>
          <p>Βρέθηκε μη δημοσιευμένο πρόχειρο από την έκδοση {offer.baseVersion}. Στο μεταξύ δημοσιεύτηκε η έκδοση {server.version}.</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="btn btn-text"
              onClick={() => {
                clearOwnerDraft(store, shopId);
                setOffer(null);
              }}
            >
              Απόρριψη
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDraft({ config: offer.config, baseVersion: server.version });
                saveOwnerDraft(store, shopId, { config: offer.config, baseVersion: server.version, savedAt: now().getTime() });
                setOffer(null);
                setFormKey((k) => k + 1);
              }}
            >
              Συνέχεια πρόχειρου
            </button>
          </div>
        </Card>
      )}
      {blocked.length > 0 && (
        <p className="form-error" role="alert">
          Δεν γίνεται διαγραφή: χρησιμοποιείται στο {blocked.join(', ')}.
        </p>
      )}
      <GeneralSection {...sectionProps('general')} />
      <ChannelsSection {...sectionProps('channels')} />
      {/* Task 11 inserts <TotalsSection …/> and <PreviewCard …/> here. */}
      <TareSection {...sectionProps('tare')} />

      <div className="publish-bar">
        <p>{published !== null ? `Δημοσιεύτηκε η έκδοση ${published}.` : errors.length > 0 ? 'Διόρθωσε τα λάθη για να δημοσιεύσεις.' : dirty ? 'Οι αλλαγές ισχύουν στα ταμεία μετά τη δημοσίευση.' : 'Καμία αλλαγή.'}</p>
        <button type="button" className="btn btn-primary" disabled={!dirty || errors.length > 0 || publish.busy} onClick={() => void doPublish(draft.baseVersion)}>
          Δημοσίευση
        </button>
      </div>
      <ErrorText state={publish.state} />

      {conflict !== undefined && (
        <Sheet title="Οι ρυθμίσεις άλλαξαν" subtitle={ownerErrorMessage({ code: 'version_conflict', currentVersion: conflict })} onClose={() => setConflict(undefined)}>
          <p className="notice-soft">Κάποιος δημοσίευσε ρυθμίσεις από άλλη καρτέλα ή συσκευή όσο έκανες αλλαγές.</p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={() => void loadNewer()}>
              Φόρτωση νέας
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void overwrite()}>
              Δημοσίευση πάνω της
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
```

Wire it into `ShopLayout.tsx` — replace `TabBody`:

```tsx
import { SettingsScreen } from './settings/SettingsScreen';

/** Tasks 12 and 13 replace the staff/devices placeholders. */
function TabBody({ tab, api, shopId, store, now }: { tab: ShopTab; api: OwnerApi; shopId: string; store: KeyValueStore; now: () => Date }) {
  if (tab === 'settings') return <SettingsScreen api={api} shopId={shopId} store={store} now={now} />;
  return <p className="notice-soft">{TABS.find((t) => t.tab === tab)?.label}</p>;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/features/owner && npm run typecheck`
Expected: PASS. If the "same-version draft" test sees `1000` instead of `7.77`, the `GeneralSection` was not remounted after the draft was restored — make sure `formKey` changes whenever `draft` is replaced from outside typing (restore, load newer, continue offer).

- [ ] **Step 6: Commit**

```bash
git add src/features/owner tests/features/owner/settings.test.tsx
git commit -m "feat(owner): settings editor with local draft, publish and conflict handling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Formula builder and live preview

**Files:**
- Create: `src/features/owner/settings/TotalsSection.tsx`, `src/features/owner/settings/PreviewCard.tsx`
- Modify: `src/features/owner/settings/SettingsScreen.tsx` (render both after `ChannelsSection`)
- Test: `tests/features/owner/totals.test.tsx`

**Interfaces:**
- Consumes: `SectionProps`, `SectionErrors` (Task 10); `termOptions`, `termLabel`, `formulaText` (Task 4); `previewTotals`, `PreviewSample` (Task 6); `plus`, `minus` (core/config); `formatEuro` (core/money).
- Produces: `TotalsSection(props: SectionProps)`, `PreviewCard({ config }: { config: ShopConfig })`.

- [ ] **Step 1: Write the failing tests** `tests/features/owner/totals.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { applySettings } from '../../../src/features/owner/model/settingsDraft';
import { PreviewCard } from '../../../src/features/owner/settings/PreviewCard';
import { TotalsSection } from '../../../src/features/owner/settings/TotalsSection';

afterEach(cleanup);

function Harness({ initial }: { initial: ShopConfig }) {
  const [config, setConfig] = useState(initial);
  return (
    <>
      <TotalsSection config={config} dispatch={(a) => setConfig(applySettings(config, a).config)} errors={[]} />
      <PreviewCard config={config} />
      <output data-testid="json">{JSON.stringify(config.totals)}</output>
    </>
  );
}
const jj = (): ShopConfig => structuredClone(joinJuicePreset) as ShopConfig;
const totals = () => JSON.parse(screen.getByTestId('json').textContent ?? '[]') as ShopConfig['totals'];

describe('TotalsSection', () => {
  it('shows each total as a readable formula', () => {
    render(<Harness initial={jj()} />);
    const cash = screen.getByRole('group', { name: 'ΜΕΤΡΗΤΑ' });
    expect(cash.textContent).toContain('ΤΑΜΕΙΟ − Αρχικό ταμείο − Έξοδα');
  });

  it('builds a new total from + and − terms', () => {
    render(<Harness initial={jj()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Σύνολο' }));
    const group = screen.getByRole('group', { name: 'Νέο σύνολο' });
    fireEvent.change(within(group).getByLabelText('Όρος για Νέο σύνολο'), { target: { value: 'channel:wolt' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Πρόσθεση όρου' }));
    fireEvent.change(within(group).getByLabelText('Όρος για Νέο σύνολο'), { target: { value: 'channel:efood' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Αφαίρεση όρου' }));
    expect(group.textContent).toContain('WOLT − EFOOD');
    fireEvent.click(within(group).getByRole('button', { name: 'Αλλαγή πρόσημου EFOOD' }));
    expect(group.textContent).toContain('WOLT + EFOOD');
    fireEvent.click(within(group).getByRole('button', { name: 'Διαγραφή όρου WOLT' }));
    expect(totals().at(-1)?.terms).toEqual([{ sign: 1, ref: { kind: 'channel', id: 'efood' } }]);
  });

  it('renames, flags and removes totals', () => {
    render(<Harness initial={jj()} />);
    const lim = screen.getByRole('group', { name: 'ΕΣΟΔΑ LIM' });
    fireEvent.click(within(lim).getByLabelText('Στην κοινοποίηση'));
    expect(totals().find((t) => t.id === 'income_lim')?.showInShare).toBe(true);
    fireEvent.change(within(lim).getByLabelText('Όνομα συνόλου ΕΣΟΔΑ LIM'), { target: { value: 'ΕΣΟΔΑ' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'ΕΣΟΔΑ' })).getByRole('button', { name: 'Διαγραφή συνόλου ΕΣΟΔΑ' }));
    expect(totals().some((t) => t.id === 'income_lim')).toBe(false);
  });
});

describe('PreviewCard', () => {
  it('computes totals from sample amounts', () => {
    render(<Harness initial={jj()} />);
    const preview = screen.getByRole('region', { name: 'Δοκιμή με ποσά' });
    fireEvent.change(within(preview).getByLabelText('Δοκιμή: Μετρημένα'), { target: { value: '1500' } });
    fireEvent.change(within(preview).getByLabelText('Δοκιμή: myPos'), { target: { value: '310,25' } });
    expect(within(preview).getByLabelText('Αποτέλεσμα ΤΑΜΕΙΟ').textContent).toBe('1.810,25€');
    expect(within(preview).getByLabelText('Αποτέλεσμα ΜΕΤΡΗΤΑ').textContent).toBe('500,00€');
  });

  it('flags a sample it cannot use', () => {
    render(<Harness initial={jj()} />);
    const preview = screen.getByRole('region', { name: 'Δοκιμή με ποσά' });
    fireEvent.change(within(preview).getByLabelText('Δοκιμή: Μετρημένα'), { target: { value: '10,02' } });
    expect((within(preview).getByLabelText('Δοκιμή: Μετρημένα') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/totals.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/features/owner/settings/TotalsSection.tsx`:

```tsx
import { useState } from 'react';
import { minus, plus, type TotalDef } from '../../../core/config';
import { Card } from '../../../ui/Card';
import { formulaText, termLabel, termOptions } from '../model/terms';
import { SectionErrors, type SectionProps } from './GeneralSection';

function TotalEditor({ total, config, dispatch }: Omit<SectionProps, 'errors'> & { total: TotalDef }) {
  const options = termOptions(config, total.id);
  const [pick, setPick] = useState(options[0]?.key ?? '');
  const chosen = options.find((o) => o.key === pick) ?? options[0];

  return (
    <fieldset className="card" aria-label={total.label} style={{ border: 0 }}>
      <div className="row">
        <input className="field text" aria-label={`Όνομα συνόλου ${total.label}`} value={total.label} onChange={(e) => dispatch({ type: 'renameTotal', id: total.id, label: e.target.value })} />
        <button type="button" className="icon-btn" aria-label={`Πάνω ${total.label}`} onClick={() => dispatch({ type: 'moveTotal', id: total.id, delta: -1 })}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={`Κάτω ${total.label}`} onClick={() => dispatch({ type: 'moveTotal', id: total.id, delta: 1 })}>
          ↓
        </button>
        <button type="button" className="icon-btn" aria-label={`Διαγραφή συνόλου ${total.label}`} onClick={() => dispatch({ type: 'removeTotal', id: total.id })}>
          ×
        </button>
      </div>
      <p className="formula">= {formulaText(config, total)}</p>
      {total.terms.map((term, i) => {
        const label = termLabel(config, term.ref);
        return (
          <div className="term" key={`${i}-${label}`}>
            <button type="button" className="sign" aria-label={`Αλλαγή πρόσημου ${label}`} onClick={() => dispatch({ type: 'flipTerm', totalId: total.id, index: i })}>
              {term.sign === 1 ? '+' : '−'}
            </button>
            <span className="row-label">{label}</span>
            <button type="button" className="icon-btn" aria-label={`Διαγραφή όρου ${label}`} onClick={() => dispatch({ type: 'removeTerm', totalId: total.id, index: i })}>
              ×
            </button>
          </div>
        );
      })}
      <div className="term">
        <select className="select" aria-label={`Όρος για ${total.label}`} value={chosen?.key ?? ''} onChange={(e) => setPick(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="sign" aria-label="Πρόσθεση όρου" disabled={!chosen} onClick={() => chosen && dispatch({ type: 'addTerm', totalId: total.id, term: plus(chosen.ref) })}>
          +
        </button>
        <button type="button" className="sign" aria-label="Αφαίρεση όρου" disabled={!chosen} onClick={() => chosen && dispatch({ type: 'addTerm', totalId: total.id, term: minus(chosen.ref) })}>
          −
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={total.showInSummary} onChange={(e) => dispatch({ type: 'setTotalFlag', id: total.id, flag: 'showInSummary', value: e.target.checked })} />
        Στη σύνοψη
      </label>
      <label className="check">
        <input type="checkbox" checked={total.showInShare} onChange={(e) => dispatch({ type: 'setTotalFlag', id: total.id, flag: 'showInShare', value: e.target.checked })} />
        Στην κοινοποίηση
      </label>
    </fieldset>
  );
}

export function TotalsSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Σύνολα">
      <p className="notice-soft">Κάθε σύνολο είναι όροι που προστίθενται (+) ή αφαιρούνται (−).</p>
      {config.totals.map((t) => (
        <TotalEditor key={t.id} total={t} config={config} dispatch={dispatch} />
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addTotal', label: 'Νέο σύνολο' })}>
        + Σύνολο
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
```

`src/features/owner/settings/PreviewCard.tsx`:

```tsx
import { useState } from 'react';
import type { ShopConfig } from '../../../core/config';
import { formatEuro } from '../../../core/money';
import { Card } from '../../../ui/Card';
import { previewTotals, type PreviewSample } from '../model/preview';

/** Live check of the formulas with made-up amounts. All maths is previewTotals → evaluateTotals. */
export function PreviewCard({ config }: { config: ShopConfig }) {
  const [sample, setSample] = useState<PreviewSample>({ counted: '', expenses: '', channels: {} });
  const result = previewTotals(config, sample);
  const bad = new Set(!result.ok && result.reason === 'bad_sample' ? result.fields : []);

  const field = (key: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="row" key={key}>
      <span className="row-label">{label}</span>
      <input className="field" aria-label={`Δοκιμή: ${label}`} aria-invalid={bad.has(key) || undefined} inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <Card title="Δοκιμή με ποσά">
      {field('counted', 'Μετρημένα', sample.counted, (v) => setSample({ ...sample, counted: v }))}
      {config.channels.map((c) =>
        field(c.id, c.label, sample.channels[c.id] ?? '', (v) => setSample({ ...sample, channels: { ...sample.channels, [c.id]: v } })),
      )}
      {field('expenses', 'Έξοδα', sample.expenses, (v) => setSample({ ...sample, expenses: v }))}
      {result.ok ? (
        result.totals.map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <b aria-label={`Αποτέλεσμα ${t.label}`}>{formatEuro(t.cents)}</b>
          </div>
        ))
      ) : result.reason === 'invalid_config' ? (
        <p className="notice-soft">Διόρθωσε τα λάθη των ρυθμίσεων για να δεις αποτελέσματα.</p>
      ) : (
        <p className="row-hint err">Τα μετρημένα πρέπει να βγαίνουν με τα κέρματα του ταμείου· τα ποσά ≥ 0.</p>
      )}
    </Card>
  );
}
```

In `SettingsScreen.tsx`, replace the comment `{/* Task 11 inserts … */}` with:

```tsx
      <TotalsSection {...sectionProps('totals')} />
      <PreviewCard config={draft.config} />
```

and add the imports:

```tsx
import { PreviewCard } from './PreviewCard';
import { TotalsSection } from './TotalsSection';
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/features/owner && npm run typecheck`
Expected: PASS (settings tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/settings tests/features/owner/totals.test.tsx
git commit -m "feat(owner): +/− formula builder with live preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Staff screen

**Files:**
- Create: `src/features/owner/OwnerStaffScreen.tsx`
- Modify: `src/features/owner/ShopLayout.tsx` (`TabBody`: staff → `OwnerStaffScreen`)
- Test: `tests/features/owner/staff.test.tsx`

**Interfaces:**
- Consumes: `OwnerApi`, `StaffRow` (Task 7); `checkName`, `STAFF_NAME_MAX`, `isPin` (Task 3); `isLocked`, `formatClock` (Task 3); `nameProblemMessage`, `ownerErrorMessage` (Task 5); `useAction`, `ErrorText` (Task 8).
- Produces: `OwnerStaffScreen({ api, shopId, now }: { api: OwnerApi; shopId: string; now: () => Date })`.

- [ ] **Step 1: Write the failing tests** `tests/features/owner/staff.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffRow } from '../../../src/data/remote/ownerApi';
import { OwnerStaffScreen } from '../../../src/features/owner/OwnerStaffScreen';
import { fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date('2026-09-29T10:00:00Z');
const maria: StaffRow = { id: 'm', name: 'ΜΑΡΙΑ', active: true, lockedUntil: null };
const type = (label: string, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });

describe('OwnerStaffScreen', () => {
  it('adds a staff member with a 4-digit PIN and reloads', async () => {
    const listStaff = vi.fn().mockReturnValueOnce(ok([])).mockReturnValue(ok([maria]));
    const api = fakeApi({ listStaff });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    await screen.findByText(/Δεν υπάρχει ακόμα προσωπικό/);
    type('Όνομα νέου ατόμου', ' ΜΑΡΙΑ ');
    type('PIN νέου ατόμου', '12a4');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(screen.getByRole('alert').textContent).toContain('4 ψηφία');
    type('PIN νέου ατόμου', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(await screen.findByRole('group', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
    expect(api.createStaff).toHaveBeenCalledWith(SHOP, 'ΜΑΡΙΑ', '1234');
    expect((screen.getByLabelText('PIN νέου ατόμου') as HTMLInputElement).value).toBe('');
  });

  it('shows a lock and unlocks without changing the PIN', async () => {
    const locked = { ...maria, lockedUntil: '2026-09-29T10:10:00Z' };
    const listStaff = vi.fn().mockReturnValueOnce(ok([locked])).mockReturnValue(ok([maria]));
    const api = fakeApi({ listStaff });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    const row = await screen.findByRole('group', { name: 'ΜΑΡΙΑ' });
    expect(row.textContent).toContain('Κλειδωμένος έως');
    fireEvent.click(within(row).getByRole('button', { name: 'Ξεκλείδωμα' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'ΜΑΡΙΑ' }).textContent).not.toContain('Κλειδωμένος'));
    expect(api.unlockStaff).toHaveBeenCalledWith('m');
  });

  it('changes a PIN, renames, and deactivates', async () => {
    const api = fakeApi({ listStaff: vi.fn(() => ok([maria])) });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    const row = await screen.findByRole('group', { name: 'ΜΑΡΙΑ' });
    fireEvent.click(within(row).getByRole('button', { name: 'Αλλαγή PIN' }));
    type('Νέο PIN ΜΑΡΙΑ', '9876', row);
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση PIN' }));
    await waitFor(() => expect(api.setStaffPin).toHaveBeenCalledWith('m', '9876'));
    fireEvent.click(within(row).getByRole('button', { name: 'Μετονομασία' }));
    type('Νέο όνομα ΜΑΡΙΑ', 'ΜΑΡΙΑ Κ.', row);
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    await waitFor(() => expect(api.updateStaff).toHaveBeenCalledWith('m', { name: 'ΜΑΡΙΑ Κ.' }));
    fireEvent.click(within(row).getByLabelText('Ενεργός'));
    await waitFor(() => expect(api.updateStaff).toHaveBeenCalledWith('m', { active: false }));
  });

  it('network failure: busy clears, message shows, the button works again', async () => {
    const createStaff = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValue(ok('x'));
    const api = fakeApi({ createStaff });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    await screen.findByText(/Δεν υπάρχει ακόμα προσωπικό/);
    type('Όνομα νέου ατόμου', 'ΝΙΚΟΣ');
    type('PIN νέου ατόμου', '5555');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    const add = screen.getByRole('button', { name: 'Προσθήκη' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(createStaff).toHaveBeenCalledTimes(2));
  });

  it('shows the duplicate-name error from the server', async () => {
    const api = fakeApi({ createStaff: vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'staff_name_taken' as const } })) });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    await screen.findByText(/Δεν υπάρχει ακόμα προσωπικό/);
    type('Όνομα νέου ατόμου', 'ΜΑΡΙΑ');
    type('PIN νέου ατόμου', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Υπάρχει ήδη');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/staff.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/features/owner/OwnerStaffScreen.tsx`

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { OwnerApi, StaffRow } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { checkName, isPin, STAFF_NAME_MAX } from './model/limits';
import { nameProblemMessage, ownerErrorMessage } from './model/messages';
import { formatClock, isLocked } from './model/time';
import { ErrorText } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  now: () => Date;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; staff: StaffRow[] };

const PIN_HINT = 'Το PIN πρέπει να είναι 4 ψηφία.';

function StaffEditor({ api, person, now, onChanged }: { api: OwnerApi; person: StaffRow; now: () => Date; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'pin'>('view');
  const [text, setText] = useState('');
  const action = useAction();
  const locked = isLocked(person.lockedUntil, now().getTime());

  const after = async (p: Promise<{ ok: boolean }>) => {
    if ((await p).ok) {
      setMode('view');
      onChanged();
    }
  };
  const saveName = (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(text, STAFF_NAME_MAX);
    if (!n.ok) return action.fail(nameProblemMessage(n.problem, STAFF_NAME_MAX));
    void after(action.run(() => api.updateStaff(person.id, { name: n.value })));
  };
  const savePin = (e: FormEvent) => {
    e.preventDefault();
    if (!isPin(text)) return action.fail(PIN_HINT);
    void after(action.run(() => api.setStaffPin(person.id, text)));
  };

  return (
    <fieldset className="card" aria-label={person.name} style={{ border: 0 }}>
      <div className="row">
        <span className="row-label">
          <b>{person.name}</b>
          {locked && person.lockedUntil !== null && <span className="row-hint err"> · Κλειδωμένος έως {formatClock(person.lockedUntil)}</span>}
        </span>
        <label className="check">
          <input type="checkbox" checked={person.active} disabled={action.busy} onChange={(e) => void after(action.run(() => api.updateStaff(person.id, { active: e.target.checked })))} />
          Ενεργός
        </label>
      </div>
      {mode === 'view' && (
        <div className="choices">
          {locked && (
            <button type="button" className="choice" disabled={action.busy} onClick={() => void after(action.run(() => api.unlockStaff(person.id)))}>
              Ξεκλείδωμα
            </button>
          )}
          <button type="button" className="choice" onClick={() => { setText(''); setMode('pin'); }}>
            Αλλαγή PIN
          </button>
          <button type="button" className="choice" onClick={() => { setText(person.name); setMode('rename'); }}>
            Μετονομασία
          </button>
        </div>
      )}
      {mode === 'rename' && (
        <form className="row" onSubmit={saveName} noValidate>
          <input className="field text" aria-label={`Νέο όνομα ${person.name}`} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={action.busy}>
            OK
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('view')}>
            Άκυρο
          </button>
        </form>
      )}
      {mode === 'pin' && (
        <form className="row" onSubmit={savePin} noValidate>
          <input className="field" aria-label={`Νέο PIN ${person.name}`} type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση PIN" disabled={action.busy}>
            OK
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('view')}>
            Άκυρο
          </button>
        </form>
      )}
      <ErrorText state={action.state} />
    </fieldset>
  );
}

export function OwnerStaffScreen({ api, shopId, now }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const add = useAction();

  const reload = useCallback(async () => {
    const r = await api.listStaff(shopId);
    setLoad(r.ok ? { status: 'ready', staff: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
  }, [api, shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(name, STAFF_NAME_MAX);
    if (!n.ok) return add.fail(nameProblemMessage(n.problem, STAFF_NAME_MAX));
    if (!isPin(pin)) return add.fail(PIN_HINT);
    const r = await add.run(() => api.createStaff(shopId, n.value, pin));
    if (r.ok) {
      setName('');
      setPin('');
      await reload();
    }
  };

  return (
    <>
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <Card>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          <button type="button" className="btn btn-text" onClick={() => void reload()}>
            Ξανά
          </button>
        </Card>
      )}
      {load.status === 'ready' && load.staff.length === 0 && <p className="notice-soft">Δεν υπάρχει ακόμα προσωπικό.</p>}
      {load.status === 'ready' && load.staff.map((p) => <StaffEditor key={p.id} api={api} person={p} now={now} onChanged={() => void reload()} />)}
      <Card title="Νέο άτομο">
        <form className="form" onSubmit={submit} noValidate>
          <input className="text-field" aria-label="Όνομα νέου ατόμου" placeholder="Όνομα" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="text-field" aria-label="PIN νέου ατόμου" placeholder="PIN (4 ψηφία)" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
          <p className="notice-soft">Πες το PIN στο άτομο — δεν εμφανίζεται ξανά.</p>
          <button type="submit" className="btn btn-primary" disabled={add.busy}>
            Προσθήκη
          </button>
          <ErrorText state={add.state} />
        </form>
      </Card>
    </>
  );
}
```

Note: the `maxLength={4}` input still receives `'12a4'` in the test via `fireEvent.change` (jsdom doesn't enforce maxLength on programmatic changes) — validation by `isPin` is what refuses it.

In `ShopLayout.tsx`'s `TabBody` add before the fallback:

```tsx
  if (tab === 'staff') return <OwnerStaffScreen api={api} shopId={shopId} now={now} />;
```

with `import { OwnerStaffScreen } from './OwnerStaffScreen';`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/features/owner && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/owner tests/features/owner/staff.test.tsx
git commit -m "feat(owner): staff screen — add, PIN, unlock, rename, (de)activate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Devices and pairing codes

**Files:**
- Create: `src/features/owner/DevicesScreen.tsx`
- Modify: `src/features/owner/ShopLayout.tsx` (`TabBody`: devices → `DevicesScreen`; remove the placeholder fallback)
- Test: `tests/features/owner/devices.test.tsx`

**Interfaces:**
- Consumes: `OwnerApi`, `DeviceRow` (Task 7); `formatPairingCode`, `secondsLeft`, `formatCountdown`, `PAIRING_TTL_SECONDS` (Task 3); `formatDate` (Task 3); `checkLabel`, `DEVICE_LABEL_MAX` (Task 3); `ownerErrorMessage` (Task 5); `Sheet` (ui); `useAction`, `ErrorText` (Task 8).
- Produces: `DevicesScreen({ api, shopId, now }: { api: OwnerApi; shopId: string; now: () => Date })`.

- [ ] **Step 1: Write the failing tests** `tests/features/owner/devices.test.tsx`

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRow } from '../../../src/data/remote/ownerApi';
import { DevicesScreen } from '../../../src/features/owner/DevicesScreen';
import { fakeApi, ok } from './fakeApi';

const SHOP = '11111111-1111-4111-8111-111111111111';
let nowMs = Date.parse('2026-09-29T10:00:00Z');
const now = () => new Date(nowMs);
const phone: DeviceRow = { userId: 'u1', label: 'Ταμείο 1', createdAt: '2026-09-20T08:00:00Z', revokedAt: null };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  nowMs = Date.parse('2026-09-29T10:00:00Z');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DevicesScreen', () => {
  it('shows a pairing code with a countdown that expires', async () => {
    const api = fakeApi();
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση νέας συσκευής' }));
    expect(await screen.findByText('ABCD-EFGH')).toBeTruthy();
    expect(screen.getByText(/10:00/)).toBeTruthy();
    act(() => {
      nowMs += 61_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(/8:59/)).toBeTruthy();
    act(() => {
      nowMs += 600_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(/Ο κωδικός έληξε/)).toBeTruthy();
    expect(screen.queryByText('ABCD-EFGH')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Νέος κωδικός' }));
    await waitFor(() => expect(api.createPairingCode).toHaveBeenCalledTimes(2));
  });

  it('lists devices and revokes after confirmation', async () => {
    const listDevices = vi.fn().mockReturnValueOnce(ok([phone])).mockReturnValue(ok([{ ...phone, revokedAt: '2026-09-29T10:00:00Z' }]));
    const api = fakeApi({ listDevices });
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    expect(row.textContent).toContain('20/09/2026');
    expect(row.textContent).toContain('Ενεργή');
    fireEvent.click(within(row).getByRole('button', { name: 'Ανάκληση' }));
    const dialog = screen.getByRole('dialog', { name: 'Ανάκληση συσκευής' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ανάκληση' }));
    await waitFor(() => expect(api.updateDevice).toHaveBeenCalledWith('u1', { revoke: true }));
    expect((await screen.findByRole('group', { name: 'Ταμείο 1' })).textContent).toContain('Ανακλήθηκε');
  });

  it('renames a device within 60 characters', async () => {
    const api = fakeApi({ listDevices: vi.fn(() => ok([phone])) });
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Μετονομασία' }));
    fireEvent.change(within(row).getByLabelText('Νέο όνομα συσκευής'), { target: { value: 'x'.repeat(61) } });
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    expect(within(row).getByRole('alert').textContent).toContain('60');
    fireEvent.change(within(row).getByLabelText('Νέο όνομα συσκευής'), { target: { value: 'Ταμείο μπαρ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    await waitFor(() => expect(api.updateDevice).toHaveBeenCalledWith('u1', { label: 'Ταμείο μπαρ' }));
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/devices.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/features/owner/DevicesScreen.tsx`

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DeviceRow, OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { Sheet } from '../../ui/Sheet';
import { checkLabel, DEVICE_LABEL_MAX } from './model/limits';
import { ownerErrorMessage } from './model/messages';
import { formatCountdown, formatPairingCode, PAIRING_TTL_SECONDS, secondsLeft } from './model/pairing';
import { formatDate } from './model/time';
import { ErrorText } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  now: () => Date;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; devices: DeviceRow[] };

function PairingCard({ api, shopId, now }: Props) {
  const [code, setCode] = useState<{ code: string; expiresAtMs: number } | null>(null);
  const [, setTick] = useState(0);
  const action = useAction();

  useEffect(() => {
    if (code === null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [code]);

  const create = async () => {
    const r = await action.run(() => api.createPairingCode(shopId));
    if (r.ok) setCode({ code: r.data, expiresAtMs: now().getTime() + PAIRING_TTL_SECONDS * 1000 });
  };

  const left = code ? secondsLeft(code.expiresAtMs, now().getTime()) : 0;
  return (
    <Card title="Σύνδεση συσκευής ταμείου">
      {code === null && (
        <button type="button" className="btn btn-primary wide" disabled={action.busy} onClick={() => void create()}>
          Σύνδεση νέας συσκευής
        </button>
      )}
      {code !== null && left > 0 && (
        <>
          <p className="notice-soft">Άνοιξε την εφαρμογή στο κινητό του ταμείου και γράψε αυτόν τον κωδικό:</p>
          <p className="pair-code" aria-live="polite">
            {formatPairingCode(code.code)}
          </p>
          <p className="notice-soft">Λήγει σε {formatCountdown(left)} · ισχύει μία φορά.</p>
          <button type="button" className="btn btn-text" onClick={() => setCode(null)}>
            Κλείσιμο
          </button>
        </>
      )}
      {code !== null && left === 0 && (
        <>
          <p className="status-warn">Ο κωδικός έληξε.</p>
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void create()}>
            Νέος κωδικός
          </button>
        </>
      )}
      <ErrorText state={action.state} />
    </Card>
  );
}

function DeviceEditor({ api, device, onChanged }: { api: OwnerApi; device: DeviceRow; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const title = device.label || 'Χωρίς όνομα';

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const l = checkLabel(text, DEVICE_LABEL_MAX);
    if (!l.ok) return action.fail(`Έως ${DEVICE_LABEL_MAX} χαρακτήρες.`);
    const r = await action.run(() => api.updateDevice(device.userId, { label: l.value }));
    if (r.ok) {
      setRenaming(false);
      onChanged();
    }
  };
  const revoke = async () => {
    setConfirming(false);
    const r = await action.run(() => api.updateDevice(device.userId, { revoke: true }));
    if (r.ok) onChanged();
  };

  return (
    <fieldset className="card" aria-label={title} style={{ border: 0 }}>
      <div className="row">
        <span className="row-label">
          <b>{title}</b>
          <span className="row-hint">
            Συνδέθηκε {formatDate(device.createdAt)} · {device.revokedAt ? 'Ανακλήθηκε' : 'Ενεργή'}
          </span>
        </span>
      </div>
      {renaming ? (
        <form className="row" onSubmit={saveName} noValidate>
          <input className="field text" aria-label="Νέο όνομα συσκευής" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={action.busy}>
            OK
          </button>
        </form>
      ) : (
        <div className="choices">
          <button type="button" className="choice" onClick={() => { setText(device.label); setRenaming(true); }}>
            Μετονομασία
          </button>
          {!device.revokedAt && (
            <button type="button" className="choice" onClick={() => setConfirming(true)}>
              Ανάκληση
            </button>
          )}
        </div>
      )}
      <ErrorText state={action.state} />
      {confirming && (
        <Sheet title="Ανάκληση συσκευής" onClose={() => setConfirming(false)}>
          <p>Η συσκευή «{title}» δεν θα μπορεί να κάνει κλεισίματα. Για να ξανασυνδεθεί θα χρειαστεί νέος κωδικός.</p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={() => setConfirming(false)}>
              Άκυρο
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void revoke()}>
              Ανάκληση
            </button>
          </div>
        </Sheet>
      )}
    </fieldset>
  );
}

export function DevicesScreen({ api, shopId, now }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const reload = useCallback(async () => {
    const r = await api.listDevices(shopId);
    setLoad(r.ok ? { status: 'ready', devices: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
  }, [api, shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <PairingCard api={api} shopId={shopId} now={now} />
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <Card>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          <button type="button" className="btn btn-text" onClick={() => void reload()}>
            Ξανά
          </button>
        </Card>
      )}
      {load.status === 'ready' && load.devices.length === 0 && <p className="notice-soft">Καμία συνδεδεμένη συσκευή.</p>}
      {load.status === 'ready' && load.devices.map((d) => <DeviceEditor key={d.userId} api={api} device={d} onChanged={() => void reload()} />)}
    </>
  );
}
```

In `ShopLayout.tsx`, `TabBody` becomes:

```tsx
function TabBody({ tab, api, shopId, store, now }: { tab: ShopTab; api: OwnerApi; shopId: string; store: KeyValueStore; now: () => Date }) {
  if (tab === 'settings') return <SettingsScreen api={api} shopId={shopId} store={store} now={now} />;
  if (tab === 'staff') return <OwnerStaffScreen api={api} shopId={shopId} now={now} />;
  return <DevicesScreen api={api} shopId={shopId} now={now} />;
}
```

with `import { DevicesScreen } from './DevicesScreen';`. Remove the now-unused `TABS.find` fallback.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/features/owner && npm run typecheck`
Expected: PASS. If the countdown test flakes, check that `DevicesScreen` reads time only through the `now` prop (never `Date.now()`).

- [ ] **Step 5: Commit**

```bash
git add src/features/owner tests/features/owner/devices.test.tsx
git commit -m "feat(owner): pairing codes with countdown, device list, rename, revoke

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Wire the owner area into the app; docs

**Files:**
- Modify: `src/app/App.tsx`, `src/app/router.ts` (remove `useRoute`), `src/features/register/RegisterScreen.tsx`, `src/features/register/HeaderMenu.tsx`
- Modify: `tests/app/app.test.tsx`, `tests/features/people.test.tsx`
- Modify: `CLAUDE.md`, `PROJECT_STATUS.md`, `README.md`

**Interfaces:**
- Consumes: `useHash`, `parseAppRoute`, `ownerHash`, `routeHash`, `OwnerRoute` (Task 2); `parseAuthRedirect` (Task 2); `OwnerAppProps` (Task 8); `OwnerEntry` default export (Task 8).
- Produces: `App` props gain `ownerArea?: ComponentType<Omit<OwnerAppProps, 'api'>>` (tests pass a stub; default is the lazy `OwnerEntry`). `HeaderMenu` gains `onOwner: () => void`; `RegisterScreen` gains `onOwner: () => void`.

- [ ] **Step 1: Write the failing tests** — append to `tests/app/app.test.tsx`

```tsx
import type { ComponentType } from 'react';
import type { OwnerAppProps } from '../../src/features/owner/OwnerApp';

const OwnerStub: ComponentType<Omit<OwnerAppProps, 'api'>> = ({ route, redirect }) => (
  <p>
    owner:{route.name}:{redirect?.kind ?? 'none'}
  </p>
);

describe('owner area', () => {
  it('opens from the menu and keeps the register mounted', async () => {
    render(<App appStore={{ store: memoryStore(), persistent: true }} now={NOW} newId={newId} share={share} ownerArea={OwnerStub} />);
    type('100€', '500');
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Διαχείριση καταστήματος' }));
    expect(await screen.findByText('owner:shops:none')).toBeTruthy();
    expect(window.location.hash).toBe('#/owner');
    act(() => {
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('500');
  });

  it('routes an email-link return to the owner area with the parsed redirect', async () => {
    window.history.replaceState(null, '', '/?auth=recovery&code=abc');
    render(<App appStore={{ store: memoryStore(), persistent: true }} now={NOW} newId={newId} share={share} ownerArea={OwnerStub} />);
    expect(await screen.findByText('owner:shops:recovery')).toBeTruthy();
    window.history.replaceState(null, '', '/');
  });
});
```

(`act` is already imported at the top of `app.test.tsx`.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/app/app.test.tsx`
Expected: FAIL — `ownerArea` prop / menu item don't exist.

- [ ] **Step 3: Implement**

`src/features/register/HeaderMenu.tsx` — add `onOwner: () => void` to `Props`, destructure it, and add after the Προσωπικό item:

```tsx
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOwner();
            }}
          >
            Διαχείριση καταστήματος
          </button>
```

`src/features/register/RegisterScreen.tsx` — add `onOwner: () => void;` to its props interface, destructure it, and pass it on: `<HeaderMenu … onOwner={onOwner} />`.

`tests/features/people.test.tsx` renders `HeaderMenu` directly in several tests — add `onOwner={vi.fn()}` to every `<HeaderMenu …/>` there so it still typechecks.

`src/app/App.tsx` (full replacement):

```tsx
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { loadTheme, saveTheme } from '../data/local/prefs';
import { loadStaff, normalizeStaff, saveStaff } from '../data/local/staff';
import { pickStore, type AppStore } from '../data/local/storage';
import type { OwnerAppProps } from '../features/owner/OwnerApp';
import { RegisterScreen } from '../features/register/RegisterScreen';
import { shareCard, type ShareFn } from '../features/register/share';
import { StaffScreen } from '../features/staff/StaffScreen';
import { TareScreen } from '../features/tare/TareScreen';
import { parseAuthRedirect } from './authRedirect';
import { ErrorBoundary } from './ErrorBoundary';
import { randomId } from './ids';
import { ownerHash, parseAppRoute, routeHash, useHash, type OwnerRoute, type Route } from './router';
import { LOCAL_SHOP, type LocalShop } from './shop';
import { applyTheme, nextTheme } from './theme';

type OwnerArea = ComponentType<Omit<OwnerAppProps, 'api'>>;

/** Loaded on first visit to #/owner, so supabase-js stays out of the register bundle. */
const LazyOwnerEntry = lazy(() => import('../features/owner/OwnerEntry'));

interface AppProps {
  appStore?: AppStore;
  shop?: LocalShop;
  now?: () => Date;
  newId?: () => string;
  share?: ShareFn;
  /** Tests pass a stub; the real area is lazy-loaded. */
  ownerArea?: OwnerArea;
}

const systemNow = (): Date => new Date();

export function App({ appStore, shop = LOCAL_SHOP, now = systemNow, newId = randomId, share = shareCard, ownerArea: OwnerAreaComponent = LazyOwnerEntry }: AppProps) {
  const [{ store, persistent }] = useState(() => appStore ?? pickStore());
  const [hash, setHash] = useHash();
  const [redirect] = useState(() => parseAuthRedirect(window.location.search));
  const [staff, setStaff] = useState(() => loadStaff(store, shop.id));
  const [themePref, setThemePref] = useState(() => loadTheme(store));
  const appRoute = parseAppRoute(hash);

  useEffect(() => applyTheme(themePref), [themePref]);

  // An email link (confirm / reset) returns to `/?auth=…`; send it to the owner area once.
  useEffect(() => {
    if (redirect !== null && parseAppRoute(window.location.hash).area !== 'owner') setHash('#/owner', { replace: true });
  }, [redirect, setHash]);

  const cycleTheme = () => {
    const next = nextTheme(themePref);
    saveTheme(store, next);
    setThemePref(next);
  };
  const changeStaff = (names: string[]) => setStaff(saveStaff(store, shop.id, names) ?? normalizeStaff(names));
  const navigate = (route: Route) => setHash(routeHash(route));
  const navigateOwner = (route: OwnerRoute, opts?: { replace?: boolean }) => setHash(ownerHash(route), opts);
  const registerRoute = appRoute.area === 'register' ? appRoute.route : null;

  return (
    <ErrorBoundary>
      {!persistent && (
        <p className="notice" role="alert">
          Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.
        </p>
      )}
      {/* The register stays mounted (hidden) so switching screens never loses typing. */}
      <div hidden={registerRoute !== 'register'}>
        <RegisterScreen
          shop={shop}
          store={store}
          now={now}
          newId={newId}
          share={share}
          staff={staff}
          themePref={themePref}
          active={registerRoute === 'register'}
          onTheme={cycleTheme}
          onNavigate={navigate}
          onOwner={() => setHash('#/owner')}
        />
      </div>
      {registerRoute === 'staff' && <StaffScreen staff={staff} onChange={changeStaff} onBack={() => navigate('register')} />}
      {registerRoute === 'tare' && <TareScreen items={shop.config.tareItems} onBack={() => navigate('register')} />}
      {appRoute.area === 'owner' && (
        <Suspense fallback={<p className="notice-soft">Φόρτωση…</p>}>
          <OwnerAreaComponent
            route={appRoute.route}
            navigate={navigateOwner}
            store={store}
            now={now}
            redirect={redirect}
            onRedirectHandled={() => window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)}
            redirectBase={`${window.location.origin}${window.location.pathname}`}
            onExit={() => navigate('register')}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}
```

`src/app/router.ts` — delete `useRoute` (App now uses `useHash`); keep `parseRoute`/`routeHash`. Run `grep -rn useRoute src tests` to confirm nothing else uses it.

- [ ] **Step 4: Run the whole suite, typecheck, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all PASS; the build output shows a separate chunk for `OwnerEntry` (supabase-js lives there, not in the main chunk). Check with `ls dist/assets` — two JS chunks at least.

- [ ] **Step 5: Manual check against the dev project**

1. Ensure `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for `fstfuhogvsdaiwpfdmep` (`get_project_url`, `get_publishable_keys` via the connector if missing — publishable key only, never service-role).
2. Supabase dashboard (owner): Authentication → URL Configuration → Site URL = the Vercel URL; Redirect URLs add `http://localhost:5173/**` and `https://<vercel-domain>/**`. Authentication → Sign In / Providers → Email: "Confirm email" on.
3. `npm run dev` → menu → Διαχείριση καταστήματος → Νέος λογαριασμός → confirm the email in the same browser → create shop «Join Juice» with float 1000 and channels ΚΕΡΜΑΤΑ (Μετρητά εκτός ταμείου), WOLT, EFOOD (Delivery), myPos, Eurobank (Κάρτα) → Ρυθμίσεις: add ΜΕΤΡΗΤΑ LIM (ΜΕΤΡΗΤΑ + Έξοδα) and ΕΣΟΔΑ LIM (ΜΕΤΡΗΤΑ + Έξοδα + Όλες οι κάρτες) → preview matches V2 numbers → Δημοσίευση → add staff with PINs → Συσκευές: generate a code.
4. Open a second tab, publish from both → the second shows the conflict dialog.
5. Record in PROJECT_STATUS what was and wasn't done.

- [ ] **Step 6: Update the docs**

`CLAUDE.md` — Architecture: add
- `src/data/remote/` — the only code importing supabase-js. `owner.ts` (`createOwnerApi`) is the one path for owner reads/writes; `errors.ts` maps every failure into the closed `OwnerError` union; `client.ts` builds the PKCE client.
- `src/features/owner/` — owner area (lazy-loaded from `#/owner`): `model/` is pure (settings reducer, terms, preview, limits, pairing, messages); screens get an injected `OwnerApi`.

Invariants: add
- Owner screens never call supabase directly — only through `OwnerApi`; UI tests use `tests/features/owner/fakeApi.ts` and never load supabase-js.
- Auth uses PKCE with `detectSessionInUrl: false`; email links return as `?auth=signup|recovery&code=…` and `OwnerApp` exchanges the code exactly once. Redirect URLs must be allow-listed in the Supabase dashboard.
- Shared-browser rule: signing in as owner in a browser holding an anonymous (paired phone) session unpairs it; the login/signup screens require explicit confirmation.
- A new server error string needs a case in `mapError` and a Greek message in `ownerErrorMessage`, or it surfaces as «Κάτι πήγε στραβά».
- `publish_config` conflicts are never retried automatically; the owner chooses «Φόρτωση νέας» or «Δημοσίευση πάνω της».
- The settings preview computes only through `previewTotals` → `evaluateTotals`.

`PROJECT_STATUS.md`:
- Stages: replace the Plan 4 line with `- [x] Plan 4a — owner app (auth, shop, settings + formula builder, staff/PIN, pairing codes, devices)` and `- [ ] Plan 4b — phone side (pair, server config + staff, PIN sign-in, remove LOCAL_SHOP)`.
- Database findings: L23 → `fixed — owner app checks 80/40/60 before calling (limits.ts)`; L26 → `fixed — create_pairing_code deletes the shop's expired/used codes (migration 20260929000006)`.
- Open decisions for Plan 4: shop rename → done (grant + policy); unlock → done (`unlock_staff`); `device_status()` → Plan 4b; device label FK → Plan 5.
- Tests: add owner model (settings reducer, terms, preview, limits, pairing, messages, mapError, owner API parameter names, owner drafts, auth storage) and owner UI (auth + link errors, shops, new shop, settings publish/conflict/draft, formula builder + preview, staff, devices + countdown); database 050.
- Not verified: real email delivery + confirm/reset links incl. same-browser PKCE rule (unless done in Step 5 — then say so and with which browser); owner UI on a real phone; anonymous-session warning against a real paired phone (4b); Supabase free-tier auth email rate limits.

`README.md` — add a "Supabase dashboard setup" section: Site URL, the two redirect URL patterns, Confirm email on, and that the `.env` values must also be registered in Vercel.

- [ ] **Step 7: Commit**

```bash
git add src tests CLAUDE.md PROJECT_STATUS.md README.md
git commit -m "feat(app): lazy owner area under #/owner, menu entry, email-link return; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
