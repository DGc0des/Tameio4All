// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateEl } from '../../../../src/app/dates';
import { denomLabel } from '../../../../src/core/denominations';
import type { ClosingInputs } from '../../../../src/core/formula';
import { formatEuro } from '../../../../src/core/money';
import { joinJuicePreset } from '../../../../src/core/presets';
import { memoryStore } from '../../../../src/data/local/storage';
import type { Result } from '../../../../src/data/remote/ownerApi';
import { DayScreen } from '../../../../src/features/owner/history/DayScreen';
import { breakdown } from '../../../../src/features/owner/history/model';
import type { ClosingVersion, DayDetail } from '../../../../src/features/owner/history/types';
import { ownerErrorMessage } from '../../../../src/features/owner/model/messages';
import { ShopLayout } from '../../../../src/features/owner/ShopLayout';
import type { Snapshot } from '../../../../src/features/register/live/fields';
import { fail, fakeApi, ok } from '../fakeApi';

afterEach(cleanup);

const SHOP = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';
const DATE = '2026-11-09';
const STAFF = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NAMES = { [STAFF]: 'ΜΑΡΙΑ' };
const NOW = () => new Date(2026, 10, 11, 12);

const olderInputs: ClosingInputs = {
  schema: 2,
  counts: { '10000': 3 },
  channelCents: { wolt: 1000 },
  expenses: [{ id: 'x0', description: 'Ψωμί', cents: 300, addedBy: { kind: 'staff', id: STAFF } }],
};
const currentInputs: ClosingInputs = {
  schema: 2,
  counts: { '10000': 14, '5000': 3 },
  channelCents: { wolt: 4550, efood: 2000 },
  expenses: [
    { id: 'x1', description: 'Γάλα', cents: 850, addedBy: { kind: 'staff', id: STAFF } },
    { id: 'x2', description: 'Λεμόνια', cents: 1200, addedBy: { kind: 'owner' } },
  ],
};
const version = (id: string, over: Partial<ClosingVersion> = {}): ClosingVersion => ({
  id, kind: 'staff', authorName: 'ΜΑΡΙΑ', createdAt: '2026-11-09T19:42:00Z', configId: 'cfg1', inputs: currentInputs, correctsId: null, ...over,
});
const v1 = version('v1', { createdAt: '2026-11-09T17:05:00Z', authorName: 'ΓΙΑΝΝΗΣ', inputs: olderInputs });
const v2 = version('v2');
const day = (over: Partial<DayDetail> = {}): DayDetail => ({
  today: '2026-11-11', businessDate: DATE, versions: [v2, v1], configs: { cfg1: joinJuicePreset }, staffNames: NAMES, open: null, ...over,
});
const openSnap: Snapshot = {
  id: 'oc-1', businessDate: DATE, configId: 'cfg1', config: joinJuicePreset, revision: 2, lastSubmit: null,
  fields: { 'd:10000': { key: 'd:10000', value: { text: '2', mode: 'count' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-09T20:00:00Z' } },
};

function setup(d: DayDetail | Promise<Result<DayDetail>> = day(), navigate = vi.fn()) {
  const closingDay = vi.fn(() => (d instanceof Promise ? d : ok(d)));
  const api = fakeApi({ closingDay });
  render(<DayScreen api={api} shopId={SHOP} date={DATE} navigate={navigate} now={NOW} />);
  return { api, closingDay, navigate };
}
const region = (name: string) => screen.getByRole('region', { name });
const loaded = () => screen.findByText(/Υποβλήθηκε|Δεν υποβλήθηκε|Διορθώθηκε|Καταχωρήθηκε|Δεν διαβάζεται|Δεν υπάρχει κλείσιμο/);

describe('DayScreen', () => {
  it('loads the day, shows its date and goes back to the list', async () => {
    const { closingDay, navigate } = setup();
    expect(closingDay).toHaveBeenCalledWith(SHOP, DATE);
    expect(screen.getByText('Φόρτωση…')).toBeTruthy();
    await loaded();
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect(screen.getByRole('heading', { name: formatDateEl(DATE) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Ιστορικό' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: SHOP, tab: 'history' });
  });

  it('the current staff version reads «Υποβλήθηκε 21:42 · ΜΑΡΙΑ»', async () => {
    setup();
    expect(await screen.findByText('Υποβλήθηκε 21:42 · ΜΑΡΙΑ')).toBeTruthy();
  });

  it('shows the counted denominations, channels, expense lines with authors and every total', async () => {
    setup();
    await loaded();
    const b = breakdown(joinJuicePreset, currentInputs, NAMES)!;

    const counted = within(region('Καταμέτρηση'));
    expect(b.denominations.length).toBe(2);
    for (const d of b.denominations) {
      const row = counted.getByText(`${denomLabel(d.denom)} × ${d.count}`).parentElement!;
      expect(row.textContent).toContain(formatEuro(d.cents));
    }
    expect(counted.getByText('100€ × 14')).toBeTruthy();

    const channels = within(region('Κανάλια'));
    for (const c of b.channels) {
      expect(channels.getByText(c.label).parentElement!.textContent).toContain(formatEuro(c.cents));
    }
    expect(b.channels.map((c) => c.label)).toEqual(['WOLT', 'EFOOD']);

    const expenses = within(region('Έξοδα'));
    const milk = expenses.getByText('Γάλα').closest('li')!;
    expect(milk.textContent).toContain(formatEuro(850));
    expect(milk.textContent).toContain('ΜΑΡΙΑ');
    const lemons = expenses.getByText('Λεμόνια').closest('li')!;
    expect(lemons.textContent).toContain(formatEuro(1200));
    expect(lemons.textContent).toContain('Ιδιοκτήτης');

    const totals = within(region('Σύνολα'));
    expect(b.totals.length).toBe(joinJuicePreset.totals.length);
    for (const t of b.totals) {
      expect(totals.getByText(t.label).parentElement!.textContent).toContain(formatEuro(t.cents));
    }
  });

  it('«Φάκελος» opens the envelope sheet', async () => {
    setup();
    await loaded();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Φάκελος' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Τι μένει στο ταμείο')).toBeTruthy();
  });

  it('lists the versions newest first and lets the owner open an older one', async () => {
    setup();
    await loaded();
    const versions = region('2 υποβολές');
    const rows = within(versions).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['21:42ΜΑΡΙΑ', '19:05ΓΙΑΝΝΗΣ']);
    expect(screen.queryByText('Βλέπεις παλαιότερη έκδοση')).toBeNull();

    fireEvent.click(rows[1]!);
    expect(screen.getByText('Βλέπεις παλαιότερη έκδοση')).toBeTruthy();
    expect(screen.getByText('Υποβλήθηκε 19:05 · ΓΙΑΝΝΗΣ')).toBeTruthy();
    expect(within(region('Καταμέτρηση')).getByText('100€ × 3')).toBeTruthy();
    expect(within(region('Έξοδα')).getByText('Ψωμί')).toBeTruthy();
    expect(within(region('Έξοδα')).queryByText('Γάλα')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Διόρθωση' })).toBeNull();

    fireEvent.click(within(region('2 υποβολές')).getAllByRole('button')[0]!);
    expect(screen.queryByText('Βλέπεις παλαιότερη έκδοση')).toBeNull();
    expect(within(region('Καταμέτρηση')).getByText('100€ × 14')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Διόρθωση' })).toBeTruthy();
  });

  it('omits the versions list when there is a single version', async () => {
    setup(day({ versions: [v2] }));
    await loaded();
    expect(screen.queryByRole('region', { name: /υποβολές/ })).toBeNull();
  });

  it('an owner correction says who corrected it; one without a corrected version says it was entered', async () => {
    const stamp = '2026-11-09T12:32:00Z';
    const corrected = version('v3', { kind: 'owner_correction', authorName: 'Ιδιοκτήτης', createdAt: stamp, correctsId: 'v2' });
    setup(day({ versions: [corrected, v2, v1] }));
    expect(await screen.findByText('Διορθώθηκε από ιδιοκτήτη · Δευ 09/11 14:32')).toBeTruthy();
    cleanup();

    const entered = version('v3', { kind: 'owner_correction', authorName: 'Ιδιοκτήτης', createdAt: stamp, correctsId: null });
    setup(day({ versions: [entered] }));
    expect(await screen.findByText('Καταχωρήθηκε από ιδιοκτήτη · Δευ 09/11 14:32')).toBeTruthy();
  });

  it('an unreadable current version says «Δεν διαβάζεται», offers no «Διόρθωση», and older versions stay reachable', async () => {
    const broken = version('v3', { configId: 'missing' });
    setup(day({ versions: [broken, v2, v1] }));
    expect(await screen.findByText('Δεν διαβάζεται')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Διόρθωση' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Καταμέτρηση' })).toBeNull();
    const rows = within(region('3 υποβολές')).getAllByRole('button');
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[2]!);
    expect(screen.queryByText('Δεν διαβάζεται')).toBeNull();
    expect(within(region('Καταμέτρηση')).getByText('100€ × 3')).toBeTruthy();
  });

  it('an unreadable older version says «Δεν διαβάζεται» while the current one stays correctable', async () => {
    const brokenOld = version('v1', { inputs: { nope: true } });
    setup(day({ versions: [v2, brokenOld] }));
    await loaded();
    fireEvent.click(within(region('2 υποβολές')).getAllByRole('button')[1]!);
    expect(screen.getByText('Δεν διαβάζεται')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Διόρθωση' })).toBeNull();
    fireEvent.click(within(region('2 υποβολές')).getAllByRole('button')[0]!);
    expect(screen.getByRole('button', { name: 'Διόρθωση' })).toBeTruthy();
  });

  it('an unsubmitted day shows «Δεν υποβλήθηκε», the open closing numbers and «Αποθήκευση ως κλείσιμο»', async () => {
    setup(day({ versions: [], open: openSnap }));
    expect(await screen.findByText('Δεν υποβλήθηκε')).toBeTruthy();
    expect(within(region('Καταμέτρηση')).getByText('100€ × 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Αποθήκευση ως κλείσιμο' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Διόρθωση' })).toBeNull();
    expect(screen.queryByRole('region', { name: /υποβολές/ })).toBeNull();
  });

  it('an unsubmitted day whose open closing cannot be read says «Δεν διαβάζεται» and offers no save', async () => {
    setup(day({ versions: [], open: { ...openSnap, config: {} } }));
    expect(await screen.findByText('Δεν διαβάζεται')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Αποθήκευση ως κλείσιμο' })).toBeNull();
  });

  it('no closing and no open closing: says so and keeps the back link', async () => {
    const { navigate } = setup(day({ versions: [], open: null }));
    expect(await screen.findByText('Δεν υπάρχει κλείσιμο για αυτή τη μέρα.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Ιστορικό' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: SHOP, tab: 'history' });
  });

  it('a load error shows the message and «Ξανά», which refetches', async () => {
    const closingDay = vi.fn()
      .mockImplementationOnce(() => fail({ code: 'network' }))
      .mockImplementation(() => ok(day()));
    render(<DayScreen api={fakeApi({ closingDay })} shopId={SHOP} date={DATE} navigate={vi.fn()} now={NOW} />);
    expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'network' }));
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect(screen.getByRole('button', { name: '← Ιστορικό' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByText('Υποβλήθηκε 21:42 · ΜΑΡΙΑ')).toBeTruthy();
    expect(closingDay).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('«Διόρθωση» is offered for a readable current version, also when the day is today', async () => {
    setup(day({ today: DATE }));
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Διόρθωση' }));
    expect(screen.queryByRole('button', { name: 'Διόρθωση' })).toBeNull();
    expect(screen.getByTestId('day-editing').textContent).toBe('correct');
  });

  it('«Αποθήκευση ως κλείσιμο» switches to the editing placeholder', async () => {
    setup(day({ versions: [], open: openSnap }));
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση ως κλείσιμο' }));
    expect(screen.getByTestId('day-editing').textContent).toBe('file');
  });

  it('ignores a response that belongs to a request that was superseded', async () => {
    const pending: ((r: Result<DayDetail>) => void)[] = [];
    const closingDay = vi.fn(() => new Promise<Result<DayDetail>>((res) => pending.push(res)));
    const api = fakeApi({ closingDay });
    const { rerender } = render(<DayScreen api={api} shopId={SHOP} date="2026-11-08" navigate={vi.fn()} now={NOW} />);
    rerender(<DayScreen api={api} shopId={SHOP} date={DATE} navigate={vi.fn()} now={NOW} />);
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[1]!({ ok: true, data: day() });
    });
    await act(async () => {
      pending[0]!({ ok: true, data: day({ businessDate: '2026-11-08', versions: [version('old', { authorName: 'ΛΑΘΟΣ' })] }) });
    });
    expect(screen.getByText('Υποβλήθηκε 21:42 · ΜΑΡΙΑ')).toBeTruthy();
    expect(screen.queryByText(/ΛΑΘΟΣ/)).toBeNull();
  });
});

describe('ShopLayout day route', () => {
  it('renders the day screen (not the list) for tab=history with a date', async () => {
    const api = fakeApi({
      listShops: vi.fn(() => ok([{ id: SHOP, name: 'Μαγαζί' }])),
      closingDay: vi.fn(() => ok(day())),
    });
    render(
      <ShopLayout api={api} shopId={SHOP} tab="history" date={DATE} navigate={vi.fn()} store={memoryStore()} now={NOW}
        email="o@test.gr" onSignOut={vi.fn()} onExit={vi.fn()} />,
    );
    expect(await screen.findByText('Υποβλήθηκε 21:42 · ΜΑΡΙΑ')).toBeTruthy();
    await waitFor(() => expect(api.closingDay).toHaveBeenCalledWith(SHOP, DATE));
    expect(api.listClosings).not.toHaveBeenCalled();
  });
});
