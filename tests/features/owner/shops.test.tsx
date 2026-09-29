// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateConfig, type ShopConfig } from '../../../src/core/config';
import { memoryStore } from '../../../src/data/local/storage';
import { NewShopScreen } from '../../../src/features/owner/NewShopScreen';
import { ShopLayout } from '../../../src/features/owner/ShopLayout';
import { ShopsScreen } from '../../../src/features/owner/ShopsScreen';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ShopsScreen', () => {
  it('auto-opens the only shop on first load', async () => {
    const navigate = vi.fn();
    const onLoaded = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Join Juice' }])) })} navigate={navigate} autoOpen onLoaded={onLoaded} onSignOut={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: A, tab: 'settings' }, { replace: true }));
    expect(onLoaded).toHaveBeenCalled();
  });

  it('lists several shops and offers a new one', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α' }, { id: B, name: 'Β' }])) })} navigate={navigate} autoOpen onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Β' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: B, tab: 'settings' });
    fireEvent.click(screen.getByRole('button', { name: '+ Νέο κατάστημα' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'new' });
  });

  it('does not auto-open when coming back to the list', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α' }])) })} navigate={navigate} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Α' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a load error with retry', async () => {
    const listShops = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok([]));
    render(<ShopsScreen api={fakeApi({ listShops })} navigate={vi.fn()} autoOpen onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByText(/Δεν έχεις ακόμα κατάστημα/)).toBeTruthy();
  });

  it('exits back to the register from the header', async () => {
    const onExit = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([])) })} navigate={vi.fn()} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={onExit} />);
    await screen.findByText(/Δεν έχεις ακόμα κατάστημα/);
    fireEvent.click(screen.getByRole('button', { name: '← Ταμείο' }));
    expect(onExit).toHaveBeenCalled();
  });
});

describe('NewShopScreen', () => {
  it('creates a valid config from name, float and channels', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    render(<NewShopScreen api={api} navigate={navigate} />);
    type('Όνομα καταστήματος', '  Join Juice ');
    type('Αρχικό ταμείο (€)', '1000');
    fireEvent.click(screen.getByRole('button', { name: '+ Κανάλι' }));
    type('Όνομα καναλιού 1', 'WOLT');
    fireEvent.change(screen.getByLabelText('Είδος καναλιού 1'), { target: { value: 'delivery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: '11111111-1111-4111-8111-111111111111', tab: 'settings' }, { replace: true }));
    const [name, config] = (api.createShop as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ShopConfig];
    expect(name).toBe('Join Juice');
    expect(config.floatCents).toBe(100000);
    expect(config.channels).toEqual([{ id: 'ch_1', label: 'WOLT', type: 'delivery' }]);
    expect(validateConfig(config)).toEqual([]);
  });

  it('refuses an empty name, a bad float and an unnamed channel before calling the server', () => {
    const api = fakeApi();
    render(<NewShopScreen api={api} navigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(screen.getByRole('alert').textContent).toContain('όνομα');
    type('Όνομα καταστήματος', 'X');
    type('Αρχικό ταμείο (€)', '5-3');
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(screen.getByRole('alert').textContent).toContain('ταμείο');
    type('Αρχικό ταμείο (€)', '');
    fireEvent.click(screen.getByRole('button', { name: '+ Κανάλι' }));
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(screen.getByRole('alert').textContent).toContain('κανάλι');
    expect(api.createShop).not.toHaveBeenCalled();
  });
});

describe('ShopLayout', () => {
  it('shows the shop name, renames it, and switches tabs', async () => {
    const api = fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Join Juice' }])) });
    const navigate = vi.fn();
    render(<ShopLayout api={api} shopId={A} tab="settings" navigate={navigate} store={memoryStore()} now={() => new Date()} email="o@t.gr" onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Join Juice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Μετονομασία καταστήματος' }));
    type('Νέο όνομα καταστήματος', 'Join Juice 2');
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    expect(await screen.findByRole('heading', { name: 'Join Juice 2' })).toBeTruthy();
    expect(api.renameShop).toHaveBeenCalledWith(A, 'Join Juice 2');
    fireEvent.click(screen.getByRole('button', { name: 'Προσωπικό' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: A, tab: 'staff' });
  });

  it('says so when the shop is not found', async () => {
    render(<ShopLayout api={fakeApi()} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email={null} onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect(await screen.findByText(/Το κατάστημα δεν βρέθηκε/)).toBeTruthy();
  });

  it('exits back to the register from the footer', async () => {
    const onExit = vi.fn();
    render(<ShopLayout api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Join Juice' }])) })} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email="o@t.gr" onSignOut={vi.fn()} onExit={onExit} />);
    await screen.findByRole('heading', { name: 'Join Juice' });
    fireEvent.click(screen.getByRole('button', { name: '← Ταμείο' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('shows a load error with retry', async () => {
    const listShops = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok([{ id: A, name: 'Join Juice' }]));
    render(<ShopLayout api={fakeApi({ listShops })} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email="o@t.gr" onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Join Juice' })).toBeTruthy();
  });
});
