// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
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
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

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
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('TodayScreen', () => {
  it('shows an empty closing with the not-submitted line and no submit button', async () => {
    setup();
    await settle();
    expect(box('100€').value).toBe('');
    expect(screen.getByText('Δεν έχει υποβληθεί ακόμα')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Υποβολή' })).toBeNull();
  });

  it('shows who submitted and when', async () => {
    setup({ todayClosing: vi.fn(() => ok(snap({ lastSubmit: { closingId: 'x', staffName: 'ΜΑΡΙΑ', at: '2026-11-07T20:30:00Z' } }))) });
    await settle();
    expect(screen.getByText(/^Υποβλήθηκε \d\d:\d\d · ΜΑΡΙΑ$/)).toBeTruthy();
  });

  it('an owner edit calls setTodayField', async () => {
    const { api, channels } = setup();
    await settle();
    act(() => channels[0]!.emitStatus('live'));
    fireEvent.focus(box('100€'));
    fireEvent.change(box('100€'), { target: { value: '500' } });
    fireEvent.blur(box('100€'));
    await settle();
    expect(api.setTodayField).toHaveBeenCalledWith(SHOP, 'd:10000', { text: '500', mode: 'amount' }, 0);
  });

  it('a broadcast updates the view', async () => {
    const { channels } = setup();
    await settle();
    act(() => channels[0]!.emitField({ key: 'd:10000', value: { text: '300', mode: 'amount' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T20:00:00Z', revision: 1, businessDate: '2026-11-07' }));
    await settle();
    expect(box('100€').value).toBe('300');
  });

  it('joins as «Ιδιοκτήτης» and closes its channel on unmount', async () => {
    const { api, channels, unmount } = setup();
    await settle();
    expect(api.live).toHaveBeenCalledWith(SHOP, { name: 'Ιδιοκτήτης' }, expect.anything());
    unmount();
    expect(channels[0]!.close).toHaveBeenCalled();
  });

  it('remembers the entry mode per shop on this device', async () => {
    const { store } = setup();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '# Κομμάτια' }));
    expect(loadEntryMode(store, SHOP)).toBe('count');
  });

  it('not_owner shows its message with a retry', async () => {
    setup({ todayClosing: vi.fn(() => fail<Snapshot>({ code: 'not_owner' })) });
    await settle();
    expect(screen.getByRole('alert').textContent).toContain(ownerErrorMessage({ code: 'not_owner' }));
    expect(screen.getByRole('button', { name: 'Δοκίμασε ξανά' })).toBeTruthy();
  });
});

describe('ShopLayout today tab', () => {
  it('has «Σήμερα» as the first tab', async () => {
    render(<ShopLayout api={fakeApi({ listShops: vi.fn(() => ok([{ id: SHOP, name: 'JJ' }])) })} shopId={SHOP} tab="today" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email="o@t.gr" onSignOut={vi.fn()} onExit={vi.fn()} />);
    await settle();
    const tabs = screen.getByRole('navigation', { name: 'Ενότητες καταστήματος' }).querySelectorAll('button');
    expect(tabs[0]!.textContent).toBe('Σήμερα');
    expect(tabs[0]!.getAttribute('aria-current')).toBe('page');
  });
});
