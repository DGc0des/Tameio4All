# Tameio4All

Project notes: read project-notes/index.md first.

Configurable, sellable version of tameioV2 (cash-register closing). Design:
`docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md` (v1) and
`docs/superpowers/specs/2026-11-07-live-closing-and-history-design.md` (stage 2 live closing; its «History
dashboard» and «Owner corrections» sections are stage 3). Plans: `docs/superpowers/plans/` (stage 3:
`2026-11-11-stage-3-history-and-corrections.md`; stage 4 store link entry: `2026-11-11-stage-4-store-link-entry.md`,
spec `docs/superpowers/specs/2026-11-11-store-link-entry-design.md`; stage 5 multiple closings per day:
`2026-11-17-stage-5-multiple-closings-per-day.md`, spec `docs/superpowers/specs/2026-11-17-multiple-closings-per-day-design.md`; stage 6 shop roles: `2026-11-17-stage-6-shop-roles.md`,
spec `docs/superpowers/specs/2026-11-17-shop-roles-design.md`).

## Architecture
- `src/core/` — pure TypeScript money logic. No packages, no DOM, no Supabase. Every UI and
  report computes through these functions. The purity rule is enforced by
  `tests/core-purity.test.ts` (a Vitest check, not a linter).
- `src/features/register/draft.ts` + `derive.ts` — the register's pure model: `Draft` holds raw typed text
  (no `id`/`mode`; entry mode is a per-shop local preference); `deriveClosing(config, draft)` is the only
  bridge from text to money. The draft is never stored on its own any more — it is derived from the live
  closing's fields (`draftFromFields`).
- `src/features/register/live/` — the live shared closing engine. `fields.ts` (field model, key regex, value
  guards, `Snapshot`/`PendingEdit`/`ServerField` types; stage 5: `MAX_CLOSINGS`, `isClosingNo`, `CashMode`/`isCashMode`,
  `sameClosing`), `merge.ts` (pure snapshot + pending edits → draft,
  last-write-wins reducers, the +1 revision rule), `syncEngine.ts` (per-author send queue, replay, stale/wrong_day/
  wrong_closing handling, sign-out `drain`; every edit belongs to one closing, see stage 5),
  `useLiveClosing.ts` (React binding; takes a `Writer`).
- `src/data/local/` — the only code that touches localStorage: theme, `phone.ts` (stored staff session +
  cached device context) and `openClosing.ts` (per shop: cached snapshot, pending edit queue, entry mode).
  Every call is failure-safe; `pickStore()` falls back to memory when storage is unavailable.
- `src/data/remote/` — the only code importing supabase-js. `timeoutFetch.ts` is the client's fetch: every request
  gives up each attempt after `REQUEST_TIMEOUT_MS` = 15 s: RPC calls (POST) fail as `network` after 15 s; GET table
  reads are retried by postgrest-js up to 3× (1/2/4 s waits), so they give up after ≈ 67 s. `owner.ts` (`createOwnerApi`) is the
  one path for owner reads/writes; `errors.ts` maps every failure into the closed `OwnerError`
  union; `client.ts` builds the PKCE client. `supabase.ts` exports `getSupabase()`: the ONE shared
  client (owner and phone use the same instance). `deviceApi.ts` (the `DeviceApi` interface),
  `device.ts` (`createDeviceApi`, the one path for phone reads/writes: context, staff list, `join`,
  sign in/out, open closing, `setField`, submit, `startNextClosing(token, date, closingNo)` (stage 5), suggestions
  (`suggestionData(token)`: needs the staff token))
  and `deviceErrors.ts` (`mapDeviceError` →
  closed `DeviceError`). `live.ts` (`openShopChannel`) is the realtime channel wrapper (private channel
  `shop:<shopId>`: `field`, `submitted` and `closing_started` broadcasts in, presence in/out) plus the shape-checked parsers
  (`parseSnapshot`, `parseServerField`, `parseStaleCurrent`, `parseSubmitInfo`, `parseFieldBroadcast`, `parseClosingStarted`). `history.ts` has the shape-checked parsers of the
  owner history payloads (`parseHistoryList`, `parseDayDetail`; they import `isIsoDate` from `src/app/dates.ts`).
