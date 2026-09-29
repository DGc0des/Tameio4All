// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRow } from '../../../src/data/remote/ownerApi';
import { DevicesScreen } from '../../../src/features/owner/DevicesScreen';
import { fakeApi, ok } from './fakeApi';

const SHOP = '11111111-1111-4111-8111-111111111111';
let nowMs = Date.parse('2026-09-29T10:00:00Z');
const now = () => new Date(nowMs);
const phone: DeviceRow = { userId: 'u1', label: 'Ταμείο 1', createdAt: '2026-09-20T08:00:00Z', revokedAt: null };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  nowMs = Date.parse('2026-09-29T10:00:00Z');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DevicesScreen', () => {
  it('shows a pairing code with a countdown that expires', async () => {
    const api = fakeApi();
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση νέας συσκευής' }));
    expect(await screen.findByText('ABCD-EFGH')).toBeTruthy();
    expect(screen.getByText(/10:00/)).toBeTruthy();
    act(() => {
      nowMs += 61_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(/8:59/)).toBeTruthy();
    act(() => {
      nowMs += 600_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(/Ο κωδικός έληξε/)).toBeTruthy();
    expect(screen.queryByText('ABCD-EFGH')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Νέος κωδικός' }));
    await waitFor(() => expect(api.createPairingCode).toHaveBeenCalledTimes(2));
  });

  it('lists devices and revokes after confirmation', async () => {
    const listDevices = vi.fn().mockReturnValueOnce(ok([phone])).mockReturnValue(ok([{ ...phone, revokedAt: '2026-09-29T10:00:00Z' }]));
    const api = fakeApi({ listDevices });
    render(<DevicesScreen api={api} shopId={SHOP} now={now} />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    expect(row.textContent).toContain('20/09/2026');
    expect(row.textContent).toContain('Ενεργή');
    fireEvent.click(within(row).getByRole('button', { name: 'Ανάκληση' }));
    const dialog = screen.getByRole('dialog', { name: 'Ανάκληση συσκευής' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ανάκληση' }));
    await waitFor(() => expect(api.updateDevice).toHaveBeenCalledWith('u1', { revoke: true }));
    expect((await screen.findByRole('group', { name: 'Ταμείο 1' })).textContent).toContain('Ανακλήθηκε');
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
    await waitFor(() => expect(api.updateDevice).toHaveBeenCalledWith('u1', { label: 'Ταμείο μπαρ' }));
  });
});
