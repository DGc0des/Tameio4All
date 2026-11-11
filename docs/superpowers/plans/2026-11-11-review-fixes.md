# Review Fixes (2026-11-11 project scan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four findings of the 2026-11-11 whole-project scan and bring the docs back in line with the code.

**Architecture:** No new features. One new pure module (`timeoutFetch`) wired into the single Supabase client; three small changes in owner screens/model; doc corrections last. No SQL, no migration, no change to any cross-file invariant.

**Tech Stack:** TypeScript (strict), React 19, Vitest 5 + Testing Library (jsdom per file via `// @vitest-environment jsdom`), supabase-js 2.

**Spec:** There is no separate spec. The "Findings" section below is the spec; read it together with `CLAUDE.md` (architecture and invariants) before starting.

## Findings (what this plan fixes)

| ID | Sev | Finding |
|---|---|---|
| M38 | Medium | No Supabase request has a timeout. A stalled connection (weak Wi-Fi, not fully offline) hangs until the browser gives up (minutes). `loadGate` then sits on «Φόρτωση…» with no retry button, and the sync engine (one load and one write in flight at a time) sends nothing and keeps Υποβολή disabled. |
| L87 | Low | Owner «Σήμερα» (`TodayScreen`) shows no date and has no stale-day guard. On a slow or offline start it shows the cached snapshot of another day under «Σήμερα»; edits typed there are dropped as `wrong_day`. The phone register already has both (date in header; M21 guard). |
| L88 | Low | `formatClock` / `formatDate` (`src/features/owner/model/time.ts`) use the browser's time zone; every other timestamp uses Europe/Athens. |
| L89 | Low | `TodayScreen` keeps `expectedOverride` (set after `closing_changed`) until a save succeeds. If a cashier submits in between, the next «Καταχώρηση αλλαγών» is guarded on the outdated id and fails once. |
| Docs | — | `README.md` and `PROJECT_STATUS.md` contain statements stage 4 made false (listed in Task 5). |

## Global Constraints

- Work on a new branch `fix/review-2026-11-11` created from `main`. Do not push; do not merge.
- `npm test` and `npm run typecheck` must pass before every commit. Run `npm run build` once at the end.
- Baseline before any change: `npm test` → 805 passed on 61 files; `npm run typecheck` clean. If the baseline differs, stop and report.
- Code and comments in English; UI text in Greek. Tests live in `tests/` and import the real functions (never re-implement logic in a test).
- Only `src/data/remote/` may import supabase-js. `src/core/` stays pure. Owner UI tests use `tests/features/owner/fakeApi.ts` and never load supabase-js.
- Do not touch `supabase/` (no SQL change is needed).
- Do not change behavior outside the findings. If an existing test fails for a reason this plan does not predict, stop and report instead of editing the test to pass.
- Updating the docs is the last task, not optional.

## Review Focus

Each line is pinned by a test in the task named.

1. A request that never answers → the caller gets a `network` error after 15 s, not a hang (Task 1, `timeoutFetch` test + both mapper tests).
2. A caller that aborts its own request (supabase-js passes its own `signal` in some calls) → the original abort error passes through unchanged, not reported as a timeout (Task 1).
3. A request that answers in time → no timer left running, response returned untouched (Task 1).
4. Owner opens «Σήμερα» offline with yesterday's snapshot cached → no boxes, no numbers, the offline text (Task 2).
5. A timestamp just before midnight UTC → shown as the next day, Athens time, regardless of the machine's zone (Task 3).

---

### Task 1: Request timeout on the Supabase client (M38)

**Files:**
- Create: `src/data/remote/timeoutFetch.ts`
- Modify: `src/data/remote/client.ts`, `src/data/remote/deviceErrors.ts` (`NETWORK_RE`), `src/data/remote/errors.ts` (`NETWORK_RE`)
- Test: create `tests/data/timeoutFetch.test.ts`; modify `tests/data/deviceErrors.test.ts`, `tests/data/remoteErrors.test.ts`

