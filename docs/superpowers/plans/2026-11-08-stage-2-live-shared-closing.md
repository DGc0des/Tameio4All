# Stage 2 — live shared closing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every signed-in phone of a shop and the owner's «Σήμερα» tab edit one shared closing for the
current business day; each box saves on its own, changes appear on the others within ~1–2 s, a name tag
shows who is in a box, edits queue offline, and Υποβολή submits exactly what the server holds.

**Architecture:** The server keeps one open closing per (shop, business_date) as one row per box
(`open_closing_fields`, raw typed text, never cents), pinned to the config current when it was created.
All writes go through server functions that bump a per-field version and the closing's `revision` and
broadcast the change on a private Realtime channel `shop:<shop_id>` (presence on the same channel). The
client keeps `snapshot (from server) + pending queue (local, persisted)` and derives the register's
`Draft` from them with pure functions; the existing `deriveClosing` turns that into money.

**Tech Stack:** React 19 + TypeScript strict, Vitest + Testing Library, Supabase Postgres functions,
Supabase Realtime (private Broadcast + Presence, `realtime.send`), supabase-js.

**Spec:** `docs/superpowers/specs/2026-11-07-live-closing-and-history-design.md` — "Live shared closing",
"Submission", owner «Σήμερα», "Delivery order → 2". Stage 1 (merged) provides staff sessions,
`private.business_date`, `private.staff_session`, session-based `submit_closing`, the phone gate.

## Global Constraints

- All stage-1 invariants in `CLAUDE.md` hold (RLS on, `anon` nothing, phones only via server functions,
  `security definer` + `search_path = ''`, `revoke … from public, anon`, expected failures return
  `{ok:false,error}`, identity only from `auth.uid()` + staff token, business date only from
  `private.business_date`).
- **Each box saves independently; same box → last write to reach the server wins** (online). Writes are
  per field, never the whole closing.
- **Offline replay:** a queued edit whose box changed on the server since the phone last saw it is
  dropped in favour of the server value, toast «Το πεδίο {label} άλλαξε από {name}».
- **Wrong day:** queued edits for a past business date are dropped with toast
  «Η ημέρα άλλαξε — οι αλλαγές εκτός σύνδεσης δεν αποθηκεύτηκαν».
- **Config pinned per open closing:** `open_closings.config_id` = latest config at creation; every client
  computes with that config; `submit_closing` refuses any other `config_id` (`config_mismatch`).
- **Entry mode (Ποσό/Κομμάτια) is per phone** (local pref per shop), switchable any time; denomination boxes
  are stored as `{text, mode}` and displayed converted with `convertEntry`; an unconvertible value shows
  as typed with the existing error hint.
- **Presence tag:** another client focused on a box shows its name on that box; owner shows as «Ιδιοκτήτης».
  Not a lock.
- **Owner edits today's closing live** with the same LWW rule; owner writes are attributed to the owner;
  **only signed-in staff press Υποβολή**.
- **Submit:** sends inputs derived from the merged view plus the snapshot `revision`; refused
  `draft_changed` if the server revision differs; Υποβολή disabled while offline or while the pending queue
  is not empty. After submit every client shows «Υποβλήθηκε HH:MM · {name}»; the closing stays editable.
- Write debounce 400 ms per box, flush on blur.
- Paired phone with nobody signed in still shows only sign-in (no subscription, no numbers).
- Money stays text until `deriveClosing`; components never parse money. Greek UI, English code.
  `npm test` + `npm run typecheck` before every commit.

## Review Focus

1. **Two clients type the same box at nearly the same time** — both end on the server's last value with
   no flip-flop: a broadcast older than the snapshot's version is ignored, and a box with an unsent local
   edit keeps showing the local text until that edit is acknowledged. Test in Task 6.
2. **Offline edit to a box someone else changed meanwhile** — dropped, server value shown, toast names the
   other person. Tests in Task 1 (`stale`) and Task 6.
