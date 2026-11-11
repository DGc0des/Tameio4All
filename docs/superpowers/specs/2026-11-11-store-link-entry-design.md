# Store link entry — design (stage 4)

Status: **built** (plan `docs/superpowers/plans/2026-11-11-stage-4-store-link-entry.md`, branch `stage-4-store-link-entry`);
migration applied to dev on 2026-11-11; real-device check pending.
Date: 2026-11-11.

## Why

Getting a phone into a store is fragile and depends on the owner being reachable.

- A paired phone is an anonymous Supabase user whose session lives only in that browser's storage.
  When the storage or the session is lost, the phone is a stranger again. This happens without anyone
  doing anything wrong: iOS Safari evicts a site's storage after about 7 days without a visit, the
  home-screen app and the Safari tab have separate storage, an unused session can expire, and an owner
  sign-in in the same browser replaces the session.
- The only way back in is a pairing code that the owner must create on the spot (single use, 10 minutes).
- Every re-pair adds a new row in «Συσκευές». The owner can only rename or revoke a row, so the list
  fills with dead copies of the same physical phone.

**What the owner asked for (their words):** a cashier whose phone forgot everything, with the owner not
around, should get back in with «just their name and their PIN». The owner also wants to delete devices.
They accepted a permanent store link/QR kept in the store as the way the phone learns which store it is.

## Goals

1. A cashier can enter the store from any phone, without the owner, using the store link (or QR, or the
   typed store code) + their name + their PIN.
2. A phone that already entered once needs only name + PIN on a normal day (as today).
3. A phone that lost its session but kept its storage gets back in silently: the cashier sees the usual
   name + PIN screen, not the entry screen.
4. The owner can show, print, copy and replace the store link at any time.
5. The owner can remove a device from the list for real, and dead entries stop piling up.

## Non-goals

- Owner sign-up, shop creation and staff management (name + PIN, created by the owner) do not change.
- No personal accounts for staff, no email/phone for cashiers.
- No in-app QR scanner. The phone's camera app opens the link; the typed store code is the fallback.
- No per-device approval by the owner. The owner declined that in favour of the link.
- No cleanup of the leftover anonymous `auth.users` rows of removed devices (record it as a known
  leftover in the status doc).

## Anti-goals

- The 4-digit PIN must never be the only secret. A PIN can only be tried by a phone that already holds
  the store key.
- Nothing about the live closing, submit, history or the staff-session rules may change. A phone stays
  "an anonymous auth user with a live `devices` row"; only *how it gets that row* changes.
- No second way to enter a store. The pairing code is removed, not kept beside the link.

## What the owner accepted

Anyone who holds the store link and knows a PIN can enter from any phone, including an ex-employee from
home. The two locks are: deactivate that cashier (already blocks them), or replace the link (blocks
everyone until they get the new one).

Someone who holds the link but no PIN can still see the shop name, its settings and the staff names, and
can lock cashiers out for 15 minutes at a time by guessing PINs (the existing 5-attempt lockout). The
answer to that is also «replace the link».

---

## How it works

### The store key

- One key per shop: 16 characters from the existing pairing alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (80 bits), shown as `XXXX-XXXX-XXXX-XXXX`. It does not expire and is not single use.
- The store link is `<app origin + path>#/join/<16 chars>`. The key sits in the hash, so it is never
  sent to the hosting server or written to its logs.
- One pure function parses every input path (the link route, a pasted link, a typed code):
  `parseJoinKey(text): string | null`. It strips everything except letters and digits after an optional
  `…#/join/` prefix, upper-cases, and accepts only `^[A-HJ-NP-Z2-9]{16}$`. The router and the entry
  screen both call it; nothing else validates a key on the client.

### Database (one new migration + tests)

New table `public.shop_join_keys (shop_id uuid primary key references shops on delete cascade,
key text not null unique, created_at timestamptz not null default now())`. RLS on, every privilege
revoked from `public, anon, authenticated`: no client reads it directly.

The key is stored in plain text so the owner can see the same link/QR again later. (Storing only a hash
would force a replacement, which kicks every phone out, each time the owner wants to reprint it.)

`devices` gains `last_seen_at timestamptz` and `last_staff_id uuid references staff on delete set null`.

Functions, all `security definer`, `search_path = ''`, `revoke … from public, anon`, execute for
`authenticated` only:

