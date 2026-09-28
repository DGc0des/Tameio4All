# Tameio4All Plan 2 — Register UI (local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The register screen staff use at the till — count cash, log expenses and other income, see totals, get the Φάκελος breakdown, submit and share the closing — as a React web app running on the Join Juice preset with on-device storage, deployed to Vercel.

**Architecture:** Vite + React 19 + TypeScript on top of the tested `src/core`. A pure draft model (`draft.ts`) holds the raw typed text; a pure `deriveClosing` is the only bridge from text to money (it calls core). Components only render and dispatch. All `localStorage` access lives in `src/data/local`. Components are built and tested one by one (Tasks 6–12), then composed once in `RegisterScreen`/`App` with end-to-end flow tests (Task 13).

**Tech Stack:** React 19.3, Vite 8, @vitejs/plugin-react 6, TypeScript 7 (strict), Vitest 5 (node + jsdom), Testing Library (React 16, DOM 10), @fontsource/inter 5, html-to-image 1.11.

**Spec:** `docs/superpowers/specs/2026-09-28-plan-2-register-ui-design.md` (parent: `docs/superpowers/specs/2026-09-28-tameio4all-v1-design.md`)

## Global Constraints

- UI copy is Greek, exactly as written in this plan; code, comments and test names are English.
- Components never parse or add money themselves. Text → cents goes through `deriveClosing` (Task 5) or core helpers (`parseAmount`, `sumAmounts`); display goes through `formatEuro`.
- Only `src/data/local/*` touches `localStorage`. Every storage call is wrapped so a failure never throws into the UI.
- No shop data in code except `src/app/shop.ts` `LOCAL_SHOP` (DEV ONLY, uses `joinJuicePreset`). No staff names in code.
- Colour tokens and values exactly as in the spec table (light + dark). Font Inter with `font-variant-numeric: tabular-nums`.
- Touch targets ≥ 44px; inputs use `font-size: 16px` (prevents iOS zoom) and `inputMode` decimal/numeric.
- € mode shows no piece count beside a field; # mode shows the row's euro value in grey beside it.
- The Z photo is attached to the share only — never stored anywhere.
- `src/core` stays pure (the existing `tests/core-purity.test.ts` must keep passing).
- UI tests start with `// @vitest-environment jsdom`, import `cleanup` and register `afterEach(cleanup)`; they import real modules (no re-implemented logic).
- `npm test` and `npm run typecheck` pass before every commit; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Storage write fails at Υποβολή** (quota full / private mode) → the user sees "Δεν αποθηκεύτηκε. Δοκίμασε ξανά.", nothing claims success, the draft is kept. Pinned in Task 13.
2. **Corrupt or old-format draft in storage** → the app starts with a fresh form, no crash. Pinned in Task 13.
3. **Greek thousands separator typed in € mode** ("1.500" in the 100€ field) → flagged invalid, never silently read as 1,50€. Pinned in Task 13.
4. **Υποβολή tapped twice / retried** → exactly one stored closing. Pinned in Task 4 (`saveSubmission` duplicate) and Task 10 (button disappears after save).
5. **Comma decimals everywhere** ("45,60" in a channel, "7,80" in an expense) → counted exactly like a dot. Pinned in Task 5 and Task 13.

---

## File Structure

```
index.html                      Vite entry (lang="el", viewport, theme-color)
vite.config.ts                  React plugin + Vitest config
src/main.tsx                    mounts <App/>, imports fonts + theme.css
src/app/App.tsx                 composition: store, route, staff, theme, error boundary
src/app/theme.css               tokens (light/dark) + all component styles
src/app/theme.ts                applyTheme / nextTheme / THEME_LABELS
src/app/router.ts               hash routes: register | tare | staff
src/app/dates.ts                todayIso, isIsoDate, formatDayEl, formatDateEl
src/app/ids.ts                  randomId (crypto.randomUUID with fallback)
src/app/shop.ts                 LOCAL_SHOP (DEV ONLY)
src/app/ErrorBoundary.tsx
src/ui/AmountField.tsx, Card.tsx, Sheet.tsx          primitives
src/data/local/storage.ts       KeyValueStore, memoryStore, browserStore, pickStore, readJson/writeJson, shopKey
src/data/local/drafts.ts        loadDraft / saveDraft / clearDraft (10 h TTL)
src/data/local/submissions.ts   Submission, loadSubmissions / saveSubmission / pastExpenses
src/data/local/staff.ts         normalizeStaff / loadStaff / saveStaff
src/data/local/prefs.ts         ThemePref, loadTheme / saveTheme
src/features/register/draft.ts          Draft model + reducer (pure)
src/features/register/derive.ts         deriveClosing + block reasons (pure)
src/features/register/coinCalc.ts       sumAmounts (pure)
src/features/register/share.ts          shareCard (html-to-image + Web Share)
src/features/register/useDraftAutosave.ts
src/features/register/{ModeSwitch,CountCard,ChannelsCard,SummaryCard,BottomBar,ExpensesCard,
                       EnvelopeSheet,SubmitSheet,PeopleSheet,HeaderMenu,CoinCalcSheet,RegisterScreen}.tsx
src/features/staff/StaffScreen.tsx
src/features/tare/TareScreen.tsx
src/core/money.ts               + formatEuro
tests/core/money.test.ts        + formatEuro tests
tests/app/*, tests/data/*, tests/features/*   new tests
```

---

### Task 1: `formatEuro` in core

**Files:**
- Modify: `src/core/money.ts` (append)
- Test: `tests/core/money.test.ts` (append)

**Interfaces:**
- Produces: `formatEuro(c: Cents): string` — Greek format: `185520 → "1.855,20€"`, `-100000 → "-1.000,00€"`, `5 → "0,05€"`.

- [ ] **Step 1: Append the failing tests to `tests/core/money.test.ts`**

Add `formatEuro` to the existing import from `'../../src/core/money'`, then append:

```ts
describe('formatEuro', () => {
  it.each([
    [185520, '1.855,20€'],
    [5, '0,05€'],
    [0, '0,00€'],
    [-100000, '-1.000,00€'],
    [123456789, '1.234.567,89€'],
    [99999, '999,99€'],
    [-5, '-0,05€'],
  ])('%i → %s', (c, out) => {
    expect(formatEuro(c)).toBe(out);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/money.test.ts`
Expected: FAIL — `formatEuro` is not exported.

- [ ] **Step 3: Append to `src/core/money.ts`**

```ts
/** Greek display format: 185520 → "1.855,20€" (dot thousands, comma decimals). */
export function formatEuro(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${whole},${String(a % 100).padStart(2, '0')}€`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS (purity test still passes), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/money.ts tests/core/money.test.ts
git commit -m "feat(core): formatEuro for Greek-formatted amounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Vite + React scaffold, theme, test infrastructure

**Files:**
- Create: `index.html`, `vite.config.ts`, `src/main.tsx`, `src/app/App.tsx`, `src/app/theme.css`, `tests/app/smoke.test.tsx`
- Modify: `package.json` (scripts), `tsconfig.json`

**Interfaces:**
- Produces: `App` component (placeholder here; replaced in Task 13); the CSS class vocabulary every later component uses (`app, top, page, meta-btn, icon-btn, seg, card, card-head, row, row-label, row-hint, field, link, chips, chip, tot, bar-wrap, bar, bar-amt, btn, btn-primary, btn-text, blocked, sheet-backdrop, sheet, sheet-grab, sub, list, list-row, status-ok, status-warn, rest, toast, menu-wrap, menu, notice, notice-soft, choices, choice, wide, sheet-actions, share-card, share-head, share-left, date-label, tare-net, expense`).

- [ ] **Step 1: Install dependencies**

```bash
npm install react@^19.3.0 react-dom@^19.3.0 @fontsource/inter@^5.3.0 html-to-image@^1.11.13
npm install -D vite@^8.3.1 @vitejs/plugin-react@^6.1.1 @types/react@^19.3.0 @types/react-dom@^19.3.0 jsdom@^30.1.1 @testing-library/react@^16.3.3 @testing-library/dom@^10
```

- [ ] **Step 2: Update `package.json` scripts** to exactly:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 3: Replace `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node' },
});
```

- [ ] **Step 5: Write the failing smoke test `tests/app/smoke.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { App } from '../../src/app/App';

afterEach(cleanup);

it('renders the register title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/app/smoke.test.tsx`
Expected: FAIL — cannot resolve `../../src/app/App`.

- [ ] **Step 7: Write `index.html`**

```html
<!doctype html>
<html lang="el">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#F4F1EA" />
    <title>Ταμείο</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Write `src/app/App.tsx` (placeholder, replaced in Task 13)**

```tsx
export function App() {
  return (
    <div className="app">
      <header className="top">
        <h1>Κλείσιμο ταμείου</h1>
      </header>
    </div>
  );
}
```

- [ ] **Step 9: Write `src/main.tsx`**

```tsx
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './app/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 10: Write `src/app/theme.css`**

```css
:root {
  --bg: #F4F1EA; --surface: #FFFDF9; --field: #F4F1EA; --ink: #1D1B17; --muted: #8A8376;
  --faint: #B0A99B; --line: #E9E3D6; --accent: #2F6B4F; --accent-ink: #FFFFFF;
  --accent-soft: #EDF3EF; --danger: #B3261E; --danger-soft: #FBECEA; --warn: #9A6200;
  color-scheme: light;
}
:root[data-theme='dark'] {
  --bg: #151412; --surface: #1F1D1A; --field: #2A2723; --ink: #F1EDE4; --muted: #9B9486;
  --faint: #6E685E; --line: #2E2B26; --accent: #6FBF95; --accent-ink: #0F1A14;
  --accent-soft: #1D2A23; --danger: #F2877F; --danger-soft: #3A1F1D; --warn: #E6B566;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #151412; --surface: #1F1D1A; --field: #2A2723; --ink: #F1EDE4; --muted: #9B9486;
    --faint: #6E685E; --line: #2E2B26; --accent: #6FBF95; --accent-ink: #0F1A14;
    --accent-soft: #1D2A23; --danger: #F2877F; --danger-soft: #3A1F1D; --warn: #E6B566;
    color-scheme: dark;
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body {
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-variant-numeric: tabular-nums; -webkit-text-size-adjust: 100%; line-height: 1.35;
}
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.app { max-width: 480px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; }
.page { flex: 1; padding: 0 12px 16px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 22px 12px 8px; }
.top h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.meta-btn { display: block; background: none; border: 0; padding: 4px 0; min-height: 44px; color: var(--muted); font-size: 14px; text-align: left; }
.icon-btn { background: none; border: 0; min-width: 44px; min-height: 44px; border-radius: 12px; font-size: 20px; color: var(--ink); }

.seg { display: flex; background: var(--field); border-radius: 12px; padding: 4px; margin: 6px 0 4px; }
.seg button { flex: 1; border: 0; background: transparent; min-height: 44px; padding: 10px 6px; border-radius: 9px; font-size: 14px; color: var(--muted); }
.seg button[aria-pressed='true'] { background: var(--surface); color: var(--ink); font-weight: 650; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }

.card { background: var(--surface); border-radius: 20px; margin: 10px 0; padding: 14px 16px; }
.card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.card-head h2 { margin: 0; font-size: 15px; font-weight: 650; }
.card-head span { font-size: 14px; color: var(--muted); }

.row { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 2px 0; }
.row-label { flex: 1; font-size: 15px; }
.row-hint { font-size: 12px; color: var(--faint); margin: 0; }
.row-hint.err { color: var(--danger); }
.field { width: 110px; min-height: 40px; background: var(--field); border: 0; border-radius: 10px; padding: 8px 10px; font-size: 16px; font-weight: 600; text-align: right; }
.field::placeholder { color: var(--faint); font-weight: 400; }
.field[aria-invalid='true'] { background: var(--danger-soft); color: var(--danger); }
.field.text { flex: 1; width: auto; min-width: 0; text-align: left; font-weight: 500; }
.expense { padding: 2px 0 4px; }

.link { background: none; border: 0; padding: 8px 0; min-height: 44px; font-size: 14px; font-weight: 600; color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 6px; }
.chip { border: 0; min-height: 32px; padding: 6px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 13px; }

.tot { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 14px; color: var(--muted); }
.tot b { color: var(--ink); }
.tot.main { padding-top: 8px; font-size: 20px; font-weight: 700; color: var(--ink); }

.bar-wrap { position: sticky; bottom: 0; background: var(--surface); box-shadow: 0 -1px 0 var(--line); }
.bar { display: flex; align-items: center; gap: 10px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
.bar-amt { flex: 1; }
.bar-amt small { display: block; font-size: 12px; color: var(--muted); }
.bar-amt strong { font-size: 22px; font-weight: 700; }
.blocked { margin: 0; padding: 10px 16px 0; font-size: 13px; color: var(--danger); }

.btn { border: 0; border-radius: 12px; min-height: 44px; padding: 11px 16px; font-size: 15px; font-weight: 650; }
.btn-primary { background: var(--accent); color: var(--accent-ink); }
.btn-text { background: none; color: var(--accent); }
.btn:disabled { opacity: 0.45; cursor: default; }
.wide { display: block; width: 100%; margin-top: 14px; }

.sheet-backdrop { position: fixed; inset: 0; z-index: 10; display: flex; align-items: flex-end; justify-content: center; background: rgba(29, 27, 23, 0.35); }
.sheet { width: 100%; max-width: 480px; max-height: 90dvh; overflow: auto; background: var(--surface); border-radius: 24px 24px 0 0; padding: 12px 20px calc(22px + env(safe-area-inset-bottom)); }
.sheet-grab { width: 36px; height: 4px; margin: 0 auto 14px; border-radius: 4px; background: var(--line); }
.sheet h2 { margin: 0; font-size: 20px; font-weight: 700; }
.sub { margin: 2px 0 14px; font-size: 13px; color: var(--muted); }
.sheet-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.list { list-style: none; margin: 0; padding: 0; }
.list-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; }
.status-ok { margin: 12px 0 0; font-weight: 600; color: var(--accent); }
.status-warn { margin: 12px 0 0; font-weight: 600; color: var(--warn); }
.rest { margin-top: 10px; font-size: 14px; color: var(--muted); }
.rest summary { min-height: 44px; display: flex; align-items: center; }

.share-card { background: var(--surface); padding: 4px 0 8px; }
.share-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
.share-left { margin: 8px 0 0; font-size: 13px; color: var(--muted); }
.share-left span { color: var(--ink); font-weight: 600; }

.choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
.choice { border: 0; min-height: 44px; padding: 10px 14px; border-radius: 12px; background: var(--field); font-size: 15px; }
.choice[aria-checked='true'] { background: var(--accent); color: var(--accent-ink); font-weight: 650; }
.date-label { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; font-size: 13px; color: var(--muted); }

.menu-wrap { position: relative; }
.menu { position: absolute; right: 0; top: 48px; z-index: 5; display: flex; flex-direction: column; min-width: 180px; padding: 6px; border-radius: 14px; background: var(--surface); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15); }
.menu button { background: none; border: 0; min-height: 44px; padding: 10px 14px; border-radius: 10px; text-align: left; }

.toast { position: fixed; left: 50%; bottom: 110px; z-index: 20; transform: translateX(-50%); padding: 10px 16px; border-radius: 12px; background: var(--ink); color: var(--bg); font-size: 14px; }
.notice { margin: 8px 12px 0; padding: 10px 12px; border-radius: 12px; background: var(--danger-soft); color: var(--danger); font-size: 13px; }
.notice-soft { margin: 8px 0; font-size: 13px; color: var(--muted); }
.tare-net { min-width: 64px; text-align: right; }

@media (prefers-reduced-motion: no-preference) {
  .sheet { animation: sheet-in 0.2s ease-out; }
  @keyframes sheet-in { from { transform: translateY(24px); opacity: 0.6; } to { transform: none; opacity: 1; } }
}
```

- [ ] **Step 11: Run tests, typecheck and a production build**

Run: `npm test && npm run build`
Expected: all tests PASS (smoke included); `tsc` clean; `vite build` writes `dist/`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: Vite + React scaffold, theme tokens, jsdom test setup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dates and the draft model (pure)

**Files:**
- Create: `src/app/dates.ts`, `src/features/register/draft.ts`
- Test: `tests/app/dates.test.ts`, `tests/features/register/draft.test.ts`