3. **Submit races** — tapping Υποβολή with unsent edits is blocked; a change by another phone between
   snapshot and submit returns `draft_changed`, the phone resyncs, the sheet asks to check and tap again.
   Tests in Task 2 and Task 7.
4. **Mode views differ** — Μαρία in Κομμάτια, Νίκος in Ποσό, same box shows «3» and «300» and both derive
   300,00€; «30» typed in Ποσό for 100€ shows «30» + error in Κομμάτια. Test in Task 3.
5. **Removed expense line edited elsewhere** — one phone removes a line while another edits its amount:
   the line stays removed in every view and its amount never reaches the inputs. Test in Task 3.

---

## Field model (shared by SQL and TS)

| key | value (jsonb) | meaning |
|---|---|---|
| `d:<denomCents>` | `{"text": string, "mode": "amount"\|"count"}` | denomination box |
| `c:<channelId>` | `{"text": string}` | channel box |
| `e:<expenseId>` | `{"addedBy": {...}, "removed": boolean, "order": number}` | expense line meta (`order` = client ms at creation) |
| `e:<expenseId>:d` | `{"text": string}` | expense description |
| `e:<expenseId>:a` | `{"text": string}` | expense amount |

Key regex (SQL and TS): `^(d:[0-9]{1,6}|c:[A-Za-z0-9_-]{1,40}|e:[A-Za-z0-9-]{1,64}(:[da])?)$`.
`text` ≤ 200 chars. Server-side author on `e:<id>` creation: staff session → `{kind:'staff', id}`;
owner → `{kind:'owner'}` (client-sent `addedBy` is ignored and replaced).

## File map

| File | Role |
|---|---|
| `supabase/migrations/2026110800000N_open_closings.sql`, `…_live_submit.sql` | tables, functions, realtime policies |
| `supabase/tests/080_open_closing.sql`, `090_live_submit.sql` | SQL tests |
| `src/features/register/live/fields.ts` | key builders/parsers, value guards, `FieldKey` types |
| `src/features/register/live/merge.ts` | snapshot + pending → `Draft`; apply server field; replay decision |
| `src/features/register/draft.ts`, `derive.ts` | `entries` become `{text, mode}`; mode leaves the draft |
| `src/data/local/openClosing.ts` | persisted pending queue + snapshot cache + entry-mode pref |
| `src/data/remote/live.ts` | Realtime channel wrapper (`openShopChannel`) |
| `src/data/remote/device.ts`/`deviceApi.ts`, `owner.ts`/`ownerApi.ts` | new calls |
| `src/features/register/live/useLiveClosing.ts` + `syncEngine.ts` | the client sync engine |
| `src/features/register/LiveClosingView.tsx` | cards bound to the engine (used by phone and owner) |
| `src/features/owner/TodayScreen.tsx` | owner «Σήμερα» tab |

---

### Task 1: Database — open closing, field writes, realtime authorization

**Files:** Create `supabase/migrations/20261108000001_open_closings.sql`, `supabase/tests/080_open_closing.sql`.

**Interfaces — Produces (SQL):**
- Tables (RLS on, all grants revoked from public/anon/authenticated):
  `open_closings(id uuid pk, shop_id, business_date date, config_id → shop_configs, revision bigint not null default 0, last_submit jsonb, created_at, unique(shop_id,business_date))`;
  `open_closing_fields(open_closing_id → open_closings on delete cascade, key text, value jsonb, version int not null, updated_by_staff uuid null → staff, updated_by_owner uuid null, updated_at timestamptz, primary key(open_closing_id,key))`.
