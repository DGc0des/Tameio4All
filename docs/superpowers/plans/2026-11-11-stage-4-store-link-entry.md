# Store Link Entry (Stage 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone enters a store with a permanent store link/QR/code plus the cashier's name and PIN, returns by itself after losing its session, and the owner can show, print, replace the link and really remove devices.

**Architecture:** A phone stays "an anonymous Supabase user with a `devices` row"; only how it gets that row changes. A new `shop_join_keys` table holds one permanent key per shop; `join_shop(key)` replaces the single-use pairing code. The phone stores the key locally and re-joins once from its one load path. Live closing, submit, history and staff sessions are not touched.

**Tech Stack:** TypeScript (strict), React 19, Vite, Vitest + Testing Library, Supabase (Postgres functions, RLS, anonymous auth), `qrcode-generator` (new, owner area only).

**Spec:** `docs/superpowers/specs/2026-11-11-store-link-entry-design.md` — read it first. Also read the repo `CLAUDE.md` (architecture + invariants).

## Preconditions (before Task 1)

- The working tree currently holds uncommitted stage-3 follow-up work, including the unapplied migration `supabase/migrations/20261111000003_today_save_and_submit_revision.sql`. That work must be committed (and its migration applied to dev) by the project owner **before** this plan starts. Do not commit or revert those files as part of this plan.
- `npm test` and `npm run typecheck` pass on the starting commit.

## Global Constraints

- Code and comments in English; every user-facing string in Greek, copied **verbatim** from this plan.
- `npm test` and `npm run typecheck` must pass before every commit.
- Only `src/data/remote/` imports supabase-js; only `src/data/local/` touches localStorage; `src/core/` stays pure.
- Owner screens talk to the server only through `OwnerApi`; phone screens only through `DeviceApi`. UI tests use `tests/features/owner/fakeApi.ts` / `tests/features/phone/fakeDeviceApi.ts`.
- Every new `public` function: `security definer`, `set search_path = ''`, `revoke all … from public, anon`, `grant execute … to authenticated`. Every new table: RLS on, all privileges revoked from `public, anon, authenticated`.
- Identity only from `auth.uid()` / `auth.jwt()`; owner functions answer "not yours" and "doesn't exist" both as `not_owner` (errcode `42501`).
- Store key format: exactly 16 characters of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; regex `^[A-HJ-NP-Z2-9]{16}$`; shown as `XXXX-XXXX-XXXX-XXXX`; link `<origin + pathname>#/join/<16 chars>`.
- Unused-device prune window: 30 days on `coalesce(last_seen_at, created_at)`.
- The pairing code is removed, not kept as a second option. No in-app QR scanner. No device-name question at entry.
- A new server error string needs a case in `mapDeviceError` and a Greek message in `deviceErrorMessage` in the same commit. This plan adds exactly one: `other_shop`.
- SQL test files are written here but can only be **run** against the dev project (Task 7). Track written vs applied honestly.

## Review Focus