**Interfaces:**
- Produces:
  - `export const REQUEST_TIMEOUT_MS = 15000;`
  - `export const TIMEOUT_MESSAGE = 'request_timeout';`
  - `export function timeoutFetch(ms: number, base?: typeof fetch): typeof fetch` — `base` defaults to `globalThis.fetch` resolved at call time (not at creation).

**Decisions (not open to change):**
- Use `AbortController` + `setTimeout`, not `AbortSignal.timeout` / `AbortSignal.any` (older iOS Safari lacks them).
- On our timeout the returned promise rejects with `new Error(TIMEOUT_MESSAGE)`. This fixed text is what the mappers match: postgrest-js reports a thrown fetch error as `{ message: 'Error: request_timeout', … }`, auth-js as `AuthRetryableFetchError` (already mapped). Browser abort messages differ per engine, so they are not matched.
- If the caller passed `init.signal`: forward its abort to our controller (and abort at once if it is already aborted); when the caller's signal caused the abort, rethrow the original error, not `TIMEOUT_MESSAGE`.
- The timer is cleared when the fetch settles (resolve or reject). A response whose body stalls after the headers is not covered (note it in Task 5).
- Both mappers: add `request_timeout` to the existing `NETWORK_RE` alternation. No new error code, no new Greek message: a timeout is `network`, so the existing paths apply (gate → cached register or retry screen; engine → keep the item, retry after `NETWORK_RETRY_MS`; submit / owner save → the kept idempotency key answers `repeat` if the first attempt had landed).

- [ ] **Step 1: Create the branch and confirm the baseline**

```bash
git checkout -b fix/review-2026-11-11
npm run typecheck && npm test
```
Expected: typecheck clean, 805 passed (61 files).

- [ ] **Step 2: Write the failing tests**

`tests/data/timeoutFetch.test.ts` (node environment, `vi.useFakeTimers()`; restore real timers in `afterEach`). Use a fake base fetch that records its `init` and returns a promise that rejects with `init.signal.reason ?? new DOMException('aborted', 'AbortError')` when `init.signal` aborts, and that the test can resolve by hand.

```ts
it('rejects with request_timeout when the base fetch does not answer in time', async () => {
  const f = timeoutFetch(15000, hangingFetch);
  const p = f('https://x.test/rpc');
  const settled = expect(p).rejects.toThrow(TIMEOUT_MESSAGE);
  await vi.advanceTimersByTimeAsync(15000);
  await settled;
});
it('does not reject before the timeout', async () => {
  // advance 14999 ms → the promise is still pending
});
it('returns the response untouched and leaves no timer running', async () => {
  // resolve the base fetch with a Response → same object comes back; vi.getTimerCount() === 0
});
it('clears the timer when the base fetch rejects (e.g. Failed to fetch)', async () => {
  // base rejects with new TypeError('Failed to fetch') → same error; vi.getTimerCount() === 0
});
it("passes the caller's own abort through, not as a timeout", async () => {
  // const c = new AbortController(); f(url, { signal: c.signal }); c.abort();
  // → rejects, and the error message is NOT TIMEOUT_MESSAGE; vi.getTimerCount() === 0
});
it('aborts at once when the caller signal is already aborted', async () => { /* same assertion */ });
it('passes input and the other init fields to the base fetch', async () => {
  // method, headers, body arrive unchanged; init.signal is an AbortSignal
});
it('REQUEST_TIMEOUT_MS is 15000', () => expect(REQUEST_TIMEOUT_MS).toBe(15000));
```

In `tests/data/deviceErrors.test.ts`, inside «maps fetch failures to network», add:
```ts
expect(mapDeviceError(new Error('request_timeout'))).toEqual({ code: 'network' });
expect(mapDeviceError({ message: 'Error: request_timeout', code: '' })).toEqual({ code: 'network' });
```
In `tests/data/remoteErrors.test.ts`, inside «recognises network failures», add the same two lines with `mapError`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/data/timeoutFetch.test.ts tests/data/deviceErrors.test.ts tests/data/remoteErrors.test.ts`
Expected: FAIL (module not found; the mapper cases return `unknown`).

- [ ] **Step 4: Implement `timeoutFetch.ts` and extend both `NETWORK_RE`**

`timeoutFetch.ts` imports nothing. Keep the two regexes in step (same alternation in both files).

- [ ] **Step 5: Wire it into the client**

In `src/data/remote/client.ts`, add to the `createClient` options:
```ts
global: { fetch: timeoutFetch(REQUEST_TIMEOUT_MS) },
```
Update the file's doc comment with one sentence: every request made through this client fails as `network` after `REQUEST_TIMEOUT_MS`.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test`
Expected: clean; all tests pass (805 + the new ones).

