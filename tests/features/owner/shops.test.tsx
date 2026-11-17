// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateConfig, type ShopConfig } from '../../../src/core/config';
import { loadSnapshot, saveSnapshot } from '../../../src/data/local/openClosing';
import { memoryStore } from '../../../src/data/local/storage';
import { NewShopScreen } from '../../../src/features/owner/NewShopScreen';
import { ShopLayout } from '../../../src/features/owner/ShopLayout';
import { ShopsScreen } from '../../../src/features/owner/ShopsScreen';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ShopsScreen roles', () => {
  const rows = [{ id: A, name: 'Α', role: 'owner' as const, myName: 'Ιδιοκτήτης' }, { id: B, name: 'Β', role: 'manager' as const, myName: 'Νίκος' }];
  it('shows the role badge only on a shop that is not yours, and opens it on its landing tab', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok(rows)) })} store={memoryStore()} navigate={navigate} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    const first = await screen.findByRole('button', { name: /^Α/ });
    const second = screen.getByRole('button', { name: /^Β/ });
    expect(first.textContent).not.toContain('Υπεύθυνος');
    expect(second.textContent).toContain('Υπεύθυνος καταστήματος');
    fireEvent.click(second);
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: B, tab: 'today' });
  });

  it('deleting the account clears local data only of shops you own', async () => {
    const store = memoryStore();
    for (const id of [A, B]) saveSnapshot(store, id, { id: 'oc', businessDate: '2026-09-29', configId: 'c1', config: {}, revision: 0, closingNo: 1, closingsPlanned: 1, cashMode: 'separate' as const, lastSubmit: null, fields: {} });
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok(rows)) })} store={store} navigate={vi.fn()} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: /^Α/ });
    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή λογαριασμού' }));
    const sheet = screen.getByRole('dialog');
    await waitFor(() => expect(sheet).toBeTruthy());
    fireEvent.change(within(sheet).getByLabelText('Email για επιβεβαίωση'), { target: { value: 'owner@test.gr' } });
    await waitFor(() => expect((within(sheet).getByRole('button', { name: 'Διαγραφή' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Διαγραφή' }));
    await waitFor(() => expect(loadSnapshot(store, A)).toBeNull());
    expect(loadSnapshot(store, B)).not.toBeNull();
  });
});

describe('ShopsScreen', () => {
  it('auto-opens the only shop on first load', async () => {
    const navigate = vi.fn();
    const onLoaded = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Δοκιμαστικό', role: 'owner' as const, myName: 'Ιδιοκτήτης' }])) })} store={memoryStore()} navigate={navigate} autoOpen onLoaded={onLoaded} onSignOut={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: A, tab: 'settings' }, { replace: true }));
    expect(onLoaded).toHaveBeenCalled();
  });

  it('lists several shops and offers a new one', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α', role: 'owner' as const, myName: 'Ιδιοκτήτης' }, { id: B, name: 'Β', role: 'owner' as const, myName: 'Ιδιοκτήτης' }])) })} store={memoryStore()} navigate={navigate} autoOpen onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Β' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: B, tab: 'settings' });
    fireEvent.click(screen.getByRole('button', { name: '+ Νέο κατάστημα' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'new' });
  });

  it('does not auto-open when coming back to the list', async () => {
    const navigate = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α', role: 'owner' as const, myName: 'Ιδιοκτήτης' }])) })} store={memoryStore()} navigate={navigate} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Α' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a load error with retry', async () => {
    const listShops = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok([]));
    render(<ShopsScreen api={fakeApi({ listShops })} store={memoryStore()} navigate={vi.fn()} autoOpen onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByText(/Δεν έχεις ακόμα κατάστημα/)).toBeTruthy();
  });

  it('exits back to the register from the header', async () => {
    const onExit = vi.fn();
    render(<ShopsScreen api={fakeApi({ listShops: vi.fn(() => ok([])) })} store={memoryStore()} navigate={vi.fn()} autoOpen={false} onLoaded={vi.fn()} onSignOut={vi.fn()} onExit={onExit} />);
    await screen.findByText(/Δεν έχεις ακόμα κατάστημα/);
    fireEvent.click(screen.getByRole('button', { name: '← Ταμείο' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('deletes the account only after the email is typed', async () => {
    const onSignOut = vi.fn();
    const store = memoryStore();
    saveSnapshot(store, A, { id: 'oc', businessDate: '2026-09-29', configId: 'c1', config: {}, revision: 0, closingNo: 1, closingsPlanned: 1, cashMode: 'separate' as const, lastSubmit: null, fields: {} });
    const api = fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Α', role: 'owner' as const, myName: 'Ιδιοκτήτης' }])) });
    render(<ShopsScreen api={api} store={store} navigate={vi.fn()} autoOpen={false} onLoaded={vi.fn()} onSignOut={onSignOut} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Α' });
    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή λογαριασμού' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Σβήνονται οριστικά ο λογαριασμός σου και όλα τα καταστήματά σου.');
    const confirmButton = within(sheet).getByRole('button', { name: 'Διαγραφή' }) as HTMLButtonElement;
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    fireEvent.change(within(sheet).getByLabelText('Email για επιβεβαίωση'), { target: { value: 'other@test.gr' } });
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Email για επιβεβαίωση'), { target: { value: ' Owner@Test.gr ' } });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
    expect(api.deleteAccount).toHaveBeenCalledTimes(1);
    expect(loadSnapshot(store, A)).toBeNull();
  });

  it('keeps the account and shows the message when the deletion fails', async () => {
    const onSignOut = vi.fn();
    const api = fakeApi({ deleteAccount: vi.fn(() => fail<void>({ code: 'network' })) });
    render(<ShopsScreen api={api} store={memoryStore()} navigate={vi.fn()} autoOpen={false} onLoaded={vi.fn()} onSignOut={onSignOut} onExit={vi.fn()} />);
    await screen.findByText(/Δεν έχεις ακόμα κατάστημα/);
    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή λογαριασμού' }));
    const sheet = screen.getByRole('dialog');
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    fireEvent.change(within(sheet).getByLabelText('Email για επιβεβαίωση'), { target: { value: 'owner@test.gr' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Διαγραφή' }));
    expect((await within(sheet).findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe('NewShopScreen', () => {
  it('creates a valid config from name, float and channels', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    render(<NewShopScreen api={api} navigate={navigate} />);
    type('Όνομα καταστήματος', '  Δοκιμαστικό ');
    type('Αρχικό ταμείο (€)', '1000');
    fireEvent.click(screen.getByRole('button', { name: '+ Κανάλι' }));
    type('Όνομα καναλιού 1', 'WOLT');
    fireEvent.change(screen.getByLabelText('Είδος καναλιού 1'), { target: { value: 'delivery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: '11111111-1111-4111-8111-111111111111', tab: 'settings' }, { replace: true }));
    const [name, config] = (api.createShop as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ShopConfig];
    expect(name).toBe('Δοκιμαστικό');
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
    const api = fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Δοκιμαστικό', role: 'owner' as const, myName: 'Ιδιοκτήτης' }])) });
    const navigate = vi.fn();
    render(<ShopLayout api={api} shopId={A} tab="settings" navigate={navigate} store={memoryStore()} now={() => new Date()} email="o@t.gr" userId="u1" onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Δοκιμαστικό' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Μετονομασία καταστήματος' }));
    type('Νέο όνομα καταστήματος', 'Δοκιμαστικό 2');
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    expect(await screen.findByRole('heading', { name: 'Δοκιμαστικό 2' })).toBeTruthy();
    expect(api.renameShop).toHaveBeenCalledWith(A, 'Δοκιμαστικό 2');
    fireEvent.click(screen.getByRole('button', { name: 'Προσωπικό' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shop', shopId: A, tab: 'staff' });
  });

  it('says so when the shop is not found', async () => {
    render(<ShopLayout api={fakeApi()} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email={null} userId="u1" onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect(await screen.findByText(/Το κατάστημα δεν βρέθηκε/)).toBeTruthy();
  });

  it('exits back to the register from the footer', async () => {
    const onExit = vi.fn();
    render(<ShopLayout api={fakeApi({ listShops: vi.fn(() => ok([{ id: A, name: 'Δοκιμαστικό', role: 'owner' as const, myName: 'Ιδιοκτήτης' }])) })} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email="o@t.gr" userId="u1" onSignOut={vi.fn()} onExit={onExit} />);
    await screen.findByRole('heading', { name: 'Δοκιμαστικό' });
    fireEvent.click(screen.getByRole('button', { name: '← Ταμείο' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('shows a load error with retry', async () => {
    const listShops = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok([{ id: A, name: 'Δοκιμαστικό', role: 'owner' as const, myName: 'Ιδιοκτήτης' }]));
    render(<ShopLayout api={fakeApi({ listShops })} shopId={A} tab="settings" navigate={vi.fn()} store={memoryStore()} now={() => new Date()} email="o@t.gr" userId="u1" onSignOut={vi.fn()} onExit={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Δοκιμαστικό' })).toBeTruthy();
  });
});