1. A cashier pastes the whole link, a lower-case code, or a code with dashes/spaces into the code field → it is accepted exactly like the scanned link (Task 2 tests).
2. The link is opened while offline → the cashier sees «Δεν υπάρχει σύνδεση.» with the code still filled in, so retry is one tap; the key is not lost with the cleared hash (Task 4 test).
3. The link route is processed twice (React StrictMode, a re-render before the hash is cleared) → `join` is called once (Task 4 test).
4. Storage is unavailable (private window) → joining still works; only the silent return is lost; nothing throws (Task 3 test).
5. The owner replaces the link while a cashier has unsent edits → the phone lands on the entry screen with the "ask for the new link" message and the pending-edit queue in storage is untouched (Task 4 test).

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261112000001_store_join_keys.sql` (new) | Table, functions, removals |
| `supabase/tests/120_join_keys.sql` (new), `010`–`110` (setup lines) | SQL security tests |
| `src/app/joinKey.ts` (new) | Pure: parse/format the key, build the link, parse the join route |
| `src/app/router.ts` | Nothing new exported; `App.tsx` uses `parseJoinRoute` |
| `src/data/remote/deviceApi.ts`, `device.ts`, `deviceErrors.ts` | `join` replaces `pair`; `other_shop` |
| `src/data/local/phone.ts` | Stored join key |
| `src/features/phone/model/platform.ts` (new) | Pure: device label from the user agent |
| `src/features/phone/model/join.ts` (new) | The one client join path (calls the api, keeps the stored key right) |
| `src/features/phone/model/load.ts` (new) | The load path as a testable function, incl. the silent re-join |
| `src/features/phone/JoinScreen.tsx` (new, replaces `PairScreen.tsx`) | Entry screen |
| `src/features/phone/PhoneApp.tsx`, `model/gate.ts`, `model/messages.ts` | Link handling, switch-store sheet, messages |
| `src/data/remote/ownerApi.ts`, `owner.ts` | Join key, rotate, list/remove devices |
| `src/features/owner/DevicesScreen.tsx`, `src/features/owner/StoreLinkCard.tsx` (new), `src/features/owner/QrCode.tsx` (new) | Owner UI |
| `src/features/owner/model/pairing.ts` | Deleted |
| `CLAUDE.md`, `PROJECT_STATUS.md`, `supabase/tests/README.md`, the spec | Docs (Task 7) |

---

### Task 1: Database — store keys, join, remove, list

**Files:**
- Create: `supabase/migrations/20261112000001_store_join_keys.sql`
- Create: `supabase/tests/120_join_keys.sql`
- Modify: `supabase/tests/010_tables_rls.sql`, `020`, `030`, `040`, `050`, `060`, `070`, `080`, `090`, `100`, `110` (phone setup lines only, plus the pairing assertions in `020`/`030`/`050`)

**Interfaces:**
- Consumes (existing): `private.require_owner(uuid)`, `private.is_anonymous()`, `private.check_staff_pin`, `private.device_shop()`, `private.business_date(uuid)`, the current body of `public.staff_sign_in` in `20261107000001_staff_sessions.sql`.
- Produces (SQL, used by Tasks 3 and 5):
  - `public.owner_get_join_key(p_shop_id uuid) returns text`
  - `public.owner_rotate_join_key(p_shop_id uuid) returns text`
  - `public.join_shop(p_key text, p_label text default '', p_switch boolean default false) returns uuid` — raises `not_a_device_session` (42501), `invalid_code` (22023), `other_shop` (22023)
  - `public.owner_remove_device(p_device_user_id uuid) returns void`
  - `public.owner_list_devices(p_shop_id uuid) returns table (user_id uuid, label text, created_at timestamptz, last_seen_at timestamptz, last_staff_name text)`

- [ ] **Step 1: Write `supabase/tests/120_join_keys.sql`** in the style of `030_device_functions.sql` (one transaction, `begin … rollback`, same test users: owner A `…a1`, owner B `…b1`, phones `…d1`, `…d2`, `…d3` anonymous; each failure raises `'T<n> …'`). Tests:
  - T1 `owner_get_join_key` returns `^[A-HJ-NP-Z2-9]{16}$` and the same value on a second call.
  - T2 owner B and a phone get `not_owner` from `owner_get_join_key`, `owner_rotate_join_key`, `owner_list_devices` for shop A; `owner_remove_device` with a random uuid and with shop A's device (as owner B) both raise `not_owner`.
  - T3 `join_shop` as owner A (non-anonymous) raises `not_a_device_session`; with a wrong key raises `invalid_code`.
  - T4 phone D1 joins with `'  ' || lower(key with dashes) || ' '`; result = shop A; `device_context()` has one row; label stored.
  - T5 D1 joins again: still one `devices` row, `created_at` and `label` unchanged.
  - T6 owner B's shop key: D1 `join_shop(keyB)` raises `other_shop`; with `p_switch => true` the row moves to shop B, D1's live staff session of shop A is revoked, `last_seen_at`/`last_staff_id` are null.
  - T7 `staff_sign_in` with a wrong PIN leaves `last_seen_at` null; with the right PIN sets `last_seen_at` and `last_staff_id`; `owner_list_devices` returns that staff's name as `last_staff_name`.
  - T8 `owner_remove_device(D2)`: the row is gone, D2's live staff session is revoked, `set_closing_field` with D2's token answers `not_a_device`; D2 can `join_shop` again with the same key.
  - T9 `owner_rotate_join_key`: returns a different key; every device row of the shop is gone; live staff sessions revoked; the old key raises `invalid_code`; the new key joins.
  - T10 prune: as superuser backdate D3's `created_at` 31 days (no `last_seen_at`) and D2's `last_seen_at` 31 days; D1 joins → D3 and D2 rows deleted, D1 kept; a 31-day-old device of **shop B** is not deleted.
  - T11 `anon` cannot execute any of the five functions; `authenticated` cannot `select` from `shop_join_keys`; `create_pairing_code`, `redeem_pairing_code` and `pairing_codes` no longer exist; an owner `update public.devices set revoked_at = now()` is denied.

- [ ] **Step 2: Write the migration.** Contents, in this order:

```sql
create table public.shop_join_keys (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  key text not null unique check (key ~ '^[A-HJ-NP-Z2-9]{16}$'),
  created_at timestamptz not null default now()
);
alter table public.shop_join_keys enable row level security;
revoke all on public.shop_join_keys from public, anon, authenticated;

alter table public.devices
  add column last_seen_at timestamptz,
  add column last_staff_id uuid references public.staff (id) on delete set null;
