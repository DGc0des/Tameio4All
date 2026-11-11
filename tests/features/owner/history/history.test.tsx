// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerRoute } from '../../../../src/app/router';
import { addDaysIso, formatDayMonthLongEl, formatTimeEl, formatWeekdayEl } from '../../../../src/app/dates';
import { joinJuicePreset } from '../../../../src/core/presets';
import { formatEuro } from '../../../../src/core/money';
import type { ClosingInputs } from '../../../../src/core/formula';
import { memoryStore } from '../../../../src/data/local/storage';
import type { Result } from '../../../../src/data/remote/ownerApi';
import { HistoryScreen } from '../../../../src/features/owner/history/HistoryScreen';
import { summarizeInputs } from '../../../../src/features/owner/history/model';
import type { ClosingVersion, HistoryDay, HistoryList } from '../../../../src/features/owner/history/types';
import { ownerErrorMessage } from '../../../../src/features/owner/model/messages';
import { ShopLayout } from '../../../../src/features/owner/ShopLayout';
import type { Snapshot } from '../../../../src/features/register/live/fields';
import { fail, fakeApi, ok } from '../fakeApi';

afterEach(cleanup);

const SHOP = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';
const inputs = (hundreds: number): ClosingInputs => ({
  schema: 2,
  counts: { '10000': hundreds },
  channelCents: { wolt: 4550 },
  expenses: [{ id: 'x1', description: 'Γάλα', cents: 850, addedBy: { kind: 'owner' } }],
});
const version = (id: string, over: Partial<ClosingVersion> = {}): ClosingVersion => ({
  id, kind: 'staff', authorName: 'ΜΑΡΙΑ', createdAt: '2026-11-10T21:00:00Z', configId: 'cfg1', inputs: inputs(3), correctsId: null, ...over,
});
const submitted = (businessDate: string, current: ClosingVersion, versionCount = 1): HistoryDay => ({ status: 'submitted', businessDate, current, versionCount });
/** Wednesday 2026-11-11 is «today»; the current week is Monday 2026-11-09 – Sunday 2026-11-15. */
const TODAY = '2026-11-11';
const MON = '2026-11-09';
const SUN = '2026-11-15';
const list = (days: HistoryDay[], over: Partial<HistoryList> = {}): HistoryList => ({
  today: TODAY, from: MON, to: SUN, configs: { cfg1: joinJuicePreset, bad: {} }, days, ...over,
});
const openSnap = (businessDate: string): Snapshot => ({
  id: 'oc-1', businessDate, configId: 'cfg1', config: joinJuicePreset, revision: 2, lastSubmit: null,
  fields: { 'd:10000': { key: 'd:10000', value: { text: '200', mode: 'amount' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-09T20:00:00Z' } },
});
const cardName = (date: string) => new RegExp(`${formatWeekdayEl(date)}.*${formatDayMonthLongEl(date)}`);
const card = (date: string) => screen.getByRole('button', { name: cardName(date) });
/** Every card of the grid (buttons and inert ones), in document order. */
const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.week-card'));
const inertCard = (date: string) => screen.getByText(formatDayMonthLongEl(date)).closest<HTMLElement>('.week-card')!;
const RANGE = '9 – 15 Νοεμβρίου 2026';
const expectedLines = (inp: unknown) => {
  const s = summarizeInputs(joinJuicePreset, inp)!;
  return [...s.totals.map((t) => [t.label, formatEuro(t.cents)] as const), ['Έξοδα', formatEuro(s.expensesCents)] as const];
};

/** The server's answer for whatever week is asked for (null/null: the default range). */
const echo = (days: HistoryDay[]) => (_s: string, f: string | null, t: string | null) => ok(list(days, { from: f ?? '2026-10-13', to: t ?? TODAY }));

function setup(l: HistoryList | Promise<Result<HistoryList>> = list([]), navigate = vi.fn()) {
  const listClosings = vi.fn(() => (l instanceof Promise ? l : ok(l)));
  const api = fakeApi({ listClosings });
  render(<HistoryScreen api={api} shopId={SHOP} navigate={navigate} />);
  return { api, listClosings, navigate };
}

const pendingApi = () => {
  const pending: ((r: Result<HistoryList>) => void)[] = [];
  const listClosings = vi.fn((_s: string, _f: string | null, _t: string | null) => new Promise<Result<HistoryList>>((res) => pending.push(res)));
  return { pending, listClosings, api: fakeApi({ listClosings }) };
};

describe('HistoryScreen week view', () => {
  it('first load asks the server default, shows «Φόρτωση…», then the week of today with seven cards, Monday first', async () => {
    const { listClosings } = setup(list([submitted('2026-11-10', version('v1'))]));
    expect(listClosings).toHaveBeenCalledWith(SHOP, null, null);
    expect(screen.getByText('Φόρτωση…')).toBeTruthy();
    await screen.findByText(RANGE);
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect(cards()).toHaveLength(7);
    expect(cards().map((c) => c.querySelector('b')!.textContent)).toEqual(['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']);
    expect(screen.queryByLabelText('Από')).toBeNull();
    expect(screen.queryByLabelText('Έως')).toBeNull();
  });

  it('«←» fetches the previous Monday–Sunday; «→» comes back and is disabled again on the current week', async () => {
    const listClosings = vi.fn(echo([]));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText(RANGE);
    const next = screen.getByRole('button', { name: 'Επόμενη εβδομάδα' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, '2026-11-02', '2026-11-08');
    await screen.findByText('2 – 8 Νοεμβρίου 2026');
    expect(cards()).toHaveLength(7);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, MON, SUN);
    await screen.findByText(RANGE);
    expect(next.disabled).toBe(true);
  });

  it('a week across months shows both months', async () => {
    const listClosings = vi.fn(echo([]));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText(RANGE);
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
      await waitFor(() => expect(screen.queryByText('Φόρτωση…')).toBeNull());
    }
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, '2026-10-26', '2026-11-01');
    expect(screen.getByText('26 Οκτωβρίου – 1 Νοεμβρίου 2026')).toBeTruthy();
  });

  it('«Αυτή η εβδομάδα» is disabled on the current week and returns to it from another', async () => {
    const listClosings = vi.fn(echo([]));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText(RANGE);
    const here = screen.getByRole('button', { name: 'Αυτή η εβδομάδα' }) as HTMLButtonElement;
    expect(here.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await screen.findByText('2 – 8 Νοεμβρίου 2026');
    expect(here.disabled).toBe(false);
    fireEvent.click(here);
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, MON, SUN);
    await screen.findByText(RANGE);
    expect(here.disabled).toBe(true);
  });

  it('«Χθες» opens yesterday of the server date on the day screen', async () => {
    const { navigate } = setup(list([]));
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Χθες' }));
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-10' });
  });

  it('«Χθες» crosses a month boundary by arithmetic on the server date', async () => {
    const { navigate } = setup(list([], { today: '2026-12-01' }));
    await screen.findByText('30 Νοεμβρίου – 6 Δεκεμβρίου 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Χθες' }));
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-30' });
  });

  it('shows a submitted card: weekday, date, summary totals, expenses, author and time', async () => {
    setup(list([submitted('2026-11-10', version('v1'))]));
    await screen.findByText(RANGE);
    const r = card('2026-11-10');
    expect(within(r).getByText('Τρίτη')).toBeTruthy();
    expect(within(r).getByText('10 Νοεμβρίου')).toBeTruthy();
    for (const [label, euro] of expectedLines(inputs(3))) {
      expect(within(r).getByText(label).parentElement!.textContent).toContain(euro);
    }
    expect(within(r).getByText('Έξοδα').parentElement!.textContent).toContain(formatEuro(850));
    expect(within(r).getByText(`ΜΑΡΙΑ · ${formatTimeEl('2026-11-10T21:00:00Z')}`)).toBeTruthy();
    expect(within(r).queryByText('Δεν διαβάζεται')).toBeNull();
    expect(within(r).queryByText('Σήμερα')).toBeNull();
  });

  it('shows «διορθωμένο» for an owner correction, «N υποβολές» for several staff versions, neither for a single one', async () => {
    setup(list([
      submitted('2026-11-10', version('v3', { kind: 'owner_correction', authorName: 'Ιδιοκτήτης' }), 3),
      submitted('2026-11-09', version('v2'), 2),
      submitted('2026-11-08', version('v1')),
    ], { from: '2026-11-02', to: '2026-11-08' }));
    await screen.findByText(RANGE);
    const corrected = card('2026-11-10');
    expect(within(corrected).getByText('διορθωμένο')).toBeTruthy();
    expect(within(corrected).getByText(/Ιδιοκτήτης ·/)).toBeTruthy();
    expect(within(corrected).queryByText(/υποβολές/)).toBeNull();
    const several = card('2026-11-09');
    expect(within(several).getByText('2 υποβολές')).toBeTruthy();
    expect(within(several).queryByText('διορθωμένο')).toBeNull();
  });

  it('today with a submission is a normal submitted card with a «Σήμερα» tag', async () => {
    const { navigate } = setup(list([submitted(TODAY, version('v1'))]));
    await screen.findByText(RANGE);
    const r = card(TODAY);
    expect(within(r).getByText('Σήμερα')).toBeTruthy();
    expect(within(r).getByText('Έξοδα').parentElement!.textContent).toContain(formatEuro(850));
    expect(within(r).queryByText('Σε εξέλιξη')).toBeNull();
    fireEvent.click(r);
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: TODAY });
  });

  it('shows an unsubmitted day with «Δεν υποβλήθηκε» and the numbers of the open closing', async () => {
    setup(list([{ status: 'unsubmitted', businessDate: '2026-11-10', open: openSnap('2026-11-10') }]));
    await screen.findByText(RANGE);
    const r = card('2026-11-10');
    expect(within(r).getByText('Δεν υποβλήθηκε')).toBeTruthy();
    expect(r.className).toContain('is-unsubmitted');
    const withNothing = { schema: 2, counts: { '10000': 2 }, channelCents: {}, expenses: [] };
    for (const [label, euro] of expectedLines(withNothing)) {
      expect(within(r).getByText(label).parentElement!.textContent).toContain(euro);
    }
  });

  it('today without a submission says «Σε εξέλιξη» and opens the «Σήμερα» tab', async () => {
    const { navigate } = setup(list([]));
    await screen.findByText(RANGE);
    const r = card(TODAY);
    expect(within(r).getByText('Σε εξέλιξη')).toBeTruthy();
    fireEvent.click(r);
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'today' });
  });

  it('a past day with nothing is a faded «—» that still opens its day screen', async () => {
    const { navigate } = setup(list([]));
    await screen.findByText(RANGE);
    const r = card('2026-11-09');
    expect(within(r).getByText('—')).toBeTruthy();
    expect(r.className).toContain('is-faded');
    fireEvent.click(r);
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-09' });
  });

  it('future days are faded «—» and cannot be tapped', async () => {
    const { navigate } = setup(list([]));
    await screen.findByText(RANGE);
    for (const d of ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) {
      expect(screen.queryByRole('button', { name: cardName(d) })).toBeNull();
      const c = inertCard(d);
      expect(within(c).getByText(formatWeekdayEl(d))).toBeTruthy();
      expect(within(c).getByText('—')).toBeTruthy();
      expect(c.className).toContain('is-faded');
      expect(c.tagName).not.toBe('BUTTON');
      fireEvent.click(c);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('an unreadable card says «Δεν διαβάζεται» and does not hide its neighbours', async () => {
    setup(list([
      submitted('2026-11-11', version('v1')),
      submitted('2026-11-10', version('v2', { configId: 'bad' })),
      submitted('2026-11-09', version('v3', { configId: 'missing' })),
    ]));
    await screen.findByText(RANGE);
    expect(within(card('2026-11-10')).getByText('Δεν διαβάζεται')).toBeTruthy();
    expect(within(card('2026-11-09')).getByText('Δεν διαβάζεται')).toBeTruthy();
    expect(within(card('2026-11-10')).getByText(/ΜΑΡΙΑ ·/)).toBeTruthy(); // the footer survives
    expect(within(card('2026-11-11')).queryByText('Δεν διαβάζεται')).toBeNull();
    expect(within(card('2026-11-11')).getByText('Έξοδα').parentElement!.textContent).toContain(formatEuro(850));
  });

  it('unreadable inputs and an unreadable unsubmitted day in another week leave its readable card alone', async () => {
    const listClosings = vi.fn((_s: string, f: string | null, t: string | null) => ok(list(f === null ? [] : [
      submitted('2026-11-08', version('v4', { inputs: { nope: true } })),
      { status: 'unsubmitted', businessDate: '2026-11-07', open: { ...openSnap('2026-11-07'), config: {} } },
      submitted('2026-11-06', version('v5')),
    ], { from: f ?? MON, to: t ?? SUN })));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await screen.findByText('2 – 8 Νοεμβρίου 2026');
    expect(within(card('2026-11-08')).getByText('Δεν διαβάζεται')).toBeTruthy();
    expect(within(card('2026-11-07')).getByText('Δεν διαβάζεται')).toBeTruthy();
    expect(within(card('2026-11-07')).getByText('Δεν υποβλήθηκε')).toBeTruthy();
    expect(within(card('2026-11-06')).queryByText('Δεν διαβάζεται')).toBeNull();
    expect(within(card('2026-11-06')).getByText('Έξοδα').parentElement!.textContent).toContain(formatEuro(850));
  });

  it('a config id that names an Object.prototype member is unreadable, not looked up on the prototype', async () => {
    setup(list([submitted('2026-11-10', version('v1', { configId: 'constructor' })), submitted('2026-11-09', version('v2', { configId: 'toString' }))]));
    await screen.findByText(RANGE);
    expect(within(card('2026-11-10')).getByText('Δεν διαβάζεται')).toBeTruthy();
    expect(within(card('2026-11-09')).getByText('Δεν διαβάζεται')).toBeTruthy();
  });

  it('tapping a submitted card (even an unreadable one) opens that day', async () => {
    const { navigate } = setup(list([submitted('2026-11-10', version('v1')), submitted('2026-11-09', version('v2', { configId: 'bad' }))]));
    await screen.findByText(RANGE);
    fireEvent.click(card('2026-11-10'));
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-10' });
    fireEvent.click(card('2026-11-09'));
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-09' });
  });

  it('a past week has seven tappable cards and no «Σε εξέλιξη»', async () => {
    const listClosings = vi.fn(echo([]));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await screen.findByText('2 – 8 Νοεμβρίου 2026');
    expect(screen.queryByText('Σε εξέλιξη')).toBeNull();
    for (let i = 0; i < 7; i += 1) expect(card(addDaysIso('2026-11-02', i))).toBeTruthy();
  });
});

describe('HistoryScreen errors and ordering', () => {
  it('a network failure shows the message and «Ξανά», which repeats the first request', async () => {
    const listClosings = vi.fn()
      .mockImplementationOnce(() => fail({ code: 'network' }))
      .mockImplementation(() => ok(list([submitted('2026-11-10', version('v1'))])));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'network' }));
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect(cards()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    await screen.findByText(RANGE);
    expect(listClosings).toHaveBeenCalledTimes(2);
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, null, null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed week change keeps the week navigation and «Ξανά» repeats that week', async () => {
    const listClosings = vi.fn()
      .mockImplementationOnce(() => ok(list([])))
      .mockImplementationOnce(() => fail({ code: 'network' }))
      .mockImplementation(() => ok(list([submitted('2026-11-03', version('v1'))], { from: '2026-11-02', to: '2026-11-08' })));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'network' }));
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect(screen.getByText('2 – 8 Νοεμβρίου 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, '2026-11-02', '2026-11-08');
    await screen.findByRole('button', { name: cardName('2026-11-03') });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('bad_range shows its message and no «Ξανά»', async () => {
    const listClosings = vi.fn(() => fail<HistoryList>({ code: 'bad_range' }));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'bad_range' }));
    expect(screen.queryByRole('button', { name: 'Ξανά' })).toBeNull();
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
  });

  it('ignores a response that arrives after a newer request was made', async () => {
    const { pending, api } = pendingApi();
    render(<HistoryScreen api={api} shopId={SHOP} navigate={vi.fn()} />);
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending[0]!({ ok: true, data: list([]) });
    });
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' })); // request 2: 2 – 8 Nov
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' })); // request 3: 26 Oct – 1 Nov
    expect(pending).toHaveLength(3);
    await act(async () => {
      pending[2]!({ ok: true, data: list([submitted('2026-10-28', version('v8'))], { from: '2026-10-26', to: '2026-11-01' }) });
    });
    await act(async () => {
      pending[1]!({ ok: true, data: list([submitted('2026-11-03', version('v2'))], { from: '2026-11-02', to: '2026-11-08' }) });
    });
    expect(screen.getByText('26 Οκτωβρίου – 1 Νοεμβρίου 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: cardName('2026-10-28') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: cardName('2026-11-03') })).toBeNull();
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
  });

  it('keeps the previous week\'s cards, dimmed, while the next week loads, then replaces them; the first load shows only «Φόρτωση…»', async () => {
    const { pending, api } = pendingApi();
    render(<HistoryScreen api={api} shopId={SHOP} navigate={vi.fn()} />);
    expect(screen.getByText('Φόρτωση…')).toBeTruthy();
    expect(cards()).toHaveLength(0);
    await act(async () => {
      pending[0]!({ ok: true, data: list([submitted('2026-11-10', version('v1'))]) });
    });
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    expect(screen.getByText('Φόρτωση…')).toBeTruthy();
    expect(screen.getByText('2 – 8 Νοεμβρίου 2026')).toBeTruthy();
    expect(cards()).toHaveLength(7);
    expect(screen.getByRole('button', { name: cardName('2026-11-10') })).toBeTruthy();
    expect(document.querySelector('.week-grid')!.className).toContain('is-loading');
    await act(async () => {
      pending[1]!({ ok: true, data: list([submitted('2026-11-03', version('v2'))], { from: '2026-11-02', to: '2026-11-08' }) });
    });
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect(cards()).toHaveLength(7);
    expect(screen.getByRole('button', { name: cardName('2026-11-03') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: cardName('2026-11-10') })).toBeNull();
    expect(document.querySelector('.week-grid')!.className).not.toContain('is-loading');
  });

  it('a failed week change replaces the previous cards with the error', async () => {
    const { pending, api } = pendingApi();
    render(<HistoryScreen api={api} shopId={SHOP} navigate={vi.fn()} />);
    await act(async () => {
      pending[0]!({ ok: true, data: list([]) });
    });
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await act(async () => {
      pending[1]!({ ok: false, error: { code: 'network' } });
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(cards()).toHaveLength(0);
  });

  it('a superseded failure does not replace the newer cards', async () => {
    const { pending, api } = pendingApi();
    render(<HistoryScreen api={api} shopId={SHOP} navigate={vi.fn()} />);
    await act(async () => {
      pending[0]!({ ok: true, data: list([]) });
    });
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await act(async () => {
      pending[2]!({ ok: true, data: list([submitted('2026-10-28', version('v8'))], { from: '2026-10-26', to: '2026-11-01' }) });
    });
    await act(async () => {
      pending[1]!({ ok: false, error: { code: 'network' } });
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: cardName('2026-10-28') })).toBeTruthy();
  });
});

