// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShopTab } from '../../../src/app/router';
import { savePending } from '../../../src/data/local/openClosing';
import { memoryStore } from '../../../src/data/local/storage';
import type { LiveHandlers } from '../../../src/data/remote/live';
import { juiceBarPreset } from '../../../src/core/presets';
import { fakeLive, type FakeLive } from '../phone/fakeDeviceApi';
import type { ShopRole } from '../../../src/features/owner/model/roles';
import { ShopLayout } from '../../../src/features/owner/ShopLayout';
import { fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';

function setup(role: ShopRole, tab: ShopTab) {
  const navigate = vi.fn();
  const api = fakeApi({ listShops: vi.fn(() => ok([{ id: SHOP, name: 'Μαγαζί', role, myName: 'Νίκος' }])) });
  render(<ShopLayout api={api} shopId={SHOP} tab={tab} navigate={navigate} store={memoryStore()} now={() => new Date()} email="o@t.gr" userId="u1" onSignOut={vi.fn()} onExit={vi.fn()} />);
  return { navigate };
}
const tabNames = () => Array.from(screen.getByRole('navigation', { name: 'Ενότητες καταστήματος' }).querySelectorAll('button')).map((b) => b.textContent);

describe('ShopLayout by role', () => {
  it('owner: five tabs and the rename button', async () => {
    const { navigate } = setup('owner', 'settings');
    await screen.findByRole('navigation', { name: 'Ενότητες καταστήματος' });
    expect(tabNames()).toEqual(['Σήμερα', 'Ιστορικό', 'Ρυθμίσεις', 'Προσωπικό', 'Συσκευές']);
    expect(screen.getByRole('button', { name: 'Μετονομασία καταστήματος' })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('manager: four tabs and no rename', async () => {
    const { navigate } = setup('manager', 'staff');
    await screen.findByRole('navigation', { name: 'Ενότητες καταστήματος' });
    expect(tabNames()).toEqual(['Σήμερα', 'Ιστορικό', 'Προσωπικό', 'Συσκευές']);
    expect(screen.queryByRole('button', { name: 'Μετονομασία καταστήματος' })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('accountant: only «Ιστορικό»', async () => {
    setup('accountant', 'history');
    await screen.findByRole('navigation', { name: 'Ενότητες καταστήματος' });
    expect(tabNames()).toEqual(['Ιστορικό']);
  });

  it('a manager on the settings tab is sent to «Σήμερα» (replace) and sees nothing meanwhile', async () => {
    const { navigate } = setup('manager', 'settings');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: SHOP, tab: 'today' }, { replace: true }));
    expect(screen.queryByRole('navigation', { name: 'Ενότητες καταστήματος' })).toBeNull();
  });

  it('an accountant on the staff tab is sent to «Ιστορικό»', async () => {
    const { navigate } = setup('accountant', 'staff');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: SHOP, tab: 'history' }, { replace: true }));
  });
});

describe('ShopLayout queue author', () => {
  it('a manager (userId u1) on «Σήμερα» sends the stored office:u1 item and not office:u2\'s', async () => {
    const store = memoryStore();
    const item = (author: string, text: string, key: 'd:10000' | 'd:5000') => ({ author, key, value: { text, mode: 'amount' as const }, businessDate: '2026-11-07', closingNo: 1, baseVersion: null, queuedOffline: false, seq: 1 });
    savePending(store, SHOP, 'office:u1', [item('office:u1', '11', 'd:10000')]);
    savePending(store, SHOP, 'office:u2', [item('office:u2', '22', 'd:5000')]);
    const channels: FakeLive[] = [];
    const api = fakeApi({
      listShops: vi.fn(() => ok([{ id: SHOP, name: 'Μαγαζί', role: 'manager' as const, myName: 'Νίκος' }])),
      todayClosing: vi.fn(() => ok({
        id: 'oc-1', businessDate: '2026-11-07', configId: 'c1', config: juiceBarPreset, revision: 0, closingNo: 1, closingsPlanned: 1, cashMode: 'separate' as const, lastSubmit: null, fields: {},
      })),
      live: vi.fn((_s: string, _m: { name: string }, h: LiveHandlers) => { const l = fakeLive(h); channels.push(l); return l; }),
    });
    render(<ShopLayout api={api} shopId={SHOP} tab="today" navigate={vi.fn()} store={store} now={() => new Date(2026, 10, 7, 22, 0)} email="m@t.gr" userId="u1" onSignOut={vi.fn()} onExit={vi.fn()} />);
    await screen.findByLabelText('100€');
    expect(api.live).toHaveBeenCalledWith(SHOP, { name: 'Νίκος' }, expect.anything());
    act(() => channels[0]!.emitStatus('live'));
    await waitFor(() => expect(api.setTodayField).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(api.setTodayField).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.setTodayField).mock.calls[0]!.slice(0, 5)).toEqual([SHOP, '2026-11-07', 1, 'd:10000', { text: '11', mode: 'amount' }]);
  });
});