```

  - `private.new_join_key() returns text` (volatile, not executable by any client role): 16 characters, each `substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(extensions.gen_random_bytes(16), i) % 32) + 1, 1)` — same loop as `create_pairing_code` in `20260929000006_owner_app.sql`.
  - `owner_get_join_key`: `require_owner`; `insert … values (p_shop_id, private.new_join_key()) on conflict (shop_id) do nothing`; return the stored key.
  - `owner_rotate_join_key`: `require_owner`; `update public.staff_sessions set revoked_at = now() where shop_id = p_shop_id and revoked_at is null`; `delete from public.devices where shop_id = p_shop_id`; upsert a new key (`on conflict (shop_id) do update set key = excluded.key, created_at = now()`); return it.
  - `join_shop` — the body is the decision, so it is given:

```sql
create function public.join_shop(p_key text, p_label text default '', p_switch boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text := upper(regexp_replace(coalesce(p_key, ''), '[^A-Za-z0-9]', '', 'g'));
  v_shop uuid;
  v_cur uuid;
  v_revoked timestamptz;
begin
  if v_uid is null or not private.is_anonymous() then
    raise exception 'not_a_device_session' using errcode = '42501';
  end if;
  select k.shop_id into v_shop from public.shop_join_keys k where k.key = v_key;
  if v_shop is null then raise exception 'invalid_code' using errcode = '22023'; end if;

  select d.shop_id, d.revoked_at into v_cur, v_revoked from public.devices d where d.user_id = v_uid for update;
  if v_cur = v_shop then
    update public.devices set revoked_at = null where user_id = v_uid;
  else
    if v_cur is not null and v_revoked is null and not coalesce(p_switch, false) then
      raise exception 'other_shop' using errcode = '22023';
    end if;
    update public.staff_sessions set revoked_at = now() where device_user_id = v_uid and revoked_at is null;
    insert into public.devices (user_id, shop_id, label)
    values (v_uid, v_shop, left(btrim(coalesce(p_label, '')), 60))
    on conflict (user_id) do update
      set shop_id = excluded.shop_id, label = excluded.label, revoked_at = null, created_at = now(),
          last_seen_at = null, last_staff_id = null;
  end if;

  delete from public.devices d
   where d.shop_id = v_shop and d.user_id <> v_uid
     and coalesce(d.last_seen_at, d.created_at) < now() - interval '30 days';
  return v_shop;
end $$;
```

  - `owner_remove_device`: look up the device's `shop_id`; null → `raise exception 'not_owner' using errcode = '42501'`; `require_owner(shop)`; revoke that device's live `staff_sessions`; delete the row.
  - `owner_list_devices`: plpgsql; `require_owner`; `return query` the five columns with `left join public.staff st on st.id = d.last_staff_id`, `where d.shop_id = p_shop_id and d.revoked_at is null`, `order by coalesce(d.last_seen_at, d.created_at) desc`.
  - `create or replace function public.staff_sign_in(...)`: copy the current body from `20261107000001_staff_sessions.sql` unchanged and add, right after the PIN check succeeds, `update public.devices set last_seen_at = now(), last_staff_id = p_staff_id where user_id = auth.uid();`. Keep the "never raises for expected failures" rule.
  - Removals: `drop function public.create_pairing_code(uuid); drop function public.redeem_pairing_code(text, text); drop table public.pairing_codes; delete from public.devices where revoked_at is not null; revoke update (revoked_at) on public.devices from authenticated;` (the `update (label)` grant and the `revoked_at` column stay).
  - Grants/revokes for all five public functions per Global Constraints; `revoke all on function private.new_join_key() from public, anon, authenticated`.

- [ ] **Step 3: Update the other SQL test files.** In every file `010`–`110`, replace the phone setup pair `create_pairing_code(shop)` + `redeem_pairing_code(code, label)` with `owner_get_join_key(shop)` + `join_shop(key, label)` (keep the `t.code` setting name or rename consistently per file). In `030` rewrite the pairing assertions (T1, T3 and any single-use/expiry tests) to the join equivalents or delete the ones that test expiry/single use; in `020`/`050` delete the `create_pairing_code` tests (their cases live in `120` now); in `010` add `shop_join_keys` to the "no client access" table checks and drop `pairing_codes`. Tests that set `devices.revoked_at` as superuser stay as they are.

- [ ] **Step 4: Verify what can be verified locally.** Run: `grep -rn "pairing_code" supabase/tests supabase/migrations/20261112000001_store_join_keys.sql` — expected: only the three `drop`/comment lines in the migration. Run `npm test && npm run typecheck` — expected: PASS (no TS change yet). The SQL itself runs in Task 7.

- [ ] **Step 5: Commit** — `feat(db): permanent store key, join_shop, device removal (written, not applied)`.

---

### Task 2: Pure join-key helpers

**Files:**
- Create: `src/app/joinKey.ts`
- Test: `tests/app/joinKey.test.ts`

**Interfaces:**
- Produces:
  - `parseJoinKey(text: string): string | null` — the 16-char canonical key or null
  - `formatJoinKey(key: string): string` — `'ABCDEFGHJKLMNPQR'` → `'ABCD-EFGH-JKLM-NPQR'`; other lengths returned unchanged
  - `joinLink(base: string, key: string): string` — `` `${base}#/join/${key}` ``
  - `parseJoinRoute(hash: string): { key: string | null } | null` — null when the hash is not a join route; `{ key: null }` for `#/join` / `#/join/<anything malformed>`

- [ ] **Step 1: Write the failing tests**

```ts
const K = 'ABCDEFGHJKLMNPQR';
describe('parseJoinKey', () => {
  it.each([
    [K, K],
    ['abcd-efgh-jklm-npqr', K],
    ['  ABCD EFGH JKLM NPQR \n', K],
    [`https://app.example/#/join/${K}`, K],
    [`https://app.example/sub/path/#/join/abcd-efgh-jklm-npqr`, K],
  ])('accepts %s', (input, key) => expect(parseJoinKey(input)).toBe(key));
  it.each(['', 'ABCDEFGH', `${K}2`, 'ABCDEFGHJKLMNPQ0', 'ABCDEFGHIJKLMNPQ', 'ABCDEFGHJKLMNPO1', `https://app.example/#/owner/${K}x`])(
    'rejects %s', (input) => expect(parseJoinKey(input)).toBeNull());
});
it('formatJoinKey groups by four', () => expect(formatJoinKey(K)).toBe('ABCD-EFGH-JKLM-NPQR'));
it('joinLink', () => expect(joinLink('https://a.b/app/', K)).toBe(`https://a.b/app/#/join/${K}`));
describe('parseJoinRoute', () => {
  it('reads a key', () => expect(parseJoinRoute(`#/join/${K}`)).toEqual({ key: K }));
  it('accepts dashes and lower case', () => expect(parseJoinRoute('#/join/abcd-efgh-jklm-npqr')).toEqual({ key: K }));
  it.each(['#/join', '#/join/', '#/join/short', `#/join/${K}/extra`])('malformed %s', (h) => expect(parseJoinRoute(h)).toEqual({ key: null }));
  it.each(['', '#/', '#/owner', '#/joined', '#/owner/join/x'])('not a join route: %s', (h) => expect(parseJoinRoute(h)).toBeNull());
});
```

- [ ] **Step 2: Run** `npx vitest run tests/app/joinKey.test.ts` — expected: FAIL (module missing).
- [ ] **Step 3: Implement the four functions** in `src/app/joinKey.ts`. `parseJoinKey`: if the text contains `#/join/`, keep only what follows it; strip every character that is not a letter or digit; upper-case; accept only `/^[A-HJ-NP-Z2-9]{16}$/`. A text that contains `#` but not `#/join/` is rejected. `parseJoinRoute` matches `^#/join(?:/(.*))?$` and passes group 1 (rejecting any further `/`) to `parseJoinKey`. No imports.
- [ ] **Step 4: Run** the same command — expected: PASS. Then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(app): pure store-key parsing and link helpers`.

---

### Task 3: Phone data layer — `join` replaces `pair`

**Files:**
- Modify: `src/data/remote/deviceApi.ts`, `src/data/remote/device.ts`, `src/data/remote/deviceErrors.ts`, `src/data/local/phone.ts`, `src/features/phone/model/messages.ts`, `src/features/phone/PairScreen.tsx` (call-site rename only; the screen is replaced in Task 4), `tests/features/phone/fakeDeviceApi.ts`
- Create: `src/features/phone/model/platform.ts`, `src/features/phone/model/join.ts`
- Test: `tests/data/deviceApi.test.ts`, `tests/data/deviceErrors.test.ts`, `tests/data/phoneLocal.test.ts`, `tests/features/phone/join.test.ts` (new), plus every test that names `pair` (`grep -rn "\.pair\b\|pair:" tests`)

**Interfaces:**
- Consumes: `join_shop` (Task 1).
- Produces:
  - `DeviceError` gains `| { code: 'other_shop' }`
  - `DeviceApi.join(key: string, label: string, opts?: { force?: boolean; switchShop?: boolean }): Promise<DResult<void>>` (replaces `pair`; same session rules: refuses on a failed session lookup, `owner_signed_in` unless `force`, signs in anonymously when needed; calls `rpc('join_shop', { p_key, p_label, p_switch: opts?.switchShop === true })`)
  - `loadJoinKey(store): string | null`, `saveJoinKey(store, key: string): boolean`, `clearJoinKey(store): void` in `src/data/local/phone.ts`, storage key `'tameio4all:v1:phone:joinKey'`; `loadJoinKey` returns only a value matching `^[A-HJ-NP-Z2-9]{16}$`
  - `platformLabel(userAgent: string): string` — `'iPhone'` for `/iPhone|iPod/`, `'iPad'` for `/iPad/`, `'Android'` for `/Android/`, else `'Υπολογιστής'`
  - `joinStore(api: DeviceApi, store: KeyValueStore, key: string, label: string, opts?: { force?: boolean; switchShop?: boolean }): Promise<DResult<void>>` — the only client code that calls `api.join`. On ok: `saveJoinKey`. On `invalid_code`: `clearJoinKey` when the stored key equals `key`. Never throws, even when the store does.

- [ ] **Step 1: Write the failing tests.**
  - `deviceErrors.test.ts`: `mapDeviceError({ message: 'other_shop', code: '22023' })` → `{ code: 'other_shop' }`.
  - `deviceApi.test.ts`: rename the `pair` tests to `join`; assert the rpc is `join_shop` with `{ p_key: K, p_label: 'iPhone', p_switch: false }`, and `p_switch: true` with `{ switchShop: true }`.
  - `phoneLocal.test.ts`: save/load/clear round trip; a stored `'nope'` loads as null; a store whose `setItem` throws → `saveJoinKey` returns false and does not throw.
  - `join.test.ts`:

```ts
it('saves the key after a successful join', async () => {
  const api = fakeDeviceApi(); const store = memoryStore();
  expect((await joinStore(api, store, K, 'iPhone')).ok).toBe(true);
  expect(loadJoinKey(store)).toBe(K);
});
it('forgets a stored key the server no longer accepts', async () => {
  const store = memoryStore(); saveJoinKey(store, K);
  const api = fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'invalid_code' })) });
  await joinStore(api, store, K, 'iPhone');
  expect(loadJoinKey(store)).toBeNull();
});
it('keeps the stored key when another key is refused, and on a network failure', async () => { /* K2 refused → K stays; network → K stays */ });
it('joins even when storage is unavailable (Review Focus 4)', async () => {
  const r = await joinStore(fakeDeviceApi(), throwingStore(), K, 'iPhone');
  expect(r.ok).toBe(true);
});
```
  (use the existing memory/throwing store helpers of `tests/data/phoneLocal.test.ts`; add one if none exists.)
  - `platform` cases in `join.test.ts`: an iPhone UA, an iPad UA, an Android UA, a desktop UA, `''` → `'Υπολογιστής'`.

- [ ] **Step 2: Run** `npx vitest run tests/data tests/features/phone` — expected: FAIL.
- [ ] **Step 3: Implement.** `deviceErrors.ts`: add `'other_shop'` to `RAISED` and map it to `{ code: 'other_shop' }` (keep `invalid_code` and `not_a_device_session` behaviour). `messages.ts` — exact copy:
  - `not_a_device`: `'Αυτή η συσκευή δεν είναι σε κατάστημα. Άνοιξε τον σύνδεσμο του καταστήματος.'`
  - `invalid_code`: `'Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.'`
  - `other_shop`: `'Η συσκευή είναι ήδη σε άλλο κατάστημα.'`
  - `device_revoked` stays as is.
  Rename `pair` → `join` in `fakeDeviceApi.ts` and in `PairScreen.tsx` (it keeps compiling by calling `api.join(clean, label.trim(), …)`).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — expected: PASS.
- [ ] **Step 5: Commit** — `feat(phone): join a store by key (data layer)`.

---

### Task 4: Phone — entry screen, link handling, silent return

**Files:**
- Create: `src/features/phone/JoinScreen.tsx`, `src/features/phone/model/load.ts`
- Delete: `src/features/phone/PairScreen.tsx`
- Modify: `src/features/phone/PhoneApp.tsx`, `src/features/phone/model/gate.ts`, `src/app/App.tsx`
- Test: `tests/features/phone/load.test.ts` (new), `tests/features/phone/gate.test.ts`, `tests/features/phone/phoneApp.test.tsx`, `tests/app/app.test.tsx`

**Interfaces:**
- Consumes: `parseJoinKey`, `parseJoinRoute` (Task 2); `joinStore`, `platformLabel`, `loadJoinKey`, `DeviceApi.join`, `other_shop` (Task 3).
- Produces:
  - `loadGate(api: DeviceApi, store: KeyValueStore, label: string): Promise<GateEvent>` in `model/load.ts` — everything `PhoneApp.load` does today after the `api === null` check, returning the event instead of dispatching (it still saves the cached context on success).
  - `PhoneAppProps` gains `link: { key: string | null } | null` and `onLinkTaken: () => void`.
  - `JoinScreen` props: `{ api: DeviceApi; store: KeyValueStore; label: string; notice: string | null; initialKey: string | null; onJoined: () => void; onOwner: () => void }`.
  - Gate: `load_failed` with `error.code === 'invalid_code'` → `unpairedBy(error)` (so the entry screen shows the "ask for the new link" message). No other reducer change; `unpaired` now means "not in a store".

**Behaviour to implement (the decisions):**

`loadGate`:
1. `auth = await api.session()`. `owner = auth.ok && auth.data?.anonymous === false`.
2. If `auth.ok && auth.data === null` → outcome "not in a store". Else `r = await api.context()`: ok with data → save cached context, return `{ t: 'loaded', ctx, stored }`; ok with null, or error `not_a_device` → outcome "not in a store"; any other error → `{ t: 'load_failed', error, cached, stored }` as today.
3. Outcome "not in a store": `key = loadJoinKey(store)`. If `key === null || owner` → return what today's code returns for that case (`loaded` with `ctx: null`, or the `load_failed` with `not_a_device`). Otherwise `j = await joinStore(api, store, key, label)` — **once**:
   - ok → `api.context()` again and return `loaded`/`load_failed` from it (no second join).
   - `invalid_code` → `{ t: 'load_failed', error: { code: 'invalid_code' }, cached: null, stored: null }`.
   - `owner_signed_in` → `{ t: 'loaded', ctx: null, stored: null }`.
   - anything else (incl. `network`) → `{ t: 'load_failed', error: j.error, cached: loadCachedContext(store), stored: loadStaffSession(store) }`.

`PhoneApp`:
- `load` becomes `dispatch(await loadGate(api, store, label))` where `label = platformLabel(navigator.userAgent)` (memoized).
- Link intake: when `link !== null`, copy it into component state **once** (guard with a ref so a second render or StrictMode re-run does not take it twice) and call `onLinkTaken()`.
- A taken link is acted on when the gate is settled (not `loading`):
  - gate `unpaired`: render `JoinScreen` with `initialKey = link.key`; when `link.key === null` the notice is `'Ο σύνδεσμος δεν είναι σωστός.'`.
  - gate `signed_out`/`ready`: `link.key === null` → drop it. Otherwise call `joinStore(api, store, key, label)` once: ok → drop the link (same store; nothing else happens); `other_shop` → show the switch sheet; `invalid_code`/`network`/other → show `deviceErrorMessage(error)` as a dismissible `.notice` and drop the link.
  - Switch sheet (`Sheet` from `src/ui/Sheet`): title `'Αλλαγή καταστήματος'`, body `` `Η συσκευή είναι στο «${ctx.shopName}». Να μπει στο κατάστημα του συνδέσμου;` ``, buttons `'Άκυρο'` (drop the link) and `'Αλλαγή'` → `joinStore(…, { switchShop: true })` → on ok `dispatch({ t: 'paired' })` (reload; the stored staff session no longer matches and is cleared by the existing rules).
  - other gate states (`offline_no_cache`, `load_error`, `unconfigured`): keep the link until the gate settles into one of the above.
- `case 'unpaired'` renders `JoinScreen` (not `PairScreen`).

`JoinScreen` (exact copy):
- Header `'Είσοδος στο κατάστημα'`; sub text `'Σκάναρε το QR του καταστήματος ή άνοιξε τον σύνδεσμό του. Αλλιώς γράψε εδώ τον κωδικό.'`
- One input, `aria-label="Κωδικός καταστήματος"`, `autoCapitalize="characters"`, `autoComplete="off"`, `spellCheck={false}`; submit button `'Είσοδος'`, disabled while busy or empty.
- Submit: `parseJoinKey(text)`; null → error `'Ο κωδικός δεν είναι σωστός.'` (no server call). Otherwise `joinStore(api, store, key, label)`; ok → `onJoined()`.
- `initialKey !== null`: the field starts as `formatJoinKey(initialKey)` and the join is attempted once on mount (ref-guarded). On failure the field keeps the code and the error shows (Review Focus 2).
- `owner_signed_in` → the existing confirmation block, same copy as `PairScreen` today (`'Είσαι συνδεδεμένος ως ιδιοκτήτης σε αυτόν τον browser. Η σύνδεση συσκευής θα σε αποσυνδέσει.'`, `'Συνέχεια'` → `{ force: true }`, `'Άκυρο'`).
- `other_shop` cannot happen here for a phone with no store, but a revoked/odd state might: treat it like any error message.
- Footer link `'Διαχείριση καταστήματος'` → `onOwner` (as today). No device-name field.

`App.tsx`: `const joinRoute = parseJoinRoute(hash)`; pass `link={joinRoute}` and `onLinkTaken={() => setHash('#/', { replace: true })}` to the phone area. A join hash is in the register area already (`parseAppRoute` returns `register` for it) — verify with a test, change nothing in `router.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `load.test.ts` (no React), with `K` stored via `saveJoinKey` unless said otherwise:

