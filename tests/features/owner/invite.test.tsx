// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerRoute } from '../../../src/app/router';
import { loadPendingInvite, savePendingInvite } from '../../../src/data/local/pendingInvite';
import { memoryStore } from '../../../src/data/local/storage';
import type { OwnerApi } from '../../../src/data/remote/ownerApi';
import { InviteScreen } from '../../../src/features/owner/InviteScreen';
import { OwnerApp } from '../../../src/features/owner/OwnerApp';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const TOKEN = 'A'.repeat(32);

const info = { shops: [{ id: 's1', name: 'Κάφε' }, { id: 's2', name: 'Μπαρ' }], role: 'accountant' as const, displayName: 'Νίκος', email: 'm@test.gr', expiresAt: '2026-11-24T00:00:00Z' };

function renderScreen(api: OwnerApi, token: string | null = TOKEN) {
  const store = memoryStore();
  if (token) savePendingInvite(store, token);
  const navigate = vi.fn();
  const onSwitchAccount = vi.fn(() => Promise.resolve());
  render(<InviteScreen api={api} token={token} store={store} navigate={navigate} onSwitchAccount={onSwitchAccount} />);
  return { store, navigate, onSwitchAccount };
}

describe('InviteScreen', () => {
  it('shows what is offered', async () => {
    renderScreen(fakeApi({ inviteInfo: vi.fn(() => ok(info)) }));
    expect(await screen.findByRole('heading', { name: 'Πρόσκληση' })).toBeTruthy();
    expect(screen.getByText(/Κάφε/)).toBeTruthy();
    expect(screen.getByText(/Μπαρ/)).toBeTruthy();
    expect(screen.getByText('ως Λογιστής')).toBeTruthy();
    expect(screen.getByText('για m@test.gr')).toBeTruthy();
  });

  it('accepts, clears the pending token and goes to the shops', async () => {
    const api = fakeApi({ inviteInfo: vi.fn(() => ok(info)) });
    const { store, navigate } = renderScreen(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Αποδοχή' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
    expect(api.acceptInvite).toHaveBeenCalledWith(TOKEN);
    expect(loadPendingInvite(store)).toBeNull();
  });

  it('declines with «Όχι τώρα»', async () => {
    const api = fakeApi({ inviteInfo: vi.fn(() => ok(info)) });
    const { store, navigate } = renderScreen(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Όχι τώρα' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true });
    expect(api.acceptInvite).not.toHaveBeenCalled();
    expect(loadPendingInvite(store)).toBeNull();
  });

  it.each([
    ['invite_wrong_email', 'άλλο email', false],
    ['invite_unconfirmed', 'Επιβεβαίωσε πρώτα', false],
    ['invite_expired', 'έληξε', true],
    ['invite_invalid', 'δεν ισχύει πια', true],
  ] as const)('shows %s from accept', async (code, text, clears) => {
    const api = fakeApi({ inviteInfo: vi.fn(() => ok(info)), acceptInvite: vi.fn(() => fail<string[]>({ code })) });
    const { store, navigate } = renderScreen(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Αποδοχή' }));
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(navigate).not.toHaveBeenCalled();
    expect(loadPendingInvite(store) === null).toBe(clears);
  });

  it('wrong account: «Σύνδεση με άλλο λογαριασμό» keeps the token and signs out', async () => {
    const api = fakeApi({ inviteInfo: vi.fn(() => ok(info)), acceptInvite: vi.fn(() => fail<string[]>({ code: 'invite_wrong_email' })) });
    const { store, navigate, onSwitchAccount } = renderScreen(api);
    expect(screen.queryByRole('button', { name: 'Σύνδεση με άλλο λογαριασμό' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Αποδοχή' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση με άλλο λογαριασμό' }));
    await waitFor(() => expect(onSwitchAccount).toHaveBeenCalledTimes(1));
    expect(navigate).not.toHaveBeenCalled();
    expect(loadPendingInvite(store)).toBe(TOKEN);
  });

  it.each(['invite_unconfirmed', 'invite_expired'] as const)('offers no account switch for %s', async (code) => {
    const api = fakeApi({ inviteInfo: vi.fn(() => ok(info)), acceptInvite: vi.fn(() => fail<string[]>({ code })) });
    renderScreen(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Αποδοχή' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Σύνδεση με άλλο λογαριασμό' })).toBeNull();
  });

  it('shows an info error (expired) and clears the token', async () => {
    const { store } = renderScreen(fakeApi({ inviteInfo: vi.fn(() => fail<typeof info>({ code: 'invite_expired' })) }));
    expect((await screen.findByRole('alert')).textContent).toContain('έληξε');
    expect(loadPendingInvite(store)).toBeNull();
  });

  it('rejects a missing token', () => {
    renderScreen(fakeApi(), null);
    expect(screen.getByText('Ο σύνδεσμος πρόσκλησης δεν είναι σωστός.')).toBeTruthy();
  });
});

describe('OwnerApp invite route', () => {
  const start = (route: OwnerRoute, api: OwnerApi, store = memoryStore(), extra: Partial<Parameters<typeof OwnerApp>[0]> = {}) => {
    const navigate = vi.fn();
    render(<OwnerApp route={route} navigate={navigate} api={api} store={store} redirectBase="https://tameio.app/" onExit={vi.fn()} {...extra} />);
    return { navigate, store };
  };

  it('signed out: saves the token and shows login with signup offered', async () => {
    const { store } = start({ name: 'invite', token: TOKEN }, fakeApi({ session: vi.fn(() => Promise.resolve(null)) }));
    expect(await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Νέος λογαριασμός' })).toBeTruthy();
    expect(loadPendingInvite(store)).toBe(TOKEN);
  });

  it('signed in: shows the invitation', async () => {
    start({ name: 'invite', token: TOKEN }, fakeApi({ inviteInfo: vi.fn(() => ok(info)) }));
    expect(await screen.findByRole('button', { name: 'Αποδοχή' })).toBeTruthy();
  });

  it('after a signup redirect, resumes the stored invite instead of the shops', async () => {
    const store = memoryStore();
    savePendingInvite(store, TOKEN);
    const { navigate } = start({ name: 'shops' }, fakeApi(), store, { redirect: { kind: 'signup', code: 'c' } });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'invite', token: TOKEN }, { replace: true }));
  });

  it('after a signup redirect with no stored invite goes to the shops', async () => {
    const { navigate } = start({ name: 'shops' }, fakeApi(), memoryStore(), { redirect: { kind: 'signup', code: 'c' } });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
  });

  /** A session that starts signed out and becomes the invited person's after a password login. */
  const loginApi = () => {
    let signedIn = false;
    return fakeApi({
      session: vi.fn(() => Promise.resolve(signedIn ? { email: 'm@test.gr', userId: 'u1', anonymous: false } : null)),
      signIn: vi.fn(() => {
        signedIn = true;
        return Promise.resolve({ ok: true as const, data: undefined });
      }),
      inviteInfo: vi.fn(() => ok(info)),
    });
  };
  const signInThroughForm = () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'm@test.gr' } });
    fireEvent.change(screen.getByLabelText('Κωδικός'), { target: { value: 'secret123' } });
    fireEvent.submit(screen.getByLabelText('Κωδικός').closest('form')!);
  };

  it('signed out on the invite route, then a password login: lands on the invitation', async () => {
    const api = loginApi();
    const { store } = start({ name: 'invite', token: TOKEN }, api);
    await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' });
    expect(loadPendingInvite(store)).toBe(TOKEN);
    signInThroughForm();
    expect(await screen.findByRole('button', { name: 'Αποδοχή' })).toBeTruthy();
    expect(api.inviteInfo).toHaveBeenCalledWith(TOKEN);
  });

  it('a stored invite, then a password login on the login route: resumes the invite', async () => {
    const api = loginApi();
    const store = memoryStore();
    savePendingInvite(store, TOKEN);
    const { navigate } = start({ name: 'login' }, api, store);
    await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' });
    expect(navigate).not.toHaveBeenCalled();
    signInThroughForm();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'invite', token: TOKEN }, { replace: true }));
  });

  it('a session on the shops route with a stored invite goes to the invite', async () => {
    const store = memoryStore();
    savePendingInvite(store, TOKEN);
    const { navigate } = start({ name: 'shops' }, fakeApi(), store);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'invite', token: TOKEN }, { replace: true }));
  });

  it('a session on the shops route with no stored invite stays on the shops', async () => {
    const { navigate } = start({ name: 'shops' }, fakeApi({ listShops: vi.fn(() => ok([])) }), memoryStore());
    await screen.findByText('Δεν έχεις ακόμα κατάστημα.');
    expect(navigate).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'invite' }), expect.anything());
  });

  it('wrong account: switching signs out and shows the login on the invite route, the token kept', async () => {
    const api = fakeApi({ inviteInfo: vi.fn(() => ok(info)), acceptInvite: vi.fn(() => fail<string[]>({ code: 'invite_wrong_email' })) });
    const store = memoryStore();
    savePendingInvite(store, TOKEN);
    const { navigate } = start({ name: 'invite', token: TOKEN }, api, store);
    fireEvent.click(await screen.findByRole('button', { name: 'Αποδοχή' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση με άλλο λογαριασμό' }));
    expect(await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' })).toBeTruthy();
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(loadPendingInvite(store)).toBe(TOKEN);
  });
});