- [ ] **Step 7: Commit**

```bash
git add src/data/remote/timeoutFetch.ts src/data/remote/client.ts src/data/remote/deviceErrors.ts src/data/remote/errors.ts tests/data
git commit -m "fix(remote): 15 s request timeout, reported as network (M38)"
```

---

### Task 2: «Σήμερα» shows its date and never another day's cached closing (L87)

**Files:**
- Modify: `src/features/owner/TodayScreen.tsx`
- Test: `tests/features/owner/today.test.tsx`

**Decisions:**
- The owner's browser never computes the business date. "The current day" is the `businessDate` of the last snapshot a `load()` returned in this mount.
- Wrap the writer inside the existing `useMemo`: after `createTodayWriter(api, shopId).load()` answers `ok`, store `r.data.businessDate` in a new state `loadedDate: string | null` (initial `null`), then return `r` unchanged. `write` and `live` are passed through.
- `const staleDay = state.snapshot !== null && state.snapshot.businessDate !== loadedDate;` When `staleDay`, treat `snapshot` and `draft` as `null` for everything rendered (same pattern as `RegisterScreen`'s `staleDay`). The existing `snapshot === null` branch then shows «Φόρτωση…» or, when `state.status === 'offline'`, «Το ταμείο θα φορτώσει μόλις υπάρξει σύνδεση.» — no new text.
- Consequence, accepted: an owner who opens «Σήμερα» with no connection sees no numbers until the first load succeeds (before: the cached ones, undated).
- Date line: a separate `<p className="sub">` holding exactly `formatDayEl(snapshot.businessDate)` (from `src/app/dates.ts`, e.g. «Σαβ 07/11»), rendered immediately above the existing «Υποβλήθηκε … / Δεν έχει υποβληθεί ακόμα» paragraph. Do not merge it into that paragraph (existing tests match its text).

- [ ] **Step 1: Write the failing tests** in `describe('TodayScreen')`, using the file's `setup`/`snap` helpers and `saveSnapshot` from `src/data/local/openClosing`:

```ts
it('L87: shows the business date of the closing', async () => {
  // default setup (snap businessDate '2026-11-07') → await screen.findByText('Σαβ 07/11')
});
it("L87: another day's cached closing is not shown before today's load", async () => {
  // store pre-seeded with saveSnapshot(store, SHOP, snap({ businessDate: '2026-11-06', fields: { 'c:<a channel id of joinJuicePreset>': {…text: '55'} } }))
  // todayClosing returns a promise the test resolves later with snap() ('2026-11-07')
  // before resolving: screen.queryByDisplayValue('55') is null, 'Φόρτωση…' is shown, 'Παρ 06/11' is not shown
  // after resolving: findByText('Σαβ 07/11'); queryByDisplayValue('55') still null
});
it('L87: offline with only a cached closing shows the offline text, no boxes', async () => {
  // same seeded store; todayClosing answers fail({ code: 'network' }) → findByText('Το ταμείο θα φορτώσει μόλις υπάρξει σύνδεση.'); no '55'
});
it('L87: after wrong_day the reloaded day is shown with its date', async () => {
  // extend the existing M1 flow: the resync returns snap({ id: 'oc-2', businessDate: '2026-11-08' }) → findByText('Κυρ 08/11')
});
```
Pass the seeded store the same way the existing «remembers the entry mode per shop» test passes one.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/features/owner/today.test.tsx`
Expected: the four new tests FAIL; the existing ones pass.

- [ ] **Step 3: Implement in `TodayScreen.tsx`** as decided above. `lastSubmit`, `changed`, `saveBlocked`, `saveLive` keep using the (guarded) `snapshot`.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npx vitest run tests/features/owner`
Expected: all pass, including every pre-existing test in `today.test.tsx` unchanged (they load before they assert). If a pre-existing test fails, stop and report.

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/TodayScreen.tsx tests/features/owner/today.test.tsx
git commit -m "fix(owner): Σήμερα shows its date and hides another day's cached closing (L87)"
```

---

### Task 3: Owner timestamps in shop time (L88)

**Files:**
- Modify: `src/features/owner/model/time.ts`
- Test: `tests/features/owner/model.test.ts` (and `tests/features/owner/devices.test.tsx` / `staff.test.tsx` only if their fixed expectations break)

**Interfaces (signatures unchanged):**
- `formatClock(iso: string): string` → `HH:MM` in Europe/Athens.
- `formatDate(iso: string): string` → `DD/MM/YYYY` in Europe/Athens.
- New rule for both: unparseable input is returned unchanged (today it prints `NaN`).

**Decisions:**
- `formatClock` delegates to `formatTimeEl` from `src/app/dates.ts`.
- `formatDate` uses one module-level `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: 'numeric' })` read through `formatToParts` (same style as `STAMP_EL` in `dates.ts`).
- `isLocked` is untouched.

- [ ] **Step 1: Replace the test «formats clock and date in Greek style»** in `tests/features/owner/model.test.ts` (it builds its ISO from local time, which hides the bug):

```ts
it('formats clock and date in shop time (Europe/Athens), whatever the machine zone', () => {
  expect(formatClock('2026-11-11T22:30:00Z')).toBe('00:30');     // EET, UTC+2
  expect(formatDate('2026-11-11T22:30:00Z')).toBe('12/11/2026');
  expect(formatClock('2026-07-01T21:30:00Z')).toBe('00:30');     // EEST, UTC+3
  expect(formatDate('2026-07-01T21:30:00Z')).toBe('02/07/2026');
  expect(formatDate('2026-09-29T06:05:00Z')).toBe('29/09/2026');
});
it('returns unparseable input unchanged', () => {
  expect(formatClock('nope')).toBe('nope');
  expect(formatDate('nope')).toBe('nope');
});
```

- [ ] **Step 2: Run to see it fail** — `TZ=UTC npx vitest run tests/features/owner/model.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run in two zones**