```ts
it('paired phone: loaded, join never called', …);
it('no session + stored key: joins once, then loads the context', async () => {
  const session = vi.fn().mockResolvedValueOnce({ ok: true, data: null });
  const api = fakeDeviceApi({ session });
  const e = await loadGate(api, store, 'iPhone');
  expect(api.join).toHaveBeenCalledTimes(1);
  expect(api.join).toHaveBeenCalledWith(K, 'iPhone', undefined);
  expect(e).toMatchObject({ t: 'loaded', ctx: { shopId: FAKE_SHOP_ID } });
});
it('context says not_a_device + stored key: joins once', …);
it('no stored key: loaded with ctx null, join never called', …);
it('owner session: never joins, even with a stored key', …);           // session → { anonymous: false }, context → ok(null)
it('replaced link: invalid_code clears the key and reports it', async () => {
  const api = fakeDeviceApi({ context: vi.fn(() => fail({ code: 'not_a_device' })), join: vi.fn(() => fail<void>({ code: 'invalid_code' })) });
  expect(await loadGate(api, store, 'iPhone')).toMatchObject({ t: 'load_failed', error: { code: 'invalid_code' } });
  expect(loadJoinKey(store)).toBeNull();
});
it('network failure on the re-join keeps the key and falls back like any offline load', …);
it('join ok but context still fails: one join only, the failure is returned', …);
```
  - `gate.test.ts`: `load_failed` with `invalid_code` → `{ s: 'unpaired', notice: 'Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.' }`.
  - `phoneApp.test.tsx` (rewrite the pairing tests; the fake's `context` returns `ok(null)` until `join` succeeds where a test needs the entry screen):
    - typing `abcd-efgh-jklm-npqr` + «Είσοδος» calls `join` with `('ABCDEFGHJKLMNPQR', <label>, undefined)` and shows the sign-in screen;
    - typing `abc` shows «Ο κωδικός δεν είναι σωστός.» and never calls `join`;
    - `link={{ key: K }}` on an unpaired phone: `onLinkTaken` called once, `join` called once even when rendered inside `<StrictMode>` and re-rendered with the same `link` (Review Focus 3), then the sign-in screen;
    - `link={{ key: null }}` on an unpaired phone shows «Ο σύνδεσμος δεν είναι σωστός.»;
    - link + `join` failing with `network` on an unpaired phone: «Δεν υπάρχει σύνδεση.» and the input still shows `ABCD-EFGH-JKLM-NPQR` (Review Focus 2);
    - link on a signed-in (`ready`) phone, `join` ok: register still on screen, no sheet;
    - link on a `ready` phone, `join` → `other_shop`: sheet «Αλλαγή καταστήματος»; «Αλλαγή» calls `join` with `{ switchShop: true }` and the phone ends on the sign-in screen; «Άκυρο» keeps the register;
    - owner-session confirmation still works (`{ force: true }`);
    - Review Focus 5: a `ready` phone with a stored key and a non-empty pending queue (`data/local/openClosing.ts` key present in the store); a register call fails with `not_a_device`, `join` fails with `invalid_code` → the entry screen shows «Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.» and the pending-queue storage key still holds the same value.
  - `app.test.tsx`: loading the app at `#/join/<K>` renders the phone area and the hash becomes `#/`.

- [ ] **Step 2: Run** `npx vitest run tests/features/phone tests/app` — expected: FAIL.
- [ ] **Step 3: Implement** `model/load.ts`, the gate case, `JoinScreen.tsx`, the `PhoneApp` changes and the `App.tsx` wiring as specified above; delete `PairScreen.tsx`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — expected: PASS. Run `grep -rn "PairScreen\|κωδικό σύζευξης\|Κωδικός σύζευξης" src tests` — expected: no matches.
- [ ] **Step 5: Commit** — `feat(phone): enter a store by link or code; silent return`.

---

### Task 5: Owner data layer

**Files:**
- Modify: `src/data/remote/ownerApi.ts`, `src/data/remote/owner.ts`, `tests/features/owner/fakeApi.ts`, `src/features/owner/DevicesScreen.tsx` (only what is needed to keep it compiling; the UI is Task 6)
- Delete: `src/features/owner/model/pairing.ts` and its tests in `tests/features/owner/model.test.ts`
- Test: `tests/data/ownerApi.test.ts`

**Interfaces:**
- Consumes: the four owner functions (Task 1).
- Produces (in `OwnerApi`):
  - `joinKey(shopId: string): Promise<Result<string>>` → `rpc('owner_get_join_key', { p_shop_id })`
  - `rotateJoinKey(shopId: string): Promise<Result<string>>` → `rpc('owner_rotate_join_key', { p_shop_id })`
  - `listDevices(shopId: string): Promise<Result<DeviceRow[]>>` → `rpc('owner_list_devices', { p_shop_id })`
  - `renameDevice(userId: string, label: string): Promise<Result<void>>` (replaces `updateDevice`; same table update as today, label only)
  - `removeDevice(userId: string): Promise<Result<void>>` → `rpc('owner_remove_device', { p_device_user_id })`
  - `createPairingCode` and `updateDevice` are removed.
  - `DeviceRow = { userId: string; label: string; createdAt: string; lastSeenAt: string | null; lastStaffName: string | null }` (`revokedAt` removed)
  - Both key methods return `{ ok: false, error: BAD_RESPONSE }` (the existing constant in `owner.ts`) when the payload is not a string that `parseJoinKey` accepts.

- [ ] **Step 1: Write the failing tests** in `ownerApi.test.ts`: each method calls the rpc named above with the argument shape above; `listDevices` maps `{ user_id, label, created_at, last_seen_at, last_staff_name }` rows and tolerates a null payload as `[]`; `joinKey` with payload `'nope'` → `bad_response`; a `not_owner` raise maps to the existing `not_owner` `OwnerError`.
- [ ] **Step 2: Run** `npx vitest run tests/data/ownerApi.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement.** In `fakeApi.ts`: `joinKey: vi.fn(() => ok('ABCDEFGHJKLMNPQR'))`, `rotateJoinKey: vi.fn(() => ok('STUVWXYZ23456789'))`, `listDevices: vi.fn(() => ok([]))`, `renameDevice`, `removeDevice` → `ok(undefined)`. Keep `DevicesScreen.tsx` compiling by swapping to the new method names and dropping `PairingCard` (a plain placeholder is fine; Task 6 replaces the screen) — update `tests/features/owner/devices.test.tsx` only as far as needed to pass.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — expected: PASS. `grep -rn "createPairingCode\|formatPairingCode\|PAIRING_TTL" src tests` — expected: no matches.
- [ ] **Step 5: Commit** — `feat(owner): store key and device removal (data layer)`.

---

### Task 6: Owner «Συσκευές» screen

**Files:**
- Create: `src/features/owner/StoreLinkCard.tsx`, `src/features/owner/QrCode.tsx`
- Modify: `src/features/owner/DevicesScreen.tsx`, its caller (find with `grep -rn "DevicesScreen" src`), `src/app/theme.css`, `package.json` (`npm install qrcode-generator`)
- Test: `tests/features/owner/devices.test.tsx`

**Interfaces:**
- Consumes: `OwnerApi.joinKey/rotateJoinKey/listDevices/renameDevice/removeDevice`, `DeviceRow` (Task 5); `formatJoinKey`, `joinLink` (Task 2); `Sheet`, `Card`, `useAction`, `ErrorText`, `formatDate`.
- Produces:
  - `QrCode({ text, label }: { text: string; label: string })` — an inline `<svg role="img" aria-label={label}>` built from `qrcode-generator` (type number `0` = auto, error correction `'M'`), dark modules as `<rect>`/one `<path>` in `#000` on a `#fff` background with a 4-module quiet zone. It must be black on white in both themes (a QR on the dark theme does not scan).
  - `StoreLinkCard({ api, shopId, shopName, onRotated })`.
  - `DevicesScreen` props become `{ api: OwnerApi; shopId: string; shopName: string }` (`now` is no longer needed; pass the shop name from wherever the shop tabs already have it).

**UI (exact copy):**

`StoreLinkCard` — `Card` titled `'Είσοδος στο κατάστημα'`:
- loads `api.joinKey(shopId)` on mount; `'Φόρτωση…'` while loading; on error the message through `ownerErrorMessage` and a `'Ξανά'` button.
- hint: `'Το προσωπικό σκανάρει το QR ή ανοίγει τον σύνδεσμο και μπαίνει με το όνομα και το PIN του.'`
- `QrCode` of `joinLink(window.location.origin + window.location.pathname, key)`, `label="QR εισόδου στο κατάστημα"`; under it the code as `formatJoinKey(key)` in the existing `.pair-code` style.
- Buttons: `'Αντιγραφή συνδέσμου'` → `navigator.clipboard.writeText(link)`, then the button reads `'Αντιγράφηκε'` for 2 s; when the clipboard is missing or rejects, show the link in a read-only, selected `<input aria-label="Σύνδεσμος καταστήματος">` instead. `'Κοινοποίηση'` rendered only when `typeof navigator.share === 'function'` → `navigator.share({ title: shopName, url: link })` (a rejected/cancelled share is ignored). `'Εκτύπωση'` → `window.print()`. `'Νέος σύνδεσμος'` (text button) → confirmation sheet.
- Rotate sheet: title `'Νέος σύνδεσμος'`; body `'Ο παλιός σύνδεσμος και το QR θα πάψουν να ισχύουν. Όλες οι συσκευές θα βγουν από το κατάστημα και το προσωπικό θα χρειαστεί τον νέο σύνδεσμο.'`; buttons `'Άκυρο'` / `'Νέος σύνδεσμος'` → `api.rotateJoinKey(shopId)`; on ok show the new key and call `onRotated()` (the screen reloads the device list).
- Print card: rendered with `createPortal` to `document.body`, class `print-only`, containing the shop name (`<h1>`), the `QrCode`, the formatted code and the line `'Σκάναρε για να μπεις στο ταμείο. Μετά: όνομα και PIN.'`. CSS in `theme.css`: `.print-only { display: none; }` and `@media print { body > :not(.print-only) { display: none !important; } .print-only { display: block; background: #fff; color: #000; text-align: center; } }`. It lives outside every glass container (CLAUDE.md theme rule).

Device list (below the card):
- row title: `device.label || 'Χωρίς όνομα'`; hint: `` `Τελευταία χρήση ${formatDate(lastSeenAt)} · ${lastStaffName}` `` when `lastSeenAt` is set (omit `' · name'` when `lastStaffName` is null), else `'Δεν χρησιμοποιήθηκε ακόμα'`.
- actions: `'Μετονομασία'` (the existing inline form, now via `api.renameDevice`) and `'Αφαίρεση'`.
- remove sheet: title `'Αφαίρεση συσκευής'`; body `` `Η συσκευή «${title}» θα φύγει από τη λίστα και όποιος είναι συνδεδεμένος σε αυτήν θα αποσυνδεθεί. Αν έχει ακόμα τον σύνδεσμο του καταστήματος, μπορεί να ξαναμπεί· για να μην μπορεί, απενεργοποίησε τον υπάλληλο ή φτιάξε νέο σύνδεσμο.` ``; buttons `'Άκυρο'` / `'Αφαίρεση'` → `api.removeDevice(userId)` → reload.
- empty list: `'Καμία συσκευή στο κατάστημα.'`. No «Ανάκληση», no «Ενεργή/Ανακλήθηκε».

- [ ] **Step 1: Write the failing tests** in `devices.test.tsx` (through `fakeApi`):
  - the card shows `ABCD-EFGH-JKLM-NPQR` and an image named «QR εισόδου στο κατάστημα»;
  - «Αντιγραφή συνδέσμου» calls a stubbed `navigator.clipboard.writeText` with a string ending in `#/join/ABCDEFGHJKLMNPQR`, then shows «Αντιγράφηκε»; with `writeText` rejecting, the «Σύνδεσμος καταστήματος» input holds the link;
  - «Κοινοποίηση» is absent when `navigator.share` is undefined;
  - «Νέος σύνδεσμος» → the sheet text → confirm calls `rotateJoinKey('<shopId>')` once, shows `STUV-WXYZ-2345-6789`, and `listDevices` is called again; «Άκυρο» calls nothing;
  - a row with `lastSeenAt` + `lastStaffName: 'ΜΑΡΙΑ'` shows «Τελευταία χρήση … · ΜΑΡΙΑ»; a row with `lastSeenAt: null` shows «Δεν χρησιμοποιήθηκε ακόμα»;
  - «Αφαίρεση» → confirm calls `removeDevice(userId)` and reloads; a failing `removeDevice` shows the error and keeps the row;
  - a failing `joinKey` shows the error with «Ξανά», and the device list still renders.
- [ ] **Step 2: Run** `npx vitest run tests/features/owner/devices.test.tsx` — expected: FAIL.
- [ ] **Step 3: Implement** as specified. Confirm `qrcode-generator` is only imported from `QrCode.tsx` (it must not land in the phone bundle: the owner area is lazy-loaded).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — expected: PASS, and the build output shows `qrcode-generator` inside an owner chunk, not the entry chunk.
- [ ] **Step 5: Commit** — `feat(owner): store link card with QR, replace link, remove devices`.

---

### Task 7: Apply to dev, verify on real devices, docs

This task needs the Supabase connector (dev project `fstfuhogvsdaiwpfdmep`) and a real phone. If the executor lacks either, it stops after Step 4 and reports exactly which steps were not done.

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_STATUS.md`, `supabase/tests/README.md`, `docs/superpowers/specs/2026-11-11-store-link-entry-design.md` (status line)
- Create: `WORK_LOG_2026-11-12.md` (or the actual date)

- [ ] **Step 1: Apply** `20261112000001_store_join_keys.sql` to dev (after confirming `…0003_today_save_and_submit_revision` is applied). Applying drops the pairing functions: the deployed client must be the new build before staff use it.
- [ ] **Step 2: Run** every SQL test file `010`–`120` against dev. Expected: each finishes without error. Fix the file or the migration (as a **new** migration if `…0001` was already applied) and re-run.
- [ ] **Step 3: Check the Auth settings** in the Supabase dashboard: no session time-box and no inactivity timeout for the project; anonymous sign-ins enabled. Record what was found.
- [ ] **Step 4: Update the docs.**
  - `CLAUDE.md`: add the five invariants listed in the spec's «Invariants to write into CLAUDE.md» section, plus: the `other_shop` error and the `p_switch` rule; `joinStore` is the only client join path; `loadGate` is the one load path. Remove/replace: «A revoked phone stays revoked until an owner gives it a fresh pairing code…», the pairing mentions in the `src/data/remote/` and `src/features/phone/` bullets (`pair` → `join`, `PairScreen` → `JoinScreen`), and the `pairing` mention in the `src/features/owner/` bullet.
  - `PROJECT_STATUS.md`: add the stage, and these open items with severities — **L**: anonymous `auth.users` rows of removed/pruned devices are never deleted; **L**: a removed phone already joined to the realtime channel keeps receiving broadcasts until it rejoins (existing known limit); **M**: a link holder without a PIN can read shop name/settings/staff names and trigger PIN lockouts (accepted; remedy «Νέος σύνδεσμος»).
  - `supabase/tests/README.md`: describe `120`, the changed setup in `010`–`110`, and the run date/result (or "not yet run").
  - Spec: change the status line to built/applied as appropriate.
- [ ] **Step 5: Real-device check** (the full happy path, on a phone, against the deployed build): owner opens «Συσκευές» → scan the QR with the phone camera → name + PIN → register opens. Clear the site data → open the link again → name + PIN. Home-screen app: type the code. «Νέος σύνδεσμος» → the phone lands on the entry screen with the "ask for the new link" message. «Αφαίρεση» on a signed-in phone → it is signed out and comes back by itself. Print preview shows only the card.
- [ ] **Step 6: Write the work log** with an explicit «Not verified» section (at minimum: anything from Steps 1–3 and 5 that was not done; concurrency of two phones joining at once; QR scan from a printed card; iOS 7-day eviction recovery in practice).
- [ ] **Step 7: Commit** — `docs: stage 4 store link entry (invariants, status, test runs)`.