**Interfaces:**
- Consumes: `convertEntry`, `EntryMode` (core/denominations); `sanitizeAmountInput` (core/money).
- Produces:
  - `todayIso(now: Date): string` (local date `YYYY-MM-DD`), `isIsoDate(s: string): boolean`, `formatDayEl(iso: string): string` (`"Δευ 28/09"`), `formatDateEl(iso: string): string` (`"28/09/2026"`).
  - `interface ExpenseDraft { id: string; description: string; amountText: string }`
  - `interface Draft { id: string; staffName: string; businessDate: string; mode: EntryMode; entries: Record<string, string>; channels: Record<string, string>; expenses: ExpenseDraft[] }` — `entries` keyed by `String(denominationCents)`, `channels` by channel id.
  - `newDraft(id: string, businessDate: string, staffName?: string, mode?: EntryMode): Draft`
  - `type DraftAction` (below), `type DraftDispatch = (action: DraftAction) => void`, `draftReducer(draft: Draft, action: DraftAction): Draft`, `isDraft(x: unknown): x is Draft`.

- [ ] **Step 1: Write the failing test `tests/app/dates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatDateEl, formatDayEl, isIsoDate, todayIso } from '../../src/app/dates';

describe('dates', () => {
  it('todayIso uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 8, 28, 23, 59))).toBe('2026-09-28');
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('isIsoDate accepts real dates only', () => {
    expect(isIsoDate('2026-09-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('28/09/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('formats Greek day labels and full dates', () => {
    expect(formatDayEl('2026-09-28')).toBe('Δευ 28/09');
    expect(formatDayEl('2026-09-27')).toBe('Κυρ 27/09');
    expect(formatDateEl('2026-09-28')).toBe('28/09/2026');
    expect(formatDayEl('nonsense')).toBe('nonsense');
  });
});
```

- [ ] **Step 2: Write the failing test `tests/features/register/draft.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { draftReducer, isDraft, newDraft, type Draft } from '../../../src/features/register/draft';

const base = (): Draft => newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ');

describe('draftReducer', () => {
  it('sanitizes typed amounts (comma → dot, junk stripped)', () => {
    let d = draftReducer(base(), { type: 'setEntry', denom: 10000, text: '12,5' });
    expect(d.entries['10000']).toBe('12.5');
    d = draftReducer(d, { type: 'setChannel', id: 'wolt', text: '5-3a' });
    expect(d.channels.wolt).toBe('53');
  });

  it('converts entries when the mode changes and keeps invalid text as typed', () => {
    let d = draftReducer(base(), { type: 'setEntry', denom: 10000, text: '500' });
    d = draftReducer(d, { type: 'setEntry', denom: 1000, text: '55' });
    d = draftReducer(d, { type: 'setMode', mode: 'count', denominations: [10000, 1000] });
    expect(d.mode).toBe('count');
    expect(d.entries).toEqual({ '10000': '5', '1000': '55' });
    d = draftReducer(d, { type: 'setMode', mode: 'amount', denominations: [10000, 1000] });
    expect(d.entries['10000']).toBe('500');
  });

  it('setMode to the current mode is a no-op', () => {
    const d = base();
    expect(draftReducer(d, { type: 'setMode', mode: 'amount', denominations: [10000] })).toBe(d);
  });

  it('adds expenses up to the maximum, edits and removes them', () => {
    let d = draftReducer(base(), { type: 'addExpense', id: 'e1', max: 2 });
    d = draftReducer(d, { type: 'addExpense', id: 'e2', max: 2 });
    d = draftReducer(d, { type: 'addExpense', id: 'e3', max: 2 });
    expect(d.expenses.map((e) => e.id)).toEqual(['e1', 'e2']);
    d = draftReducer(d, { type: 'setExpense', id: 'e1', description: ' Nice ', amountText: '7,80' });
    expect(d.expenses[0]).toEqual({ id: 'e1', description: ' Nice ', amountText: '7.80' });
    d = draftReducer(d, { type: 'setExpense', id: 'e1', amountText: '9' });
    expect(d.expenses[0]?.description).toBe(' Nice ');
    d = draftReducer(d, { type: 'removeExpense', id: 'e1' });
    expect(d.expenses.map((e) => e.id)).toEqual(['e2']);
  });

  it('trims staff names and rejects invalid dates', () => {
    let d = draftReducer(base(), { type: 'setStaff', name: '  ΜΑΡΙΑ ' });
    expect(d.staffName).toBe('ΜΑΡΙΑ');
    d = draftReducer(d, { type: 'setDate', date: '2026-02-30' });
    expect(d.businessDate).toBe('2026-09-28');
    d = draftReducer(d, { type: 'setDate', date: '2026-09-27' });
    expect(d.businessDate).toBe('2026-09-27');
  });

  it('resetInputs clears amounts but keeps staff, date and mode, with a new id', () => {
    let d = draftReducer(base(), { type: 'setEntry', denom: 10000, text: '500' });
    d = draftReducer(d, { type: 'setMode', mode: 'count', denominations: [10000] });
    d = draftReducer(d, { type: 'addExpense', id: 'e1', max: 10 });
    d = draftReducer(d, { type: 'resetInputs', id: 'd2' });
    expect(d).toEqual({
      id: 'd2', staffName: 'ΓΚΡΕΖΙΟΣ', businessDate: '2026-09-28', mode: 'count',
      entries: {}, channels: {}, expenses: [],
    });
  });

  it('replace swaps the whole draft', () => {
    const other = newDraft('x', '2026-01-01');
    expect(draftReducer(base(), { type: 'replace', draft: other })).toBe(other);
  });
});

describe('isDraft', () => {
  it('accepts a real draft and rejects junk', () => {
    expect(isDraft(base())).toBe(true);
    expect(isDraft(JSON.parse(JSON.stringify(base())))).toBe(true);
    expect(isDraft(null)).toBe(false);
    expect(isDraft({ id: 5 })).toBe(false);
    expect(isDraft({ ...base(), mode: 'pieces' })).toBe(false);
    expect(isDraft({ ...base(), entries: { '500': 5 } })).toBe(false);
    expect(isDraft({ ...base(), expenses: [{ id: 'e1' }] })).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx vitest run tests/app/dates.test.ts tests/features/register/draft.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/app/dates.ts`**

```ts
const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD (the shop's business day, not UTC). */
export function todayIso(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

const DAYS_EL = ['Κυρ', 'Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ'];

/** "2026-09-28" → "Δευ 28/09". Unknown input is returned unchanged. */
export function formatDayEl(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  return `${DAYS_EL[new Date(y, mo - 1, d).getDay()]} ${pad(d)}/${pad(mo)}`;
}

/** "2026-09-28" → "28/09/2026". Unknown input is returned unchanged. */
export function formatDateEl(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}
```

- [ ] **Step 5: Write `src/features/register/draft.ts`**

```ts
import { isIsoDate } from '../../app/dates';
import { convertEntry, type EntryMode } from '../../core/denominations';
import { sanitizeAmountInput } from '../../core/money';

export interface ExpenseDraft {
  id: string;
  description: string;
  amountText: string;
}

/** Everything the person typed, as text. Money is only derived from it by deriveClosing. */
export interface Draft {
  id: string;
  staffName: string;
  businessDate: string;
  mode: EntryMode;
  /** Keyed by String(denominationCents). */
  entries: Record<string, string>;
  /** Keyed by channel id. */
  channels: Record<string, string>;
  expenses: ExpenseDraft[];
}

export function newDraft(id: string, businessDate: string, staffName = '', mode: EntryMode = 'amount'): Draft {
  return { id, staffName, businessDate, mode, entries: {}, channels: {}, expenses: [] };
}

export type DraftAction =
  | { type: 'setEntry'; denom: number; text: string }
  | { type: 'setChannel'; id: string; text: string }
  | { type: 'setMode'; mode: EntryMode; denominations: readonly number[] }
  | { type: 'addExpense'; id: string; max: number }
  | { type: 'setExpense'; id: string; description?: string; amountText?: string }
  | { type: 'removeExpense'; id: string }
  | { type: 'setStaff'; name: string }
  | { type: 'setDate'; date: string }
  | { type: 'resetInputs'; id: string }
  | { type: 'replace'; draft: Draft };

export type DraftDispatch = (action: DraftAction) => void;

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'setEntry':
      return { ...draft, entries: { ...draft.entries, [String(action.denom)]: sanitizeAmountInput(action.text) } };
    case 'setChannel':
      return { ...draft, channels: { ...draft.channels, [action.id]: sanitizeAmountInput(action.text) } };
    case 'setMode': {
      if (action.mode === draft.mode) return draft;
      const entries: Record<string, string> = {};
      for (const d of action.denominations) {
        const text = draft.entries[String(d)];
        if (text !== undefined && text !== '') entries[String(d)] = convertEntry(text, d, draft.mode, action.mode);
      }
      return { ...draft, mode: action.mode, entries };
    }
    case 'addExpense':
      if (draft.expenses.length >= action.max) return draft;
      return { ...draft, expenses: [...draft.expenses, { id: action.id, description: '', amountText: '' }] };
    case 'setExpense':
      return {
        ...draft,
        expenses: draft.expenses.map((e) =>
          e.id !== action.id
            ? e
            : {
                ...e,
                ...(action.description !== undefined ? { description: action.description } : {}),
                ...(action.amountText !== undefined ? { amountText: sanitizeAmountInput(action.amountText) } : {}),
              },
        ),
      };
    case 'removeExpense':
      return { ...draft, expenses: draft.expenses.filter((e) => e.id !== action.id) };
    case 'setStaff':
      return { ...draft, staffName: action.name.trim() };
    case 'setDate':
      return isIsoDate(action.date) ? { ...draft, businessDate: action.date } : draft;
    case 'resetInputs':
      return newDraft(action.id, draft.businessDate, draft.staffName, draft.mode);
    case 'replace':
      return action.draft;
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStringRecord = (x: unknown): boolean => isObj(x) && Object.values(x).every((v) => typeof v === 'string');
const isExpenseDraft = (x: unknown): boolean =>
  isObj(x) && typeof x.id === 'string' && typeof x.description === 'string' && typeof x.amountText === 'string';

/** Guards drafts read back from storage (they may be from an older app version or corrupted). */
export function isDraft(x: unknown): x is Draft {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.staffName === 'string' &&
    typeof x.businessDate === 'string' &&
    (x.mode === 'amount' || x.mode === 'count') &&
    isStringRecord(x.entries) &&
    isStringRecord(x.channels) &&
    Array.isArray(x.expenses) &&
    x.expenses.every(isExpenseDraft)
  );
}
```

- [ ] **Step 6: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(register): pure draft model and Greek date helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: On-device storage layer

**Files:**
- Create: `src/data/local/storage.ts`, `src/data/local/drafts.ts`, `src/data/local/submissions.ts`, `src/data/local/staff.ts`, `src/data/local/prefs.ts`
- Test: `tests/data/local.test.ts`

**Interfaces:**
- Consumes: `Draft`, `isDraft` (Task 3); `ClosingInputs` (core/formula); `PastExpense` (core/suggestions).
- Produces:
  - `interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }`
  - `memoryStore(): KeyValueStore`, `browserStore(): KeyValueStore | null`, `interface AppStore { store: KeyValueStore; persistent: boolean }`, `pickStore(): AppStore`
  - `shopKey(shopId: string, name: string): string` → `tameio4all:v1:<shopId>:<name>`; `readJson(store, key): unknown` (null on missing/garbage/throw); `writeJson(store, key, value): boolean`; `removeKey(store, key): void`
  - `DRAFT_TTL_MS = 36_000_000`; `loadDraft(store, shopId, nowMs): Draft | null`; `saveDraft(store, shopId, draft, nowMs): boolean`; `clearDraft(store, shopId): void`
  - `interface Submission { id: string; shopId: string; staffName: string; businessDate: string; submittedAt: string; inputs: ClosingInputs }`; `type SaveResult = 'saved' | 'duplicate' | 'failed'`; `MAX_SUBMISSIONS = 500`; `loadSubmissions(store, shopId): Submission[]`; `saveSubmission(store, submission): SaveResult`; `pastExpenses(subs: readonly Submission[]): PastExpense[]`
  - `normalizeStaff(names: readonly unknown[]): string[]`; `loadStaff(store, shopId): string[]`; `saveStaff(store, shopId, names: readonly string[]): string[] | null`
  - `type ThemePref = 'system' | 'light' | 'dark'`; `loadTheme(store): ThemePref`; `saveTheme(store, pref): boolean`

- [ ] **Step 1: Write the failing test `tests/data/local.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { ClosingInputs } from '../../src/core/formula';
import { clearDraft, DRAFT_TTL_MS, loadDraft, saveDraft } from '../../src/data/local/drafts';
import { loadTheme, saveTheme } from '../../src/data/local/prefs';
import { loadStaff, normalizeStaff, saveStaff } from '../../src/data/local/staff';
import {
  memoryStore, readJson, removeKey, shopKey, writeJson, type KeyValueStore,
} from '../../src/data/local/storage';
import {
  loadSubmissions, MAX_SUBMISSIONS, pastExpenses, saveSubmission, type Submission,
} from '../../src/data/local/submissions';
import { newDraft } from '../../src/features/register/draft';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

const inputs = (expenses: ClosingInputs['expenses'] = []): ClosingInputs => ({
  schema: 1, counts: { '10000': 5 }, channelCents: {}, expenses,
});
const sub = (id: string, expenses: ClosingInputs['expenses'] = []): Submission => ({
  id, shopId: 'local', staffName: 'ΓΚΡΕΖΙΟΣ', businessDate: '2026-09-28',
  submittedAt: '2026-09-28T21:00:00.000Z', inputs: inputs(expenses),
});

describe('storage', () => {
  it('namespaces keys per shop', () => {
    expect(shopKey('local', 'draft')).toBe('tameio4all:v1:local:draft');
  });

  it('round-trips JSON and treats garbage as missing', () => {
    const s = memoryStore();
    expect(writeJson(s, 'k', { a: 1 })).toBe(true);
    expect(readJson(s, 'k')).toEqual({ a: 1 });
    s.setItem('bad', '{{{');
    expect(readJson(s, 'bad')).toBeNull();
    expect(readJson(s, 'missing')).toBeNull();
  });

  it('never throws when the browser store fails', () => {
    expect(readJson(throwing, 'k')).toBeNull();
    expect(writeJson(throwing, 'k', 1)).toBe(false);
    expect(() => removeKey(throwing, 'k')).not.toThrow();
  });
});

describe('drafts', () => {
  const now = 1_790_000_000_000;

  it('restores a draft saved within 10 hours', () => {
    const s = memoryStore();
    const d = newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ');
    expect(saveDraft(s, 'local', d, now)).toBe(true);
    expect(loadDraft(s, 'local', now + DRAFT_TTL_MS - 1)).toEqual(d);
  });

  it('drops an expired draft and deletes it', () => {
    const s = memoryStore();
    saveDraft(s, 'local', newDraft('d1', '2026-09-28'), now);
    expect(loadDraft(s, 'local', now + DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.getItem(shopKey('local', 'draft'))).toBeNull();
  });

  it('drops a malformed draft', () => {
    const s = memoryStore();
    s.setItem(shopKey('local', 'draft'), JSON.stringify({ savedAt: now, draft: { id: 5 } }));
    expect(loadDraft(s, 'local', now)).toBeNull();
    s.setItem(shopKey('local', 'draft'), 'not json');
    expect(loadDraft(s, 'local', now)).toBeNull();
  });

  it('clearDraft removes it; failures return null/false', () => {
    const s = memoryStore();
    saveDraft(s, 'local', newDraft('d1', '2026-09-28'), now);
    clearDraft(s, 'local');
    expect(loadDraft(s, 'local', now)).toBeNull();
    expect(saveDraft(throwing, 'local', newDraft('d1', '2026-09-28'), now)).toBe(false);
    expect(loadDraft(throwing, 'local', now)).toBeNull();
  });
});

describe('submissions', () => {
  it('saves once per id (double tap / retry safe)', () => {
    const s = memoryStore();
    expect(saveSubmission(s, sub('a'))).toBe('saved');
    expect(saveSubmission(s, sub('a'))).toBe('duplicate');
    expect(loadSubmissions(s, 'local')).toHaveLength(1);
  });

  it('reports failure when storage refuses the write', () => {
    expect(saveSubmission(throwing, sub('a'))).toBe('failed');
  });

  it('skips malformed records', () => {
    const s = memoryStore();
    s.setItem(shopKey('local', 'submissions'), JSON.stringify([sub('a'), { id: 1 }, null, { ...sub('b'), inputs: 3 }]));
    expect(loadSubmissions(s, 'local').map((x) => x.id)).toEqual(['a']);
  });

  it(`keeps only the newest ${MAX_SUBMISSIONS}`, () => {
    const s = memoryStore();
    for (let i = 0; i <= MAX_SUBMISSIONS; i++) saveSubmission(s, sub(`s${i}`));
    const ids = loadSubmissions(s, 'local').map((x) => x.id);
    expect(ids).toHaveLength(MAX_SUBMISSIONS);
    expect(ids[0]).toBe('s1');
    expect(ids.at(-1)).toBe(`s${MAX_SUBMISSIONS}`);
  });

  it('turns submissions into past expenses dated by business date', () => {
    expect(pastExpenses([sub('a', [{ description: 'Nice', cents: 1300 }])])).toEqual([
      { description: 'Nice', cents: 1300, date: '2026-09-28' },
    ]);
  });
});

describe('staff', () => {
  it('normalizes: trims, collapses spaces, drops empties and case-insensitive duplicates', () => {
    expect(normalizeStaff(['  ΜΑΡΙΑ ', 'Μαρία', 'μαρια', '', 'ΝΙΚΟΣ  Π', 5])).toEqual(['ΜΑΡΙΑ', 'Μαρία', 'ΝΙΚΟΣ Π']);
  });

  it('saves and loads per shop; junk loads as empty', () => {
    const s = memoryStore();
    expect(saveStaff(s, 'local', ['ΓΚΡΕΖΙΟΣ', ' ΓΚΡΕΖΙΟΣ'])).toEqual(['ΓΚΡΕΖΙΟΣ']);
    expect(loadStaff(s, 'local')).toEqual(['ΓΚΡΕΖΙΟΣ']);
    s.setItem(shopKey('local', 'staff'), '"x"');
    expect(loadStaff(s, 'local')).toEqual([]);
    expect(saveStaff(throwing, 'local', ['A'])).toBeNull();
  });
});

describe('prefs', () => {
  it('defaults to system and persists light/dark', () => {
    const s = memoryStore();
    expect(loadTheme(s)).toBe('system');
    expect(saveTheme(s, 'dark')).toBe(true);
    expect(loadTheme(s)).toBe('dark');
    s.setItem('tameio4all:v1:prefs:theme', '"purple"');
    expect(loadTheme(s)).toBe('system');
  });
});
```