| Function | Who | Does |
|---|---|---|
| `owner_get_join_key(shop) returns text` | owner | `require_owner`; returns the shop's key, creating it on first call. |
| `owner_rotate_join_key(shop) returns text` | owner | `require_owner`; replaces the key; revokes every live `staff_sessions` row of the shop; deletes every `devices` row of the shop. Returns the new key. |
| `join_shop(key, label default '', switch default false) returns uuid` | phone | Caller must be an anonymous user (else `not_a_device_session`, 42501, as `redeem_pairing_code` does today). Unknown key → `invalid_code` (22023). A caller already in a **different** store gets `other_shop` (22023) unless `switch` is true. Upserts the caller's `devices` row for that shop (`revoked_at = null`); `created_at` is reset only when the row is new or the shop changed. Then deletes the shop's other devices that were unused for 30 days (`coalesce(last_seen_at, created_at) < now() - 30 days`). Returns the shop id. |
| `owner_remove_device(device_user_id) returns void` | owner | Missing and foreign ids both raise `not_owner`. Revokes that device's live staff sessions and deletes its `devices` row. |
| `owner_list_devices(shop)` | owner | `require_owner`; returns `user_id, label, created_at, last_seen_at, last_staff_name`, newest use first. Replaces the direct table read in `owner.ts`. |
| `staff_sign_in` (new body) | phone | As today, plus `update devices set last_seen_at = now(), last_staff_id = p_staff_id` for the caller after a correct PIN. |

Removed in the same migration: `create_pairing_code`, `redeem_pairing_code`, the `pairing_codes` table,
and the owner's column grant to update `devices.revoked_at`. Rows that are already revoked are deleted.
The `revoked_at` column and the `revoked_at is null` checks in the existing functions stay (nothing sets
it any more; rewriting eight functions to drop a column buys nothing).

`invalid_code` is reused on purpose (it already has a `mapDeviceError` case; only its Greek text changes:
«Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.», used for a typed code and for a replaced
link alike). One new error string crosses the SQL/TS boundary: `other_shop`, so the phone can ask before
switching stores without guessing which store a key belongs to.

### Phone

Entry (replaces `PairScreen`; title «Είσοδος στο κατάστημα»):

- Text: scan the store's QR or open the store link. Below it one field, «Κωδικός καταστήματος», that
  accepts a typed code or a pasted link (through `parseJoinKey`). No device-name field: the label is
  filled automatically from the platform («iPhone», «Android», «Υπολογιστής») and the owner can rename it.
- The typed code matters for the iOS home-screen app: a scanned QR opens Safari, which has different
  storage from the installed app.

Opening `#/join/<key>`:

1. The key is taken from the hash and the hash is replaced with `#/` (so it does not stay in the address
   bar or get re-run on reload).
2. No session, or an anonymous one that is not in a store → join, then the gate reloads → name + PIN.
3. Already in the **same** store → nothing to do; continue as usual.
4. In a **different** store → ask first («Αλλαγή καταστήματος;»). Unsent edits of the old store stay in
   its own queue, as today.
5. An owner is signed in in this browser → the existing «θα σε αποσυνδέσει» confirmation.
6. Malformed key in the link → the entry screen with «Ο σύνδεσμος δεν είναι σωστός».

Silent return (goal 3):

- After a successful join the phone stores the key (`src/data/local/phone.ts`, next to the cached context).
- When the one load path ends in "not a store phone" (`not_a_device`, or definitely no session) **and** a
  stored key exists **and** no owner session is present, it tries `join` once with the stored key and
  loads again. `invalid_code` → forget the stored key and show the entry screen with the `invalid_code`
  message. A network failure keeps the key and follows the existing offline
  rules. At most one automatic attempt per load: no loops.
- This also repairs the shared-browser case: after an owner signs out, the phone returns to the store by
  itself.
- The stored key is cleared only on `invalid_code` or when the phone joins another store.

`DeviceApi.pair(code, label, opts)` becomes `join(key, label, opts)` with the same owner-session rules;
the gate reducer keeps its states (`unpaired` now means "not in a store").

### Owner («Συσκευές» tab)

Top card «Είσοδος στο κατάστημα»:

- the QR of the store link, the code as `XXXX-XXXX-XXXX-XXXX`, and three actions: «Αντιγραφή συνδέσμου»,
  «Κοινοποίηση» (only where `navigator.share` exists) and «Εκτύπωση» (a print view with the shop name,
  the QR, the code and one line of instructions);