- `src/features/owner/` — owner area (lazy-loaded from `#/owner`): `model/` is pure (settings
  reducer, terms, preview, limits, messages); screens get an injected `OwnerApi`. The shop tabs are
  «Σήμερα» · «Ιστορικό» · «Ρυθμίσεις» · «Προσωπικό» · «Συσκευές». «Σήμερα» (`TodayScreen`, the first tab): the
  owner sees and edits today's live closing through `todayWriter.ts` (`createTodayWriter`, the owner `Writer`
  adapter over `OwnerApi`). A bare shop route still lands on «Ρυθμίσεις». «Ρυθμίσεις» also holds `settings/ClosingPlanCard.tsx`
  («Κλεισίματα ανά ημέρα»: count 1..6 and the cash mode, read with `OwnerApi.closingPlan` from `shops`, saved on its own
  with `OwnerApi.setClosingPlan` → `set_closing_plan`; not part of the published config). «Συσκευές» (`DevicesScreen`) shows the
  store link card (`StoreLinkCard`: link, QR via `QrCode`/qrcode-generator, the code as XXXX-XXXX-XXXX-XXXX, copy,
  print, «Νέος σύνδεσμος» with confirmation) and the device list (last use, last cashier, «Αφαίρεση»).
 Deletion (LG2): «Προσωπικό» «Οριστική διαγραφή» (confirmation sheet → `OwnerApi.eraseStaff`; `listStaff` hides erased
 rows), the last card of «Ρυθμίσεις» `DangerZoneCard` (type the shop name → `deleteShop`, then `clearShop` +
 `clearOwnerDraft` and back to the shop list), and «Διαγραφή λογαριασμού» on the shop list (type the account email →
 `deleteAccount`, which signs out of this browser; every listed shop's local data is cleared).
 Roles (stage 6): the shop list (`my_shops`) carries each shop's role and `myName`; `ShopLayout` shows the tabs of
 `allowedTabs(role)` (owner: all five; manager: «Σήμερα» · «Ιστορικό» · «Προσωπικό» · «Συσκευές»; accountant: «Ιστορικό»)
 and sends a tab the role lacks to `landingTab(role)` (replace); actions by `can(role, …)` (`model/roles.ts`). «Ρυθμίσεις»
 (owner only) holds the «Συνεργάτες» card (`settings/MembersCard.tsx`: invite, link/mailto, role change, removal,
 reissue). `InviteScreen` (`#/owner/invite/<token>`) shows the invite to the signed-in person and accepts it.
- `src/features/owner/history/` — «Ιστορικό» (stage 3, per closing since stage 5): `types.ts` (`HistoryList`/`HistoryDay`/
  `HistoryClosing`/`DayDetail`/`DayClosing`/`ClosingVersion`), pure `model.ts` (`summarizeInputs`/`summarizeOpen`, `weekCells`,
  `breakdown`, `snapshotFromInputs`, `applyLocalEdit`, stage 5 `combineDay`/`summarizeDay`/`summarizeDetail`; every number
  goes through `evaluateTotals`/`planEnvelope`, never throws on unreadable
  stored data), and screens over an injected `OwnerApi`: `HistoryScreen` (Monday–Sunday week of day cards via `weekCells`; «today» only from the server's `listClosings`), `DayScreen` (one
  day: the «Σύνολο ημέρας» card and a closing selector when the day has several closings, then `ClosingView` for the shown
  closing: versions, breakdown, Φάκελος, «Διόρθωση»/«Επαναφορά»), `CorrectionEditor` (edit + save a correction). Routes:
  `#/owner/shop/<id>/history`, `…/history/<YYYY-MM-DD>` and `…/history/<YYYY-MM-DD>/<n>` (closing `n`, 1..6; `router.ts`;
  a malformed date segment is dropped, a malformed closing segment is dropped to the day route; without `n` or with a
  number the day does not have, `DayScreen` shows the highest-numbered closing).
- `src/app/closingLabel.ts` (stage 5, pure): `closingLabel(2)` «2ο κλείσιμο», `closingOfLabel(2, 3)` «2ο κλείσιμο από 3»
  (no «από» for a 1-closing plan; callers then show nothing), `closingsDoneLabel(1, 3)` «1 από 3 κλεισίματα».
  `src/features/register/StartNextSheet.tsx`: `canStartNext` (pure) and the «Έναρξη Nου κλεισίματος» sheet.
- `src/features/phone/` — phone shell (lazy `PhoneEntry` builds the real `DeviceApi`): `model/gate.ts` is the
  pure gate reducer (loading → unconfigured | offline_no_cache | load_error | unpaired → signed_out → ready); `PhoneApp`
  renders only from it; `JoinScreen` (the entry screen: tries a link's key once, or the typed store code; no name/PIN — that is `SignInScreen`), `SignInScreen`.
  `model/load.ts` (`loadGate`, the one load path), `model/join.ts` (`joinStore`, the one join path),
  `model/platform.ts` (`platformLabel`, the default device label). `src/app/joinKey.ts`: `parseJoinKey`,
  `formatJoinKey`, `joinLink`, `parseJoinRoute` (the `#/join/<key>` route). App tests pass `deviceApi={fakeDeviceApi()}`.
- `src/ui/` primitives, `src/features/*` screens and sheets, `src/app/` composition (App, hash
  router, theme, error boundary).
- `supabase/migrations/` — the database (source of truth; applied to the dev project
  `fstfuhogvsdaiwpfdmep` with the Supabase connector). `supabase/tests/` — SQL security tests,
  one rolled-back transaction each (see its README).

## Invariants
- Response headers (CSP etc.) come from `vercel.json`; a new external origin needs a CSP entry there.
- Every Supabase request goes through `timeoutFetch` (set once in `client.ts`). The 15 s is per attempt: RPC calls (POST) fail as `network` after 15 s; GET table reads are retried by postgrest-js
  up to 3× (1/2/4 s waits) and give up after ≈ 67 s. A timeout rejects with the fixed
  message `request_timeout`, which both `mapDeviceError` and `mapError` map to `network` (cross-file: the message in
  `timeoutFetch.ts` and both `NETWORK_RE`). Never add a second client or a raw `fetch`.
- Money is integer cents everywhere in core. Parse with `parseAmount`; display with `formatEuro`
  (UI) — `formatCents` is the plain form.
- `ShopConfig` and `ClosingInputs` both carry a `schema: 1` field (day-zero identifier). Bump it
  whenever the stored shape changes; validators reject a mismatched/missing schema as `bad_shape`.
- Configs and closing inputs are read back as JSON (jsonb / stored rows), so `validateConfig` and
  `validateClosingInputs` both accept `unknown` and never throw on foreign input — they report
  structural problems as `bad_shape`/`bad_id`/`bad_label`/etc. instead. `isShopConfig(x)` is the
  `unknown` → `ShopConfig` type guard built on `validateConfig`.
- Totals are computed only by `evaluateTotals(config, inputs)`. Closings store raw inputs +
  `config_id`, never totals (staff cannot fake a total; old closings keep their formulas).
- Shop configs are immutable versions; a new version is a new row.
- A config must pass `validateConfig` before use; `evaluateTotals` throws `ConfigInvalidError`
  otherwise, then `ClosingInputsInvalidError` if `validateClosingInputs` finds a problem.
- Envelope (Φάκελος) is computed only by `planEnvelope`, fed computed totals — never UI text.
  Exact up to ~20 000€ (`MAX_UNITS` at 5c units); best-effort above that.
- Staff/PINs are never part of `ShopConfig` (server-side table only).
- No shop's data ships in the code: expense suggestions are learned per shop from its own submitted
  expense lines via `buildSupplierHistory` (30 most recent amounts per supplier). Never add a
  hardcoded supplier list.
- Components never parse or add money: text → cents via `deriveClosing`/core, display via `formatEuro`.
- The Z photo is attached to the share only — never stored (not on the device, not on the server).
- Database: RLS on every table, `anon` gets nothing, phones have no direct table access (server
  functions only), every function is `security definer` + `search_path = ''` with execute for
  `authenticated` only. Identity only from `auth.uid()`/`auth.jwt()`.
- `ClosingInputs.schema` is 2 for new closings (`CLOSING_INPUTS_SCHEMA`): each expense carries `id` and `addedBy` (`{kind:'staff',id}` | `{kind:'owner'}`); schema 1 rows stay readable. `validateClosingInputs` enforces the schema-2 expense rules as `bad_shape`; a draft expense with no author (pre-sign-in) is blocked from submit by `submitBlockReason`.
- Owner caps (migration `20261114000004`): 20 shops per owner (`too_many_shops`), 100 staff rows per shop, active or not (`too_many_staff`), 50 config versions per shop created in the last 24 h (`too_many_versions`); each raised with errcode 22023 by `create_shop`/`create_staff`/`publish_config` under a lock, each with a `mapError` case and a Greek `ownerErrorMessage`.
- Cross-file invariant: the closing `inputs` shape is defined by `ClosingInputs` (src/core) AND
  checked by `private.inputs_shape_ok` (SQL). Bumping `schema` or changing the shape needs a new
  migration updating that check, or phones' submissions will be refused as `bad_inputs`.
- Schema 2 is a cross-file invariant: `validateClosingInputs` and `private.inputs_shape_ok` both accept 1|2;
  `submit_closing` accepts only 2 (`bad_inputs` otherwise); schema-2 expenses need `id` (1–64 chars) and `addedBy`
  (`{kind:'staff',id: uuid of a staff of the shop}` or `{kind:'owner'}`); `submit_closing` further requires each line to
  be a live, not removed `e:<id>` field of the closing it names, with that same author (`owner_save_closing` checks a stored author only for lines of the **live** closing (today, highest number) that exist as an `e:<id>` field; for past days, for earlier closings of today and for live-closing lines with no `e:<id>` field it keeps the staff-of-the-shop rule, owner lines allowed). Change one side and the other needs a
  migration/commit in the same change.
- **Erasure** (migration `20261115000001_erasure`, LG2). `owner_erase_staff(staff)` keeps the staff row as a
 permanent tombstone (closings reference it): name «Διαγραμμένος υπάλληλος <first 8 hex of the id>», `pin_hash` null,
 inactive, lock state cleared, `erased_at` set; its sessions and trust rows are deleted, `devices.last_staff_id` cleared,
 and `last_submit.staff_name` of its submits rewritten. An erased row is never updated again (`staff_owner_update`
 requires `erased_at is null`; `set_staff_pin`/`unlock_staff` answer `not_owner`); it still counts toward the 100-staff
 cap. Cross-file invariant: the placeholder text is produced only in SQL; the client never builds it. `closings` rows
 leave the database only with their whole shop: `owner_delete_shop(shop, typed name)` (`confirm_mismatch` 22023 unless
 the trimmed name matches exactly) and `owner_delete_account()` go through `private.delete_shop`. It keeps the shop's
 anonymous phone users (a phone reuses its stored token; with its user deleted its next `join_shop` would fail on
 `devices.user_id`); the purge removes them once storeless and idle. `owner_erase_staff` locks the shop `for no key
 update` (a concurrent `staff_sign_in` holds device + staff and needs a key-share lock on the shop). The daily `pg_cron` job `purge_stale` (03:30 UTC, `private.purge_stale`) deletes staff
 sessions older than 90 days and anonymous users older than 30 days with no `devices` row and no auth session used in
 30 days. Residual: realtime broadcast payloads (`updated_by_name`, `staff_name`) already sent stay in
 `realtime.messages` until Supabase drops the partition; free-text expense descriptions are not scanned.
 `confirm_mismatch` has a `mapError` case and the Greek message «Το όνομα δεν ταιριάζει. Γράψε το ακριβώς όπως φαίνεται.».
 `clearShop(store, shop)` (`data/local/openClosing.ts`) removes a deleted shop's queue (every author's), snapshot and
 entry mode.
- Internal `private.*` helpers are not callable by clients, except `private.is_shop_owner`,
  `private.can_use_shop_topic` and (stage 6) `private.shop_role` (all executable by `authenticated`; row-level security /
  realtime policies need them; each only answers about the caller's own access).
- Database: a new table or function in `public` needs an explicit `revoke … from public, anon` (default
  privileges still grant new objects to anon/authenticated); table grants chosen deliberately.
- Owner functions report "not yours" and "doesn't exist" the same way (`not_owner`), so ids can't be
  probed; there is no `staff_not_found` error from owner functions (only phone functions return
  `staff_not_found`).
- **Store link entry (stage 4).** A phone enters a store only through `join_shop(key, label, switch)`. The store
  key is the only thing that lets a browser list staff or try a PIN. The link is `<origin+pathname>#/join/<key>`
  (the key sits in the hash, so it never reaches the hosting server).
- The key lives in `shop_join_keys` (one per shop, no client table access), readable only through
  `owner_get_join_key` (created on first use); replacing it (`owner_rotate_join_key`) removes every device and ends
  every staff session of the shop.
- «Αφαίρεση» (`owner_remove_device`) is cleanup, not a ban: there is no revoked state any more (revoked rows were
  deleted by the migration and nothing sets `revoked_at`). A phone that still has the key can come back. The
  pairing code (`pairing_codes`, `create_pairing_code`, `redeem_pairing_code`) is gone: no second way into a store.
- `join_shop` raises `not_a_device_session` (42501, not an anonymous session), `invalid_code` (22023, unknown key)
  and `other_shop` (22023): a phone already in another live store must pass `p_switch = true`, which the phone sends
  only after «Αλλαγή καταστήματος;». Joining the same store again is one row; switching ends that phone's staff
  sessions. Every join deletes the shop's *other* devices unused for 30 days (`coalesce(last_seen_at, created_at)`);
  `staff_sign_in` stamps `last_seen_at`/`last_staff_id` after a correct PIN only.
- Cross-file invariant: the key format `^[A-HJ-NP-Z2-9]{16}$` is produced in SQL (`private.new_join_key`, the
  `shop_join_keys.key` CHECK) and checked by `parseJoinKey` (`src/app/joinKey.ts`). Every client input path (link
  route, pasted link, typed code) goes through `parseJoinKey`; it maps Greek look-alike capitals to Latin.
- `joinStore` (`model/join.ts`) is the only client code calling `DeviceApi.join`: it stores the key after a
  successful join and forgets it when the server refuses that same key (`invalid_code`).
- `loadGate` (`model/load.ts`) is the one load path. Automatic re-join happens only there, at most once per load,
  with the stored key, and never while an owner session is present. Gate rule: a `server_error` `not_a_device` while
  `ready`/`signed_out` goes to `loading` carrying the not-in-store notice (so the silent return runs); a load that
  then finds no store shows that notice on the entry screen. `invalid_code` on load → the entry screen with «Ζήτα
  τον νέο σύνδεσμο».
- A non-UUID id sent to any function fails with a Postgres type error before the function runs (nothing
  is changed).
- `staff_sign_in` / `submit_closing` / `set_closing_field` return `{ok:false,error}` for expected failures — never
  raise there (a raise rolls back the PIN lockout counters). `staff_sign_in` is the only PIN entry point
  (`verify_staff_pin` was dropped, L93); every PIN goes through `private.check_staff_pin`.
- **PIN lockout** (migration `20261114000003_pin_lockout`, H24/M39). A phone is *trusted for a cashier* once that
  cashier entered a correct PIN on it (a `device_staff_trust` row, written inside `check_staff_pin`; no client
  table access). Wrong PINs are counted on two tracks:

  | Phone is… | Wrong PIN is counted on | At 5 wrong | Blocks |
  |---|---|---|---|
  | not trusted for this cashier | `staff.failed_attempts` | the **cashier** is locked (`staff_locked`) | only phones not trusted for this cashier |
  | trusted for this cashier | `device_staff_trust.failed_attempts` | the **phone** is locked (`device_locked`) | everyone on that phone |

  Both results carry `locked_until`; the phone shows «Δοκίμασε ξανά στις HH:MM» (shop time; «αύριο στις HH:MM» when it
  ends on a later Athens calendar day, «στις DD/MM HH:MM» beyond that — `athensDaysAfter` in `src/app/dates.ts`) and
  stays on the sign-in screen; `device_locked` also tells the cashier the owner can free the phone with «Αφαίρεση» in
  «Συσκευές» (the owner UI does not show device locks). Lock time escalates through `private.lock_duration(level)` = `least(15 min · 2^least(level, 7),
  24 h)` → 15 m, 30 m, 1 h, 2 h, 4 h, 8 h, 16 h, then 24 h (`staff.lock_level` / `devices.lock_level`); the level
  restarts at 0 when the previous lock ended more than 7 days ago (or there was none). **A correct PIN never clears
  `locked_until` or `lock_level`** (an expired lock is harmless and the level must survive); it resets only its own
  track's counter. `unlock_staff`/`set_staff_pin` reset the cashier's counter, lock and level; «Αφαίρεση»
  (`owner_remove_device`) deletes the device row and with it its lock and trust rows (cascade); a `join_shop` that
  moves a phone to another shop deletes its trust rows and clears its lock. **Lock order device → staff**:
  `check_staff_pin` locks the `devices` row `FOR UPDATE` first, then the `staff` row; any function that locks both
  must keep that order. Residual, accepted: an outsider can keep a cashier locked on phones that cashier has never
  used (the way out is «Νέος σύνδεσμος»); a phone locked for a long time is freed by «Αφαίρεση» (it re-joins
  untrusted); a locked trusted phone can also shed its lock by clearing its site data or switching to another shop and
  back (a new device row, no trust rows), after which its tries count on the cashier track — no better for an attacker
  than the outsider path, so accepted.
- **Staff PIN = exactly 6 digits** (migration `20261114000006_six_digit_pins`, H24). Cross-file invariant: the format
  `^[0-9]{6}$` lives in `private.check_pin` (used by `create_staff`/`set_staff_pin` → `bad_pin_format`), in the regex
  inside `private.check_staff_pin`, and in the client (`isPin`/`PIN_LENGTH` in `src/features/owner/model/limits.ts`,
  used by `OwnerStaffScreen` and `SignInScreen`) — change them together. `staff.pin_hash` null = no PIN set:
  `check_staff_pin` answers `pin_not_set` right after the `device_locked` check, before any comparison (required:
  `crypt(pin, null)` is null and would fall through to the correct-PIN path) and never counts, locks or trusts; the
  phone stays on the sign-in screen («Δεν έχει οριστεί PIN…»). The owner sees it through the generated column
  `staff.has_pin` (column select grant like the other staff columns; `pin_hash` stays unreadable) as «Χωρίς PIN —
  όρισε νέο». The 2026-11-14 cutover cleared every PIN and revoked every live staff session (trust rows, lock times
  and levels kept): the owner sets a new PIN for each cashier.
- Owner screens never call supabase directly — only through `OwnerApi`; UI tests use
  `tests/features/owner/fakeApi.ts` and never load supabase-js.
- Auth uses PKCE with `detectSessionInUrl: false`; email links return as `?auth=signup|recovery&code=…`
  and `OwnerApp` exchanges the code exactly once. Redirect URLs must be allow-listed in the Supabase
  dashboard.
- Shared-browser rule: signing in as owner in a browser holding an anonymous (paired phone) session
  unpairs it; the login/signup screens require explicit confirmation.
- A new server error string needs a case in `mapError` and a Greek message in `ownerErrorMessage`, or
  it surfaces as «Κάτι πήγε στραβά».
- `publish_config` conflicts are never retried automatically; the owner chooses «Φόρτωση νέας» or
  «Δημοσίευση πάνω της».
- The settings preview computes only through `previewTotals` → `evaluateTotals`.
- Theme (`src/app/theme.css`): frosted glass over midnight/pale backgrounds; electric blue = actions,
  cantaloupe (`--hl`) = key numbers. `.share-card` must stay opaque (`--solid`) — `shareCard` renders it
  to a PNG using its computed background. Glass panels use `backdrop-filter`, which traps
  `position: fixed` children, so `Sheet` renders through a portal to `<body>`; keep any new fixed overlay
  out of glass containers the same way.
- Business day: the shop's business date comes only from `private.business_date` (Europe/Athens, the owner's
  day-change time, default 04:00; a new time takes effect from the next business day, via
  `prev_day_change_time`/`day_change_switch_at`). The phone never computes it; it reads `business_date` from
  `device_context()` and `staff_sign_in`.
- Staff session (`staff_sessions`): `staff_sign_in` verifies the PIN and returns a random token; only its sha256
  is stored (the PIN is never stored; the raw token only lives on the phone). One live session per phone (a new
  sign-in revokes the phone's earlier ones), valid for its business date only; it dies on sign-out, device
  revocation or staff deactivation. Phone functions authorize from the token + `auth.uid()`, never a
  client-sent staff or shop id. Phones cannot read `staff_sessions`/`device_staff_trust` or call `private.*`.
- Phone: a stored `StaffSession` is used only when its `shopId` and `businessDate` match the device context;
  it is saved while the gate is `ready` and cleared on `signed_out`/`unpaired`. The gate entering `loading` is the
  one reload path (PhoneApp runs `loadGate`): after joining, after a sign-in that was offline or doesn't match
  the context, on `session_invalid`/`wrong_day` (which also clear the stored session), and on the gate's `retry`
  (while offline: the `online` event, the page becoming visible, «Δοκίμασε ξανά»; also from `load_error`). Load
  order: `session()` first — only a lookup that succeeded with no session means unpaired (stored session + cached
  context cleared); a failed lookup is "couldn't tell" (auth-js returns `{session:null, error}` when an expired
  access token can't be refreshed offline) and falls through to `context()`. `join` refuses on a failed lookup. Only a `network` failure falls back to the cached context (offline); `device_revoked`/
  `not_a_device` (incl. Postgres 42501) go to the entry screen (after the one silent re-join attempt); any other failure is `load_error` (message + retry, never a cached
  register). A phone in a store with nobody signed in renders only the sign-in screen (no register fields, no amounts).

### Live shared closing (stage 2)
- **Open closing.** One row per shop per business day **per closing number** in `open_closings` (+ `open_closing_fields`;
  unique `(shop_id, business_date, closing_no)` since stage 5). Closing 1 is created by `private.open_closing_for` on
  first use (`get_open_closing`/`owner_get_open_closing` or a write); later ones only by `start_next_closing` (see
  «Multiple closings per day (stage 5)»). Its config is **pinned** at closing 1's creation (`config_id`) and copied to the
  day's later closings: a publish later the same day does not change today's closings. The snapshot returned to clients
  carries `config`, `config_id`, `business_date`, `revision`, `fields[]`, `last_submit` and (stage 5) `closing_no`,
  `closings_planned`, `cash_mode`; the register takes its config from it, not from `device_context`. No client has
  direct table access.
- **Field model** (`fields.ts`; values are strict shapes — no missing and no extra properties; `text` ≤ 200
  Unicode code points):

  | Key | Value |
  |---|---|
  | `d:<cents>` (`[0-9]{1,6}`) | `{text, mode: 'amount'\|'count'}` |
  | `c:<channelId>` (`[A-Za-z0-9_-]{1,40}`) | `{text}` |
  | `e:<id>` (`[A-Za-z0-9-]{1,64}`) | `{addedBy, order, removed}` (line meta) |
  | `e:<id>:d` / `e:<id>:a` | `{text}` (description / amount; only after `e:<id>` exists) |

- **Cross-file invariant: field keys and values.** The key regex `^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$`
  and the exact key sets/value shapes live in SQL (`private.closing_field_ok`, migrations `…0001`, `…0001b`)
  AND in `fields.ts` (`KEY_RE`, `isFieldValue`, `parseKey`). Change one side → new migration + same
  commit. Length is counted in code points (`char_length` in SQL; the TS guard must count the same way, not
  `.length`). The SQL regex is looser than TS in one place: it accepts non-canonical keys such as `d:0100`;
  `parseKey` rejects them, so a bad field must be dropped individually when parsing a snapshot, never null the
  whole snapshot.
  The regex (`closing_field_ok`) still accepts `d:0100`, but the write path (`write_closing_field`, migration
  `20261114000005_closing_field_limits`) now rejects non-canonical and out-of-config `d:`/`c:` keys (`bad_field`: the
  denomination must be in the pinned config's `denominations`, the channel id in its `channels`; junk config JSON
  accepts nothing) and caps total `e:<id>` lines at `maxExpenses × 5` including removed ones (`too_many_expenses`).
- **Cross-file invariant: `maxExpenses` is a JSON integer 0..30.** The rule lives in `validateConfig`
  (`src/core/config.ts`, `bad_max_expenses`) AND in `private.check_config` (`bad_config` from `create_shop`/
  `publish_config`; a config without the key is still accepted there and read as 0) — change them together (migration
  `20261114000007_max_expenses_clamp`). Stored configs are untrusted (older rows, rows written as the migration owner):
  the server reads `maxExpenses` only through `private.max_expenses(config)` (never raises; a JSON integer of at most
  9 digits → clamped to 0..30, anything else → 0), which `write_closing_field` uses for both caps (visible lines ≤ max,
  all `e:<id>` rows ≤ max × 5). Its `jsonb_array_elements` calls take `[]` unless the config value is an array, so no
  junk config makes a field write raise.
- **One write path.** Phones write only through `set_closing_field(token, date, key, value, base_version, closing_no default 1)`, owners
  through `owner_set_closing_field(shop, date, key, value, base_version, closing_no default 1)` (date rule from migration
  `…0003_live_fixes`, the closing number from `20261117000001_multi_closing`; the date is
  the snapshot's — the day on screen — and anything but the shop's business date is `wrong_day`, like the phone; a closing
  that is not the live one is `wrong_closing`).
  Both go through `private.write_closing_field(shop, staff, owner, closing_no, key, value, base_version)` (latest body:
  `20261117000001_multi_closing`; the 6-argument form was dropped), which validates, stamps the author
  (expense `addedBy` is set server-side on creation and kept on later writes), bumps the field `version` and the
  closing `revision`, returns `{ok:true, version, revision, value}` — `value` is what was **stored** (the client's
  ack applies it, never only what it sent: the author may differ) — and broadcasts a `field` event on `shop:<shopId>` **inside the function** (`realtime.send`,
  private). Clients may insert only `presence` rows into `realtime.messages` (policy: `extension = 'presence'`
  and `can_use_shop_topic`); they can never forge a `field`/`submitted` broadcast. Never add another write path.
- **Last-write-wins + optional stale check.** A write with `base_version = null` always lands (LWW); a write with
  a base that is older than the stored version returns `{ok:false,error:'stale',current}` and changes nothing.
  Rejected writes do not bump `revision`. The expense cap (`maxExpenses` of the pinned config) counts visible
  (not removed) lines; creating or un-removing a line needs a free slot (`too_many_expenses`).
- **Offline replay.** The client keeps a pending edit queue per shop (`data/local/openClosing.ts`), each edit with
  its `baseVersion` and its **author** (`PendingEdit.author`: the cashier's staff id, or `office:<uid>` for an
  office-side person since stage 6 (`officeQueueAuthor`); the old `'owner'` author is never sent again); replay sends them in order. **The queue is per author:** an engine (`EngineState.author`, from
  `useLiveClosing`'s `me.id`) loads, shows and sends only its author's items — they go out with that person's
  credentials, so cashier A's unsent edits are never sent as cashier B, nor the owner's as a phone's in a shared
  browser. Other authors' items stay stored, hidden; `savePending(store, shop, author, mine, currentDate)` is a
  read-modify-write that keeps them and drops other authors' items of a day before `currentDate` (unsendable).
  An item stored without an author (pre-tagging) fails the shape check and is dropped. **Sign-out** drains first:
  `drain(SIGN_OUT_DRAIN_MS = 3000)` flushes typing and waits until nothing of the day is queued or in flight (at
  once `false` when offline/halted), then `staff_sign_out`; whatever is left stays stored under the cashier. A persisted item whose base was `null` gets a base from the
  reloaded snapshot on startup (otherwise a replay after a remount would silently overwrite a newer value).
  `stale` → adopt the server value (a stale write with the same value counts as an ack), `network` → keep and
  retry (fixed 3 s, no backoff), `wrong_day` (phone and owner) → drop edits of the old day, tell the person, resync,
  `wrong_closing` (phone and owner, stage 5) → drop this author's edits of that closing, `WRONG_CLOSING_NOTICE`, resync,
  `bad_field`/`too_many_expenses` → drop the item, notice, resync; any other error (`session_invalid`,
  `device_revoked`, …) → keep the item, halt the engine and call `onFatal` (phone: `onServerError` → gate; owner:
  `ownerErrorMessage`). A halted engine reports non-live; `restart()` resumes it.
- **Revision: the +1 rule.** The local `snapshot.revision` (what Υποβολή sends) means "every write up to here is
  in this snapshot". It advances only when an ack or broadcast carries exactly `revision + 1` (whether or not that
  field was newer than ours — a superseded write still counts); a higher one is a gap (a broadcast late or lost):
  the field is applied by its own version rule, the revision is kept, and the engine resyncs. A load takes the
  higher of its revision and ours (ours is always complete, and the merge keeps our newer fields). Never use
  `max` on an ack/broadcast revision: a submit could then pass the server's revision check without a write the
  phone never saw. A wrong guess costs at most one extra `draft_changed`.
- **`useLiveClosing`** needs stable `store`, `shopId`, `me.name` and `me.id` (they are effect dependencies — an
  inline object restarts the channel on every render; RegisterScreen memoizes `me`). Do not render boxes while the
  draft is `null` (no snapshot yet). RegisterScreen, while the gate is online, also treats a cached snapshot whose
  `businessDate` is not `ctx.businessDate` as no snapshot (startup shows «Φόρτωση…», never yesterday's boxes:
  anything typed there would be tagged with the old day and dropped).
- **Channel.** At most one live channel per shop on the shared client at a time: close before reopen
  (`openShopChannel` waits for the old same-topic channel to leave; two simultaneous wrappers for one shop clash).
  Authorization = private channel + `realtime.messages` policies calling `private.can_use_shop_topic(topic)`:
  owner of the shop, or a phone with a live staff session in that shop. A revoked phone / deactivated cashier /
  signed-out token loses **writes** at once (every call re-checks the session) and cannot **join** the channel.
  Known limit: Realtime checks the policy at channel join (and on token refresh), not per message — a client
  already joined keeps *receiving* broadcasts until it rejoins or its access token is refreshed. Likewise an idle
  phone keeps showing yesterday's numbers after the day change until something makes it resync (a write, a
  broadcast of the new day, a reconnect, a reload).
  Known clash: an owner signing in on a paired phone's browser leaves the register mounted-but-hidden, so opening
  «Σήμερα» for the same shop there would open a second channel on one topic (see `live.ts`).
- **Presence** (who is looking at the register, `name` only) is the only thing clients publish directly.
  Presence `track()` is throttled in `openShopChannel` (`PRESENCE_MIN_INTERVAL_MS` = 1 s, latest focus only): Supabase
  closes the channel of a client that tracks too often (`ClientPresenceRateLimitReached`, H25). Never call `track` per
  keystroke/focus without the throttle. realtime-js never rejoins a server-closed channel; `openShopChannel` reopens a
  fresh one after `REOPEN_AFTER_CLOSE_MS` = 10 s (errors/timeouts are rejoined by realtime-js itself).
  Owner presence name is «Ιδιοκτήτης». Presence names are self-declared by clients (cosmetic only; nothing
  trusts them — authorship of fields comes from the server).
- **Submit.** `submit_closing(token, config_id, date, inputs, revision, key, closing_no default 1)` (latest body:
  `20261117000001_multi_closing`; the 5-arg stage-1 and the 6-arg stage-2 forms are gone).
  Order of checks: session → config of the shop / date/inputs → idempotency-key lookup (a repeat is answered before
  anything else; it must also match `closing_no`) → `wrong_day` → lock the live closing → `wrong_closing` (not the live
  closing) → `config_mismatch` (config must be the closing's pinned one) → revision. A `revision` that is not
  exactly the current one (including `null` or a future value) → `{ok:false,error:'draft_changed',revision}`,
  nothing stored. A successful submit stores a `closings` row, records `last_submit` on the open closing and
  broadcasts `submitted`; the open closing and its fields are kept (resubmit with a new key stores another
  row). The revision proves the client saw the latest fields; it does not prove `inputs` equals the merged
  fields (same trust as stage 1: the phone is the authenticated cashier).
- **Submitted lines must exist in the live closing (M40).** Every expense of `submit_closing` needs an `e:<id>` field
  in the open closing that is not `removed`, and its `addedBy` must equal that field's stored author (owner or staff).
  There is no fallback for an id with no field (the stage-1 rule is gone: an invented line is `bad_inputs`). Authors
  stay server-attributed. A retry of an already stored submit is answered by the idempotency lookup before this check.
- **Idempotency key** (client): minted when the submit sheet opens, kept while the inputs are unchanged and not
  yet acknowledged (retry / reopened sheet reuse it); an edit, a successful submit, or `draft_changed` makes the
  next opening mint a new key. `draft_changed` (and, stage 5, `wrong_closing`) is not a failure: it does **not** go to
  `onServerError` (the sheet resyncs and asks the cashier to review); every other submit/suggestion failure does (the gate decides).
  The sheet freezes `{draft, derived, revision, configId, closingNo}` when it opens and submits exactly that
  (`SubmitTarget`), never the register's current snapshot. The
  register submits only through `DeviceApi.submit` as the signed-in cashier; nothing is stored as a local
  "submission".
- **Wrong day.** The server only accepts writes and submits for the session's business date (owner writes: the
  shop's business date) (`wrong_day`); nothing is silently written to another day. The client drops wrong-day pending edits with a visible notice.
- **Local keys.** Owner and phone share the `openClosing` local keys per shop in one browser (same shop → same
  cached snapshot; one queue key holding everyone's items, each engine using only its author's). Stage-1 keys `draft`, `draft-submitted`, `unsent` are no longer read or written
  (`drafts.ts`/`useDraftAutosave`/the unsent-draft notice were removed); they may linger on devices that ran
  stage 1 and are harmless.
- Expense suggestions come from `DeviceApi.suggestionData(token)` (refetched after each successful submit); the owner
  Today view has no suggestion history. `expense_suggestion_data(p_token)` checks `private.staff_session` first and returns
  no rows (never raises) without a live session; the shop comes from the session. Without a live staff session a phone can
  read only the shop name, the config and the staff names. Since stage 5 the rows come from the current version of every
  closing of a day, except a `running` day (see stage 5), which contributes only its highest-numbered closing. An `unknown` or `network` suggestion failure never blocks the register (the gate ignores both, e.g. an old build calling
  the dropped zero-argument form); `session_invalid`/`wrong_day`/`not_a_device`/`device_revoked` from it go to the gate like
  any other phone call.
- **Owner «Σήμερα»** shows the same boxes, totals and Φάκελος as the register: it reuses `LiveClosingView`, the
 register's `BottomBar` (without `onSubmit` there is no Υποβολή button) and `EnvelopeSheet` over the same
 `deriveClosing` → `planEnvelope` result. No Υποβολή from the owner; once a cashier has submitted, the owner can
 record later changes with «Καταχώρηση αλλαγών» (see «The live closing's versions» below). It shows the snapshot's business date
 and renders a snapshot only when its `businessDate` equals the one of the last successful load in this mount (no
 cached closing of another day, none while offline at startup).
- **`last_submit.revision`** (migration `…0003_today_save_and_submit_revision`): the open closing's revision at that
 submit. `changedSinceSubmit(snapshot)` (`fields.ts`) = `revision > lastSubmit.revision` → «Άλλαξε μετά την υποβολή»
 on the phone header and «Σήμερα». Absent on older rows (`SubmitInfo.revision` optional) → no notice. Since stage 5
 `last_submit` (and the `submitted` broadcast) also carries `closing_no` (`SubmitInfo.closingNo`, optional: absent = 1).

### Closing history (stage 3)
- **`closings` is an append-only version log.** A correction inserts a new row and never updates or deletes
  one. The only owner-writable column is `voided_at` (column grant + `closings_owner_update` policy from Plan 3); no
  UI sets it, and voided rows are invisible everywhere. Columns (migration `20261111000001_closing_versions`): `seq` (identity, unique, back-filled in
  `created_at, id` order), `kind` (`'staff'` | `'owner_correction'`), `corrected_by`, `corrects_closing_id`
  (the version it replaced). `closings_kind_shape`: a `staff` row has `staff_id` and `device_user_id` and no
  `corrected_by`/`corrects_closing_id`; an `owner_correction` row has `corrected_by` and neither `staff_id` nor
  `device_user_id` (both are nullable now).
- **Current version of a closing = the non-voided row with the highest `seq`** for (shop, business date, `closing_no`)
  (per closing since stage 5; before, per day) — `private.current_closing(shop, date, closing_no)` is the helper (the
  2-argument form was dropped in `20261117000002_multi_closing_history`). `owner_list_closings` and the save guard
  (`owner_save_closing`) use it; `expense_suggestion_data(p_token)` (staff token required, `distinct on (business_date,
  closing_no) … seq desc`) and `owner_get_closing_day` (versions per closing, `seq desc`) repeat the same rule inline —
  change all together. Never order versions by `created_at` (100 T1 backdates one to prove it).
- **Totals are never stored or computed in SQL**: every number in history comes from `evaluateTotals`/
  `deriveClosing`/`planEnvelope` with the config of that version (`config_id`; the day detail carries every
  version's config, the list only the current versions'). Stored `config`/`inputs` are untrusted: they go
  through `isShopConfig`/`validateClosingInputs`; a version that fails shows «Δεν διαβάζεται» and never hides
  the other rows.
- **Read path.** `owner_list_closings(shop, from, to)` (default: last 30 days up to the shop's today; `to − from`
  over 366 days or `from > to` → `bad_range`) and `owner_get_closing_day(shop, date)`; both
  `private.require_owner` first. The owner's browser never computes the business date: `today`, `from` and `to`
  come from the response.
- **Unsubmitted closing** (per closing since stage 5; was «unsubmitted day»): an `open_closings` row of the shop with
  `business_date` before the shop's business date, at least one `open_closing_fields` row, and no non-voided `closings`
  row for that date **and closing number**. The list shows it as a `status:'unsubmitted'` entry of its day; in the day
  detail a closing's `open` is set only when its `versions` is empty (and only such closings of a past date are listed
  without versions). A day can mix submitted and unsubmitted closings.
- **One owner write path: `owner_save_closing(shop, date, config_id, inputs, expected_current_id, key, revision default null, closing_no default 1)`**
 (latest body: `20261117000002_multi_closing_history`; the 6- and 7-argument forms were dropped). Check order: `require_owner` → `bad_inputs` (key 1–100
  chars, `closing_no` 1..6, `private.inputs_shape_ok`, `schema` exactly 2, every `{kind:'staff'}` expense author is a staff row of
  *this* shop, active or not; owner lines are fine) → idempotency lookup (same key + owner row + same inputs/
  config/date/`closing_no` → `repeat:true`; else `idempotency_conflict`) → advisory lock on the day **and closing**
  (`closing-day:<shop>:<date>:<n>`), then that closing's `open_closings … for
  update` (so it serializes with a staff submit) → **the idempotency lookup again, under the locks** (a concurrent
  same-key retry gets `repeat`, not `closing_changed`) → a date after today → `no_closing_day` → is it the live closing
  (today and that row is `private.open_closing_for`'s) → current-version guard on `current_closing(shop, date, closing_no)`: when a current exists
  `expected_current_id` must equal it (`closing_changed` + `current_id` otherwise) and `config_id` must be its
  `config_id` (`config_mismatch`); when none exists `expected_current_id` must be null (`closing_changed`, `current_id`
  null) and the closing must be an unsubmitted, non-live closing with at least one field (`no_closing_day`) with `config_id` = its open closing's pinned
 one (`config_mismatch`) → live closing only: `config_mismatch`, `draft_changed`, stored authors → insert `owner_correction`
 with `closing_no` (`corrects_closing_id` = the replaced current, null for a first
 filing) `on conflict (shop_id, idempotency_key) do nothing` and answer a lost same-key race like the lookup.
 A date after the shop's business date → `no_closing_day`. Never add another owner write path for closings
 (`submit_closing` is the staff one).
- **The live closing's versions come only from the live closing.** Since stage 5 this rule applies to the **live**
 closing only (today's highest number); an earlier closing of today is corrected like a past day (next bullet). For the
 live closing a current version must exist
 (`no_closing_day`; the owner never files it first), `revision` must equal its open closing's (`draft_changed`
 + revision, nothing stored), a line that exists as `e:<id>` must carry its stored author (`bad_inputs`), and a
 successful save sets `last_submit` (`staff_name` «Ιδιοκτήτης», with `revision`) and broadcasts `submitted`. So a
 later cashier resubmit is built from the same live fields and cannot silently drop the owner's change. The UI:
 «Καταχώρηση αλλαγών» in «Σήμερα» (shown while `changedSinceSubmit`; guarded on `lastSubmit.closingId`, idempotency
 key kept while the inputs are unchanged; the remembered newer version after `closing_changed`, `expectedOverride`
 = `{forSubmit, closingNo, id}`, is used only while `forSubmit` equals the current `lastSubmit.closingId` and `closingNo`
 the snapshot's; the save key `{key, inputs, closingNo}` is re-minted for another closing); `ClosingView` offers no
 «Διόρθωση»/«Επαναφορά» for the live closing (`businessDate === today` **and** `closingNo === liveClosingNo`, both from the
 server; it shows «Οι σημερινές αλλαγές γίνονται από «Σήμερα».»). Earlier closings of today get both. Edits made after a
 submit and never re-saved are still not in history (only flagged).
- **Owner saves of a non-live closing (a past day, or an earlier closing of today) are isolated from the live closing**:
 they do not touch `open_closings` (`revision`, `last_submit`), write no `open_closing_fields` and broadcast nothing. Staff
 still submit only for the shop's business date and its live closing.
- **`closing_changed` is never retried automatically.** `CorrectionEditor` shows a sheet: «Φόρτωση νέας» (refetch
  the day; the editor remounts on the new current version, the owner's local edits are dropped) or, when the
  error carries a `currentId`, «Αποθήκευση πάνω της» (resend the same inputs guarded on that newer version). The
  idempotency key is kept across retries of the same inputs and re-minted by every edit and after `closing_changed`.
  `config_mismatch` offers «Φόρτωση νέας» only.
- **The correction editor is local.** It starts from `snapshotFromInputs` (the current version) or the
  unsubmitted closing's open snapshot, applies box edits with `applyLocalEdit`, derives through `deriveClosing`
  (blocked by `envelopeBlockReason`, and by «Δεν άλλαξε κάτι» for an unchanged correction) and saves through
  `OwnerApi.saveClosing`. It never uses `useLiveClosing`, the sync engine or `setTodayField`; no field is sent
  per edit. Existing expense lines keep their `id` and `addedBy`; lines the owner adds are `{kind:'owner'}`;
  new closings are `ClosingInputs` schema 2. Editing always starts from the **current** version, never a
  selected older one.
- **Change marks and «Επαναφορά» (DayScreen).** An owner correction is shown against its original: the newest
 `staff` version older than it (`originalOf`); `diffBreakdown` marks changed/added/removed lines with the original
 value, and the header names the original submitter. «Επαναφορά» on an older version re-saves its inputs through
 `OwnerApi.saveClosing` (guarded on the current id of the same closing; offered only for a closing that is not the live one, the current `config_id`, schema 2
 and inputs that differ from the current) — a new `owner_correction` row, nothing is deleted.
- **Cross-file invariant: history payload shapes.** `private.closing_version_json` and the `owner_list_closings`/
  `owner_get_closing_day`/`owner_save_closing` results are parsed by `history.ts` (`parseHistoryList`,
  `parseDayDetail`) and `owner.ts` (`saveClosing`):
  - `version` = `{id, kind, author_name, created_at, config_id, inputs, corrects_closing_id|null}` (`author_name`
    = the staff's name, or «Ιδιοκτήτης» for an owner row);
  - `list` (stage 5) = `{ok, today, from, to, configs:{<config_id>:config}, days:[{business_date, cash_mode,
    closings_planned, closings:[entry…] (closing_no ascending)}]}`, newest day first; `entry` = `{closing_no,
    status:'submitted', version_count, current:version}` | `{closing_no, status:'unsubmitted', open:<closing_snapshot>}`;
    a day without a closing-1 open closing (rows from before stage 2) reports `'separate'` and
    `closings_planned` = its number of distinct closings;
  - `day` (stage 5) = `{ok, today, business_date, cash_mode, closings_planned, live_closing_no (today's highest open
    closing number when the date is today, else null), closings:[{closing_no, versions:[version…] (seq desc, [0]
    current), open: <closing_snapshot>|null (only when versions is empty)}] (closing_no ascending; may be empty),
    configs (of every version of the day), staff_names (every staff of the shop, active or not)}`; a day without a
    closing-1 open closing reports `'separate'` and `closings_planned = greatest(1, number of closings)`;
 - `save` = `{ok:true, closing_id, repeat}` | `{ok:false, error:'closing_changed', current_id}` |
 `{ok:false, error:'draft_changed', revision}` (live closing only) |
 `{ok:false, error:'bad_inputs'|'config_mismatch'|'no_closing_day'|'idempotency_conflict'}`.
  The parsers drop a bad day/entry/closing/version individually (a day left with no entry, or with a bad `cash_mode`/
  `closings_planned`, is dropped; a duplicate `closing_no` in the day detail keeps the first; a bad top level → `null` →
  `unknown`/`bad_response`); change a shape on one side → a migration + the parser in the same commit.
- **Cross-file invariant: the author check.** `owner_save_closing` accepts a staff `addedBy` only if that staff row
  belongs to the shop; `validateClosingInputs` (schema-2 expense rules) and `private.inputs_shape_ok` check the
  rest. The server accepts any staff author of the shop on any line (including changing an existing
  line's author); «editing keeps the author» is enforced by the client (`snapshotFromInputs`). Trusted role.
- **Seven owner error strings** added in stage 3, each with a `mapError` case (`errors.ts`) and a Greek `ownerErrorMessage`:
 `closing_changed`, `bad_inputs`, `config_mismatch`, `no_closing_day`, `idempotency_conflict`, `bad_range`, `draft_changed`.
  `mapError` alone gives `closing_changed` a null `currentId`; `saveClosing` in `owner.ts` builds it from the
  payload's `current_id` (the editor offers «Αποθήκευση πάνω της» only with an id).
- `private.current_closing` and `private.closing_version_json` are `private.*` helpers: no client execute.

### Multiple closings per day (stage 5)
**Status 2026-11-17: both migrations applied to dev (`multi_closing` 20261117004655, `multi_closing_history`
20261117004755, byte-identical to the repo files, after clean dry runs); SQL tests 170, 180, 080, 090, 100, 110, 130, 160
pass on dev.** Not verified: the two-session concurrency check (M45); SQL files 010–070, 120, 140, 150 not re-run after
them; performance/health advisors; the start-next flow on real phones (two phones, both cash modes); an old cached phone
bundle in a multi-closing shop; `ClosingPlanCard` and the history day selector never viewed in a browser; the deployed
(Vercel) client must be this branch's build. **Deploy rule:** migrations
`20261117000001_multi_closing` and `20261117000002_multi_closing_history` are applied together (between them
`owner_save_closing` still reads `open_closings` by shop + date only), and the client that reads the new history
payloads ships with them (the old parsers cannot read the new `list`/`day` shapes).
- **Closing numbers 1..6.** `open_closings.closing_no` and `closings.closing_no` (default 1, check 1..6); unique
  `(shop_id, business_date, closing_no)` on `open_closings`; index `closings_shop_date_no_seq_idx`. The shop's plan:
  `shops.closings_per_day` (1..6, default 1) and `shops.cash_mode` (`'separate'` default | `'running'`). Existing rows read
  as closing 1 of a 1-closing `'separate'` day (column defaults).
- **The live closing** = the highest-numbered open closing of the shop's business date: `private.open_closing_for(shop)`
  (when the day has none it creates closing 1, pinning the shop's latest config and its current plan). Every write,
  submit and start goes to it; `get_open_closing`/`owner_get_open_closing` return it.
- **The plan is pinned per day.** Closing 1 copies `closings_per_day` → `open_closings.closings_planned` and `cash_mode`,
  plus the config; every later closing of the day copies all three from the closing it follows. `set_closing_plan(shop,
  count, mode)` (owner: `require_owner`, shop row `for no key update`, `bad_closing_plan` 22023 for a count outside 1..6,
  an unknown mode or nulls) changes only `shops`: it takes effect on the next business day whose closing 1 is created after
  it (also today, if nobody has opened today's closing yet); a day already started keeps its plan
  (`ClosingPlanCard`: «Αποθηκεύτηκε. Μια ημέρα που έχει ήδη ξεκινήσει μένει όπως ξεκίνησε.»; at count 1 it stores
  `'separate'`). The owner reads the plan from `shops` (`OwnerApi.closingPlan`; existing select grant + `shops_owner_read`).
- **Explicit start, never automatic.** `start_next_closing(token, date, closing_no)` — `closing_no` = the closing the
  phone shows as live. Check order: staff session → `wrong_day` → lock the live row `for update` (the lock writers and
  submit take) and re-read the day's highest row → **repeat**: the highest is `closing_no + 1` → `{ok:true, closing}`
  with its snapshot, nothing new → `wrong_closing` (`closing_no` is not the highest, or the highest is not the row we
  locked) → `no_more_closings` (`closing_no >= closings_planned`) → `not_submitted` (no `last_submit`, or
  `last_submit.revision` ≠ the closing's `revision`) → insert closing `n + 1` (same config, plan and mode, revision 0) →
  broadcast `closing_started` `{business_date, closing_no}` → `{ok:true, closing:<snapshot>}`. **`running` copies only
  expenses:** the visible lines (`e:<id>` with `removed` false, and their `:d`/`:a`) at version 1 with the same authors;
  `d:`/`c:` boxes start empty. `separate` starts empty. `maxExpenses` stays per closing, so in `running` it limits the day.
  Phone UI: the header button «Έναρξη Nου κλεισίματος» shows only when `canStartNext` (number < plan, submitted, not
  changed since, no unsent edits of this closing); the `StartNextSheet` confirms; ok / `wrong_closing` → close + resync
  (the returned snapshot is never applied by hand); `not_submitted`/`no_more_closings` → message in the sheet + resync;
  session/day errors → `onServerError`. The owner cannot start a closing.
- **`wrong_closing`.** `private.write_closing_field` and `submit_closing` lock the live row and refuse a `closing_no` that
  is not it, or when a higher row exists (`{ok:false,error:'wrong_closing'}`, nothing stored); `start_next_closing`
  holds the same lock while inserting, so a write blocked behind a start sees the new row (argued, not tested with two
  sessions). The engine: every `PendingEdit` carries `closingNo` (stored items without one = 1); an edit is shown, sent and
  merged only while the snapshot is the same closing (`sameClosing`); `wrong_closing` drops this author's edits of that
  closing with `WRONG_CLOSING_NOTICE` and resyncs; a load of another closing drops them the same way (of another day:
  `WRONG_DAY_NOTICE`); a `field`/`submitted` broadcast of another closing and every `closing_started` → resync. Owner
  «Σήμερα» maps `wrong_closing` through `todayWriter` the same way. Other authors' hidden items of an earlier closing stay
  stored until the day changes (never sent). The phone gate treats `wrong_closing`/`not_submitted`/`no_more_closings`
  as no-ops.
- **Payloads.** The snapshot adds `closing_no`, `closings_planned`, `cash_mode`; the `field` broadcast and `last_submit`/
  the `submitted` broadcast add `closing_no`; `closing_started` is new. Client parsers read an absent `closing_no` /
  `closings_planned` as 1 and an absent `cash_mode` as `'separate'` (an older server or cached data); a present but
  invalid value drops that message/snapshot. (`last_submit`/the `submitted` broadcast are the exception: an absent
  `closing_no` stays absent, `SubmitInfo.closingNo` undefined.)
- **Old builds.** The new arguments are trailing `p_closing_no int default 1` (`set_closing_field`,
  `owner_set_closing_field`, `submit_closing`, `owner_save_closing`), so an older client keeps working in a 1-closing
  shop. In a shop with several closings an old phone build reads the live snapshot but its writes and submits name
  closing 1: once closing 2 has started they are `wrong_closing`, which the old build does not know (it maps to
  `unknown`), and it has no start button. Not checked on a device.
- **Idempotency.** A same-key repeat must also match `closing_no` in `submit_closing` and `owner_save_closing`; the same key
  naming another closing is `idempotency_conflict`. The phone's key is minted per opening of the submit sheet; «Σήμερα»
  re-mints its key for another closing.
- **Day result** (`combineDay`, pure, history model; never in SQL): only submitted closings count (each its current
  version, through `summarizeInputs` → `evaluateTotals`). `running` = the highest-numbered submitted closing's summary.
  `separate` = per total, the sum over the closings (so a float subtracted in a total is subtracted once per closing),
  expenses summed; `null` («—») when any closing is unreadable or the closings do not share one `config_id`. Done/planned
  = submitted count / `max(closings_planned, number of closings)` («N από M κλεισίματα»). The week card shows the day
  result (a day with no submitted closing shows its newest open one), «N από M» and «Δεν υποβλήθηκε το Nο» for a multi-closing
  day; `DayScreen` shows «Σύνολο ημέρας» and the closing pills when the day has (or plans) more than one closing.
- **Corrections per closing.** `owner_save_closing(…, closing_no)` locks, guards and inserts per closing; `CorrectionEditor`
  and «Επαναφορά» send the shown closing's number, «Σήμερα» the snapshot's. Only the live closing needs the live revision
  and authors and records `last_submit`. Read from the SQL, not tested: a «Καταχώρηση αλλαγών» that lands just after a
  start is saved as a correction of the now earlier closing (no revision check). **Declined by the final review:** in
  `running` mode an owner correction of closing 1's expenses does not reach the lines already copied into closing 2.
- **Suggestions.** `expense_suggestion_data(p_token)` takes the current version of every `(business_date, closing_no)` of the
  last 180 days; for a day whose closing-1 open closing is `'running'` only the highest-numbered submitted closing (its lines repeat
  in every closing).
- **Accepted server asymmetries.** The day detail of a day without a closing-1 open closing reports `closings_planned =
  greatest(1, count)` (the list uses the count of its closings, always ≥ 1). `owner_save_closing` accepts a first filing of
  a non-live closing of today that has fields and no version, but no read path offers it (open closings are listed only
  for past dates, and a later closing can only start after a submit).
- **Cross-file invariants (change together):**
  - the 1..6 limit: SQL checks on `shops.closings_per_day`, `open_closings.closing_no`/`closings_planned`,
    `closings.closing_no`, `set_closing_plan`, `owner_save_closing` ↔ `MAX_CLOSINGS`/`isClosingNo` (`fields.ts`, the one
    TS definition), `MAX_CLOSINGS_PER_DAY` (`owner/model/limits.ts`, = `MAX_CLOSINGS`) and the router's closing segment
    (canonical integer + `isClosingNo`);
  - the cash-mode values `'separate'|'running'`: SQL checks on `shops.cash_mode`/`open_closings.cash_mode`,
    `set_closing_plan`, the `'running'` literal in `expense_suggestion_data` and `start_next_closing` ↔ `CashMode`/
    `isCashMode` (`fields.ts`; `ClosingPlanCard` and `StartNextSheet` texts per mode);
  - the snapshot keys `closing_no`/`closings_planned`/`cash_mode` (`private.closing_snapshot`) ↔ `parseSnapshot`
    (`live.ts`) and the stored-snapshot reader in `data/local/openClosing.ts`;
  - phone error strings `wrong_closing`, `not_submitted`, `no_more_closings` ↔ `deviceErrors.ts` (`PLAIN`), the phone's
    `deviceErrorMessage` (`phone/model/messages.ts`) and `gate.ts`;
  - owner error strings `bad_closing_plan`, `wrong_closing` ↔ `errors.ts` (`mapError`) and `ownerErrorMessage`;
  - the history payload shapes (above) ↔ `parseHistoryList`/`parseDayDetail` (`history.ts`).

### Shop roles (stage 6)
**Status: migrations applied to dev 2026-11-17 (`shop_roles` 20261117215157, `office_names` 20261117215259, from the repo files after a check that every re-created body equals its latest source apart from the role guard / name expression); SQL tests 010–200 all pass on dev (each pasted through the connector with comment lines stripped; realtime partitions present and the realtime blocks of 080/090/170/200 made to raise instead of skip, so none skipped). Nothing viewed in a browser; the «Confirm email» setting not checked.** Spec
`docs/superpowers/specs/2026-11-17-shop-roles-design.md`, plan `docs/superpowers/plans/2026-11-17-stage-6-shop-roles.md`,
migrations `20261117000003_shop_roles` and `20261117000004_office_names`.
**Deploy rule:** apply `…000003` and `…000004` together, before the client ships (the client's `listShops` needs
`my_shops`; `…000004` needs `require_role`). With the Supabase «Confirm email» setting off, `invite_unconfirmed` adds
nothing (every account counts as confirmed) — verify it is on.
- **`shop_members`** (no client table access; RLS on; every read/write through functions): `id`, `shop_id`, `invite_id`
  (shared by the rows of one multi-shop invite), `email` (lower-cased, trimmed, ≤ 254 chars), `display_name` (1–40,
  trimmed), `role` (`'manager'|'accountant'`; the owner is `shops.owner_id`, never a row), `invite_token_hash` (sha256;
  null once accepted/removed), `invited_at`, `invite_expires_at` (+7 days), `user_id` (access link, null until accepted,
  set null when the auth user is deleted), `member_uid` (permanent attribution key: no foreign key, never cleared),
  `accepted_at`, `removed_at` (removal keeps the row). Live-row uniqueness: one live row per `(shop_id, email)` and per
  `(shop_id, user_id)` (`where removed_at is null`). Cap: 20 live rows per shop (`too_many_members`). A re-invite of a
  removed person is a new row. Account deletion turns every row of the person into a tombstone: «Διαγραμμένος
  συνεργάτης <first 8 hex of member_uid>», no email, removed, no `user_id` — the text is produced only in SQL
  (`owner_delete_account`); the client never builds it.
- **Role helpers.** `private.shop_role(shop)` → `'owner'|'manager'|'accountant'|null` for the caller (a live, accepted
  row; anonymous/no caller → null; executable by `authenticated` for the policies). `private.require_role(shop, roles)`
  raises `not_owner` (42501) — the same answer as "doesn't exist", so a probe cannot tell them apart.
  `private.is_shop_owner`/`require_owner` keep meaning owner only.
- **Cross-file invariant: the function → role map** (SQL guards and policies ↔ `allowedTabs`/`can` in
  `src/features/owner/model/roles.ts`; change both together):

  | Roles | Functions / table paths | Client |
  |---|---|---|
  | owner | `publish_config`, `set_closing_plan`, `set_day_change_time`, `owner_delete_shop`, `owner_erase_staff`, shops update policy (rename), closings read/update policies, `owner_invite_member`, `owner_list_members`, `owner_set_member_role`, `owner_remove_member`, `owner_reissue_invite` | «Ρυθμίσεις»; `can`: `eraseStaff`, `manageMembers`, `editShop` |
  | owner, manager | `create_staff`, `set_staff_pin`, `unlock_staff`, staff/devices read + update policies, `owner_get_join_key`, `owner_rotate_join_key`, `owner_list_devices`, `owner_remove_device`, `owner_get_open_closing`, `owner_set_closing_field`, `owner_save_closing`, shop_configs read, the `shop:<id>` realtime topic (`can_use_shop_topic`) | «Σήμερα», «Προσωπικό», «Συσκευές»; `can`: `correct` |
  | owner, manager, accountant | `owner_list_closings`, `owner_get_closing_day`, shops read policy, `my_shops` | «Ιστορικό» |

  Role strings `'owner'|'manager'|'accountant'` live in SQL (`shop_members.role` CHECK, `shop_role`, the guards) and in
  `ShopRole`/`isShopRole`/`isMemberRole` (`roles.ts`).
- **Invites.** `owner_invite_member(shops[], email, name, role)` returns the raw token once (32 chars `^[A-HJ-NP-Z2-9]{32}$`,
  made only by `private.new_invite_token`; cross-file invariant with `parseInviteToken`/`INVITE_TOKEN_RE` in
  `src/app/inviteToken.ts`). The link is `<origin+pathname>#/owner/invite/<token>` (router `{name:'invite', token}`; the
  token sits in the hash). The owner sends it himself (copy/share/mailto); there is no server email. An invite opened
  while signed out is kept in `src/data/local/pendingInvite.ts` (saved by `OwnerApp` in an effect while the invite route is
  shown signed out) and resumed after any sign-in: a signup confirmation redirect, or a non-anonymous session present on
  the `login`/`shops` route (once per signed-in person per mount, `replace`). Accepting always needs the explicit
  «Αποδοχή»; «Όχι τώρα», an accept, `invite_expired` and `invite_invalid` clear the stored token. On `invite_wrong_email`
  «Σύνδεση με άλλο λογαριασμό» signs out and stays on the invite route with the token kept.
- **Accept checks** (`accept_shop_invite`; `invite_info` shares the first ones): non-anonymous caller (`not_owner`) →
  token among live rows (`invite_invalid`; also a used, reissued or withdrawn token) → not expired (`invite_expired`) →
  `auth.users.email_confirmed_at` set (`invite_unconfirmed`) → `auth.users.email` equals the invited email
  (`invite_wrong_email`); the email comes from `auth.users`, never the JWT. A row of a shop the caller owns or is already a
  live member of is marked removed instead; if nothing is accepted the call raises `already_member` (everything rolls back).
- **Eight owner error strings**, each with a `mapError` case and a Greek `ownerErrorMessage`: `too_many_members`,
  `already_member`, `already_owner`, `bad_member`, `invite_invalid`, `invite_expired`, `invite_unconfirmed`,
  `invite_wrong_email`.
- **Office names** (`…000004`): `private.office_name(shop, uid)` is the only producer of office-side names (no client
  execute): the member's `display_name` from the row with the latest `accepted_at` (removed rows count, so a removed
  manager keeps his name on past work; a deleted account shows the tombstone), else «Ιδιοκτήτης». It feeds
  `updated_by_name` (snapshot, stale `current`, `field` broadcast), `author_name` (versions) and `last_submit.staff_name`
  of an office save. The client never builds these names (`ClosingView` prints the version's `authorName`). Expense lines
  with `addedBy {kind:'owner'}` mean "added from the office side" (owner or manager; the shape is unchanged) and history
  labels them «Διαχείριση» (`OFFICE_NAME`, history `model.ts`).
- **Queue author** of an office-side person in «Σήμερα» is `office:<uid>` (`officeQueueAuthor`, `ShopLayout` builds `me`):
  two office people in one browser never send each other's queued edits. Items stored under the pre-stage-6 author
  `'owner'` stay hidden and are dropped after their day by `savePending`.
- **Removal** takes effect at once for every function call, table policy and realtime **join**. Known limit (like
  stage 2): a removed member already joined to `shop:<id>` keeps *receiving* broadcasts until the channel rejoins or the
  access token refreshes.

## Conventions
- Code/comments English, UI Greek. Tests in `tests/`, importing real core functions.
- `npm test`, `npm run typecheck` must pass before every commit.

## DEV ONLY register
| What | Where | Remove when |
|---|---|---|
| (none) | | |
