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
  render(<InviteScreen api={api} token={token} store={store} navigate={navigate} />);
  return { store, navigate };
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
});