- `private.open_closing_for(p_shop uuid) returns public.open_closings` — get-or-create for `private.business_date(p_shop)`, pinning the shop's latest config.
- `private.closing_snapshot(p_oc uuid) returns jsonb` → `{id, business_date, config_id, config, revision, last_submit, fields:[{key,value,version,updated_by_name,updated_at}]}` (`updated_by_name` = staff name or «Ιδιοκτήτης»).
- `public.get_open_closing(p_token text) returns jsonb` → `{ok:true, closing:<snapshot>}` | `{ok:false,error}` (`not_a_device|device_revoked|session_invalid`).
- `public.set_closing_field(p_token text, p_business_date date, p_key text, p_value jsonb, p_base_version int) returns jsonb` →
  `{ok:true, version, revision}` | `{ok:false, error}` with `…session errors | wrong_day | bad_field | too_many_expenses | stale` (`stale` carries `current: {value, version, updated_by_name}`; only when `p_base_version` is not null and ≠ current version).
- `public.owner_get_open_closing(p_shop_id uuid) returns jsonb` and
  `public.owner_set_closing_field(p_shop_id uuid, p_key text, p_value jsonb, p_base_version int) returns jsonb` — same shapes; owner's business date is always `private.business_date(shop)` (no `wrong_day`); `not_owner` raised like other owner functions.
- Every successful write: version+1 (insert = 1), `open_closings.revision`+1, then
  `realtime.send(jsonb_build_object('key',k,'value',v,'version',ver,'revision',rev,'updated_by_name',n,'updated_at',t,'business_date',bd), 'field', 'shop:'||shop_id, true)`.
- `private.can_use_shop_topic(p_topic text) returns boolean` — true when topic = `'shop:'||id` and caller is
  the shop's owner, or caller's device is paired (not revoked) to that shop **and** has a live staff session
  for today's business date. Policies on `realtime.messages` for `authenticated`: `select` and `insert`
  `using/with check (private.can_use_shop_topic((select realtime.topic())))`; execute on the helper granted to authenticated (policies need it — like `is_shop_owner`).
- Validation: key regex (Field model), value shape per key kind, `text` ≤ 200 chars; `e:<id>` creation
  refused with `too_many_expenses` when non-removed lines would exceed the pinned config's `maxExpenses`;
  author on `e:<id>` set server-side (Field model). Writes to `e:<id>:d|a` for an unknown line → `bad_field`.

- [ ] **Step 1: Write `080_open_closing.sql`** (setup like `070`: owner A shop + config + staff ΜΑΡΙΑ/ΝΙΚΟΣ, owner B shop, phones d1/d2 paired to A, d3 to B; sign in Μαρία on d1, Νίκος on d2). Tests:
  - T1 `get_open_closing` creates once (second call same id), `config_id` = latest; owner publishes a new config → still the old `config_id`.
  - T2 `set_closing_field(d:5000, {"text":"300","mode":"amount"}, null)` → version 1, revision 1; same key from d2 → version 2 (LWW); snapshot shows d2's value and `updated_by_name` ΝΙΚΟΣ.
  - T3 `p_base_version = 1` after version 2 exists → `stale` with current value/version/name; nothing changed.
  - T4 `p_business_date` ≠ today → `wrong_day`; bad key `x:1`, bad value (`{"text":5}`), 201-char text → `bad_field`.
  - T5 expense: creating `e:<id>` stores server author `{kind:'staff', id:<maria>}` even if client sends owner; `e:<id>:a` for unknown line → `bad_field`; lines beyond `maxExpenses` → `too_many_expenses`; `removed:true` frees a slot.
  - T6 d3 (shop B) token can't read/write shop A; signed-out token → `session_invalid`.
  - T7 owner A `owner_set_closing_field` works, `updated_by_name` «Ιδιοκτήτης», author `{kind:'owner'}` on a new line; owner B → `not_owner`.
  - T8 topic helper: true for owner A / d1-with-session on `shop:<A>`; false for d1 after sign-out, for d3, for anon, for a malformed topic.
  - T9 phones and owners cannot select/insert the two tables directly.
- [ ] **Step 2: Run against dev → fails. Step 3: Write and apply migration (`apply_migration` name `open_closings`). Step 4: Run 080 and 010–070 → pass.**
- [ ] **Step 5: Commit** `feat(db): open closing per day with per-field writes and realtime auth`.

