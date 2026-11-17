// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteLink, inviteMailto } from '../../../src/app/inviteToken';
import type { MemberRow } from '../../../src/data/remote/ownerApi';
import { MembersCard } from '../../../src/features/owner/settings/MembersCard';
import { fail, fakeApi, ok } from './fakeApi';

const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BASE = 'https://tameio.app/';
const TOKEN = 'A'.repeat(32);
const shops = [
  { id: SHOP, name: 'Κάφε', role: 'owner' as const, myName: 'Ιδιοκτήτης' },
  { id: OTHER, name: 'Μπαρ', role: 'owner' as const, myName: 'Ιδιοκτήτης' },
  { id: 'x', name: 'Ξένο', role: 'manager' as const, myName: 'Κάποιος' },
];
const member = (o: Partial<MemberRow> = {}): MemberRow => ({
  id: 'm1', email: 'nikos@test.gr', displayName: 'Νίκος', role: 'manager', status: 'active', expiresAt: null, acceptedAt: '2026-11-01T00:00:00Z', ...o,
});

function setNavigator(name: 'clipboard' | 'share', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}
beforeEach(() => {
  setNavigator('clipboard', undefined);
  setNavigator('share', undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderCard = (o = {}) => {
  const api = fakeApi({ listShops: vi.fn(() => ok(shops)), ...o });
  render(<MembersCard api={api} shopId={SHOP} shopName="Κάφε" redirectBase={BASE} />);
  return api;
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('MembersCard', () => {
  it('lists members with role and status', async () => {
    renderCard({
      listMembers: vi.fn(() => ok([member(), member({ id: 'm2', displayName: 'Μαρία', role: 'accountant', status: 'pending' }), member({ id: 'm3', displayName: 'Γιώργος', status: 'expired' })])),
    });
    const card = await screen.findByRole('region', { name: 'Συνεργάτες' });
    expect(await within(card).findByText('Νίκος')).toBeTruthy();
    expect(within(card).getByText('Σε αναμονή')).toBeTruthy();
    expect(within(card).getByText('Έληξε')).toBeTruthy();
    expect(within(card).getByText('Ενεργός')).toBeTruthy();
    expect(within(card).getAllByText(/Λογιστής/).length).toBeGreaterThan(0);
  });

  it('invites to the checked shops and shows the link actions', async () => {
    setNavigator('share', vi.fn(() => Promise.resolve()));
    const api = renderCard();
    await screen.findByLabelText('Μπαρ');
    expect(screen.queryByLabelText('Ξένο')).toBeNull();
    expect((screen.getByLabelText('Κάφε') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Μπαρ'));
    type('Όνομα', 'Νίκος');
    type('Email', ' M@Test.gr ');
    fireEvent.click(screen.getByLabelText('Λογιστής'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Πρόσκληση' }));
    });
    expect(api.inviteMember).toHaveBeenCalledWith([SHOP, OTHER], 'm@test.gr', 'Νίκος', 'accountant');
    expect(await screen.findByText("Ο σύνδεσμος ισχύει 7 ημέρες. Στείλ' τον μόνο σε αυτό το άτομο.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Αντιγραφή συνδέσμου' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Κοινοποίηση' })).toBeTruthy();
    const link = inviteLink(BASE, TOKEN);
    const mail = screen.getByRole('link', { name: 'Αποστολή με email' });
    expect(mail.getAttribute('href')).toBe(inviteMailto('m@test.gr', ['Κάφε', 'Μπαρ'], 'accountant', link));
  });

  it('copies the invite link', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setNavigator('clipboard', { writeText });
    renderCard();
    await screen.findByLabelText('Μπαρ');
    type('Όνομα', 'Νίκος');
    type('Email', 'm@test.gr');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Πρόσκληση' }));
    });
    await screen.findByRole('button', { name: 'Αντιγραφή συνδέσμου' });
    expect(screen.queryByRole('button', { name: 'Κοινοποίηση' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Αντιγραφή συνδέσμου' }));
    });
    expect(writeText).toHaveBeenCalledWith(inviteLink(BASE, TOKEN));
  });

  it('validates the form before calling the server', async () => {
    const api = renderCard();
    await screen.findByLabelText('Μπαρ');
    type('Όνομα', '  ');
    type('Email', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Πρόσκληση' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(api.inviteMember).not.toHaveBeenCalled();
    type('Όνομα', 'Νίκος');
    fireEvent.click(screen.getByRole('button', { name: 'Πρόσκληση' }));
    expect(api.inviteMember).not.toHaveBeenCalled();
  });

  it('shows already_member', async () => {
    renderCard({ inviteMember: vi.fn(() => fail<string>({ code: 'already_member' })) });
    await screen.findByLabelText('Μπαρ');
    type('Όνομα', 'Νίκος');
    type('Email', 'm@test.gr');
    fireEvent.click(screen.getByRole('button', { name: 'Πρόσκληση' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ήδη πρόσβαση');
  });

  it('removes a member after confirmation', async () => {
    const api = renderCard({ listMembers: vi.fn(() => ok([member()])) });
    const row = (await screen.findByText('Νίκος')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Αφαίρεση' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Αφαίρεση του/της Νίκος; Χάνει αμέσως την πρόσβαση σε αυτό το κατάστημα.')).toBeTruthy();
    expect(api.removeMember).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Αφαίρεση' }));
    });
    expect(api.removeMember).toHaveBeenCalledWith('m1');
  });

  it('changes a role', async () => {
    const api = renderCard({ listMembers: vi.fn(() => ok([member()])) });
    await screen.findByText('Νίκος');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Αλλαγή ρόλου'), { target: { value: 'accountant' } });
    });
    expect(api.setMemberRole).toHaveBeenCalledWith('m1', 'accountant');
  });

  it('issues a new link for a pending or expired invite', async () => {
    const api = renderCard({ listMembers: vi.fn(() => ok([member({ status: 'expired', acceptedAt: null })])) });
    await screen.findByText('Νίκος');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Νέος σύνδεσμος' }));
    });
    expect(api.reissueInvite).toHaveBeenCalledWith('m1');
    expect(await screen.findByRole('button', { name: 'Αντιγραφή συνδέσμου' })).toBeTruthy();
  });
});
