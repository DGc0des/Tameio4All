// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDayEl } from '../../../../src/app/dates';
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
const list = (days: HistoryDay[], over: Partial<HistoryList> = {}): HistoryList => ({
  today: '2026-11-11', from: '2026-10-13', to: '2026-11-11', configs: { cfg1: joinJuicePreset, bad: {} }, days, ...over,
});
const openSnap = (businessDate: string): Snapshot => ({
  id: 'oc-1', businessDate, configId: 'cfg1', config: joinJuicePreset, revision: 2, lastSubmit: null,
  fields: { 'd:10000': { key: 'd:10000', value: { text: '200', mode: 'amount' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-09T20:00:00Z' } },
});
const row = (date: string) => screen.getByRole('button', { name: new RegExp(formatDayEl(date)) });
const expectedLines = (inp: unknown) => {
  const s = summarizeInputs(joinJuicePreset, inp)!;
  return [...s.totals.map((t) => [t.label, formatEuro(t.cents)] as const), ['Έξοδα', formatEuro(s.expensesCents)] as const];
};

function setup(l: HistoryList | Promise<Result<HistoryList>> = list([]), navigate = vi.fn()) {
  const listClosings = vi.fn(() => (l instanceof Promise ? l : ok(l)));
  const api = fakeApi({ listClosings });
  render(<HistoryScreen api={api} shopId={SHOP} navigate={navigate} />);
  return { api, listClosings, navigate };
}

describe('HistoryScreen', () => {
  it('loads the server default range, shows «Φόρτωση…», then the rows; the date inputs hold from/to', async () => {
    const { listClosings } = setup(list([submitted('2026-11-10', version('v1'))]));
    expect(listClosings).toHaveBeenCalledWith(SHOP, null, null);
    expect(screen.getByText('Φόρτωση…')).toBeTruthy();
    await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    expect((screen.getByLabelText('Από') as HTMLInputElement).value).toBe('2026-10-13');
    expect((screen.getByLabelText('Έως') as HTMLInputElement).value).toBe('2026-11-11');
    expect((screen.getByLabelText('Από') as HTMLInputElement).type).toBe('date');
  });

  it('shows a submitted row: day, author, summary totals and expenses', async () => {
    setup(list([submitted('2026-11-10', version('v1'))]));
    const r = await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    expect(within(r).getByText(formatDayEl('2026-11-10'))).toBeTruthy();
    expect(within(r).getByText(/ΜΑΡΙΑ/)).toBeTruthy();
    for (const [label, euro] of expectedLines(inputs(3))) {
      const line = within(r).getByText(label).parentElement!;
      expect(line.textContent).toContain(euro);
    }
    expect(within(r).getByText('Έξοδα').parentElement!.textContent).toContain(formatEuro(850));
    expect(within(r).queryByText('Δεν διαβάζεται')).toBeNull();
  });

  it('shows the version count only above one, and the badge only for an owner correction', async () => {
    setup(list([
      submitted('2026-11-10', version('v3', { kind: 'owner_correction', authorName: 'Ιδιοκτήτης' }), 3),
      submitted('2026-11-09', version('v1')),
    ]));
    const corrected = await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    expect(within(corrected).getByText(/3 υποβολές/)).toBeTruthy();
    expect(within(corrected).getByText('διορθωμένο')).toBeTruthy();
    expect(within(corrected).getByText(/Ιδιοκτήτης/)).toBeTruthy();
    const plain = row('2026-11-09');
    expect(within(plain).queryByText(/υποβολ/)).toBeNull();
    expect(within(plain).queryByText('διορθωμένο')).toBeNull();
  });

  it('shows an unsubmitted row with «Δεν υποβλήθηκε» and the numbers of the open closing', async () => {
    setup(list([{ status: 'unsubmitted', businessDate: '2026-11-09', open: openSnap('2026-11-09') }]));
    const r = await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-09')) });
    expect(within(r).getByText('Δεν υποβλήθηκε')).toBeTruthy();
    const withNothing = { schema: 2, counts: { '10000': 2 }, channelCents: {}, expenses: [] };
    for (const [label, euro] of expectedLines(withNothing)) {
      expect(within(r).getByText(label).parentElement!.textContent).toContain(euro);
    }
  });

  it('an unreadable row says «Δεν διαβάζεται» and does not hide its neighbours', async () => {
    setup(list([
      submitted('2026-11-11', version('v1')),
      submitted('2026-11-10', version('v2', { configId: 'bad' })),
      submitted('2026-11-09', version('v3', { configId: 'missing' })),
      submitted('2026-11-08', version('v4', { inputs: { nope: true } })),
      { status: 'unsubmitted', businessDate: '2026-11-07', open: { ...openSnap('2026-11-07'), config: {} } },
      submitted('2026-11-06', version('v5')),
    ]));
    await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-06')) });
    for (const d of ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07']) {
      expect(within(row(d)).getByText('Δεν διαβάζεται')).toBeTruthy();
    }
    for (const d of ['2026-11-11', '2026-11-06']) {
      expect(within(row(d)).queryByText('Δεν διαβάζεται')).toBeNull();
      expect(within(row(d)).getByText('Έξοδα').parentElement!.textContent).toContain(formatEuro(850));
    }
  });

  it('tapping a row (even an unreadable one) navigates to that day', async () => {
    const { navigate } = setup(list([submitted('2026-11-10', version('v1')), submitted('2026-11-09', version('v2', { configId: 'bad' }))]));
    await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    fireEvent.click(row('2026-11-10'));
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-10' });
    fireEvent.click(row('2026-11-09'));
    expect(navigate).toHaveBeenLastCalledWith({ name: 'shop', shopId: SHOP, tab: 'history', date: '2026-11-09' });
  });

  it('changing a date refetches with both current values; clearing one does not call the API', async () => {
    const { listClosings } = setup(list([]));
    await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.');
    fireEvent.change(screen.getByLabelText('Από'), { target: { value: '2026-10-01' } });
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, '2026-10-01', '2026-11-11');
    await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.');
    fireEvent.change(screen.getByLabelText('Έως'), { target: { value: '2026-11-05' } });
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, '2026-10-01', '2026-11-05');
    await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.');
    const calls = listClosings.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Από'), { target: { value: '' } });
    expect(listClosings.mock.calls.length).toBe(calls);
    expect((screen.getByLabelText('Από') as HTMLInputElement).value).toBe('');
  });

  it('shows an empty-range message for no days', async () => {
    setup(list([]));
    expect(await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.')).toBeTruthy();
  });

  it('bad_range shows its message in an alert and keeps the date inputs usable', async () => {
    const listClosings = vi.fn()
      .mockImplementationOnce(() => ok(list([])))
      .mockImplementationOnce(() => fail({ code: 'bad_range' }))
      .mockImplementation(() => ok(list([submitted('2026-11-10', version('v1'))])));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.');
    fireEvent.change(screen.getByLabelText('Έως'), { target: { value: '2026-01-01' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ownerErrorMessage({ code: 'bad_range' }));
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    const from = screen.getByLabelText('Από') as HTMLInputElement;
    expect(from.disabled).toBe(false);
    expect((screen.getByLabelText('Έως') as HTMLInputElement).value).toBe('2026-01-01');
    fireEvent.change(from, { target: { value: '2025-12-01' } });
    await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a network failure shows the message and «Ξανά», which refetches', async () => {
    const listClosings = vi.fn()
      .mockImplementationOnce(() => fail({ code: 'network' }))
      .mockImplementation(() => ok(list([submitted('2026-11-10', version('v1'))])));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'network' }));
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    expect(listClosings).toHaveBeenCalledTimes(2);
    expect(listClosings).toHaveBeenLastCalledWith(SHOP, null, null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a response that arrives after a newer request was made', async () => {
    const pending: ((r: Result<HistoryList>) => void)[] = [];
    const listClosings = vi.fn(() => new Promise<Result<HistoryList>>((res) => pending.push(res)));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending[0]!({ ok: true, data: list([submitted('2026-11-10', version('v1'))]) });
    });
    await screen.findByRole('button', { name: new RegExp(formatDayEl('2026-11-10')) });
    fireEvent.change(screen.getByLabelText('Από'), { target: { value: '2026-10-01' } }); // request 2
    fireEvent.change(screen.getByLabelText('Από'), { target: { value: '2026-10-05' } }); // request 3
    expect(pending).toHaveLength(3);
    await act(async () => {
      pending[2]!({ ok: true, data: list([submitted('2026-11-08', version('v8'))], { from: '2026-10-05' }) });
    });
    await act(async () => {
      pending[1]!({ ok: true, data: list([submitted('2026-11-02', version('v2'))], { from: '2026-10-01' }) });
    });
    expect(screen.getByRole('button', { name: new RegExp(formatDayEl('2026-11-08')) })).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(formatDayEl('2026-11-02')) })).toBeNull();
    expect(screen.queryByText('Φόρτωση…')).toBeNull();
  });

  it('a superseded failure does not replace the newer rows', async () => {
    const pending: ((r: Result<HistoryList>) => void)[] = [];
    const listClosings = vi.fn(() => new Promise<Result<HistoryList>>((res) => pending.push(res)));
    render(<HistoryScreen api={fakeApi({ listClosings })} shopId={SHOP} navigate={vi.fn()} />);
    await act(async () => {
      pending[0]!({ ok: true, data: list([]) });
    });
    await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.');
    fireEvent.change(screen.getByLabelText('Από'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Από'), { target: { value: '2026-10-05' } });
    await act(async () => {
      pending[2]!({ ok: true, data: list([submitted('2026-11-08', version('v8'))]) });
    });
    await act(async () => {
      pending[1]!({ ok: false, error: { code: 'network' } });
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(formatDayEl('2026-11-08')) })).toBeTruthy();
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
    await screen.findByText('Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.');
  });
});