### Task 2: Database — submit against the live closing

**Files:** Create `supabase/migrations/20261108000002_live_submit.sql`, `supabase/tests/090_live_submit.sql`; modify `070`/`040` call sites.

**Interfaces:**
- Consumes: Task 1 tables, `private.open_closing_for`.
- Produces: drop the 5-arg `submit_closing`; new
  `public.submit_closing(p_token text, p_config_id uuid, p_business_date date, p_inputs jsonb, p_revision bigint, p_idempotency_key text) returns jsonb` —
  stage-1 checks and order unchanged, plus: `p_config_id` must equal the open closing's `config_id` (`config_mismatch`); `p_revision` must equal its current `revision` (`draft_changed`, carries `revision`) — checked after the idempotency lookup so a lost-answer retry still gets `repeat`. On success set `open_closings.last_submit = {closing_id, staff_name, at}` and
  `realtime.send({closing_id, staff_name, at}, 'submitted', 'shop:'||shop, true)`. The open closing stays.

- [ ] **Step 1: `090_live_submit.sql`**: T1 submit with current revision → ok, `last_submit` set; T2 another write then submit with the old revision → `draft_changed` with the new revision; T3 old config id → `config_mismatch`; T4 same key + same inputs after a later field write → `repeat` (lookup before revision check); T5 resubmit with new key and current revision → second closing row. Update `040`/`070` to sign in, create the open closing, and pass the revision.
- [ ] **Step 2–4: fail → migration (`live_submit`) → 010–090 pass. Step 5: Commit** `feat(db): submit checks the live closing's revision and pinned config`.

### Task 3: Core model — fields, merge, per-box mode

**Files:** Create `src/features/register/live/fields.ts`, `src/features/register/live/merge.ts`; modify `draft.ts`, `derive.ts`, `CountCard.tsx`, `ModeSwitch` call sites; tests `tests/features/register/live/*.test.ts`, existing draft/derive tests.

**Interfaces — Produces:**
```ts
// draft.ts
export interface BoxText { text: string; mode: EntryMode }
export interface ExpenseDraft { id: string; description: string; amountText: string; addedBy: ExpenseAuthor | null; order: number }
export interface Draft { businessDate: string; entries: Record<string, BoxText>; channels: Record<string, string>; expenses: ExpenseDraft[] }
// fields.ts
export type FieldKey = string; // validated by isFieldKey
export const KEY_RE: RegExp; // exactly the Field model regex
export function denomKey(d: Cents): FieldKey; channelKey(id: string); expenseKey(id); expenseDescKey(id); expenseAmountKey(id);
export type ServerField = { key: FieldKey; value: unknown; version: number; updatedByName: string; updatedAt: string };
export interface Snapshot { id: string; businessDate: string; configId: string; config: unknown; revision: number; lastSubmit: { closingId: string; staffName: string; at: string } | null; fields: Record<FieldKey, ServerField> }
export interface PendingEdit { key: FieldKey; value: unknown; businessDate: string; baseVersion: number | null; queuedOffline: boolean; seq: number }
// merge.ts
export function draftFromFields(snapshot: Snapshot, pending: readonly PendingEdit[]): Draft;
export function applyServerField(s: Snapshot, f: ServerField & { revision: number }): Snapshot; // ignores f.version <= current
export function fieldLabel(key: FieldKey, config: ShopConfig): string; // Greek row label for toasts
```
`draftFromFields`: latest pending edit per key overrides the snapshot value; expense lines ordered by
`order`, `removed` lines excluded entirely (their `:d`/`:a` ignored); malformed values ignored.
`deriveClosing(config, draft)` reads each `entries[k]` in its own `mode`. View mode lives outside the draft:
`CountCard` gets `viewMode` and displays `convertEntry(box.text, d, box.mode, viewMode)`; typing stores
`{text, mode: viewMode}`. Remove `setMode`/`mode` from the draft reducer. Keep the build green with minimal call-site edits: until Task 7,
RegisterScreen keeps its local reducer + `drafts.ts` persistence on the new `Draft` shape (`isDraft` accepts
only the new shape, so older stored drafts are discarded) and holds the view mode in component state.