Note on `normalizeStaff`: `'Μαρία'` vs `'ΜΑΡΙΑ'` differ by the accent, so they stay distinct (only case is ignored); `'μαρια'` duplicates `'ΜΑΡΙΑ'` case-insensitively and is dropped.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/data/local.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/data/local/storage.ts`**

```ts
/** The only module family that touches localStorage. Every call is failure-safe. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AppStore {
  store: KeyValueStore;
  /** false when the browser refused storage (private mode, blocked) — data lives only in memory. */
  persistent: boolean;
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

/** window.localStorage if it exists and accepts a write, else null. */
export function browserStore(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = 'tameio4all:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function pickStore(): AppStore {
  const browser = browserStore();
  return browser ? { store: browser, persistent: true } : { store: memoryStore(), persistent: false };
}

export const shopKey = (shopId: string, name: string): string => `tameio4all:v1:${shopId}:${name}`;

export function readJson(store: KeyValueStore, key: string): unknown {
  try {
    const raw = store.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // nothing to do: a key we cannot delete will be overwritten or expire
  }
}
```

- [ ] **Step 4: Write `src/data/local/drafts.ts`**

```ts
import { isDraft, type Draft } from '../../features/register/draft';
import { readJson, removeKey, shopKey, writeJson, type KeyValueStore } from './storage';

/** A draft older than one shift (10 h, as in tameioV2) is discarded on load. */
export const DRAFT_TTL_MS = 10 * 60 * 60 * 1000;

export function loadDraft(store: KeyValueStore, shopId: string, nowMs: number): Draft | null {
  const key = shopKey(shopId, 'draft');
  const saved = readJson(store, key);
  if (saved === null) return null;
  const s = typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  if (typeof s.savedAt !== 'number' || !isDraft(s.draft) || nowMs - s.savedAt > DRAFT_TTL_MS) {
    removeKey(store, key);
    return null;
  }
  return s.draft;
}

export function saveDraft(store: KeyValueStore, shopId: string, draft: Draft, nowMs: number): boolean {
  return writeJson(store, shopKey(shopId, 'draft'), { savedAt: nowMs, draft });
}

export function clearDraft(store: KeyValueStore, shopId: string): void {
  removeKey(store, shopKey(shopId, 'draft'));
}
```

- [ ] **Step 5: Write `src/data/local/submissions.ts`**

```ts
import type { ClosingInputs } from '../../core/formula';
import type { PastExpense } from '../../core/suggestions';
import { readJson, shopKey, writeJson, type KeyValueStore } from './storage';

/** A submitted closing kept on the device. Raw inputs only — totals are always recomputed. */
export interface Submission {
  id: string;
  shopId: string;
  staffName: string;
  businessDate: string;
  submittedAt: string;
  inputs: ClosingInputs;
}

export type SaveResult = 'saved' | 'duplicate' | 'failed';

/** localStorage is ~5 MB; ~1 KB per closing, so the newest 500 are plenty for suggestions. */
export const MAX_SUBMISSIONS = 500;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function isSubmission(x: unknown): x is Submission {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.shopId === 'string' &&
    typeof x.staffName === 'string' &&
    typeof x.businessDate === 'string' &&
    typeof x.submittedAt === 'string' &&
    isObj(x.inputs) &&
    Array.isArray(x.inputs.expenses)
  );
}

export function loadSubmissions(store: KeyValueStore, shopId: string): Submission[] {
  const raw = readJson(store, shopKey(shopId, 'submissions'));
  return Array.isArray(raw) ? raw.filter(isSubmission) : [];
}

/** Idempotent by id: a double tap or retry stores the closing once. */
export function saveSubmission(store: KeyValueStore, submission: Submission): SaveResult {
  const list = loadSubmissions(store, submission.shopId);
  if (list.some((s) => s.id === submission.id)) return 'duplicate';
  const next = [...list, submission].slice(-MAX_SUBMISSIONS);
  return writeJson(store, shopKey(submission.shopId, 'submissions'), next) ? 'saved' : 'failed';
}

/** Expense lines of past closings, for buildSupplierHistory. Malformed lines are left for it to skip. */
export function pastExpenses(subs: readonly Submission[]): PastExpense[] {
  return subs.flatMap((s) =>
    s.inputs.expenses
      .filter((e) => isObj(e))
      .map((e) => ({ description: e.description, cents: e.cents, date: s.businessDate })),
  );
}
```

- [ ] **Step 6: Write `src/data/local/staff.ts`**

```ts
import { readJson, shopKey, writeJson, type KeyValueStore } from './storage';