```bash
TZ=UTC npx vitest run tests/features/owner && TZ=America/New_York npx vitest run tests/features/owner
```
Expected: all pass in both. If `devices.test.tsx` («Τελευταία χρήση 10/11/2026», «09/11/2026») fails, its fixture timestamp falls on another Athens date: change the fixture timestamp to midday UTC of the same date, not the expectation.

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/model/time.ts tests/features/owner
git commit -m "fix(owner): staff lock and device last-use times in Europe/Athens (L88)"
```

---

### Task 4: «Καταχώρηση αλλαγών» guards on the newest known version (L89)

**Files:**
- Modify: `src/features/owner/TodayScreen.tsx`
- Test: `tests/features/owner/today.test.tsx` (inside `describe('«Άλλαξε μετά την υποβολή»')`)

**Decision:** the override is valid only for the `lastSubmit` it was learned against.
- State becomes `useState<{ forSubmit: string; id: string } | null>(null)`.
- On `closing_changed` with a non-null `currentId`: store `{ forSubmit: lastSubmit.closingId, id: currentId }`.
- The save sends `expectedCurrentId: expectedOverride?.forSubmit === lastSubmit.closingId ? expectedOverride.id : lastSubmit.closingId`.
- Cleared on a successful save, as now.

- [ ] **Step 1: Write the failing test**

```ts
it('L89: after closing_changed, a newer submit replaces the remembered version', async () => {
  // snapshot: lastSubmit { closingId: 'v1', revision: 1 }, revision 2  → the card is shown
  // saveClosing #1 → fail({ code: 'closing_changed', currentId: 'v2' })
  // then a `submitted` broadcast on the fake channel: { closingId: 'v3', staffName: 'ΜΑΡΙΑ', at: …, revision: 1 }
  //   (revision 1 < snapshot revision, so the card stays), and todayClosing now returns the same lastSubmit
  // click «Καταχώρηση αλλαγών» again → saveClosing #2 was called with expectedCurrentId: 'v3'
});
```
Also keep (or add, if missing) the neighbour case: with no broadcast in between, call #2 carries `expectedCurrentId: 'v2'`.

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/features/owner/today.test.tsx` → the new test FAILS with `'v2'` received.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** — `npm run typecheck && npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/owner/TodayScreen.tsx tests/features/owner/today.test.tsx
git commit -m "fix(owner): today save drops a remembered version once a newer submit arrives (L89)"
```

