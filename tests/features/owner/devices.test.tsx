// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRow } from '../../../src/data/remote/ownerApi';
import { DevicesScreen } from '../../../src/features/owner/DevicesScreen';
import { QrCode } from '../../../src/features/owner/QrCode';
import { fail, fakeApi, ok } from './fakeApi';

const SHOP = '11111111-1111-4111-8111-111111111111';
const phone: DeviceRow = { userId: 'u1', label: 'Ταμείο 1', createdAt: '2026-09-20T08:00:00Z', lastSeenAt: null, lastStaffName: null };

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

const card = () => screen.findByRole('region', { name: 'Είσοδος στο κατάστημα' });

describe('StoreLinkCard', () => {
  it('shows the store code and its QR', async () => {
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    expect(await within(c).findByText('ABCD-EFGH-JKLM-NPQR')).toBeTruthy();
    expect(within(c).getByRole('img', { name: 'QR εισόδου στο κατάστημα' })).toBeTruthy();
    expect(within(c).getByText(/σκανάρει το QR ή ανοίγει τον σύνδεσμο/)).toBeTruthy();
  });

  it('copies the link, then says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setNavigator('clipboard', { writeText });
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    await act(async () => {
      fireEvent.click(within(c).getByRole('button', { name: 'Αντιγραφή συνδέσμου' }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toMatch(/#\/join\/ABCDEFGHJKLMNPQR$/);
    expect(within(c).getByRole('button', { name: 'Αντιγράφηκε' })).toBeTruthy();
  });

  it('shows the link in a field when the clipboard rejects', async () => {
    setNavigator('clipboard', { writeText: vi.fn(() => Promise.reject(new Error('denied'))) });
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    await act(async () => {
      fireEvent.click(within(c).getByRole('button', { name: 'Αντιγραφή συνδέσμου' }));
    });
    const input = within(c).getByLabelText<HTMLInputElement>('Σύνδεσμος καταστήματος');
    expect(input.value).toMatch(/#\/join\/ABCDEFGHJKLMNPQR$/);
    expect(input.readOnly).toBe(true);
  });

  it('shows the link in a field when there is no clipboard', async () => {
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    await act(async () => {
      fireEvent.click(within(c).getByRole('button', { name: 'Αντιγραφή συνδέσμου' }));
    });
    expect(within(c).getByLabelText<HTMLInputElement>('Σύνδεσμος καταστήματος').value).toMatch(/#\/join\/ABCDEFGHJKLMNPQR$/);
  });

  it('offers «Κοινοποίηση» only where navigator.share exists, and ignores a cancelled share', async () => {
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    expect(within(c).queryByRole('button', { name: 'Κοινοποίηση' })).toBeNull();
    cleanup();

    const share = vi.fn(() => Promise.reject(new DOMException('cancel', 'AbortError')));
    setNavigator('share', share);
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c2 = await card();
    await within(c2).findByText('ABCD-EFGH-JKLM-NPQR');
    await act(async () => {
      fireEvent.click(within(c2).getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(share).toHaveBeenCalledWith({ title: 'Κάφε', url: expect.stringMatching(/#\/join\/ABCDEFGHJKLMNPQR$/) as unknown as string });
    expect(within(c2).queryByRole('alert')).toBeNull();
  });

  it('prints a card with the shop name, the QR and the code', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    fireEvent.click(within(c).getByRole('button', { name: 'Εκτύπωση' }));
    expect(print).toHaveBeenCalledTimes(1);
    const printed = document.body.querySelector(':scope > .print-only');
    expect(printed).not.toBeNull();
    expect(printed?.querySelector('h1')?.textContent).toBe('Κάφε');
    expect(printed?.querySelector('svg')).not.toBeNull();
    expect(printed?.textContent).toContain('ABCD-EFGH-JKLM-NPQR');
    expect(printed?.textContent).toContain('Σκάναρε για να μπεις στο ταμείο. Μετά: όνομα και PIN.');
  });

  it('replaces the link after confirmation, once, and reloads the devices', async () => {
    const api = fakeApi();
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    await waitFor(() => expect(api.listDevices).toHaveBeenCalledTimes(1));

    fireEvent.click(within(c).getByRole('button', { name: 'Νέος σύνδεσμος' }));
    let dialog = screen.getByRole('dialog', { name: 'Νέος σύνδεσμος' });
    expect(dialog.textContent).toContain('Ο παλιός σύνδεσμος και το QR θα πάψουν να ισχύουν.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.rotateJoinKey).not.toHaveBeenCalled();

    fireEvent.click(within(c).getByRole('button', { name: 'Νέος σύνδεσμος' }));
    dialog = screen.getByRole('dialog', { name: 'Νέος σύνδεσμος' });
    const confirm = within(dialog).getByRole('button', { name: 'Νέος σύνδεσμος' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(api.rotateJoinKey).toHaveBeenCalledTimes(1);
    expect(api.rotateJoinKey).toHaveBeenCalledWith(SHOP);
    expect(await within(c).findByText('STUV-WXYZ-2345-6789')).toBeTruthy();
    await waitFor(() => expect(api.listDevices).toHaveBeenCalledTimes(2));
  });

  it('keeps the old key and shows the error when the replacement fails', async () => {
    const api = fakeApi({ rotateJoinKey: vi.fn(() => fail<string>({ code: 'network' })) });
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    await within(c).findByText('ABCD-EFGH-JKLM-NPQR');
    fireEvent.click(within(c).getByRole('button', { name: 'Νέος σύνδεσμος' }));
    const dialog = screen.getByRole('dialog', { name: 'Νέος σύνδεσμος' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Νέος σύνδεσμος' }));
    });
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Νέος σύνδεσμος' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(c).getByText('ABCD-EFGH-JKLM-NPQR')).toBeTruthy();
    expect(api.listDevices).toHaveBeenCalledTimes(1);
  });

  it('shows a key load error with «Ξανά», and the device list still renders', async () => {
    const joinKey = vi.fn().mockReturnValueOnce(fail<string>({ code: 'network' })).mockReturnValue(ok('ABCDEFGHJKLMNPQR'));
    const api = fakeApi({ joinKey, listDevices: vi.fn(() => ok([phone])) });
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const c = await card();
    expect(await within(c).findByRole('alert')).toBeTruthy();
    expect(await screen.findByRole('group', { name: 'Ταμείο 1' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(c).getByRole('button', { name: 'Ξανά' }));
    });
    expect(await within(c).findByText('ABCD-EFGH-JKLM-NPQR')).toBeTruthy();
  });
});

describe('device list', () => {
  it('shows last use and the last cashier, or that the device was never used', async () => {
    const used: DeviceRow = { ...phone, userId: 'u2', label: 'Ταμείο 2', lastSeenAt: '2026-11-10T18:00:00Z', lastStaffName: 'ΜΑΡΙΑ' };
    const nameless: DeviceRow = { ...phone, userId: 'u3', label: '', lastSeenAt: '2026-11-09T18:00:00Z', lastStaffName: null };
    render(<DevicesScreen api={fakeApi({ listDevices: vi.fn(() => ok([used, phone, nameless])) })} shopId={SHOP} shopName="Κάφε" />);
    expect((await screen.findByRole('group', { name: 'Ταμείο 2' })).textContent).toContain('Τελευταία χρήση 10/11/2026 · ΜΑΡΙΑ');
    expect(screen.getByRole('group', { name: 'Ταμείο 1' }).textContent).toContain('Δεν χρησιμοποιήθηκε ακόμα');
    const n = screen.getByRole('group', { name: 'Χωρίς όνομα' });
    expect(n.textContent).toContain('Τελευταία χρήση 09/11/2026');
    expect(n.textContent).not.toContain('·');
    expect(screen.queryByText(/Ανάκληση|Ενεργή|Ανακλήθηκε/)).toBeNull();
  });

  it('says so when there are no devices', async () => {
    render(<DevicesScreen api={fakeApi()} shopId={SHOP} shopName="Κάφε" />);
    expect(await screen.findByText('Καμία συσκευή στο κατάστημα.')).toBeTruthy();
  });

  it('removes a device after confirmation and reloads', async () => {
    const listDevices = vi.fn().mockReturnValueOnce(ok([phone])).mockReturnValue(ok([]));
    const api = fakeApi({ listDevices });
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Αφαίρεση' }));
    const dialog = screen.getByRole('dialog', { name: 'Αφαίρεση συσκευής' });
    expect(dialog.textContent).toContain('Η συσκευή «Ταμείο 1» θα φύγει από τη λίστα');
    expect(dialog.textContent).toContain('απενεργοποίησε τον υπάλληλο ή φτιάξε νέο σύνδεσμο.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Αφαίρεση' }));
    await waitFor(() => expect(api.removeDevice).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText('Καμία συσκευή στο κατάστημα.')).toBeTruthy();
    expect(listDevices).toHaveBeenCalledTimes(2);
  });

  it('cancelling the removal calls nothing', async () => {
    const api = fakeApi({ listDevices: vi.fn(() => ok([phone])) });
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Αφαίρεση' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Αφαίρεση συσκευής' })).getByRole('button', { name: 'Άκυρο' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.removeDevice).not.toHaveBeenCalled();
  });

  it('a failing removal shows the error and keeps the row', async () => {
    const api = fakeApi({ listDevices: vi.fn(() => ok([phone])), removeDevice: vi.fn(() => fail<void>({ code: 'not_owner' })) });
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Αφαίρεση' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Αφαίρεση συσκευής' })).getByRole('button', { name: 'Αφαίρεση' }));
    });
    expect(await within(row).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Ταμείο 1' })).toBeTruthy();
    expect(api.listDevices).toHaveBeenCalledTimes(1);
  });

  it('renames a device within 60 characters', async () => {
    const api = fakeApi({ listDevices: vi.fn(() => ok([phone])) });
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
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
    render(<DevicesScreen api={api} shopId={SHOP} shopName="Κάφε" />);
    const row = await screen.findByRole('group', { name: 'Ταμείο 1' });
    fireEvent.click(within(row).getByRole('button', { name: 'Μετονομασία' }));
    fireEvent.change(within(row).getByLabelText('Νέο όνομα συσκευής'), { target: { value: 'x' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Άκυρο' }));
    expect(within(row).queryByLabelText('Νέο όνομα συσκευής')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Μετονομασία' })).toBeTruthy();
    expect(api.renameDevice).not.toHaveBeenCalled();
  });
});

describe('QrCode', () => {
  it('draws black modules on white with a 4-module quiet zone', () => {
    render(<QrCode text="https://example.test/#/join/ABCDEFGHJKLMNPQR" label="QR" />);
    const svg = screen.getByRole('img', { name: 'QR' });
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(w).toBe(h);
    // version n has 17 + 4n modules; plus 4 on each side.
    expect(((w ?? 0) - 8 - 17) % 4).toBe(0);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
    const path = svg.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('#000');
    // The top-left finder pattern starts at the quiet zone's edge.
    expect(path?.getAttribute('d')).toMatch(/^M4 4h/);
  });
});