/** Trims, collapses spaces, drops empties and case-insensitive duplicates (first spelling wins). */
export function normalizeStaff(names: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const name = n.trim().replace(/\s+/g, ' ');
    if (name === '') continue;
    const key = name.toLocaleLowerCase('el');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function loadStaff(store: KeyValueStore, shopId: string): string[] {
  const raw = readJson(store, shopKey(shopId, 'staff'));
  return Array.isArray(raw) ? normalizeStaff(raw) : [];
}

/** Returns the stored (normalized) list, or null if the device refused the write. */
export function saveStaff(store: KeyValueStore, shopId: string, names: readonly string[]): string[] | null {
  const clean = normalizeStaff(names);
  return writeJson(store, shopKey(shopId, 'staff'), clean) ? clean : null;
}
```

- [ ] **Step 7: Write `src/data/local/prefs.ts`**

```ts
import { readJson, writeJson, type KeyValueStore } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'tameio4all:v1:prefs:theme';

export function loadTheme(store: KeyValueStore): ThemePref {
  const v = readJson(store, THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function saveTheme(store: KeyValueStore, pref: ThemePref): boolean {
  return writeJson(store, THEME_KEY, pref);
}
```

- [ ] **Step 8: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(data): failure-safe on-device storage for drafts, submissions, staff, prefs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `deriveClosing` — text to money (pure)

**Files:**
- Create: `src/features/register/derive.ts`
- Test: `tests/features/register/derive.test.ts`

**Interfaces:**
- Consumes: `Draft` (Task 3); core `denomLabel, entryToCount, isBill, planEnvelope, EnvelopePlan, evaluateTotals, ClosingInputs, ExpenseEntry, parseAmount, Cents, ShopConfig`.
- Produces:
  - `interface FieldError { field: string; label: string; message: string }`
  - `fieldId = { denom(d: Cents): string; channel(id: string): string; expense(id: string): string }` → `"denom:1000"`, `"channel:wolt"`, `"expense:e1"`
  - `interface Derived { inputs: ClosingInputs; errors: FieldError[]; totals: Record<string, Cents>; envelope: EnvelopePlan; rowCents: Record<string, Cents>; expenseRowCents: Record<string, Cents>; billsCents: Cents; coinsCents: Cents; expensesCents: Cents }`
  - `deriveClosing(config: ShopConfig, draft: Draft): Derived`
  - `fieldError(derived: Derived, field: string): string | undefined`
  - `envelopeBlockReason(derived: Derived): string | null` → `"Λάθος τιμή: 10€, WOLT"` or null
  - `submitBlockReason(derived: Derived, draft: Draft): string | null` → envelope reason, else `"Διάλεξε όνομα για υποβολή"` when no staff, else null
- Greek messages: `not_multiple → "όχι πολλαπλάσιο"`, `negative → "αρνητικό ποσό"`, `invalid → "μη έγκυρη τιμή"`, `too_many_decimals → "πολλά δεκαδικά"`.

- [ ] **Step 1: Write the failing test `tests/features/register/derive.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import {
  deriveClosing, envelopeBlockReason, fieldError, fieldId, submitBlockReason,
} from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';

const draft = (changes: Partial<Draft>): Draft => ({ ...newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ'), ...changes });

const V2_TOTALS = { tameio: 185520, expenses_total: 2030, cash: 36755, cash_lim: 38785, income_lim: 78650 };
const V2_CHANNELS = { kermata: '150', wolt: '45.60', efood: '23,10', mypos: '310.25', eurobank: '88.40' };
const V2_EXPENSES = [
  { id: 'e1', description: 'Nice', amountText: '12.50' },
  { id: 'e2', description: ' Nice ', amountText: '7,80' },
];

describe('deriveClosing', () => {
  it('reproduces tameioV2 from € amounts typed as text', () => {
    const d = derive(draft({
      mode: 'amount',
      entries: {
        '10000': '500', '5000': '300', '2000': '240', '1000': '90', '500': '35',
        '200': '24', '100': '17', '50': '6.5', '20': '3.4', '10': '1.2', '5': '0.45',
      },
      channels: V2_CHANNELS,
      expenses: V2_EXPENSES,
    }));
    expect(d.errors).toEqual([]);
    expect(d.totals).toEqual(V2_TOTALS);
    expect(d.billsCents).toBe(116500);
    expect(d.coinsCents).toBe(5255);
    expect(d.expensesCents).toBe(2030);
    expect(d.inputs.expenses).toEqual([
      { description: 'Nice', cents: 1250 },
      { description: 'Nice', cents: 780 },
    ]);
    expect(d.rowCents['10000']).toBe(50000);
    expect(d.expenseRowCents).toEqual({ e1: 1250, e2: 780 });
  });

  it('gives the same totals from piece counts', () => {
    const d = derive(draft({
      mode: 'count',
      entries: {
        '10000': '5', '5000': '6', '2000': '12', '1000': '9', '500': '7',
        '200': '12', '100': '17', '50': '13', '20': '17', '10': '12', '5': '9',
      },
      channels: V2_CHANNELS,
      expenses: V2_EXPENSES,
    }));
    expect(d.totals).toEqual(V2_TOTALS);
  });

  it('reports invalid fields with Greek messages and leaves them out of the money', () => {
    const d = derive(draft({ entries: { '10000': '500', '1000': '95' }, channels: { wolt: '1.234' } }));
    expect(d.errors).toEqual([
      { field: 'denom:1000', label: '10€', message: 'όχι πολλαπλάσιο' },
      { field: 'channel:wolt', label: 'WOLT', message: 'πολλά δεκαδικά' },
    ]);
    expect(d.inputs.counts).toEqual({ '10000': 5 });
    expect(fieldError(d, fieldId.denom(1000))).toBe('όχι πολλαπλάσιο');
    expect(fieldError(d, fieldId.denom(10000))).toBeUndefined();
  });

  it('skips blank expense rows and names invalid ones by description or position', () => {
    const d = derive(draft({
      expenses: [
        { id: 'a', description: '', amountText: '' },
        { id: 'b', description: 'Μόνο περιγραφή', amountText: '' },
        { id: 'c', description: '', amountText: '1.234' },
        { id: 'd', description: 'Γάλα', amountText: '0' },
      ],
    }));
    expect(d.inputs.expenses).toEqual([]);
    expect(d.errors).toEqual([{ field: 'expense:c', label: 'Έξοδο 3', message: 'πολλά δεκαδικά' }]);
  });

  it('ignores entries for denominations the shop has not enabled', () => {
    const d = derive(draft({ entries: { '50000': '1000' } }));
    expect(d.inputs.counts).toEqual({});
    expect(d.errors).toEqual([]);
  });

  it('plans the exact envelope greedy missed (60€ from 1×50 + 3×20)', () => {
    // counted 110€ + ΚΕΡΜΑΤΑ 950€ − float 1000€ = 60€
    const d = derive(draft({ entries: { '5000': '50', '2000': '60' }, channels: { kermata: '950' } }));
    expect(d.totals.cash).toBe(6000);
    expect(d.envelope.put).toEqual({ '2000': 3 });
    expect(d.envelope.shortCents).toBe(0);
  });
});

describe('block reasons', () => {
  it('lists invalid fields, then requires a staff member for submit', () => {
    const bad = draft({ entries: { '1000': '95' }, channels: { wolt: '1.234' } });
    const dBad = derive(bad);
    expect(envelopeBlockReason(dBad)).toBe('Λάθος τιμή: 10€, WOLT');
    expect(submitBlockReason(dBad, bad)).toBe('Λάθος τιμή: 10€, WOLT');

    const noStaff = draft({ staffName: '' });
    const dOk = derive(noStaff);
    expect(envelopeBlockReason(dOk)).toBeNull();
    expect(submitBlockReason(dOk, noStaff)).toBe('Διάλεξε όνομα για υποβολή');
    expect(submitBlockReason(dOk, draft({}))).toBeNull();
  });
});

function derive(d: Draft) {
  return deriveClosing(cfg, d);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/features/register/derive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/features/register/derive.ts`**

```ts
import type { ShopConfig } from '../../core/config';
import { denomLabel, entryToCount, isBill } from '../../core/denominations';
import { planEnvelope, type EnvelopePlan } from '../../core/envelope';
import { evaluateTotals, type ClosingInputs, type ExpenseEntry } from '../../core/formula';
import { parseAmount, type Cents } from '../../core/money';
import type { Draft } from './draft';

export interface FieldError {
  field: string;
  label: string;
  message: string;
}

export interface Derived {
  inputs: ClosingInputs;
  errors: FieldError[];
  totals: Record<string, Cents>;
  envelope: EnvelopePlan;
  /** Value of each valid, non-zero denomination row, keyed by String(denominationCents). */
  rowCents: Record<string, Cents>;
  /** Amount of each valid, non-zero expense row, keyed by expense id. */
  expenseRowCents: Record<string, Cents>;
  billsCents: Cents;
  coinsCents: Cents;
  expensesCents: Cents;
}

export const fieldId = {
  denom: (d: Cents): string => `denom:${d}`,
  channel: (id: string): string => `channel:${id}`,
  expense: (id: string): string => `expense:${id}`,
};

const MESSAGES: Record<string, string> = {
  not_multiple: 'όχι πολλαπλάσιο',
  negative: 'αρνητικό ποσό',
  invalid: 'μη έγκυρη τιμή',
  too_many_decimals: 'πολλά δεκαδικά',
};
const message = (reason: string): string => MESSAGES[reason] ?? reason;

/** The only bridge from typed text to money. Invalid fields are reported and left out. */
export function deriveClosing(config: ShopConfig, draft: Draft): Derived {
  const errors: FieldError[] = [];

  const counts: Record<string, number> = {};
  const rowCents: Record<string, Cents> = {};
  let billsCents = 0;
  let coinsCents = 0;
  for (const d of config.denominations) {
    const key = String(d);
    const r = entryToCount(draft.entries[key] ?? '', d, draft.mode);
    if (!r.ok) {
      errors.push({ field: fieldId.denom(d), label: denomLabel(d), message: message(r.reason) });
      continue;
    }
    if (r.count === 0) continue;
    counts[key] = r.count;
    rowCents[key] = r.count * d;
    if (isBill(d)) billsCents += r.count * d;
    else coinsCents += r.count * d;
  }

  const channelCents: Record<string, Cents> = {};
  for (const ch of config.channels) {
    const r = parseAmount(draft.channels[ch.id] ?? '');
    if (r.ok) {
      if (r.value > 0) channelCents[ch.id] = r.value;
    } else if (r.reason !== 'empty') {
      errors.push({ field: fieldId.channel(ch.id), label: ch.label, message: message(r.reason) });
    }
  }

  const expenses: ExpenseEntry[] = [];
  const expenseRowCents: Record<string, Cents> = {};
  draft.expenses.slice(0, config.maxExpenses).forEach((e, i) => {
    const r = parseAmount(e.amountText);
    if (r.ok) {
      if (r.value > 0) {
        expenses.push({ description: e.description.trim(), cents: r.value });
        expenseRowCents[e.id] = r.value;
      }
    } else if (r.reason !== 'empty') {
      errors.push({ field: fieldId.expense(e.id), label: e.description.trim() || `Έξοδο ${i + 1}`, message: message(r.reason) });
    }
  });

  const inputs: ClosingInputs = { schema: 1, counts, channelCents, expenses };
  const totals = evaluateTotals(config, inputs);
  const envelope = planEnvelope(totals[config.envelopeTotalId] ?? 0, counts, config.denominations);
  const expensesCents = expenses.reduce((sum, e) => sum + e.cents, 0);

  return { inputs, errors, totals, envelope, rowCents, expenseRowCents, billsCents, coinsCents, expensesCents };
}

export function fieldError(derived: Derived, field: string): string | undefined {
  return derived.errors.find((e) => e.field === field)?.message;
}

export function envelopeBlockReason(derived: Derived): string | null {
  return derived.errors.length > 0 ? `Λάθος τιμή: ${derived.errors.map((e) => e.label).join(', ')}` : null;
}

export function submitBlockReason(derived: Derived, draft: Draft): string | null {
  return envelopeBlockReason(derived) ?? (draft.staffName === '' ? 'Διάλεξε όνομα για υποβολή' : null);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(register): deriveClosing turns typed text into validated closing inputs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI primitives — AmountField, Card, Sheet

**Files:**
- Create: `src/ui/AmountField.tsx`, `src/ui/Card.tsx`, `src/ui/Sheet.tsx`
- Test: `tests/ui/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `AmountField(props: { id: string; label: string; value: string; onChange: (text: string) => void; invalid?: boolean; inputMode?: 'decimal' | 'numeric'; placeholder?: string; onBlur?: () => void })` — `<input class="field">` with `aria-label={label}`, `aria-invalid` when invalid.
  - `Card(props: { title?: string; aside?: ReactNode; children: ReactNode })` — `<section class="card" aria-label={title}>` with `<h2>` head.
  - `Sheet(props: { title: string; subtitle?: string; onClose: () => void; children: ReactNode })` — backdrop + `role="dialog" aria-modal aria-label={title}`; Escape and backdrop click call `onClose`.

- [ ] **Step 1: Write the failing test `tests/ui/primitives.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmountField } from '../../src/ui/AmountField';
import { Card } from '../../src/ui/Card';
import { Sheet } from '../../src/ui/Sheet';

afterEach(cleanup);

describe('AmountField', () => {
  it('reports typed text and marks invalid state', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AmountField id="f" label="100€" value="" onChange={onChange} />);
    const input = screen.getByLabelText('100€');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(input, { target: { value: '500' } });
    expect(onChange).toHaveBeenCalledWith('500');
    rerender(<AmountField id="f" label="100€" value="95" invalid inputMode="numeric" onChange={onChange} />);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });
});

describe('Card', () => {
  it('renders a titled section with an aside', () => {
    render(<Card title="Κέρματα" aside="52,55€"><p>body</p></Card>);
    const section = screen.getByRole('region', { name: 'Κέρματα' });
    expect(section.textContent).toContain('52,55€');
    expect(section.textContent).toContain('body');
  });
});

describe('Sheet', () => {
  it('closes on Escape and on backdrop click, not on content click', () => {
    const onClose = vi.fn();
    render(<Sheet title="Φάκελος" subtitle="60,00€" onClose={onClose}><p>inside</p></Sheet>);
    const dialog = screen.getByRole('dialog', { name: 'Φάκελος' });
    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByText('60,00€')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/primitives.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/ui/AmountField.tsx`**

```tsx
interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  invalid?: boolean;
  inputMode?: 'decimal' | 'numeric';
  placeholder?: string;
  onBlur?: () => void;
}

export function AmountField({ id, label, value, onChange, invalid = false, inputMode = 'decimal', placeholder = '0', onBlur }: Props) {
  return (
    <input
      id={id}
      className="field"
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={inputMode}
      autoComplete="off"
      enterKeyHint="next"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}
```

- [ ] **Step 4: Write `src/ui/Card.tsx`**

```tsx
import type { ReactNode } from 'react';

export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      {title !== undefined && (
        <div className="card-head">
          <h2>{title}</h2>
          {aside !== undefined && <span>{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
```

- [ ] **Step 5: Write `src/ui/Sheet.tsx`**

```tsx
import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet over the page. Escape or a tap on the dimmed backdrop closes it. */
export function Sheet({ title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" aria-hidden="true" />
        <h2>{title}</h2>
        {subtitle !== undefined && <p className="sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): AmountField, Card and Sheet primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Counting components — ModeSwitch, CountCard, ChannelsCard, SummaryCard, BottomBar

**Files:**
- Create: `src/features/register/ModeSwitch.tsx`, `CountCard.tsx`, `ChannelsCard.tsx`, `SummaryCard.tsx`, `BottomBar.tsx` (all in `src/features/register/`)
- Test: `tests/features/register/counting.test.tsx`

**Interfaces:**
- Consumes: `AmountField`, `Card` (Task 6); `Draft`, `DraftDispatch` (Task 3); `Derived`, `fieldId`, `fieldError` (Task 5); core `denomLabel`, `formatEuro`, `Channel`, `ShopConfig`, `EntryMode`, `Cents`.
- Produces:
  - `ModeSwitch({ mode: EntryMode; onChange(mode: EntryMode): void })` — buttons "€ Ποσό" / "# Κομμάτια" with `aria-pressed`.
  - `CountCard({ title: string; denominations: readonly Cents[]; totalCents: Cents; draft: Draft; derived: Derived; dispatch: DraftDispatch })` — field ids `denom-<cents>`, aria-label = `denomLabel(d)`; in count mode the grey hint shows `formatEuro(rowCents)`; an error replaces the hint.
  - `ChannelsCard({ channels: readonly Channel[]; draft; derived; dispatch; onCalculator?(channelId: string): void })` — aria-label = channel label; 🧮 button (`aria-label="Άθροισμα για <label>"`) only for `cash_extra` channels when `onCalculator` given.
  - `SummaryCard({ config: ShopConfig; totals: Record<string, Cents> })` — first `showInSummary` total (not the envelope total) + envelope total as `.tot.main`; the rest behind "Περισσότερα ▾".
  - `BottomBar({ label: string; amountCents: Cents; envelopeBlocked: string | null; submitBlocked: string | null; onEnvelope(): void; onSubmit(): void })`

- [ ] **Step 1: Write the failing test `tests/features/register/counting.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import { BottomBar } from '../../../src/features/register/BottomBar';
import { ChannelsCard } from '../../../src/features/register/ChannelsCard';
import { CountCard } from '../../../src/features/register/CountCard';
import { deriveClosing } from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';
import { ModeSwitch } from '../../../src/features/register/ModeSwitch';
import { SummaryCard } from '../../../src/features/register/SummaryCard';

afterEach(cleanup);

const BILLS = [10000, 5000, 2000, 1000, 500];
const draft = (changes: Partial<Draft>): Draft => ({ ...newDraft('d1', '2026-09-28'), ...changes });

describe('ModeSwitch', () => {
  it('marks the active mode and reports changes', () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="amount" onChange={onChange} />);
    expect(screen.getByRole('button', { name: '€ Ποσό' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '# Κομμάτια' }));
    expect(onChange).toHaveBeenCalledWith('count');
  });
});

describe('CountCard', () => {
  it('in € mode shows only the typed amount — no piece count beside it', () => {
    const d = draft({ entries: { '10000': '500' } });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={50000} draft={d} derived={deriveClosing(cfg, d)} dispatch={vi.fn()} />);
    const row = screen.getByLabelText('100€').closest('.row') as HTMLElement;
    expect(row.querySelector('.row-hint')).toBeNull();
    expect(screen.getByRole('region', { name: 'Χαρτονομίσματα' }).textContent).toContain('500,00€');
  });

  it('in # mode shows the row value in euros beside the count', () => {
    const d = draft({ mode: 'count', entries: { '10000': '5' } });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={50000} draft={d} derived={deriveClosing(cfg, d)} dispatch={vi.fn()} />);
    const row = screen.getByLabelText('100€').closest('.row') as HTMLElement;
    expect(within(row).getByText('500,00€')).toBeTruthy();
    expect(screen.getByLabelText('100€').getAttribute('inputmode')).toBe('numeric');
  });

  it('marks an invalid row and shows why', () => {
    const d = draft({ entries: { '1000': '95' } });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} dispatch={vi.fn()} />);
    const input = screen.getByLabelText('10€');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(within(input.closest('.row') as HTMLElement).getByText('όχι πολλαπλάσιο')).toBeTruthy();
  });

  it('dispatches setEntry on typing', () => {
    const dispatch = vi.fn();
    const d = draft({});
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText('50€'), { target: { value: '300' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setEntry', denom: 5000, text: '300' });
  });
});

describe('ChannelsCard', () => {
  it('lists channels, offers the calculator only for cash_extra, dispatches setChannel', () => {
    const dispatch = vi.fn();
    const onCalculator = vi.fn();
    const d = draft({});
    render(<ChannelsCard channels={cfg.channels} draft={d} derived={deriveClosing(cfg, d)} dispatch={dispatch} onCalculator={onCalculator} />);
    fireEvent.change(screen.getByLabelText('WOLT'), { target: { value: '45,60' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setChannel', id: 'wolt', text: '45,60' });
    expect(screen.getAllByRole('button', { name: /^Άθροισμα για/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Άθροισμα για ΚΕΡΜΑΤΑ' }));
    expect(onCalculator).toHaveBeenCalledWith('kermata');
  });
});

describe('SummaryCard', () => {
  it('shows ΤΑΜΕΙΟ and the envelope total, the rest behind Περισσότερα', () => {
    const totals = { tameio: 185520, expenses_total: 2030, cash: 36755, cash_lim: 38785, income_lim: 78650 };
    render(<SummaryCard config={cfg} totals={totals} />);
    const card = screen.getByRole('region', { name: 'Σύνοψη' });
    expect(card.textContent).toContain('ΤΑΜΕΙΟ');
    expect(card.textContent).toContain('1.855,20€');
    expect(card.querySelector('.tot.main')?.textContent).toContain('367,55€');
    expect(card.textContent).not.toContain('ΕΣΟΔΑ LIM');
    fireEvent.click(screen.getByRole('button', { name: /Περισσότερα/ }));
    expect(card.textContent).toContain('ΕΣΟΔΑ LIM');
    expect(card.textContent).toContain('786,50€');
  });
});

describe('BottomBar', () => {
  it('shows the amount, disables blocked actions and explains why', () => {
    const onEnvelope = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <BottomBar label="ΜΕΤΡΗΤΑ" amountCents={36755} envelopeBlocked={null} submitBlocked="Διάλεξε όνομα για υποβολή" onEnvelope={onEnvelope} onSubmit={onSubmit} />,
    );
    expect(screen.getByText('367,55€')).toBeTruthy();
    expect(screen.getByText('Διάλεξε όνομα για υποβολή')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Φάκελος' }));
    expect(onEnvelope).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Υποβολή' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<BottomBar label="ΜΕΤΡΗΤΑ" amountCents={0} envelopeBlocked="Λάθος τιμή: 10€" submitBlocked="Λάθος τιμή: 10€" onEnvelope={onEnvelope} onSubmit={onSubmit} />);
    expect((screen.getByRole('button', { name: 'Φάκελος' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Λάθος τιμή: 10€')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/features/register/counting.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/features/register/ModeSwitch.tsx`**

```tsx
import type { EntryMode } from '../../core/denominations';

export function ModeSwitch({ mode, onChange }: { mode: EntryMode; onChange: (mode: EntryMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Τρόπος καταμέτρησης">
      <button type="button" aria-pressed={mode === 'amount'} onClick={() => onChange('amount')}>
        € Ποσό
      </button>
      <button type="button" aria-pressed={mode === 'count'} onClick={() => onChange('count')}>
        # Κομμάτια
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/features/register/CountCard.tsx`**

```tsx
import { denomLabel } from '../../core/denominations';
import { formatEuro, type Cents } from '../../core/money';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, DraftDispatch } from './draft';

interface Props {
  title: string;
  denominations: readonly Cents[];
  totalCents: Cents;
  draft: Draft;
  derived: Derived;
  dispatch: DraftDispatch;
}

export function CountCard({ title, denominations, totalCents, draft, derived, dispatch }: Props) {
  if (denominations.length === 0) return null;
  return (
    <Card title={title} aside={totalCents > 0 ? formatEuro(totalCents) : undefined}>
      {denominations.map((d) => {
        const key = String(d);
        const label = denomLabel(d);
        const error = fieldError(derived, fieldId.denom(d));
        const rowCents = derived.rowCents[key];
        // € mode: no hint. # mode: the row's euro value. An error always wins.
        const hint = error ?? (draft.mode === 'count' && rowCents !== undefined ? formatEuro(rowCents) : undefined);
        return (
          <div className="row" key={key}>
            <span className="row-label">{label}</span>
            {hint !== undefined && <span className={error !== undefined ? 'row-hint err' : 'row-hint'}>{hint}</span>}
            <AmountField
              id={`denom-${key}`}
              label={label}
              value={draft.entries[key] ?? ''}
              invalid={error !== undefined}
              inputMode={draft.mode === 'count' ? 'numeric' : 'decimal'}
              onChange={(text) => dispatch({ type: 'setEntry', denom: d, text })}
            />
          </div>
        );
      })}
    </Card>
  );
}
```

- [ ] **Step 5: Write `src/features/register/ChannelsCard.tsx`**

```tsx
import type { Channel } from '../../core/config';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, DraftDispatch } from './draft';

interface Props {
  channels: readonly Channel[];
  draft: Draft;
  derived: Derived;
  dispatch: DraftDispatch;
  onCalculator?: (channelId: string) => void;
}

export function ChannelsCard({ channels, draft, derived, dispatch, onCalculator }: Props) {
  if (channels.length === 0) return null;
  return (
    <Card title="Άλλα ποσά">
      {channels.map((ch) => {
        const error = fieldError(derived, fieldId.channel(ch.id));
        return (
          <div className="row" key={ch.id}>
            <span className="row-label">{ch.label}</span>
            {error !== undefined && <span className="row-hint err">{error}</span>}
            {ch.type === 'cash_extra' && onCalculator !== undefined && (
              <button type="button" className="icon-btn" aria-label={`Άθροισμα για ${ch.label}`} onClick={() => onCalculator(ch.id)}>
                🧮
              </button>
            )}
            <AmountField
              id={`channel-${ch.id}`}
              label={ch.label}
              value={draft.channels[ch.id] ?? ''}
              invalid={error !== undefined}
              onChange={(text) => dispatch({ type: 'setChannel', id: ch.id, text })}
            />
          </div>
        );
      })}
    </Card>
  );
}
```

- [ ] **Step 6: Write `src/features/register/SummaryCard.tsx`**

```tsx
import { useState } from 'react';
import type { ShopConfig } from '../../core/config';
import { formatEuro, type Cents } from '../../core/money';
import { Card } from '../../ui/Card';

export function SummaryCard({ config, totals }: { config: ShopConfig; totals: Record<string, Cents> }) {
  const [open, setOpen] = useState(false);
  const envelope = config.totals.find((t) => t.id === config.envelopeTotalId);
  const [first, ...rest] = config.totals.filter((t) => t.showInSummary && t.id !== config.envelopeTotalId);
  const value = (id: string) => formatEuro(totals[id] ?? 0);

  return (
    <Card title="Σύνοψη">
      {first !== undefined && (
        <div className="tot">
          <span>{first.label}</span>
          <span>{value(first.id)}</span>
        </div>
      )}
      {envelope !== undefined && (
        <div className="tot main">
          <span>{envelope.label}</span>
          <span>{value(envelope.id)}</span>
        </div>
      )}
      {rest.length > 0 && (
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          Περισσότερα {open ? '▴' : '▾'}
        </button>
      )}
      {open &&
        rest.map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <span>{value(t.id)}</span>
          </div>
        ))}
    </Card>
  );
}
```

- [ ] **Step 7: Write `src/features/register/BottomBar.tsx`**

```tsx
import { formatEuro, type Cents } from '../../core/money';

interface Props {
  label: string;
  amountCents: Cents;
  envelopeBlocked: string | null;
  submitBlocked: string | null;
  onEnvelope: () => void;
  onSubmit: () => void;
}

export function BottomBar({ label, amountCents, envelopeBlocked, submitBlocked, onEnvelope, onSubmit }: Props) {
  const reason = envelopeBlocked ?? submitBlocked;
  return (
    <footer className="bar-wrap">
      {reason !== null && <p className="blocked">{reason}</p>}
      <div className="bar">
        <div className="bar-amt">
          <small>{label}</small>
          <strong>{formatEuro(amountCents)}</strong>
        </div>
        <button type="button" className="btn btn-text" disabled={envelopeBlocked !== null} onClick={onEnvelope}>
          Φάκελος
        </button>
        <button type="button" className="btn btn-primary" disabled={submitBlocked !== null} onClick={onSubmit}>
          Υποβολή
        </button>
      </div>
    </footer>
  );
}
```

- [ ] **Step 8: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(register): mode switch, count/channel/summary cards and bottom bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Expenses card with learned suggestions

**Files:**
- Create: `src/features/register/ExpensesCard.tsx`
- Test: `tests/features/register/expenses.test.tsx`

**Interfaces:**
- Consumes: `AmountField`, `Card`; `Draft`, `DraftDispatch`, `draftReducer`, `newDraft`; `Derived`, `deriveClosing`, `fieldError`, `fieldId`; core `formatEuro`, `SupplierHistory`, `suggestExpenseDescriptions`, `exactExpenseMatch`.
- Produces: `ExpensesCard({ maxExpenses: number; draft: Draft; derived: Derived; history: SupplierHistory; dispatch: DraftDispatch; newId(): string })`. Row n (1-based) has inputs labelled `Περιγραφή εξόδου n`, `Ποσό εξόδου n`, a remove button `Αφαίρεση εξόδου n`; add button text `+ Έξοδο`; chips shown while the description is empty; on amount blur, a unique exact match fills the description.

- [ ] **Step 1: Write the failing test `tests/features/register/expenses.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import type { SupplierHistory } from '../../../src/core/suggestions';
import { deriveClosing } from '../../../src/features/register/derive';
import { draftReducer, newDraft } from '../../../src/features/register/draft';
import { ExpensesCard } from '../../../src/features/register/ExpensesCard';

afterEach(cleanup);

let n = 0;
const nextId = () => `e${++n}`;
const HISTORY: SupplierHistory = { 'Ντόντης': [2400, 1800], 'Nice': [1300] };

function Harness({ max = 10, history = HISTORY }: { max?: number; history?: SupplierHistory }) {
  const [draft, dispatch] = useReducer(draftReducer, null, () => newDraft('d1', '2026-09-28'));
  const derived = deriveClosing(cfg, draft);
  return <ExpensesCard maxExpenses={max} draft={draft} derived={derived} history={history} dispatch={dispatch} newId={nextId} />;
}

const add = () => fireEvent.click(screen.getByRole('button', { name: '+ Έξοδο' }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ExpensesCard', () => {
  it('adds rows one at a time and totals them in the header', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '12,50');
    add();
    type('Ποσό εξόδου 2', '7.80');
    expect(screen.getByRole('region', { name: 'Έξοδα' }).textContent).toContain('20,30€');
  });

  it('suggests learned suppliers for the amount and fills the description on tap', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '24');
    expect(screen.getByRole('button', { name: 'Ντόντης' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ντόντης' }));
    expect((screen.getByLabelText('Περιγραφή εξόδου 1') as HTMLInputElement).value).toBe('Ντόντης');
    expect(screen.queryByRole('button', { name: 'Ντόντης' })).toBeNull();
  });

  it('auto-fills a unique exact match when leaving the amount field', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '13');
    fireEvent.blur(screen.getByLabelText('Ποσό εξόδου 1'));
    expect((screen.getByLabelText('Περιγραφή εξόδου 1') as HTMLInputElement).value).toBe('Nice');
  });

  it('never overwrites a description the person typed', () => {
    render(<Harness />);
    add();
    type('Περιγραφή εξόδου 1', 'Γάλα');
    type('Ποσό εξόδου 1', '13');
    fireEvent.blur(screen.getByLabelText('Ποσό εξόδου 1'));
    expect((screen.getByLabelText('Περιγραφή εξόδου 1') as HTMLInputElement).value).toBe('Γάλα');
  });

  it('a new shop with no history shows no chips', () => {
    render(<Harness history={{}} />);
    add();
    type('Ποσό εξόδου 1', '24');
    expect(screen.queryAllByRole('button').filter((b) => b.classList.contains('chip'))).toHaveLength(0);
  });

  it('stops at the maximum and removes rows', () => {
    render(<Harness max={2} />);
    add();
    add();
    expect(screen.queryByRole('button', { name: '+ Έξοδο' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση εξόδου 1' }));
    expect(screen.queryByLabelText('Ποσό εξόδου 2')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Έξοδο' })).toBeTruthy();
  });

  it('shows why an amount is invalid', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '1.234');
    expect(screen.getByLabelText('Ποσό εξόδου 1').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('πολλά δεκαδικά')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/features/register/expenses.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/features/register/ExpensesCard.tsx`**

```tsx
import { formatEuro } from '../../core/money';
import { exactExpenseMatch, suggestExpenseDescriptions, type SupplierHistory } from '../../core/suggestions';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, DraftDispatch, ExpenseDraft } from './draft';

interface Props {
  maxExpenses: number;
  draft: Draft;
  derived: Derived;
  history: SupplierHistory;
  dispatch: DraftDispatch;
  newId: () => string;
}

export function ExpensesCard({ maxExpenses, draft, derived, history, dispatch, newId }: Props) {
  return (
    <Card title="Έξοδα" aside={derived.expensesCents > 0 ? formatEuro(derived.expensesCents) : undefined}>
      {draft.expenses.map((expense, index) => (
        <ExpenseRow key={expense.id} expense={expense} index={index} derived={derived} history={history} dispatch={dispatch} />
      ))}
      {draft.expenses.length < maxExpenses && (
        <button type="button" className="link" onClick={() => dispatch({ type: 'addExpense', id: newId(), max: maxExpenses })}>
          + Έξοδο
        </button>
      )}
    </Card>
  );
}

interface RowProps {
  expense: ExpenseDraft;
  index: number;
  derived: Derived;
  history: SupplierHistory;
  dispatch: DraftDispatch;
}

function ExpenseRow({ expense, index, derived, history, dispatch }: RowProps) {
  const n = index + 1;
  const error = fieldError(derived, fieldId.expense(expense.id));
  const cents = derived.expenseRowCents[expense.id] ?? 0;
  const described = expense.description.trim() !== '';
  const chips = described ? [] : suggestExpenseDescriptions(history, cents);
  const setDescription = (description: string) => dispatch({ type: 'setExpense', id: expense.id, description });
  // After leaving the amount: fill the name only when exactly one supplier has this exact amount (V2).
  const autoFill = () => {
    if (described) return;
    const name = exactExpenseMatch(history, cents);
    if (name !== null) setDescription(name);
  };

  return (
    <div className="expense">
      <div className="row">
        <input
          className="field text"
          aria-label={`Περιγραφή εξόδου ${n}`}
          placeholder="Περιγραφή"
          autoComplete="off"
          value={expense.description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <AmountField
          id={`expense-${expense.id}`}
          label={`Ποσό εξόδου ${n}`}
          value={expense.amountText}
          invalid={error !== undefined}
          onBlur={autoFill}
          onChange={(text) => dispatch({ type: 'setExpense', id: expense.id, amountText: text })}
        />
        <button type="button" className="icon-btn" aria-label={`Αφαίρεση εξόδου ${n}`} onClick={() => dispatch({ type: 'removeExpense', id: expense.id })}>
          ×
        </button>
      </div>
      {error !== undefined && <p className="row-hint err">{error}</p>}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((name) => (
            <button type="button" key={name} className="chip" onClick={() => setDescription(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(register): expenses card with suggestions learned from submissions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Φάκελος sheet

**Files:**
- Create: `src/features/register/EnvelopeSheet.tsx`
- Test: `tests/features/register/envelopeSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet`; core `planEnvelope`, `EnvelopePlan`, `denomLabel`, `formatEuro`, `Cents`.
- Produces: `EnvelopeSheet({ denominations: readonly Cents[]; envelope: EnvelopePlan; onClose(): void })` — title "Φάκελος"; subtitle `"<amount> σε N κομμάτια"` (`"1 κομμάτι"` singular); rows `"<label>"` + `"× n"`; "✓ Ακριβές ποσό" or "Λείπουν <amount>"; `<details>` "Τι μένει στο ταμείο"; target ≤ 0 → "Δεν υπάρχουν μετρητά για φάκελο.". The sheet is modal and reads the live plan, so it cannot show stale numbers (spec: fixes V2 M2).

- [ ] **Step 1: Write the failing test `tests/features/register/envelopeSheet.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planEnvelope } from '../../../src/core/envelope';
import { EnvelopeSheet } from '../../../src/features/register/EnvelopeSheet';

afterEach(cleanup);
const DENOMS = [5000, 2000, 1000];

describe('EnvelopeSheet', () => {
  it('lists what goes in and confirms an exact amount (60€ = 3×20€)', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(6000, { '5000': 1, '2000': 3 }, DENOMS)} onClose={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Φάκελος' });
    expect(within(sheet).getByText('60,00€ σε 3 κομμάτια')).toBeTruthy();
    const item = within(sheet).getByText('× 3').closest('li') as HTMLElement;
    expect(item.textContent).toContain('20€');
    expect(within(sheet).getByText('✓ Ακριβές ποσό')).toBeTruthy();
    expect(within(sheet).getByText('Τι μένει στο ταμείο')).toBeTruthy();
  });

  it('says how much is missing when the till cannot cover it', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(1000, { '5000': 1 }, DENOMS)} onClose={vi.fn()} />);
    expect(screen.getByText('Λείπουν 10,00€')).toBeTruthy();
  });

  it('uses the singular for one piece', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(5000, { '5000': 1 }, DENOMS)} onClose={vi.fn()} />);
    expect(screen.getByText('50,00€ σε 1 κομμάτι')).toBeTruthy();
  });

  it('explains when there is no cash for an envelope', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(-100000, { '5000': 1 }, DENOMS)} onClose={vi.fn()} />);
    expect(screen.getByText('Δεν υπάρχουν μετρητά για φάκελο.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/features/register/envelopeSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/features/register/EnvelopeSheet.tsx`**

```tsx
import { denomLabel } from '../../core/denominations';
import type { EnvelopePlan } from '../../core/envelope';
import { formatEuro, type Cents } from '../../core/money';
import { Sheet } from '../../ui/Sheet';

interface Props {
  denominations: readonly Cents[];
  envelope: EnvelopePlan;
  onClose: () => void;
}

const pieces = (n: number): string => (n === 1 ? '1 κομμάτι' : `${n} κομμάτια`);

export function EnvelopeSheet({ denominations, envelope, onClose }: Props) {
  if (envelope.targetCents <= 0) {
    return (
      <Sheet title="Φάκελος" onClose={onClose}>
        <p>Δεν υπάρχουν μετρητά για φάκελο.</p>
      </Sheet>
    );
  }
  const sorted = [...denominations].sort((a, b) => b - a);
  const count = (plan: Record<string, number>, d: Cents) => plan[String(d)] ?? 0;
  const put = sorted.filter((d) => count(envelope.put, d) > 0);
  const left = sorted.filter((d) => count(envelope.remaining, d) > 0);
  const total = put.reduce((n, d) => n + count(envelope.put, d), 0);

  return (
    <Sheet title="Φάκελος" subtitle={`${formatEuro(envelope.targetCents)} σε ${pieces(total)}`} onClose={onClose}>
      <ul className="list">
        {put.map((d) => (
          <li className="list-row" key={d}>
            <span>{denomLabel(d)}</span>
            <b>× {count(envelope.put, d)}</b>
          </li>
        ))}
      </ul>
      {envelope.shortCents === 0 ? (
        <p className="status-ok">✓ Ακριβές ποσό</p>
      ) : (
        <p className="status-warn">Λείπουν {formatEuro(envelope.shortCents)}</p>
      )}
      {left.length > 0 && (
        <details className="rest">
          <summary>Τι μένει στο ταμείο</summary>
          <ul className="list">
            {left.map((d) => (
              <li className="list-row" key={d}>
                <span>{denomLabel(d)}</span>
                <span>× {count(envelope.remaining, d)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(register): Φάκελος sheet (exact envelope, shortfall, what stays)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Υποβολή sheet and sharing

**Files:**
- Create: `src/features/register/share.ts`, `src/features/register/SubmitSheet.tsx`
- Test: `tests/features/register/submitSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet`; `Draft`; `Derived`, `deriveClosing`; `SaveResult` (Task 4); `formatDateEl` (Task 3); core `ShopConfig`, `denomLabel`, `isBill`, `formatEuro`; `toBlob` from `html-to-image`.
- Produces:
  - `type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed'`; `type ShareFn = (card: HTMLElement, photo: File | null) => Promise<ShareOutcome>`; `shareCard: ShareFn`.
  - `SubmitSheet({ config: ShopConfig; draft: Draft; derived: Derived; onSave(): SaveResult; onShare: ShareFn; onClose(saved: boolean): void })` — dialog title "Υποβολή", becomes "Αποθηκεύτηκε ✓" after saving; photo button "Φωτογραφία Ζ" (✓ prefix once picked; `<input type="file" accept="image/*">`, no `capture` so phones offer camera **or** gallery); before saving: button "Υποβολή"; after: "Κοινοποίηση" and "Νέο κλείσιμο"; failed save shows "Δεν αποθηκεύτηκε. Δοκίμασε ξανά."; failed share shows "Η κοινοποίηση απέτυχε.".
  - Share card content: staff name + `formatDateEl(date)`; every total with `showInShare`; each expense (`description` or `Έξοδο n`) with amount; each non-zero channel; "Χαρτονομίσματα" / "Κέρματα" lines listing what stays after the envelope (`2×100€ · 5×50€`).

- [ ] **Step 1: Write the failing test `tests/features/register/submitSheet.test.tsx`**

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import { deriveClosing } from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';
import type { ShareFn } from '../../../src/features/register/share';
import { SubmitSheet } from '../../../src/features/register/SubmitSheet';

afterEach(cleanup);

const d: Draft = {
  ...newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ'),
  entries: { '10000': '1500', '5000': '50' },
  channels: { wolt: '45,60' },
  expenses: [
    { id: 'e1', description: 'Nice', amountText: '13' },
    { id: 'e2', description: '', amountText: '2' },
  ],
};
const derived = deriveClosing(cfg, d);

function setup(onSave = vi.fn(() => 'saved' as const), onShare: ShareFn = vi.fn(async () => 'shared' as const)) {
  const onClose = vi.fn();
  render(<SubmitSheet config={cfg} draft={d} derived={derived} onSave={onSave} onShare={onShare} onClose={onClose} />);
  return { onSave, onShare, onClose, dialog: () => screen.getByRole('dialog') };
}

describe('SubmitSheet', () => {
  it('shows the share card: staff, date, shared totals, expenses, channels, what stays', () => {
    const { dialog } = setup();
    const text = dialog().textContent ?? '';
    expect(text).toContain('ΓΚΡΕΖΙΟΣ');
    expect(text).toContain('28/09/2026');
    expect(text).toContain('ΤΑΜΕΙΟ');
    expect(text).toContain('ΜΕΤΡΗΤΑ');
    expect(text).not.toContain('ΜΕΤΡΗΤΑ LIM');
    expect(text).toContain('Nice');
    expect(text).toContain('Έξοδο 2');
    expect(text).toContain('WOLT');
    expect(text).toContain('45,60€');
    expect(text).toContain('Χαρτονομίσματα');
  });

  it('saves, then offers sharing and a new closing', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = screen.getByRole('dialog', { name: 'Αποθηκεύτηκε ✓' });
    expect(within(saved).queryByRole('button', { name: 'Υποβολή' })).toBeNull();
    fireEvent.click(within(saved).getByRole('button', { name: 'Νέο κλείσιμο' }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('keeps the form and says so when saving fails', () => {
    const { onClose } = setup(vi.fn(() => 'failed' as const));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    expect(screen.getByRole('alert').textContent).toBe('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
    expect(screen.getByRole('dialog', { name: 'Υποβολή' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('shares the card with the picked Z photo (never stored by the sheet)', async () => {
    const onShare = vi.fn<ShareFn>(async () => 'shared');
    setup(undefined, onShare);
    const photo = new File(['z'], 'z.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('Φωτογραφία Ζ');
    fireEvent.change(fileInput, { target: { files: [photo] } });
    expect(screen.getByText('✓ Φωτογραφία Ζ')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(onShare).toHaveBeenCalledTimes(1);
    const [card, file] = onShare.mock.calls[0]!;
    expect(card.textContent).toContain('ΓΚΡΕΖΙΟΣ');
    expect(file).toBe(photo);
  });

  it('reports a failed share', async () => {
    setup(undefined, vi.fn<ShareFn>(async () => 'failed'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Η κοινοποίηση απέτυχε.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/features/register/submitSheet.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/features/register/share.ts`**

```ts
import { toBlob } from 'html-to-image';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';
export type ShareFn = (card: HTMLElement, photo: File | null) => Promise<ShareOutcome>;

/**
 * Renders the summary card to a PNG and shares it (plus the optional Z photo) through the phone's
 * share sheet. Falls back to downloading the image where Web Share with files is unsupported.
 * Nothing is stored.
 */
export const shareCard: ShareFn = async (card, photo) => {
  try {
    const blob = await toBlob(card, { pixelRatio: 2, backgroundColor: getComputedStyle(card).backgroundColor });
    if (!blob) return 'failed';
    const image = new File([blob], 'tameio.png', { type: 'image/png' });
    const files = photo ? [image, photo] : [image];
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
      await navigator.share({ files });
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tameio.png';
    link.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
};
```

- [ ] **Step 4: Write `src/features/register/SubmitSheet.tsx`**

```tsx
import { useRef, useState } from 'react';
import { formatDateEl } from '../../app/dates';
import type { ShopConfig } from '../../core/config';
import { denomLabel, isBill } from '../../core/denominations';
import { formatEuro } from '../../core/money';
import type { SaveResult } from '../../data/local/submissions';
import { Sheet } from '../../ui/Sheet';
import type { Derived } from './derive';
import type { Draft } from './draft';
import type { ShareFn } from './share';

interface Props {
  config: ShopConfig;
  draft: Draft;
  derived: Derived;
  onSave: () => SaveResult;
  onShare: ShareFn;
  onClose: (saved: boolean) => void;
}

export function SubmitSheet({ config, draft, derived, onSave, onShare, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    if (onSave() === 'failed') {
      setMessage('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
      return;
    }
    setMessage(null);
    setSaved(true);
  };

  const share = async () => {
    if (!cardRef.current) return;
    setBusy(true);
    const outcome = await onShare(cardRef.current, photo);
    setBusy(false);
    setMessage(outcome === 'failed' ? 'Η κοινοποίηση απέτυχε.' : null);
  };

  return (
    <Sheet title={saved ? 'Αποθηκεύτηκε ✓' : 'Υποβολή'} onClose={() => onClose(saved)}>
      <div ref={cardRef}>
        <ShareCard config={config} draft={draft} derived={derived} />
      </div>
      {message !== null && (
        <p className="status-warn" role="alert">
          {message}
        </p>
      )}
      <div className="sheet-actions">
        <label className="btn btn-text">
          {photo ? '✓ Φωτογραφία Ζ' : 'Φωτογραφία Ζ'}
          <input type="file" accept="image/*" aria-label="Φωτογραφία Ζ" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        {saved ? (
          <>
            <button type="button" className="btn btn-text" disabled={busy} onClick={() => void share()}>
              Κοινοποίηση
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onClose(true)}>
              Νέο κλείσιμο
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={save}>
            Υποβολή
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ShareCard({ config, draft, derived }: { config: ShopConfig; draft: Draft; derived: Derived }) {
  const sorted = [...config.denominations].sort((a, b) => b - a);
  const stays = (bills: boolean) =>
    sorted
      .filter((d) => isBill(d) === bills && (derived.envelope.remaining[String(d)] ?? 0) > 0)
      .map((d) => `${derived.envelope.remaining[String(d)]}×${denomLabel(d)}`)
      .join(' · ');
  const billsLeft = stays(true);
  const coinsLeft = stays(false);
  const channels = config.channels.filter((ch) => (derived.inputs.channelCents[ch.id] ?? 0) > 0);

  return (
    <div className="share-card">
      <div className="share-head">
        <strong>{draft.staffName}</strong>
        <span>{formatDateEl(draft.businessDate)}</span>
      </div>
      {config.totals
        .filter((t) => t.showInShare)
        .map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <b>{formatEuro(derived.totals[t.id] ?? 0)}</b>
          </div>
        ))}
      {derived.inputs.expenses.map((e, i) => (
        <div className="tot" key={`e${i}`}>
          <span>{e.description || `Έξοδο ${i + 1}`}</span>
          <span>{formatEuro(e.cents)}</span>
        </div>
      ))}
      {channels.map((ch) => (
        <div className="tot" key={ch.id}>
          <span>{ch.label}</span>
          <span>{formatEuro(derived.inputs.channelCents[ch.id] ?? 0)}</span>
        </div>
      ))}
      {billsLeft !== '' && (
        <p className="share-left">
          <span>Χαρτονομίσματα</span> {billsLeft}
        </p>
      )}
      {coinsLeft !== '' && (
        <p className="share-left">
          <span>Κέρματα</span> {coinsLeft}
        </p>
      )}
    </div>
  );
}
```

Note: in the share card, an expense row whose description is blank shows `Έξοδο n` where n is its position among *counted* expenses — the test's second expense (blank description, 2€) is therefore "Έξοδο 2".

- [ ] **Step 5: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(register): Υποβολή sheet with share card, Z photo and share-as-image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Staff, date, menu, routes and theme

**Files:**
- Create: `src/app/router.ts`, `src/app/theme.ts`, `src/features/register/PeopleSheet.tsx`, `src/features/register/HeaderMenu.tsx`, `src/features/staff/StaffScreen.tsx`
- Test: `tests/app/routerTheme.test.ts`, `tests/features/people.test.tsx`

**Interfaces:**
- Consumes: `Sheet`, `Card`; `ThemePref` (Task 4).
- Produces:
  - `type Route = 'register' | 'tare' | 'staff'`; `parseRoute(hash: string): Route`; `routeHash(route: Route): string`; `useRoute(): [Route, (route: Route) => void]`.
  - `THEME_LABELS: Record<ThemePref, string>` (`system: 'Αυτόματο', light: 'Ανοιχτό', dark: 'Σκούρο'`); `nextTheme(p: ThemePref): ThemePref` (system → light → dark → system); `applyTheme(pref: ThemePref, root?: HTMLElement): void` (sets/deletes `data-theme`).
  - `PeopleSheet({ staff: readonly string[]; staffName: string; businessDate: string; onStaff(name: string): void; onDate(date: string): void; onManage(): void; onClose(): void })` — title "Ποιος κλείνει;", names as `role="radio"` buttons, link "Διαχείριση ονομάτων", date input labelled "Ημερομηνία", button "Εντάξει".
  - `HeaderMenu({ hasTare: boolean; themePref: ThemePref; onNavigate(route: Route): void; onTheme(): void })` — button "Μενού"; items "Αποβάρα" (only if `hasTare`), "Προσωπικό", `"Θέμα: <label>"`.
  - `StaffScreen({ staff: readonly string[]; onChange(names: string[]): void; onBack(): void })` — heading "Προσωπικό", back button "Πίσω", note "Προσωρινό: τα ονόματα αποθηκεύονται μόνο σε αυτή τη συσκευή.", inputs `Όνομα n` (rename on blur), remove `Αφαίρεση <name>`, add via `Νέο όνομα` + "Προσθήκη" (or Enter).

- [ ] **Step 1: Write the failing test `tests/app/routerTheme.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash } from '../../src/app/router';
import { applyTheme, nextTheme, THEME_LABELS } from '../../src/app/theme';

describe('router', () => {
  it('maps hashes to routes and back', () => {
    expect(parseRoute('#/tare')).toBe('tare');
    expect(parseRoute('#/staff')).toBe('staff');
    expect(parseRoute('')).toBe('register');
    expect(parseRoute('#/anything')).toBe('register');
    expect(routeHash('register')).toBe('#/');
    expect(routeHash('staff')).toBe('#/staff');
  });
});

describe('theme', () => {
  it('cycles system → light → dark → system with Greek labels', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(THEME_LABELS.system).toBe('Αυτόματο');
  });

  it('sets or clears data-theme on the root element', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing test `tests/features/people.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderMenu } from '../../src/features/register/HeaderMenu';
import { PeopleSheet } from '../../src/features/register/PeopleSheet';
import { StaffScreen } from '../../src/features/staff/StaffScreen';

afterEach(cleanup);

describe('PeopleSheet', () => {
  it('picks a name and a date', () => {
    const onStaff = vi.fn();
    const onDate = vi.fn();
    const onManage = vi.fn();
    render(<PeopleSheet staff={['ΓΚΡΕΖΙΟΣ', 'ΜΑΡΙΑ']} staffName="ΜΑΡΙΑ" businessDate="2026-09-28" onStaff={onStaff} onDate={onDate} onManage={onManage} onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'ΜΑΡΙΑ' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    expect(onStaff).toHaveBeenCalledWith('ΓΚΡΕΖΙΟΣ');
    fireEvent.change(screen.getByLabelText('Ημερομηνία'), { target: { value: '2026-09-27' } });
    expect(onDate).toHaveBeenCalledWith('2026-09-27');
    fireEvent.click(screen.getByRole('button', { name: 'Διαχείριση ονομάτων' }));
    expect(onManage).toHaveBeenCalled();
  });

  it('says when there are no names yet', () => {
    render(<PeopleSheet staff={[]} staffName="" businessDate="2026-09-28" onStaff={vi.fn()} onDate={vi.fn()} onManage={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Δεν υπάρχουν ονόματα ακόμα.')).toBeTruthy();
  });
});

describe('HeaderMenu', () => {
  it('hides Αποβάρα without tare items and navigates / cycles theme', () => {
    const onNavigate = vi.fn();
    const onTheme = vi.fn();
    const { rerender } = render(<HeaderMenu hasTare={false} themePref="system" onNavigate={onNavigate} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.queryByRole('menuitem', { name: 'Αποβάρα' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Θέμα: Αυτόματο' }));
    expect(onTheme).toHaveBeenCalled();
    rerender(<HeaderMenu hasTare themePref="dark" onNavigate={onNavigate} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Αποβάρα' }));
    expect(onNavigate).toHaveBeenCalledWith('tare');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('StaffScreen', () => {
  it('adds, renames and removes names', () => {
    const onChange = vi.fn();
    render(<StaffScreen staff={['ΓΚΡΕΖΙΟΣ', 'ΜΑΡΙΑ']} onChange={onChange} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Νέο όνομα'), { target: { value: 'ΝΙΚΟΣ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(onChange).toHaveBeenLastCalledWith(['ΓΚΡΕΖΙΟΣ', 'ΜΑΡΙΑ', 'ΝΙΚΟΣ']);
    expect((screen.getByLabelText('Νέο όνομα') as HTMLInputElement).value).toBe('');

    const first = screen.getByLabelText('Όνομα 1');
    fireEvent.change(first, { target: { value: 'ΓΚΡΕΖΙΟΣ Δ' } });
    fireEvent.blur(first);
    expect(onChange).toHaveBeenLastCalledWith(['ΓΚΡΕΖΙΟΣ Δ', 'ΜΑΡΙΑ']);

    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση ΜΑΡΙΑ' }));
    expect(onChange).toHaveBeenLastCalledWith(['ΓΚΡΕΖΙΟΣ']);
  });

  it('ignores an empty new name and goes back', () => {
    const onChange = vi.fn();
    const onBack = vi.fn();
    render(<StaffScreen staff={[]} onChange={onChange} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText('Προσωρινό: τα ονόματα αποθηκεύονται μόνο σε αυτή τη συσκευή.')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx vitest run tests/app/routerTheme.test.ts tests/features/people.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/app/router.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';

export type Route = 'register' | 'tare' | 'staff';

export function parseRoute(hash: string): Route {
  if (hash === '#/tare') return 'tare';
  if (hash === '#/staff') return 'staff';
  return 'register';
}

export function routeHash(route: Route): string {
  return route === 'register' ? '#/' : `#/${route}`;
}

/** Hash routes keep the phone's back button working without a router dependency. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.location.hash = routeHash(next);
    setRoute(next);
  }, []);
  return [route, navigate];
}
```

- [ ] **Step 5: Write `src/app/theme.ts`**

```ts
import type { ThemePref } from '../data/local/prefs';

export const THEME_LABELS: Record<ThemePref, string> = { system: 'Αυτόματο', light: 'Ανοιχτό', dark: 'Σκούρο' };

export function nextTheme(pref: ThemePref): ThemePref {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

/** 'system' removes the override so prefers-color-scheme decides (see theme.css). */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}
```

- [ ] **Step 6: Write `src/features/register/PeopleSheet.tsx`**

```tsx
import { Sheet } from '../../ui/Sheet';

interface Props {
  staff: readonly string[];
  staffName: string;
  businessDate: string;
  onStaff: (name: string) => void;
  onDate: (date: string) => void;
  onManage: () => void;
  onClose: () => void;
}

export function PeopleSheet({ staff, staffName, businessDate, onStaff, onDate, onManage, onClose }: Props) {
  return (
    <Sheet title="Ποιος κλείνει;" onClose={onClose}>
      {staff.length === 0 ? (
        <p className="sub">Δεν υπάρχουν ονόματα ακόμα.</p>
      ) : (
        <div className="choices" role="radiogroup" aria-label="Όνομα">
          {staff.map((name) => (
            <button type="button" role="radio" aria-checked={name === staffName} key={name} className="choice" onClick={() => onStaff(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="link" onClick={onManage}>
        Διαχείριση ονομάτων
      </button>
      <label className="date-label">
        Ημερομηνία
        <input type="date" className="field text" value={businessDate} onChange={(e) => onDate(e.target.value)} />
      </label>
      <button type="button" className="btn btn-primary wide" onClick={onClose}>
        Εντάξει
      </button>
    </Sheet>
  );
}
```

- [ ] **Step 7: Write `src/features/register/HeaderMenu.tsx`**

```tsx
import { useState } from 'react';
import type { Route } from '../../app/router';
import { THEME_LABELS } from '../../app/theme';
import type { ThemePref } from '../../data/local/prefs';

interface Props {
  hasTare: boolean;
  themePref: ThemePref;
  onNavigate: (route: Route) => void;
  onTheme: () => void;
}

export function HeaderMenu({ hasTare, themePref, onNavigate, onTheme }: Props) {
  const [open, setOpen] = useState(false);
  const go = (route: Route) => {
    setOpen(false);
    onNavigate(route);
  };
  return (
    <div className="menu-wrap">
      <button type="button" className="icon-btn" aria-label="Μενού" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu">
          {hasTare && (
            <button type="button" role="menuitem" onClick={() => go('tare')}>
              Αποβάρα
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => go('staff')}>
            Προσωπικό
          </button>
          <button type="button" role="menuitem" onClick={onTheme}>
            Θέμα: {THEME_LABELS[themePref]}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Write `src/features/staff/StaffScreen.tsx`**

```tsx
import { useState } from 'react';
import { Card } from '../../ui/Card';

interface Props {
  staff: readonly string[];
  onChange: (names: string[]) => void;
  onBack: () => void;
}

/** DEV ONLY (Plan 2): device-local staff list. Replaced by server staff + PIN in Plan 4. */
export function StaffScreen({ staff, onChange, onBack }: Props) {
  const [newName, setNewName] = useState('');
  const add = () => {
    if (newName.trim() === '') return;
    onChange([...staff, newName]);
    setNewName('');
  };
  return (
    <div className="app">
      <header className="top">
        <button type="button" className="icon-btn" aria-label="Πίσω" onClick={onBack}>
          ←
        </button>
        <h1>Προσωπικό</h1>
        <span />
      </header>
      <main className="page">
        <p className="notice-soft">Προσωρινό: τα ονόματα αποθηκεύονται μόνο σε αυτή τη συσκευή.</p>
        <Card>
          {staff.map((name, i) => (
            <div className="row" key={`${i}-${name}`}>
              <input
                className="field text"
                aria-label={`Όνομα ${i + 1}`}
                defaultValue={name}
                onBlur={(e) => {
                  if (e.target.value !== name) onChange(staff.map((n, j) => (j === i ? e.target.value : n)));
                }}
              />
              <button type="button" className="icon-btn" aria-label={`Αφαίρεση ${name}`} onClick={() => onChange(staff.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <div className="row">
            <input
              className="field text"
              aria-label="Νέο όνομα"
              placeholder="Νέο όνομα"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <button type="button" className="btn btn-text" onClick={add}>
              Προσθήκη
            </button>
          </div>
        </Card>
      </main>
    </div>
  );
}
```

- [ ] **Step 9: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: staff/date sheet, header menu, hash routes, theme switch, staff screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Αποβάρα screen and coin calculator

**Files:**
- Create: `src/features/register/coinCalc.ts`, `src/features/register/CoinCalcSheet.tsx`, `src/features/tare/TareScreen.tsx`
- Test: `tests/features/tools.test.tsx`

**Interfaces:**
- Consumes: `AmountField`, `Card`, `Sheet`; core `parseAmount`, `sanitizeAmountInput`, `centsToPlain`, `formatEuro`, `netWeightGrams`, `formatKg`, `TareItem`, `Cents`.
- Produces:
  - `sumAmounts(texts: readonly string[]): { cents: Cents; invalidIndexes: number[] }` (empty rows ignored).
  - `CoinCalcSheet({ label: string; onApply(text: string): void; onClose(): void })` — title `"Άθροισμα · <label>"`, subtitle "Πρόσθεσε κάθε ποσό ξεχωριστά", starts with 3 rows labelled `Ποσό n`, typing in the last row adds a new one, "Σύνολο" line, button "Καταχώρηση" (disabled while any row is invalid) calls `onApply(centsToPlain(total))` or `onApply('')` for 0.
  - `TareScreen({ items: readonly TareItem[]; onBack(): void })` — heading "Αποβάρα", one weight input per item labelled `Βάρος <name> (kg)`, net shown in an element labelled `Καθαρό <name>` (`formatKg` or `—`).

- [ ] **Step 1: Write the failing test `tests/features/tools.test.tsx`**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../src/core/presets';
import { CoinCalcSheet } from '../../src/features/register/CoinCalcSheet';
import { sumAmounts } from '../../src/features/register/coinCalc';
import { TareScreen } from '../../src/features/tare/TareScreen';

afterEach(cleanup);

describe('sumAmounts', () => {
  it('adds valid rows, ignores empty ones, reports invalid ones', () => {
    expect(sumAmounts(['100', '', '50,50'])).toEqual({ cents: 15050, invalidIndexes: [] });
    expect(sumAmounts(['1.234', '5'])).toEqual({ cents: 500, invalidIndexes: [0] });
    expect(sumAmounts([])).toEqual({ cents: 0, invalidIndexes: [] });
  });
});

describe('CoinCalcSheet', () => {
  it('sums batches, grows a new row, and applies the total', () => {
    const onApply = vi.fn();
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Άθροισμα · ΚΕΡΜΑΤΑ' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ποσό 1'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Ποσό 3'), { target: { value: '50' } });
    expect(screen.getByLabelText('Ποσό 4')).toBeTruthy();
    expect(screen.getByText('150,00€')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Καταχώρηση' }));
    expect(onApply).toHaveBeenCalledWith('150');
  });

  it('blocks applying while a row is invalid', () => {
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ποσό 1'), { target: { value: '1.234' } });
    expect((screen.getByRole('button', { name: 'Καταχώρηση' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TareScreen', () => {
  it('shows net weight per product', () => {
    const onBack = vi.fn();
    render(<TareScreen items={joinJuicePreset.tareItems} onBack={onBack} />);
    fireEvent.change(screen.getByLabelText('Βάρος Σολομός μπροστά (kg)'), { target: { value: '1,2' } });
    expect(screen.getByLabelText('Καθαρό Σολομός μπροστά').textContent).toBe('0.840');
    fireEvent.change(screen.getByLabelText('Βάρος Κοτόπουλο (kg)'), { target: { value: '0.1' } });
    expect(screen.getByLabelText('Καθαρό Κοτόπουλο').textContent).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/features/tools.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/features/register/coinCalc.ts`**

```ts
import { parseAmount, type Cents } from '../../core/money';

/** Sum of several typed batch amounts (the V2 ΚΕΡΜΑΤΑ calculator). Empty rows are ignored. */
export function sumAmounts(texts: readonly string[]): { cents: Cents; invalidIndexes: number[] } {
  let cents = 0;
  const invalidIndexes: number[] = [];
  texts.forEach((text, i) => {
    const r = parseAmount(text);
    if (r.ok) cents += r.value;
    else if (r.reason !== 'empty') invalidIndexes.push(i);
  });
  return { cents, invalidIndexes };
}
```

- [ ] **Step 4: Write `src/features/register/CoinCalcSheet.tsx`**

```tsx
import { useState } from 'react';
import { centsToPlain, formatEuro, sanitizeAmountInput } from '../../core/money';
import { AmountField } from '../../ui/AmountField';
import { Sheet } from '../../ui/Sheet';
import { sumAmounts } from './coinCalc';

interface Props {
  label: string;
  onApply: (text: string) => void;
  onClose: () => void;
}

export function CoinCalcSheet({ label, onApply, onClose }: Props) {
  const [rows, setRows] = useState<string[]>(['', '', '']);
  const { cents, invalidIndexes } = sumAmounts(rows);

  const set = (i: number, raw: string) => {
    const text = sanitizeAmountInput(raw);
    const next = rows.map((r, j) => (j === i ? text : r));
    if (i === next.length - 1 && text !== '') next.push('');
    setRows(next);
  };

  return (
    <Sheet title={`Άθροισμα · ${label}`} subtitle="Πρόσθεσε κάθε ποσό ξεχωριστά" onClose={onClose}>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <span className="row-label">{i + 1}.</span>
          <AmountField id={`calc-${i}`} label={`Ποσό ${i + 1}`} value={r} invalid={invalidIndexes.includes(i)} onChange={(t) => set(i, t)} />
        </div>
      ))}
      <div className="tot main">
        <span>Σύνολο</span>
        <span>{formatEuro(cents)}</span>
      </div>
      <button type="button" className="btn btn-primary wide" disabled={invalidIndexes.length > 0} onClick={() => onApply(cents === 0 ? '' : centsToPlain(cents))}>
        Καταχώρηση
      </button>
    </Sheet>
  );
}
```

- [ ] **Step 5: Write `src/features/tare/TareScreen.tsx`**

```tsx
import { useState } from 'react';
import type { TareItem } from '../../core/config';
import { sanitizeAmountInput } from '../../core/money';
import { formatKg, netWeightGrams } from '../../core/tare';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';

export function TareScreen({ items, onBack }: { items: readonly TareItem[]; onBack: () => void }) {
  const [weights, setWeights] = useState<Record<number, string>>({});
  return (
    <div className="app">
      <header className="top">
        <button type="button" className="icon-btn" aria-label="Πίσω" onClick={onBack}>
          ←
        </button>
        <h1>Αποβάρα</h1>
        <span />
      </header>
      <main className="page">
        <Card>
          {items.map((item, i) => {
            const net = netWeightGrams(weights[i] ?? '', item.tareGrams);
            return (
              <div className="row" key={item.name}>
                <span className="row-label">
                  {item.name}
                  <br />
                  <small className="row-hint">αποβάρο {formatKg(item.tareGrams)}</small>
                </span>
                <AmountField
                  id={`tare-${i}`}
                  label={`Βάρος ${item.name} (kg)`}
                  placeholder="0.000"
                  value={weights[i] ?? ''}
                  onChange={(t) => setWeights({ ...weights, [i]: sanitizeAmountInput(t) })}
                />
                <strong className="tare-net" aria-label={`Καθαρό ${item.name}`}>
                  {net === null ? '—' : formatKg(net)}
                </strong>
              </div>
            );
          })}
        </Card>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Αποβάρα screen and ΚΕΡΜΑΤΑ coin calculator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Compose RegisterScreen and App; end-to-end flows

**Files:**
- Create: `src/app/ids.ts`, `src/app/shop.ts`, `src/app/ErrorBoundary.tsx`, `src/features/register/useDraftAutosave.ts`, `src/features/register/RegisterScreen.tsx`
- Modify: `src/app/App.tsx` (replace placeholder)
- Delete: `tests/app/smoke.test.tsx` (superseded)
- Test: `tests/app/app.test.tsx`, `tests/app/ids.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–12.
- Produces:
  - `randomId(): string` — `crypto.randomUUID()` when available (secure contexts), else a time+random id (plain-HTTP LAN testing).
  - `interface LocalShop { id: string; name: string; config: ShopConfig }`; `LOCAL_SHOP` (DEV ONLY).
  - `ErrorBoundary` — fallback: heading "Κάτι πήγε στραβά", text "Τα στοιχεία σου έχουν αποθηκευτεί. Ανανέωσε τη σελίδα.", button "Ανανέωση".
  - `useDraftAutosave(store, shopId, draft, now)` — debounced 300 ms save + save on `pagehide`.
  - `RegisterScreen(props: RegisterProps)` with `RegisterProps = { shop: LocalShop; store: KeyValueStore; now(): Date; newId(): string; share: ShareFn; staff: readonly string[]; themePref: ThemePref; onTheme(): void; onNavigate(route: Route): void }`. Header meta button text: `"<Δευ 28/09> · <staff or 'Διάλεξε όνομα'>"`. Toast after a saved closing: "Το κλείσιμο αποθηκεύτηκε".
  - `App(props: { appStore?: AppStore; shop?: LocalShop; now?: () => Date; newId?: () => string; share?: ShareFn })`. Non-persistent storage shows the notice "Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα."

- [ ] **Step 1: Write the failing tests**

`tests/app/ids.test.ts`:

```ts
import { expect, it } from 'vitest';
import { randomId } from '../../src/app/ids';

it('returns distinct non-empty ids', () => {
  const a = randomId();
  const b = randomId();
  expect(a).not.toBe('');
  expect(a).not.toBe(b);
});
```

`tests/app/app.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { loadStaff, saveStaff } from '../../src/data/local/staff';
import { memoryStore, shopKey, type KeyValueStore } from '../../src/data/local/storage';
import { loadSubmissions } from '../../src/data/local/submissions';
import type { ShareFn } from '../../src/features/register/share';

const NOW = () => new Date(2026, 8, 28, 22, 0);
let n = 0;
const newId = () => `id-${++n}`;
const share = vi.fn<ShareFn>(async () => 'shared');

beforeEach(() => {
  n = 0;
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function start(store: KeyValueStore = memoryStore(), persistent = true) {
  render(<App appStore={{ store, persistent }} now={NOW} newId={newId} share={share} />);
  return store;
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const barAmount = () => document.querySelector('.bar strong')?.textContent;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

function typeV2Closing() {
  for (const [label, value] of [
    ['100€', '500'], ['50€', '300'], ['20€', '240'], ['10€', '90'], ['5€', '35'], ['2€', '24'], ['1€', '17'],
    ['50c', '6.5'], ['20c', '3.4'], ['10c', '1.2'], ['5c', '0.45'],
    ['ΚΕΡΜΑΤΑ', '150'], ['WOLT', '45,60'], ['EFOOD', '23.10'], ['myPos', '310.25'], ['Eurobank', '88.40'],
  ] as const) type(label, value);
  fireEvent.click(button('+ Έξοδο'));
  type('Περιγραφή εξόδου 1', 'Nice');
  type('Ποσό εξόδου 1', '12.50');
  fireEvent.click(button('+ Έξοδο'));
  type('Ποσό εξόδου 2', '7,80');
}

describe('register flows', () => {
  it('reproduces a tameioV2 closing end to end (comma decimals included)', () => {
    start();
    typeV2Closing();
    expect(barAmount()).toBe('367,55€');
    expect(screen.getByRole('region', { name: 'Σύνοψη' }).textContent).toContain('1.855,20€');
    expect(screen.getByRole('region', { name: 'Έξοδα' }).textContent).toContain('20,30€');
  });

  it('switching € → # converts what was typed and keeps the totals', () => {
    start();
    type('100€', '1500');
    fireEvent.click(button('# Κομμάτια'));
    const field = screen.getByLabelText('100€') as HTMLInputElement;
    expect(field.value).toBe('15');
    expect(within(field.closest('.row') as HTMLElement).getByText('1.500,00€')).toBeTruthy();
    expect(barAmount()).toBe('500,00€');
  });

  it('blocks Φάκελος and Υποβολή while a field is wrong, and names it', () => {
    start();
    type('10€', '95');
    expect(button('Φάκελος').disabled).toBe(true);
    expect(button('Υποβολή').disabled).toBe(true);
    expect(screen.getByText('Λάθος τιμή: 10€')).toBeTruthy();
  });

  it('flags a Greek thousands separator instead of reading it as 1,50€', () => {
    start();
    type('100€', '1.500');
    expect(screen.getByLabelText('100€').getAttribute('aria-invalid')).toBe('true');
    expect(button('Φάκελος').disabled).toBe(true);
  });

  it('opens the exact Φάκελος (60€ as 3×20€)', () => {
    start();
    type('50€', '50');
    type('20€', '60');
    type('ΚΕΡΜΑΤΑ', '950');
    fireEvent.click(button('Φάκελος'));
    const sheet = screen.getByRole('dialog', { name: 'Φάκελος' });
    expect(within(sheet).getByText('60,00€ σε 3 κομμάτια')).toBeTruthy();
    expect(within(sheet).getByText('✓ Ακριβές ποσό')).toBeTruthy();
  });

  it('submits once, resets the numbers but keeps staff and date, and learns the expense', () => {
    const store = memoryStore();
    saveStaff(store, 'local', ['ΓΚΡΕΖΙΟΣ']);
    start(store);
    expect(button('Υποβολή').disabled).toBe(true);
    expect(screen.getByText('Διάλεξε όνομα για υποβολή')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    fireEvent.click(button('Εντάξει'));

    type('100€', '1500');
    fireEvent.click(button('+ Έξοδο'));
    type('Περιγραφή εξόδου 1', 'Ντόντης');
    type('Ποσό εξόδου 1', '24');

    fireEvent.click(button('Υποβολή'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
    expect(loadSubmissions(store, 'local')).toHaveLength(1);
    fireEvent.click(button('Νέο κλείσιμο'));

    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Δευ 28/09 · ΓΚΡΕΖΙΟΣ' })).toBeTruthy();
    expect(screen.getByText('Το κλείσιμο αποθηκεύτηκε')).toBeTruthy();
    expect(loadSubmissions(store, 'local')).toHaveLength(1);

    fireEvent.click(button('+ Έξοδο'));
    type('Ποσό εξόδου 1', '24');
    expect(screen.getByRole('button', { name: 'Ντόντης' })).toBeTruthy();
  });

  it('says so and keeps the form when the device refuses to save', () => {
    const base = memoryStore();
    const failing: KeyValueStore = {
      getItem: (k) => base.getItem(k),
      removeItem: (k) => base.removeItem(k),
      setItem: (k, v) => {
        if (k.endsWith(':submissions')) throw new Error('QuotaExceededError');
        base.setItem(k, v);
      },
    };
    saveStaff(failing, 'local', ['ΓΚΡΕΖΙΟΣ']);
    start(failing);
    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    fireEvent.click(button('Εντάξει'));
    type('100€', '1500');
    fireEvent.click(button('Υποβολή'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    expect(screen.getByRole('alert').textContent).toBe('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
    expect(screen.queryByText('Το κλείσιμο αποθηκεύτηκε')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('1500');
  });
});

describe('persistence and resilience', () => {
  it('restores the draft after a reload', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = start();
    type('100€', '500');
    act(() => {
      vi.advanceTimersByTime(350);
    });
    cleanup();
    start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('500');
  });

  it('starts fresh when the stored draft is corrupt', () => {
    const store = memoryStore();
    store.setItem(shopKey('local', 'draft'), JSON.stringify({ savedAt: NOW().getTime(), draft: { id: 5 } }));
    start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
  });

  it('warns when storage is unavailable', () => {
    start(memoryStore(), false);
    expect(screen.getByText('Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('adds a name in Προσωπικό and offers it back on the register', () => {
    const store = start();
    fireEvent.click(button('Μενού'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Προσωπικό' }));
    type('Νέο όνομα', 'ΜΑΡΙΑ');
    fireEvent.click(button('Προσθήκη'));
    expect(loadStaff(store, 'local')).toEqual(['ΜΑΡΙΑ']);
    fireEvent.click(button('Πίσω'));
    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    expect(screen.getByRole('radio', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
  });

  it('opens Αποβάρα from the menu and fills ΚΕΡΜΑΤΑ from the calculator', () => {
    start();
    fireEvent.click(button('Άθροισμα για ΚΕΡΜΑΤΑ'));
    type('Ποσό 1', '100');
    type('Ποσό 2', '50');
    fireEvent.click(button('Καταχώρηση'));
    expect((screen.getByLabelText('ΚΕΡΜΑΤΑ') as HTMLInputElement).value).toBe('150');
    fireEvent.click(button('Μενού'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Αποβάρα' }));
    expect(screen.getByRole('heading', { name: 'Αποβάρα' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/app/app.test.tsx tests/app/ids.test.ts`
Expected: FAIL — `ids` not found; `App` does not accept the props / placeholder renders no fields.

- [ ] **Step 3: Write `src/app/ids.ts`**

```ts
/** crypto.randomUUID exists only in secure contexts (https, localhost); plain-HTTP LAN testing needs a fallback. */
export function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
```

- [ ] **Step 4: Write `src/app/shop.ts`**

```ts
import type { ShopConfig } from '../core/config';
import { joinJuicePreset } from '../core/presets';

export interface LocalShop {
  id: string;
  name: string;
  config: ShopConfig;
}

/** DEV ONLY (Plan 2): the only shop until owner setup arrives in Plan 4. */
export const LOCAL_SHOP: LocalShop = { id: 'local', name: 'Join Juice', config: joinJuicePreset };
```

- [ ] **Step 5: Write `src/app/ErrorBoundary.tsx`**

```tsx
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app">
        <main className="page">
          <div className="card">
            <h2>Κάτι πήγε στραβά</h2>
            <p>Τα στοιχεία σου έχουν αποθηκευτεί. Ανανέωσε τη σελίδα.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Ανανέωση
            </button>
          </div>
        </main>
      </div>
    );
  }
}
```

- [ ] **Step 6: Write `src/features/register/useDraftAutosave.ts`**

```ts
import { useEffect, useRef } from 'react';
import { saveDraft } from '../../data/local/drafts';
import type { KeyValueStore } from '../../data/local/storage';
import type { Draft } from './draft';

/** Saves the draft 300 ms after the last change, and immediately when the page is hidden. */
export function useDraftAutosave(store: KeyValueStore, shopId: string, draft: Draft, now: () => Date): void {
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
    const timer = setTimeout(() => saveDraft(store, shopId, draft, now().getTime()), 300);
    return () => clearTimeout(timer);
  }, [store, shopId, draft, now]);

  useEffect(() => {
    const onHide = () => saveDraft(store, shopId, latest.current, now().getTime());
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [store, shopId, now]);
}
```

- [ ] **Step 7: Write `src/features/register/RegisterScreen.tsx`**

```tsx
import { useEffect, useMemo, useReducer, useState } from 'react';
import { formatDayEl, todayIso } from '../../app/dates';
import type { Route } from '../../app/router';
import type { LocalShop } from '../../app/shop';
import { isBill } from '../../core/denominations';
import { buildSupplierHistory } from '../../core/suggestions';
import { loadDraft } from '../../data/local/drafts';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import { loadSubmissions, pastExpenses, saveSubmission, type SaveResult } from '../../data/local/submissions';
import { BottomBar } from './BottomBar';
import { ChannelsCard } from './ChannelsCard';
import { CoinCalcSheet } from './CoinCalcSheet';
import { CountCard } from './CountCard';
import { deriveClosing, envelopeBlockReason, submitBlockReason } from './derive';
import { draftReducer, newDraft, type Draft } from './draft';
import { EnvelopeSheet } from './EnvelopeSheet';
import { ExpensesCard } from './ExpensesCard';
import { HeaderMenu } from './HeaderMenu';
import { ModeSwitch } from './ModeSwitch';
import { PeopleSheet } from './PeopleSheet';
import type { ShareFn } from './share';
import { SubmitSheet } from './SubmitSheet';
import { SummaryCard } from './SummaryCard';
import { useDraftAutosave } from './useDraftAutosave';

export interface RegisterProps {
  shop: LocalShop;
  store: KeyValueStore;
  now: () => Date;
  newId: () => string;
  share: ShareFn;
  staff: readonly string[];
  themePref: ThemePref;
  onTheme: () => void;
  onNavigate: (route: Route) => void;
}

type SheetName = 'envelope' | 'submit' | 'people';

export function RegisterScreen({ shop, store, now, newId, share, staff, themePref, onTheme, onNavigate }: RegisterProps) {
  const { config } = shop;
  const [draft, dispatch] = useReducer(
    draftReducer,
    null,
    (): Draft => loadDraft(store, shop.id, now().getTime()) ?? newDraft(newId(), todayIso(now())),
  );
  const derived = useMemo(() => deriveClosing(config, draft), [config, draft]);
  const [submissions, setSubmissions] = useState(() => loadSubmissions(store, shop.id));
  const history = useMemo(() => buildSupplierHistory(pastExpenses(submissions)), [submissions]);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [calcFor, setCalcFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useDraftAutosave(store, shop.id, draft, now);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const bills = config.denominations.filter(isBill);
  const coins = config.denominations.filter((d) => !isBill(d));
  const envelopeDef = config.totals.find((t) => t.id === config.envelopeTotalId);
  const calcChannel = config.channels.find((c) => c.id === calcFor);

  const save = (): SaveResult => {
    const result = saveSubmission(store, {
      id: draft.id,
      shopId: shop.id,
      staffName: draft.staffName,
      businessDate: draft.businessDate,
      submittedAt: now().toISOString(),
      inputs: derived.inputs,
    });
    if (result !== 'failed') setSubmissions(loadSubmissions(store, shop.id));
    return result;
  };

  const closeSubmit = (saved: boolean) => {
    setSheet(null);
    if (!saved) return;
    dispatch({ type: 'resetInputs', id: newId() });
    setToast('Το κλείσιμο αποθηκεύτηκε');
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Κλείσιμο ταμείου</h1>
          <button type="button" className="meta-btn" onClick={() => setSheet('people')}>
            {formatDayEl(draft.businessDate)} · {draft.staffName || 'Διάλεξε όνομα'}
          </button>
        </div>
        <HeaderMenu hasTare={config.tareItems.length > 0} themePref={themePref} onNavigate={onNavigate} onTheme={onTheme} />
      </header>
      <main className="page">
        <ModeSwitch mode={draft.mode} onChange={(mode) => dispatch({ type: 'setMode', mode, denominations: config.denominations })} />
        <CountCard title="Χαρτονομίσματα" denominations={bills} totalCents={derived.billsCents} draft={draft} derived={derived} dispatch={dispatch} />
        <CountCard title="Κέρματα" denominations={coins} totalCents={derived.coinsCents} draft={draft} derived={derived} dispatch={dispatch} />
        <ExpensesCard maxExpenses={config.maxExpenses} draft={draft} derived={derived} history={history} dispatch={dispatch} newId={newId} />
        <ChannelsCard channels={config.channels} draft={draft} derived={derived} dispatch={dispatch} onCalculator={setCalcFor} />
        <SummaryCard config={config} totals={derived.totals} />
      </main>
      <BottomBar
        label={envelopeDef?.label ?? ''}
        amountCents={derived.totals[config.envelopeTotalId] ?? 0}
        envelopeBlocked={envelopeBlockReason(derived)}
        submitBlocked={submitBlockReason(derived, draft)}
        onEnvelope={() => setSheet('envelope')}
        onSubmit={() => setSheet('submit')}
      />
      {sheet === 'envelope' && <EnvelopeSheet denominations={config.denominations} envelope={derived.envelope} onClose={() => setSheet(null)} />}
      {sheet === 'submit' && <SubmitSheet config={config} draft={draft} derived={derived} onSave={save} onShare={share} onClose={closeSubmit} />}
      {sheet === 'people' && (
        <PeopleSheet
          staff={staff}
          staffName={draft.staffName}
          businessDate={draft.businessDate}
          onStaff={(name) => dispatch({ type: 'setStaff', name })}
          onDate={(date) => dispatch({ type: 'setDate', date })}
          onManage={() => {
            setSheet(null);
            onNavigate('staff');
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {calcChannel !== undefined && (
        <CoinCalcSheet
          label={calcChannel.label}
          onApply={(text) => {
            dispatch({ type: 'setChannel', id: calcChannel.id, text });
            setCalcFor(null);
          }}
          onClose={() => setCalcFor(null)}
        />
      )}
      {toast !== null && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Replace `src/app/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { loadTheme, saveTheme } from '../data/local/prefs';
import { loadStaff, normalizeStaff, saveStaff } from '../data/local/staff';
import { pickStore, type AppStore } from '../data/local/storage';
import { RegisterScreen } from '../features/register/RegisterScreen';
import { shareCard, type ShareFn } from '../features/register/share';
import { StaffScreen } from '../features/staff/StaffScreen';
import { TareScreen } from '../features/tare/TareScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { randomId } from './ids';
import { useRoute } from './router';
import { LOCAL_SHOP, type LocalShop } from './shop';
import { applyTheme, nextTheme } from './theme';

interface AppProps {
  appStore?: AppStore;
  shop?: LocalShop;
  now?: () => Date;
  newId?: () => string;
  share?: ShareFn;
}

const systemNow = (): Date => new Date();

export function App({ appStore, shop = LOCAL_SHOP, now = systemNow, newId = randomId, share = shareCard }: AppProps) {
  const [{ store, persistent }] = useState(() => appStore ?? pickStore());
  const [route, navigate] = useRoute();
  const [staff, setStaff] = useState(() => loadStaff(store, shop.id));
  const [themePref, setThemePref] = useState(() => loadTheme(store));

  useEffect(() => applyTheme(themePref), [themePref]);

  const cycleTheme = () => {
    const next = nextTheme(themePref);
    saveTheme(store, next);
    setThemePref(next);
  };
  const changeStaff = (names: string[]) => setStaff(saveStaff(store, shop.id, names) ?? normalizeStaff(names));

  return (
    <ErrorBoundary>
      {!persistent && (
        <p className="notice" role="alert">
          Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.
        </p>
      )}
      {/* The register stays mounted (hidden) so switching screens never loses typing. */}
      <div hidden={route !== 'register'}>
        <RegisterScreen
          shop={shop}
          store={store}
          now={now}
          newId={newId}
          share={share}
          staff={staff}
          themePref={themePref}
          onTheme={cycleTheme}
          onNavigate={navigate}
        />
      </div>
      {route === 'staff' && <StaffScreen staff={staff} onChange={changeStaff} onBack={() => navigate('register')} />}
      {route === 'tare' && <TareScreen items={shop.config.tareItems} onBack={() => navigate('register')} />}
    </ErrorBoundary>
  );
}
```

- [ ] **Step 9: Delete the superseded smoke test**

Run: `git rm tests/app/smoke.test.tsx`

- [ ] **Step 10: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests PASS; typecheck clean; `vite build` succeeds.

- [ ] **Step 11: Try it locally in a browser**

Run: `npm run dev` and open the printed `http://localhost:5173/`. Type a closing, open Φάκελος, pick a name (add one via ⋯ → Προσωπικό first), submit, share (desktop falls back to downloading `tameio.png`), switch theme. Stop the server afterwards.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: compose the register screen and app; end-to-end flow tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Docs and deploy

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_STATUS.md`, `README.md`

**Interfaces:**
- Consumes: the finished app.
- Produces: accurate docs and a deployed URL (the Vercel import is a one-time human step).

- [ ] **Step 1: Update `CLAUDE.md`**

Replace the `## Architecture` section with:

```markdown
## Architecture
- `src/core/` — pure TypeScript money logic. No packages, no DOM, no Supabase. Every UI and
  report computes through these functions. The purity rule is enforced by
  `tests/core-purity.test.ts` (a Vitest check, not a linter).
- `src/features/register/draft.ts` + `derive.ts` — the register's pure model: the draft holds raw
  typed text; `deriveClosing(config, draft)` is the only bridge from text to money.
- `src/data/local/` — the only code that touches localStorage (drafts, submissions, staff, theme).
  Every call is failure-safe; `pickStore()` falls back to memory when storage is unavailable.
- `src/ui/` primitives, `src/features/*` screens and sheets, `src/app/` composition (App, hash
  router, theme, error boundary).
- (Plan 3+) `src/data/` Supabase access (the one mutation path), `supabase/migrations/`.
```

Add under `## Invariants`:

```markdown
- Components never parse or add money: text → cents via `deriveClosing`/core, display via `formatEuro`.
- The Z photo is attached to the share only — never stored (not on the device, not on the server).
```

Replace `## DEV ONLY register` content with:

```markdown
| What | Where | Remove when |
|---|---|---|
| `LOCAL_SHOP` — Join Juice preset as the only shop | `src/app/shop.ts` | Plan 4 (owner setup) |
| Device-local staff list + Προσωπικό screen | `src/data/local/staff.ts`, `src/features/staff/StaffScreen.tsx` | Plan 4 (server staff + PIN) |
```

- [ ] **Step 2: Update `PROJECT_STATUS.md`**

- In `## Stages`, change the Plan 2 line to `- [x] Plan 2 — register UI on local preset (real-device check pending)`.
- In the V2 issues table set Status: H1 `fixed — exact planEnvelope in Φάκελος sheet`, H2 `fixed — one planEnvelope fed by deriveClosing`, M1 `fixed — resetInputs keeps staff/date/mode`, M2 `fixed — modal sheet reads live derived state`, M3 `fixed — sanitize on input + deriveClosing validation`, L1 `fixed — React text rendering, no innerHTML`.
- In `## Tests` append: `UI (jsdom + Testing Library): primitives, counting cards, expenses + learned suggestions, Φάκελος, Υποβολή/share, staff/date/menu/theme, Αποβάρα, coin calculator, end-to-end register flows (V2 parity, mode switch, blocking, thousands separator, submit once + reset + learning, storage failure, draft restore, corrupt draft, no-storage notice, navigation).`
- In `## Not verified` add:

```markdown
- Plan 2 on a real phone: layout, Web Share with files (iOS Safari / Android Chrome), camera/gallery
  picker for the Z photo, html-to-image output quality, dark mode, safe-area insets.
- A full closing entered in both V2 and Tameio4All at the till, compared line by line.
- Vercel deploy URL (set up by the owner; see README).
```

- [ ] **Step 3: Update `README.md`**

Replace the `## Develop` section with:

```markdown
## Develop
    npm install
    npm run dev        # http://localhost:5173 — on a phone use http://<your-Mac-LAN-IP>:5173 (same Wi-Fi)
    npm test           # unit + UI tests
    npm run typecheck
    npm run build      # typecheck + production build into dist/
Requires Node 22.12+ (or 24+).

## Deploy (Vercel, one-time setup)
1. vercel.com → Add New → Project → import the GitHub repo `DGc0des/Tameio4All`.
2. Framework preset: Vite (auto-detected). Build command `npm run build`, output `dist`.
3. No environment variables are needed yet (Supabase arrives in Plan 3; register
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel then).
4. Deploy. Every push to `main` redeploys.
```

- [ ] **Step 4: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md PROJECT_STATUS.md README.md
git commit -m "docs: Plan 2 architecture, DEV ONLY register, status, deploy steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Human step — deploy and test on a phone**

The owner imports the repo in Vercel (README steps), opens the URL on a phone and runs one real closing alongside V2. Record results in `PROJECT_STATUS.md` (move items out of "Not verified" only when actually checked).
