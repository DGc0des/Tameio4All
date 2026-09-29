// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffRow } from '../../../src/data/remote/ownerApi';
import { OwnerStaffScreen } from '../../../src/features/owner/OwnerStaffScreen';
import { fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date('2026-09-29T10:00:00Z');
const maria: StaffRow = { id: 'm', name: 'ΜΑΡΙΑ', active: true, lockedUntil: null };
const type = (label: string, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });

describe('OwnerStaffScreen', () => {
  it('adds a staff member with a 4-digit PIN and reloads', async () => {
    const listStaff = vi.fn().mockReturnValueOnce(ok([])).mockReturnValue(ok([maria]));
    const api = fakeApi({ listStaff });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    await screen.findByText(/Δεν υπάρχει ακόμα προσωπικό/);
    type('Όνομα νέου ατόμου', ' ΜΑΡΙΑ ');
    type('PIN νέου ατόμου', '12a4');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(screen.getByRole('alert').textContent).toContain('4 ψηφία');
    type('PIN νέου ατόμου', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(await screen.findByRole('group', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
    expect(api.createStaff).toHaveBeenCalledWith(SHOP, 'ΜΑΡΙΑ', '1234');
    expect((screen.getByLabelText('PIN νέου ατόμου') as HTMLInputElement).value).toBe('');
  });

  it('shows a lock and unlocks without changing the PIN', async () => {
    const locked = { ...maria, lockedUntil: '2026-09-29T10:10:00Z' };
    const listStaff = vi.fn().mockReturnValueOnce(ok([locked])).mockReturnValue(ok([maria]));
    const api = fakeApi({ listStaff });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    const row = await screen.findByRole('group', { name: 'ΜΑΡΙΑ' });
    expect(row.textContent).toContain('Κλειδωμένος έως');
    fireEvent.click(within(row).getByRole('button', { name: 'Ξεκλείδωμα' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'ΜΑΡΙΑ' }).textContent).not.toContain('Κλειδωμένος'));
    expect(api.unlockStaff).toHaveBeenCalledWith('m');
  });

  it('changes a PIN, renames, and deactivates', async () => {
    const api = fakeApi({ listStaff: vi.fn(() => ok([maria])) });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    const row = await screen.findByRole('group', { name: 'ΜΑΡΙΑ' });
    fireEvent.click(within(row).getByRole('button', { name: 'Αλλαγή PIN' }));
    type('Νέο PIN ΜΑΡΙΑ', '9876', row);
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση PIN' }));
    await waitFor(() => expect(api.setStaffPin).toHaveBeenCalledWith('m', '9876'));
    fireEvent.click(within(row).getByRole('button', { name: 'Μετονομασία' }));
    type('Νέο όνομα ΜΑΡΙΑ', 'ΜΑΡΙΑ Κ.', row);
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    await waitFor(() => expect(api.updateStaff).toHaveBeenCalledWith('m', { name: 'ΜΑΡΙΑ Κ.' }));
    fireEvent.click(within(row).getByLabelText('Ενεργός'));
    await waitFor(() => expect(api.updateStaff).toHaveBeenCalledWith('m', { active: false }));
  });

  it('network failure: busy clears, message shows, the button works again', async () => {
    const createStaff = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValue(ok('x'));
    const api = fakeApi({ createStaff });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    await screen.findByText(/Δεν υπάρχει ακόμα προσωπικό/);
    type('Όνομα νέου ατόμου', 'ΝΙΚΟΣ');
    type('PIN νέου ατόμου', '5555');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    const add = screen.getByRole('button', { name: 'Προσθήκη' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(createStaff).toHaveBeenCalledTimes(2));
  });

  it('shows the duplicate-name error from the server', async () => {
    const api = fakeApi({ createStaff: vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'staff_name_taken' as const } })) });
    render(<OwnerStaffScreen api={api} shopId={SHOP} now={NOW} />);
    await screen.findByText(/Δεν υπάρχει ακόμα προσωπικό/);
    type('Όνομα νέου ατόμου', 'ΜΑΡΙΑ');
    type('PIN νέου ατόμου', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Υπάρχει ήδη');
  });
});
