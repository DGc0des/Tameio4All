// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
import { formatEuro } from '../../../src/core/money';
import { deriveClosing } from '../../../src/features/register/derive';
import { draftFromFields } from '../../../src/features/register/live/merge';
import { WRONG_DAY_NOTICE } from '../../../src/features/register/live/syncEngine';
import { CHANGED_SINCE_SUBMIT } from '../../../src/features/register/messages';
import { loadEntryMode } from '../../../src/data/local/openClosing';
import { memoryStore } from '../../../src/data/local/storage';
import type { LiveHandlers } from '../../../src/data/remote/live';
import type { Snapshot } from '../../../src/features/register/live/fields';
import { ownerErrorMessage } from '../../../src/features/owner/model/messages';
import { ShopLayout } from '../../../src/features/owner/ShopLayout';
import { TodayScreen } from '../../../src/features/owner/TodayScreen';
import { fakeLive, type FakeLive } from '../phone/fakeDeviceApi';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);

const SHOP = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  id: 'oc-1', businessDate: '2026-11-07', configId: 'c1', config: joinJuicePreset, revision: 0, lastSubmit: null, fields: {}, ...over,
});

function setup(over: Parameters<typeof fakeApi>[0] = {}) {
  const channels: FakeLive[] = [];
  const api = fakeApi({
    todayClosing: vi.fn(() => ok(snap())),
    live: vi.fn((_s: string, _m: { name: string }, h: LiveHandlers) => {
      const l = fakeLive(h);
      channels.push(l);
      return l;
    }),
    ...over,
  });
  const store = memoryStore();
  const view = render(<TodayScreen api={api} shopId={SHOP} store={store} now={() => new Date(2026, 10, 7, 22, 0)} newId={() => 'id-1'} />);
  return { api, store, channels, ...view };
}
/** Waits for the closing to render. */
const loaded = () => screen.findByLabelText('100€');
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