- [ ] **Step 1: Failing tests** — key builders round-trip and reject non-matching keys; `draftFromFields` with
  pending override; `applyServerField` ignores older/equal versions and bumps `revision`; Review Focus 4
  (`{text:'300',mode:'amount'}` for 10000 shows «3» in count view, derives 30000 cents; `{text:'30',mode:'amount'}` for 10000 → error hint and shown «30» in count view); Review Focus 5 (removed line with a pending amount edit → no expense in draft, not in `inputs`); `fieldLabel('d:5000')` → «50€», `c:wolt` → channel label, expense → «Έξοδο N».
- [ ] **Step 2–4: fail → implement → `npm test && npm run typecheck`. Step 5: Commit** `feat(register): field model, merge and per-box entry mode`.

### Task 4: Local storage — pending queue, snapshot cache, entry mode

**Files:** Create `src/data/local/openClosing.ts`; test `tests/data/openClosing.test.ts`. (The stage-1 `drafts.ts` is deleted in Task 7, when its last caller goes.)

**Interfaces — Produces:**
`loadPending(store, shopId): PendingEdit[]`, `savePending(store, shopId, list): boolean`,
`loadSnapshot(store, shopId): Snapshot | null`, `saveSnapshot(store, shopId, s): boolean`,
`loadEntryMode(store, shopId): EntryMode` (default `'amount'`), `saveEntryMode(store, shopId, m): boolean`.
Failure-safe; shape-checked on read; keys `tameio4all:v1:<shop>:pending|snapshot|entryMode`.

- [ ] Steps: failing tests (round-trip, corrupt → empty/null, throwing store) → implement → test → commit `feat(local): pending field queue, snapshot cache, entry-mode pref`.

### Task 5: Remote — API calls and realtime channel wrapper

**Files:** Create `src/data/remote/live.ts`; modify `deviceApi.ts`, `device.ts`, `deviceErrors.ts`, `ownerApi.ts`, `owner.ts`, `errors.ts`, Greek messages (phone `messages.ts`, owner `model/messages.ts`), fakes `tests/features/phone/fakeDeviceApi.ts`, `tests/features/owner/fakeApi.ts`; tests.

**Interfaces — Produces:**
```ts
export type LiveStatus = 'connecting' | 'live' | 'offline';
export interface LiveHandlers { onField(f: ServerField & { revision: number; businessDate: string }): void; onSubmitted(s: { closingId: string; staffName: string; at: string }): void; onPresence(p: { name: string; focus: FieldKey | null }[]): void; onStatus(s: LiveStatus): void }
export interface LiveChannel { setFocus(key: FieldKey | null): void; close(): void }
export function openShopChannel(client: SupabaseClient, shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel; // private channel `shop:<id>`, broadcast events 'field'/'submitted', presence key = random per channel
// DeviceApi additions
getOpenClosing(token: string): Promise<DResult<Snapshot>>;
setField(token: string, businessDate: string, key: FieldKey, value: unknown, baseVersion: number | null): Promise<DResult<{ version: number; revision: number }>>;
live(shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel;
submit(token, configId, businessDate, inputs, revision: number, idempotencyKey): …   // revision added
// DeviceError additions: { code:'stale'; current: ServerField } | { code:'wrong_day' } (exists) | { code:'bad_field' } | { code:'too_many_expenses' } | { code:'draft_changed'; revision: number }
// OwnerApi additions
todayClosing(shopId: string): Promise<Result<Snapshot>>;
setTodayField(shopId: string, key: FieldKey, value: unknown, baseVersion: number | null): Promise<Result<{ version: number; revision: number } | { stale: ServerField }>>;
live(shopId: string, me: { name: string }, h: LiveHandlers): LiveChannel;
```
Fakes: `live` returns a controllable fake channel (tests can emit field/submitted/presence/status).

