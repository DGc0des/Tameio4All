// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRow } from '../../../src/data/remote/ownerApi';
import { DevicesScreen } from '../../../src/features/owner/DevicesScreen';
import { fakeApi, ok } from './fakeApi';

const SHOP = '11111111-1111-4111-8111-111111111111';
let nowMs = Date.parse('2026-09-29T10:00:00Z');
const now = () => new Date(nowMs);
const phone: DeviceRow = { userId: 'u1', label: 'Ταμείο 1', createdAt: '2026-09-20T08:00:00Z', lastSeenAt: null, lastStaffName: null };

beforeEach(() => {
  // Only the countdown's own setInterval is faked; RTL's internal waitFor/findBy timers stay real,
  // so the pairing-code promise's resolution can never race with a manual clock advance.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  nowMs = Date.parse('2026-09-29T10:00:00Z');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DevicesScreen', () => {
  it('lists devices and removes one after confirmation', async () => {
    const listDevices = vi.fn().mockReturnValueOnce(ok([phone])).mockReturnValue(ok([]));
    const api = fakeApi({ listDevices });
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Αφαίρεση' }));
    const dialog = screen.getByRole('dialog', { name: 'Αφαίρεση συσκευής' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Αφαίρεση' }));
    await waitFor(() => expect(api.removeDevice).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Ταμείο 1' })).toBeNull());
  });

  it('renames a device within 60 characters', async () => {
    const api = fakeApi({ listDevices: vi.fn(() => ok([phone])) });
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Μετονομασία' }));
    fireEvent.change(within(row).getByLabelText('Νέο όνομα συσκευής'), { target: { value: 'x'.repeat(61) } });
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    expect(within(row).getByRole('alert').textContent).toContain('60');
    fireEvent.change(within(row).getByLabelText('Νέο όνομα συσκευής'), { target: { value: 'Ταμείο μπαρ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Αποθήκευση ονόματος' }));
    await waitFor(() => expect(api.renameDevice).toHaveBeenCalledWith('u1', 'Ταμείο μπαρ'));
  });

  it('cancels a device rename back to the choices view', async () => {
    const api = fakeApi({ listDevices: vi.fn(() => ok([phone])) });
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Μετονομασία' }));
    fireEvent.change(within(row).getByLabelText('Νέο όνομα συσκευής'), { target: { value: 'x' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Άκυρο' }));
    expect(within(row).queryByLabelText('Νέο όνομα συσκευής')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Μετονομασία' })).toBeTruthy();
    expect(api.renameDevice).not.toHaveBeenCalled();
  });
});
