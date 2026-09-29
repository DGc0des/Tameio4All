// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerRoute } from '../../../src/app/router';
import { memoryStore } from '../../../src/data/local/storage';
import type { OwnerApi } from '../../../src/data/remote/ownerApi';
import { OwnerApp } from '../../../src/features/owner/OwnerApp';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);

const signedOut = (o: Partial<OwnerApi> = {}) => fakeApi({ session: vi.fn(() => Promise.resolve(null)), ...o });

function start(route: OwnerRoute, api: OwnerApi | null, extra: Partial<Parameters<typeof OwnerApp>[0]> = {}) {
  const navigate = vi.fn();
  render(
    <OwnerApp route={route} navigate={navigate} api={api} store={memoryStore()} redirectBase="https://tameio.app/" onExit={vi.fn()} {...extra} />,
  );
  return navigate;
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('OwnerApp gate', () => {
  it('explains a missing server configuration', () => {
    start({ name: 'shops' }, null);
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy();
  });

  it('shows the login form in place of a protected route when signed out', async () => {
    start({ name: 'shops' }, signedOut());
    expect(await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' })).toBeTruthy();
  });

  it('sends a signed-in owner from the login route to the shops list', async () => {
    const navigate = start({ name: 'login' }, fakeApi());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
  });
});

describe('login', () => {
  it('validates, signs in, and re-reads the session', async () => {
    const session = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ email: 'owner@test.gr', anonymous: false });
    const api = signedOut({ session });
    const navigate = start({ name: 'login' }, api);
    await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' });
    type('Email', 'nope');
    type('Κωδικός', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    expect(screen.getByRole('alert').textContent).toContain('έγκυρο email');
    expect(api.signIn).not.toHaveBeenCalled();
    type('Email', 'owner@test.gr');
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
    expect(api.signIn).toHaveBeenCalledWith('owner@test.gr', 'secret123');
  });

  it('shows the server error and re-enables the button', async () => {
    start({ name: 'login' }, signedOut({ signIn: vi.fn(() => fail<void>({ code: 'invalid_credentials' })) }));
    await screen.findByRole('heading', { name: 'Σύνδεση ιδιοκτήτη' });
    type('Email', 'owner@test.gr');
    type('Κωδικός', 'wrongpass');
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Λάθος email ή κωδικός');
    expect((screen.getByRole('button', { name: 'Σύνδεση' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('requires confirmation before replacing a paired-phone session', async () => {
    const api = signedOut({ session: vi.fn(() => Promise.resolve({ email: null, anonymous: true })) });
    start({ name: 'login' }, api);
    expect(await screen.findByText(/συνδεδεμένη ως ταμείο/)).toBeTruthy();
    type('Email', 'owner@test.gr');
    type('Κωδικός', 'secret123');
    expect((screen.getByRole('button', { name: 'Σύνδεση' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Κατάλαβα, να αποσυνδεθεί το ταμείο'));
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    await waitFor(() => expect(api.signIn).toHaveBeenCalled());
  });
});

describe('signup / forgot / reset', () => {
  it('signs up with the confirm-email redirect and says to check the inbox', async () => {
    const api = signedOut();
    start({ name: 'signup' }, api);
    await screen.findByRole('heading', { name: 'Νέος λογαριασμός' });
    type('Email', 'owner@test.gr');
    type('Κωδικός', 'short');
    type('Επανάληψη κωδικού', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία λογαριασμού' }));
    expect(screen.getByRole('alert').textContent).toContain('8');
    type('Κωδικός', 'longenough');
    type('Επανάληψη κωδικού', 'longenough');
    fireEvent.click(screen.getByRole('button', { name: 'Δημιουργία λογαριασμού' }));
    expect(await screen.findByText(/owner@test.gr/)).toBeTruthy();
    expect(api.signUp).toHaveBeenCalledWith('owner@test.gr', 'longenough', 'https://tameio.app/?auth=signup');
  });

  it('sends a reset link', async () => {
    const api = signedOut();
    start({ name: 'forgot' }, api);
    await screen.findByRole('heading', { name: 'Ξέχασα τον κωδικό' });
    type('Email', 'owner@test.gr');
    fireEvent.click(screen.getByRole('button', { name: 'Αποστολή συνδέσμου' }));
    expect(await screen.findByText(/Αν υπάρχει λογαριασμός/)).toBeTruthy();
    expect(api.sendReset).toHaveBeenCalledWith('owner@test.gr', 'https://tameio.app/?auth=recovery');
  });

  it('reset without a session explains the link problem', async () => {
    start({ name: 'reset' }, signedOut());
    expect(await screen.findByText(/Ο σύνδεσμος δεν λειτούργησε/)).toBeTruthy();
  });

  it('sets a new password when the recovery session exists', async () => {
    const api = fakeApi();
    const navigate = start({ name: 'reset' }, api);
    await screen.findByRole('heading', { name: 'Νέος κωδικός' });
    type('Νέος κωδικός', 'newpassword');
    type('Επανάληψη κωδικού', 'newpassword');
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'shops' }, { replace: true }));
    expect(api.updatePassword).toHaveBeenCalledWith('newpassword');
  });
});

describe('email link redirect', () => {
  it('exchanges a recovery code once and opens the reset screen', async () => {
    const api = fakeApi();
    const onRedirectHandled = vi.fn();
    const navigate = start({ name: 'shops' }, api, { redirect: { kind: 'recovery', code: 'abc' }, onRedirectHandled });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'reset' }, { replace: true }));
    expect(api.exchangeCode).toHaveBeenCalledTimes(1);
    expect(onRedirectHandled).toHaveBeenCalled();
  });

  it('link error: a failed exchange shows a way forward, not a spinner', async () => {
    const api = signedOut({ exchangeCode: vi.fn(() => fail<void>({ code: 'link_invalid' })) });
    const navigate = start({ name: 'shops' }, api, { redirect: { kind: 'signup', code: 'used' } });
    expect(await screen.findByText(/Ο σύνδεσμος δεν λειτούργησε/)).toBeTruthy();
    expect(screen.getByText(/στη συσκευή και τον browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Νέος σύνδεσμος' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'forgot' });
    expect(api.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('an error redirect (expired link) shows the same screen without calling the server', async () => {
    const api = signedOut();
    start({ name: 'shops' }, api, { redirect: { kind: 'error', description: 'expired' } });
    expect(await screen.findByText(/Ο σύνδεσμος δεν λειτούργησε/)).toBeTruthy();
    expect(api.exchangeCode).not.toHaveBeenCalled();
  });
});

describe('sign out', () => {
  it('is reachable from the shops screen', async () => {
    const api = fakeApi({ listShops: vi.fn(() => ok([])) });
    const navigate = start({ name: 'shops' }, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Αποσύνδεση' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'login' }, { replace: true }));
    expect(api.signOut).toHaveBeenCalled();
  });
});