- [ ] Steps: failing tests (snapshot parsing incl. `updated_by_name`, `stale` mapping with current, `draft_changed` revision, submit passes `p_revision`, `openShopChannel` with a stub client subscribes `shop:<id>` with `{config:{private:true}}` and maps events/status) → implement → test → commit `feat(remote): live closing calls and realtime channel`.

### Task 6: Sync engine

**Files:** Create `src/features/register/live/syncEngine.ts` (pure state + effects runner, no React) and `useLiveClosing.ts` (React binding); tests `tests/features/register/live/syncEngine.test.ts`.

**Interfaces — Produces:**
```ts
export interface Writer { load(): Promise<DResult<Snapshot>>; write(e: PendingEdit): Promise<DResult<{ version: number; revision: number }>>; live(h: LiveHandlers): LiveChannel }
export interface LiveState { snapshot: Snapshot | null; pending: PendingEdit[]; status: LiveStatus; presence: { name: string; focus: FieldKey | null }[]; notice: string | null }
export function useLiveClosing(writer: Writer, store: KeyValueStore, shopId: string, me: { name: string }, now: () => Date): {
  state: LiveState; draft: Draft | null;
  edit(key: FieldKey, value: unknown): void;     // queue (debounced 400 ms per key), persist
  flush(key?: FieldKey): void;                    // on blur
  focus(key: FieldKey | null): void;              // presence
  resync(): Promise<void>;                        // load() + replace snapshot
}
```
Rules: every edit enters the persisted queue; a sender sends in `seq` order one at a time; while
`status !== 'live'` edits are marked `queuedOffline` with `baseVersion` = snapshot version of that key;
online edits send `baseVersion: null`; on ack apply `{version,revision}` to the snapshot and drop the
item; `stale` → drop item, apply `current`, notice «Το πεδίο {label} άλλαξε από {name}»; `wrong_day` →
drop all items of that date, notice «Η ημέρα άλλαξε — οι αλλαγές εκτός σύνδεσης δεν αποθηκεύτηκαν», then
`resync`; `network` → keep item, status `offline`, retry when status returns to `live`; on every
`live` after `connecting/offline` → `resync()` then resume sending. Incoming `field` broadcasts go
through `applyServerField`; broadcasts for another business date trigger `resync`. Snapshot is cached
(Task 4) after each change.

