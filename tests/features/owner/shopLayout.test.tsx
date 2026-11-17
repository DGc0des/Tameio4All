// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShopTab } from '../../../src/app/router';
import { memoryStore } from '../../../src/data/local/storage';
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