describe('HistoryScreen remembered week', () => {
  it('opens the week whose Monday is the initial range and fetches (from, to)', async () => {
    const listClosings = vi.fn(echo([]));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} initialRange={{ from: '2026-11-02', to: '2026-11-08' }} onRangeLoaded={vi.fn()} />);
    expect(listClosings).toHaveBeenCalledWith(SHOP, '2026-11-02', '2026-11-08');
    expect(listClosings).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 – 8 Νοεμβρίου 2026')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Φόρτωση…')).toBeNull());
    expect(cards()).toHaveLength(7);
    expect((screen.getByRole('button', { name: 'Επόμενη εβδομάδα' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports (Monday, Sunday) of the shown week only after a successful load', async () => {
    const onRangeLoaded = vi.fn();
    const { pending, api } = pendingApi();
    render(<HistoryScreen api={api} shopId={SHOP} navigate={vi.fn()} onRangeLoaded={onRangeLoaded} />);
    expect(onRangeLoaded).not.toHaveBeenCalled();
    await act(async () => {
      pending[0]!({ ok: true, data: list([]) });
    });
    expect(onRangeLoaded).toHaveBeenLastCalledWith(MON, SUN);
    onRangeLoaded.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    expect(onRangeLoaded).not.toHaveBeenCalled();
    await act(async () => {
      pending[1]!({ ok: false, error: { code: 'network' } });
    });
    expect(onRangeLoaded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    await act(async () => {
      pending[2]!({ ok: true, data: list([], { from: '2026-11-02', to: '2026-11-08' }) });
    });
    expect(onRangeLoaded).toHaveBeenLastCalledWith('2026-11-02', '2026-11-08');
  });
});

describe('ShopLayout history week', () => {
  const OTHER = '9b8a7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
  const days = [submitted('2026-11-10', version('v1')), submitted('2026-11-03', version('v0'))];

  const store = memoryStore();
  function Harness({ api }: { api: ReturnType<typeof fakeApi> }) {
    const [route, setRoute] = useState<OwnerRoute>({ name: 'shop', shopId: SHOP, tab: 'history' });
    if (route.name !== 'shop') return null;
    return (
      <>
        <button type="button" onClick={() => setRoute({ name: 'shop', shopId: OTHER, tab: 'history' })}>test: other shop</button>
        <ShopLayout api={api} shopId={route.shopId} tab={route.tab} date={route.date} navigate={setRoute} store={store}
          now={() => new Date(2026, 10, 11, 12)} email="o@test.gr" onSignOut={vi.fn()} onExit={vi.fn()} />
      </>
    );
  }
  const harnessApi = () =>
    fakeApi({
      listShops: vi.fn(() => ok([{ id: SHOP, name: 'Μαγαζί' }, { id: OTHER, name: 'Άλλο' }])),
      listClosings: vi.fn(echo(days)),
    });

  it('keeps the shown week across week → day → «← Ιστορικό»', async () => {
    const api = harnessApi();
    render(<Harness api={api} />);
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await screen.findByText('2 – 8 Νοεμβρίου 2026');
    await waitFor(() => expect(screen.queryByText('Φόρτωση…')).toBeNull());
    fireEvent.click(card('2026-11-03'));
    fireEvent.click(await screen.findByRole('button', { name: '← Ιστορικό' }));
    await screen.findByRole('button', { name: cardName('2026-11-03') });
    expect(api.listClosings).toHaveBeenLastCalledWith(SHOP, '2026-11-02', '2026-11-08');
    expect(screen.getByText('2 – 8 Νοεμβρίου 2026')).toBeTruthy();
  });

  it("a different shop's history starts with the server default, not the first shop's week", async () => {
    const api = harnessApi();
    render(<Harness api={api} />);
    await screen.findByText(RANGE);
    fireEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await screen.findByText('2 – 8 Νοεμβρίου 2026');
    await waitFor(() => expect(screen.queryByText('Φόρτωση…')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'test: other shop' }));
    await waitFor(() => expect(api.listClosings).toHaveBeenCalledWith(OTHER, null, null));
    await screen.findByText(RANGE);
    expect(api.listClosings).not.toHaveBeenCalledWith(OTHER, '2026-11-02', expect.anything());
  });
});

describe('ShopLayout history tab', () => {
  it('lists «Ιστορικό» second, marked current on the history tab', async () => {
    const api = fakeApi({ listShops: vi.fn(() => ok([{ id: SHOP, name: 'Μαγαζί' }])) });
    render(
      <ShopLayout api={api} shopId={SHOP} tab="history" navigate={vi.fn()} store={memoryStore()} now={() => new Date(2026, 10, 11, 12)}
        email="o@test.gr" onSignOut={vi.fn()} onExit={vi.fn()} />,
    );
    const nav = await screen.findByRole('navigation', { name: 'Ενότητες καταστήματος' });
    const tabs = within(nav).getAllByRole('button');
    expect(tabs.map((t) => t.textContent)).toEqual(['Σήμερα', 'Ιστορικό', 'Ρυθμίσεις', 'Προσωπικό', 'Συσκευές']);
    expect(tabs[1]!.getAttribute('aria-current')).toBe('page');
    expect(tabs.filter((t) => t.getAttribute('aria-current') === 'page')).toHaveLength(1);
    await waitFor(() => expect(api.listClosings).toHaveBeenCalledWith(SHOP, null, null));
    await screen.findByText(RANGE);
  });
});