- «Νέος σύνδεσμος» behind a confirmation that says plainly: the old link and QR stop working, every
  phone is signed out of the store, and staff need the new one to get back in.

Device list below it: label, last cashier, last used (or «Δεν χρησιμοποιήθηκε ακόμα»). Actions: rename and
«Αφαίρεση». The confirmation for «Αφαίρεση» says what it really does: the entry disappears and anyone
signed in on it is signed out; a phone that still has the store link can come back, so to keep someone
out the owner deactivates the cashier or makes a new link. «Ανάκληση» and the «Ενεργή/Ανακλήθηκε» status
are gone.

The QR is drawn as inline SVG with a small dependency-free generator (`qrcode-generator`), loaded only
with the owner area. The printed card stays opaque (same rule as `.share-card`).

### What a replaced link does to a shift in progress

The phones' next call answers `not_a_device`; the gate goes to the entry screen. Edits not yet sent stay
stored under the cashier. Once they enter with the new link and sign in on the same business day, the
queue replays as it does after any reconnect.

---

## Invariants to write into `CLAUDE.md` when this ships

- A phone enters a store only through `join_shop(key)`. The store key is the only thing that lets a
  browser list staff or try a PIN.
- The key lives in `shop_join_keys`, readable only through `owner_get_join_key`; replacing it
  (`owner_rotate_join_key`) removes every device and ends every staff session of the shop.
- «Αφαίρεση» is cleanup, not a ban: there is no revoked state any more. Replaces the old rule «a revoked
  phone stays revoked until an owner gives it a fresh pairing code».
- Cross-file: the key format (`^[A-HJ-NP-Z2-9]{16}$`) is produced in SQL and checked by `parseJoinKey`.
- Automatic re-join happens only from the load path, at most once per load, never while an owner session
  is present.

## Tests

- SQL (`supabase/tests/120_join_keys.sql`, and the pairing parts of `030`/`050`/`010` rewritten): anon
  gets nothing; a non-owner gets `not_owner` from the four owner functions, same for a missing id;
  `join_shop` refuses a non-anonymous caller and a wrong key; joining twice is one row; joining shop B
  moves the row; rotation invalidates the old key, deletes devices and revokes live sessions (a write with
  the old token fails); `owner_remove_device` ends that phone's session; the 30-day prune removes only
  unused rows of that shop; `staff_sign_in` stamps `last_seen_at`/`last_staff_id` only on a correct PIN.
- Vitest: `parseJoinKey` (link, dashed, lower case, wrong length, excluded letters, trailing junk); the
  router's join route; the load path (silent re-join once, `invalid_code` clears the key, no attempt with
  an owner session, network keeps the key); entry screen; devices screen (copy, replace with
  confirmation, remove) through `fakeApi`/`fakeDeviceApi`.

## Rollout

- The migration and the new client go out together: the old client's pairing calls stop existing.
- Every phone paired today keeps working (its `devices` row is untouched). It has no stored key, so the
  first time it loses its session it lands on the entry screen once and needs the link.
- Check in the Supabase dashboard that Auth has no session time-box or inactivity timeout configured for
  the project; if one is set, phones fall back to the silent re-join more often than needed.

## Not verified

- Why a cashier-only phone loses its session today was not reproduced; the causes listed under «Why» are
  the known ones for this setup, not a diagnosis of a specific phone.
- Whether `qrcode-generator` output scans reliably from a printed A6 card and from a screen in dark theme.

## Calls made by the designer (not decided by the owner — check these)

1. The key is stored readable (not hashed) so the same QR can be shown again.
2. 16-character typable key instead of a long random URL token.
3. The phone remembers the key and re-joins by itself.
4. «Αφαίρεση» does not ban a phone; the revoked state is dropped.
5. Devices unused for 30 days are removed automatically when another phone joins.
6. No device-name question at entry; the label is the platform name.
7. Switching to another store's link asks for confirmation.
8. The pairing code is removed entirely rather than kept as a second option.
9. `invalid_code` is reused as the error string for a wrong or replaced key.
10. The server refuses a silent store switch (`other_shop`); the phone asks, then re-sends with `switch`.

Plan: `docs/superpowers/plans/2026-11-11-stage-4-store-link-entry.md`.