const type = (value: string) => {
  fireEvent.focus(box('100€'));
  fireEvent.change(box('100€'), { target: { value } });
  fireEvent.blur(box('100€'));
};
const FIELD = { key: 'd:10000', value: { text: '300', mode: 'amount' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T20:00:00Z', revision: 1, businessDate: '2026-11-07' };

describe('TodayScreen', () => {
  it('shows an empty closing with the not-submitted line and no submit button', async () => {
    setup();
    expect((await loaded() as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Δεν έχει υποβληθεί ακόμα')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Υποβολή' })).toBeNull();
  });

  it('shows who submitted and when', async () => {
    setup({ todayClosing: vi.fn(() => ok(snap({ lastSubmit: { closingId: 'x', staffName: 'ΜΑΡΙΑ', at: '2026-11-07T20:30:00Z' } }))) });
    expect(await screen.findByText(/^Υποβλήθηκε \d\d:\d\d · ΜΑΡΙΑ$/)).toBeTruthy();
  });

  it('an owner edit on a live channel calls setTodayField with a null base version', async () => {
    const { api, channels } = setup();
    await loaded();
    act(() => channels[0]!.emitStatus('live'));
    // The live status triggers a resync; wait for it to be asked and answered.
    await waitFor(() => expect(api.todayClosing).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    type('500');
    await waitFor(() => expect(api.setTodayField).toHaveBeenCalledWith(SHOP, '2026-11-07', 'd:10000', { text: '500', mode: 'amount' }, null));
  });

  it('an edit while connecting is held back, then sent with base version 0 once live', async () => {
    const { api, channels } = setup();
    await loaded();
    type('500');
    expect(api.setTodayField).not.toHaveBeenCalled();
    act(() => channels[0]!.emitStatus('live'));
    await waitFor(() => expect(api.setTodayField).toHaveBeenCalledWith(SHOP, '2026-11-07', 'd:10000', { text: '500', mode: 'amount' }, 0));
  });

  it('a broadcast updates the view', async () => {
    const { channels } = setup();
    await loaded();
    act(() => channels[0]!.emitField(FIELD));
    await waitFor(() => expect(box('100€').value).toBe('300'));
  });

  it('joins as «Ιδιοκτήτης» and closes its channel on unmount', async () => {
    const { api, channels, unmount } = setup();
    await loaded();
    expect(api.live).toHaveBeenCalledWith(SHOP, { name: 'Ιδιοκτήτης' }, expect.anything());
    unmount();
    expect(channels[0]!.close).toHaveBeenCalled();
  });

  it('remembers the entry mode per shop on this device', async () => {
    const { store } = setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '# Κομμάτια' }));
    expect(loadEntryMode(store, SHOP)).toBe('count');
  });

  it('M1: an owner write refused as wrong_day is dropped with the day-change notice and resyncs', async () => {
    const { api, channels } = setup({ setTodayField: vi.fn(() => fail<{ version: number; revision: number }>({ code: 'wrong_day' })) });
    await loaded();
    act(() => channels[0]!.emitStatus('live'));
    await waitFor(() => expect(api.todayClosing).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    type('500');
    await waitFor(() => expect(api.setTodayField).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(WRONG_DAY_NOTICE));
    await waitFor(() => expect(api.todayClosing).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(box('100€').value).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull(); // not fatal
  });

  it('M5: the owner can open the Φάκελος breakdown, computed by planEnvelope like the register', async () => {
    const fields = { 'd:10000': { key: 'd:10000', value: { text: '1500', mode: 'amount' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '' } };
    const s = snap({ fields });
    setup({ todayClosing: vi.fn(() => ok(s)) });
    await loaded();
    const expected = deriveClosing(joinJuicePreset, draftFromFields(s, [])).envelope;
    expect(expected.targetCents).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Φάκελος' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(formatEuro(expected.targetCents));
    expect(dialog.textContent).toContain(`× ${expected.put['10000']}`);
    expect(screen.queryByRole('button', { name: 'Υποβολή' })).toBeNull();
  });

  it('the owner fills ΚΕΡΜΑΤΑ from the calculator', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Άθροισμα για ΚΕΡΜΑΤΑ' }));
    fireEvent.change(box('Ποσό 1'), { target: { value: '100' } });
    fireEvent.change(box('Ποσό 2'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Καταχώρηση' }));
    expect(box('ΚΕΡΜΑΤΑ').value).toBe('150');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('«Άλλαξε μετά την υποβολή»', () => {
    const submitted = (revision: number, submittedAt: number | undefined) =>
      snap({ revision, lastSubmit: { closingId: 'v2', staffName: 'ΜΑΡΙΑ', at: '2026-11-07T20:30:00Z', ...(submittedAt === undefined ? {} : { revision: submittedAt }) } });
    const goLive = async (channels: FakeLive[], api: ReturnType<typeof setup>['api']) => {
      act(() => channels[0]!.emitStatus('live'));
      await waitFor(() => expect(api.todayClosing).toHaveBeenCalledTimes(2));
      await act(async () => { await Promise.resolve(); });
    };

    it('is not shown when nothing changed since the submit, or for an old submit without a revision', async () => {
      setup({ todayClosing: vi.fn(() => ok(submitted(3, 3))) });
      await loaded();
      expect(screen.queryByText(CHANGED_SINCE_SUBMIT)).toBeNull();
      cleanup();
      setup({ todayClosing: vi.fn(() => ok(submitted(5, undefined))) });
      await loaded();
      expect(screen.queryByText(CHANGED_SINCE_SUBMIT)).toBeNull();
    });

    it('«Καταχώρηση αλλαγών» saves the live numbers with the live revision, guarded on the last submit', async () => {
      const saveClosing = vi.fn(() => ok({ closingId: 'v3', repeat: false }));
      const { api, channels } = setup({ todayClosing: vi.fn(() => ok(submitted(4, 3))), saveClosing });
      await loaded();
      expect(screen.getByText(CHANGED_SINCE_SUBMIT)).toBeTruthy();
      const save = screen.getByRole('button', { name: 'Καταχώρηση αλλαγών' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true); // still connecting
      await goLive(channels, api);
      fireEvent.click(save);
      await waitFor(() => expect(saveClosing).toHaveBeenCalledWith(SHOP, {
        businessDate: '2026-11-07', configId: 'c1', inputs: expect.objectContaining({ schema: 2 }), expectedCurrentId: 'v2', key: 'id-1', revision: 4,
      }));
      expect(await screen.findByText('Οι αλλαγές καταχωρήθηκαν')).toBeTruthy();
    });

    it('draft_changed shows its message and resyncs', async () => {
      const saveClosing = vi.fn(() => fail<{ closingId: string; repeat: boolean }>({ code: 'draft_changed' }));
      const { api, channels } = setup({ todayClosing: vi.fn(() => ok(submitted(4, 3))), saveClosing });
      await loaded();
      await goLive(channels, api);
      fireEvent.click(screen.getByRole('button', { name: 'Καταχώρηση αλλαγών' }));
      expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'draft_changed' }));
      await waitFor(() => expect(api.todayClosing).toHaveBeenCalledTimes(3));
    });
  });

  it('not_owner shows its message with a retry', async () => {
    setup({ todayClosing: vi.fn(() => fail<Snapshot>({ code: 'not_owner' })) });
    expect((await screen.findByRole('alert')).textContent).toContain(ownerErrorMessage({ code: 'not_owner' }));
    expect(screen.getByRole('button', { name: 'Δοκίμασε ξανά' })).toBeTruthy();
  });
});

describe('ShopLayout today tab', () => {
  it('has «Σήμερα» as the first tab', async () => {
    render(<ShopLayout api={fakeApi({ listShops: vi.fn(() => ok([{ id: SHOP, name: 'JJ' }])) })} shopId={SHOP} tab="today" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email="o@t.gr" onSignOut={vi.fn()} onExit={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: 'Ενότητες καταστήματος' });
    const tabs = nav.querySelectorAll('button');
    expect(tabs[0]!.textContent).toBe('Σήμερα');
    expect(tabs[0]!.getAttribute('aria-current')).toBe('page');
  });
});