---

### Task 5: Docs (last step)

**Files:** `README.md`, `PROJECT_STATUS.md`, `CLAUDE.md`. No code.

- [ ] **Step 1: `README.md`**
  - Deploy step 3: replace «No environment variables are needed yet (Supabase arrives in Plan 3; …)» with: register `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel before the first deploy (the build ships with them `undefined` otherwise; see the dashboard section).
  - Database: replace «Before the owner app works: … allow anonymous sign-ins» with: phones join a store as anonymous users, so anonymous sign-ins must be enabled before a phone can enter a store.

- [ ] **Step 2: `PROJECT_STATUS.md`**
  - Stages, stage 4 line: «code complete on `stage-4-store-link-entry`» → «code complete, merged to `main`».
  - Add a section `## Review findings (2026-11-11 whole-project scan)` after «Stage 4 findings», with a table in the file's format (ID · Issue · Fix · Status) for M38, L87, L88, L89, each `fixed` with its commit hash and its "why" (take the Issue text from the Findings table above).
  - In the same section add two open items: `L90` — a response whose body stalls after the headers is not covered by the request timeout (timer is cleared when the fetch settles); `L91` — an owner opening «Σήμερα» offline sees no cached numbers (accepted trade-off of L87).
  - Tests section: remove the stale mentions of pairing («limits, pairing, messages», «devices + pairing countdown»); add one paragraph for this change with the real `npm test` count and file count from Step 4, `typecheck` and `build` results, and the new test file `tests/data/timeoutFetch.test.ts`.
  - Not verified: in the stage-1 list, steps 2–3 and 9 still say «create a pairing code» / «enter the code» / «the pairing screen»: reword to the store link and the entry screen. Add under a new bullet for this change: the 15 s timeout has only run against fakes — not verified on a real phone with a stalled network (devtools throttling "offline after connect" or a captive Wi-Fi), nor that supabase-js surfaces the timeout to `mapDeviceError`/`mapError` as `Error: request_timeout` / `AuthRetryableFetchError` against the real API.

- [ ] **Step 3: `CLAUDE.md`**
  - Architecture, `src/data/remote/` bullet: add `timeoutFetch.ts` (the client's fetch: every request fails as `network` after `REQUEST_TIMEOUT_MS` = 15 s).
  - Invariants: add «Every Supabase request goes through `timeoutFetch` (set once in `client.ts`). A timeout rejects with the fixed message `request_timeout`, which both `mapDeviceError` and `mapError` map to `network` (cross-file: the message in `timeoutFetch.ts` and both `NETWORK_RE`). Never add a second client or a raw `fetch`.»
  - Live shared closing, «Owner «Σήμερα»» bullet: add that it shows the snapshot's business date and renders a snapshot only when its `businessDate` equals the one of the last successful load in this mount (no cached closing of another day, none while offline at startup).
  - Stage 3 «Today's versions» bullet: add the `expectedOverride` rule (valid only for the `lastSubmit.closingId` it was learned against).

- [ ] **Step 4: Final verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: clean; all tests pass; build ok. Put the real numbers into `PROJECT_STATUS.md` (Step 2).

- [ ] **Step 5: Commit**

```bash
git add README.md PROJECT_STATUS.md CLAUDE.md
git commit -m "docs: review fixes 2026-11-11 (M38, L87–L89), stale stage-4 statements"
```

- [ ] **Step 6: Report** — list the commits, the final test count, anything that deviated from this plan, and repeat the "Not verified" items. Do not push or merge.