- [ ] **Step 1: Failing tests** (fake Writer + fake channel + fake timers): debounce coalesces typing into one write; Review Focus 1 (local pending text wins over an incoming broadcast for the same key until ack; then the server's later version wins; older broadcast ignored); Review Focus 2 (offline edit with baseVersion, server returns `stale` → value replaced, notice names the person); wrong_day drop + notice + resync; network failure keeps the queue and retries on `live`; reconnect resyncs before sending; queue survives a remount (persisted).
- [ ] **Step 2–4: fail → implement → test. Step 5: Commit** `feat(register): live sync engine`.

### Task 7: Phone register on the live closing

**Files:** Create `src/features/register/LiveClosingView.tsx` (header-less cards: ModeSwitch, CountCard×2, ExpensesCard, ChannelsCard, SummaryCard, presence tags); modify `RegisterScreen.tsx`, `CountCard.tsx`, `ChannelsCard.tsx`, `ExpensesCard.tsx`, `SubmitSheet.tsx`, `PhoneApp.tsx` (pass config from the snapshot, not `device_context`); tests `tests/features/register/*`, `tests/app/app.test.tsx`.

**Interfaces:**
- Consumes: `useLiveClosing`, `DeviceApi.getOpenClosing/setField/live/submit(…revision…)`, `loadEntryMode/saveEntryMode`.
- Produces: `LiveClosingView({ config, draft, derived, viewMode, onViewMode, presence, edit, flush, focus, author, newId, now, history })` — reused by Task 8. Presence tag: small pill with the other client's name inside the row of the focused box (`aria-label="Επεξεργάζεται: {name}"`).
- RegisterScreen: config = `isShopConfig(snapshot.config)`; offline banner from `state.status === 'offline'`; Υποβολή blocked with «Περιμένει αποθήκευση…» while `pending.length > 0`, with «Χρειάζεται σύνδεση για υποβολή» while offline; submit sends `snapshot.revision`; `draft_changed` → `resync()` and the sheet shows «Κάποιος άλλαξε κάτι — έλεγξε και πάτα ξανά Υποβολή» and mints a new key on next tap; `lastSubmit` shows «Υποβλήθηκε HH:MM · {name}» under the header (also live via `onSubmitted`). New expense line: write `e:<id>` `{addedBy, removed:false, order: now()}`; remove: `{…, removed:true}`. Delete `src/data/local/drafts.ts` (+ its tests) and the draft reducer if nothing else uses it.

- [ ] **Step 1: Failing tests** — two RegisterScreens sharing one fake server (fake api whose writes broadcast to both fake channels): typing on A appears on B; mode switch on A doesn't change B (Review Focus 4 at UI level); presence tag on B when A focuses a box; submit disabled while pending; `draft_changed` path (Review Focus 3); «Υποβλήθηκε» line appears on both after A submits; signed-out phone opens no channel (`live` not called).
- [ ] **Step 2–4: fail → implement → `npm test && npm run typecheck`. Step 5: Commit** `feat(register): phones edit the shared live closing`.

### Task 8: Owner «Σήμερα» tab

**Files:** Modify `src/app/router.ts` (`ShopTab` gains `'today'`, first in `SHOP_TABS`), `ShopLayout.tsx` (tab «Σήμερα» first); create `src/features/owner/TodayScreen.tsx`; tests `tests/features/owner/today.test.tsx`, `tests/app/ownerRouter.test.ts`.

**Interfaces:** Consumes `OwnerApi.todayClosing/setTodayField/live`, `useLiveClosing` (owner `Writer` adapter), `LiveClosingView`. Owner presence name «Ιδιοκτήτης»; owner new lines `addedBy {kind:'owner'}` (server enforces); entry-mode pref stored per shop on the owner's device; no Υποβολή button; shows «Υποβλήθηκε HH:MM · {name}» or «Δεν έχει υποβληθεί ακόμα»; empty closing shows the cards with empty boxes.

- [ ] Steps: failing tests (route `#/owner/shop/<id>/today` parses; owner edits a box → `setTodayField` called; a fake broadcast updates the view; no submit button; error `not_owner` shows `ownerErrorMessage`) → implement → test → commit `feat(owner): live «Σήμερα» view and edits`.

### Task 9: Verify and document

**Files:** `CLAUDE.md`, `PROJECT_STATUS.md`, `supabase/tests/README.md`.

- [ ] **Step 1:** Run SQL 010–090 on dev; `npm test`, `npm run typecheck`, `npm run build` → all pass.
- [ ] **Step 2:** Confirm Realtime is enabled for the project and private channels authorize via
  `realtime.messages` policies (Dashboard → Realtime settings: "Allow public access" off is fine — the
  channel is private). If a dashboard toggle is needed, record it as a user step, don't change settings.
- [ ] **Step 3: Docs.** CLAUDE.md: field model table and key regex as a cross-file invariant (SQL validation
  ↔ `fields.ts`); open closing + pinned config; LWW + offline replay + wrong-day rules; presence; one write
  path (`set_closing_field`/`owner_set_closing_field` broadcast inside the function); submit revision rule.
  PROJECT_STATUS: stage 2 code-complete; not verified: two real phones + owner browser typing the same box,
  airplane-mode edit and reconnect, cheap Android blur/realtime performance.
- [ ] **Step 4: Commit** `docs: stage 2 — live shared closing`.
