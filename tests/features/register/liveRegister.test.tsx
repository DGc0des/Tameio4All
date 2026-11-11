// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEntryMode, loadPending, savePending, saveSnapshot } from '../../../src/data/local/openClosing';
import { memoryStore, type KeyValueStore } from '../../../src/data/local/storage';
import type { DResult, DeviceApi, DeviceContext, StaffSession } from '../../../src/data/remote/deviceApi';
import type { FieldAck, Snapshot } from '../../../src/features/register/live/fields';
import { PhoneApp } from '../../../src/features/phone/PhoneApp';
import { CHANGED_SINCE_SUBMIT } from '../../../src/features/register/messages';
import { RegisterScreen } from '../../../src/features/register/RegisterScreen';
import { FAKE_CONFIG_ID, FAKE_SHOP_ID, fail, fakeDeviceApi, fakeLive, fakeServer, ok, type FakeServer } from '../phone/fakeDeviceApi';

afterEach(cleanup);

const CTX: DeviceContext = { shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: null, businessDate: '2026-11-07' };
const MARIA: StaffSession = { token: 'token-1', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: FAKE_SHOP_ID };
const NIKOS: StaffSession = { token: 'token-2', staffId: 'staff-nikos', name: 'ΝΙΚΟΣ', businessDate: '2026-11-07', shopId: FAKE_SHOP_ID };

let n = 0;
const newId = () => `id-${++n}`;

interface Phone {
  api: DeviceApi;
  store: KeyValueStore;
  q: ReturnType<typeof within>;
  container: HTMLElement;
  onServerError: ReturnType<typeof vi.fn>;
}

function phone(server: FakeServer, session: StaffSession, store: KeyValueStore = memoryStore(), overrides: Partial<DeviceApi> = {}): Phone {
  const api = fakeDeviceApi(overrides, server);
  const onServerError = vi.fn();
  const { container } = render(
    <RegisterScreen
      ctx={CTX}
      session={session}
      api={api}
      store={store}
      now={() => new Date(2026, 10, 7, 22, 0)}
      newId={newId}
      share={vi.fn(async () => 'shared' as const)}
      themePref="system"
      active
      offline={false}
      onTheme={vi.fn()}
      onOwner={vi.fn()}
      onSignOut={vi.fn()}
      onServerError={onServerError}
    />,
  );
  return { api, store, q: within(container), container, onServerError };
}

/** Presence pills' full text (visible name + screen-reader prefix). */
const tags = (el: HTMLElement) => [...el.querySelectorAll('.presence')].map((t) => t.textContent);

/** Lets fake writes, broadcasts and presence (microtasks) land. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function twoPhones() {
  const server = fakeServer();
  const a = phone(server, MARIA);
  const b = phone(server, NIKOS);
  await settle();
  return { server, a, b };
}

const field = (p: Phone, label: string) => p.q.getByLabelText(label) as HTMLInputElement;
/** Types into a box and leaves it (blur flushes the write). */
const typeAndLeave = (p: Phone, label: string, value: string) => {
  fireEvent.focus(field(p, label));
  fireEvent.change(field(p, label), { target: { value } });
  fireEvent.blur(field(p, label));
};
const barSubmit = (p: Phone) => p.q.getByRole('button', { name: 'Υποβολή' }) as HTMLButtonElement;
const dialog = () => screen.getByRole('dialog');
const tapSheetSubmit = () =>
  act(async () => {
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Υποβολή' }));
  });

describe('phones on the shared live closing', () => {
  it('typing on A appears on B', async () => {
    const { a, b } = await twoPhones();
    typeAndLeave(a, '100€', '500');
    await settle();
    expect(field(b, '100€').value).toBe('500');
    expect(a.api.setField).toHaveBeenCalledWith('token-1', '2026-11-07', 'd:10000', { text: '500', mode: 'amount' }, null);
  });

  it('a mode switch on A changes only A’s view; both derive the same money (Review Focus 4)', async () => {
    const { a, b } = await twoPhones();
    fireEvent.click(a.q.getByRole('button', { name: '# Κομμάτια' }));
    typeAndLeave(a, '100€', '3');
    await settle();
    expect(field(a, '100€').value).toBe('3');
    expect(field(b, '100€').value).toBe('300');
    expect(b.q.getByRole('button', { name: '€ Ποσό' }).getAttribute('aria-pressed')).toBe('true');
    expect(a.q.getByRole('region', { name: 'Χαρτονομίσματα' }).textContent).toContain('300,00€');
    expect(b.q.getByRole('region', { name: 'Χαρτονομίσματα' }).textContent).toContain('300,00€');
    // The mode is this phone's preference, per shop.
    expect(loadEntryMode(a.store, FAKE_SHOP_ID)).toBe('count');
    expect(loadEntryMode(b.store, FAKE_SHOP_ID)).toBe('amount');
  });

  it('an unconvertible amount shows as typed with the error in the other mode', async () => {
    const { a, b } = await twoPhones();
    fireEvent.click(b.q.getByRole('button', { name: '# Κομμάτια' }));
    typeAndLeave(a, '100€', '30');
    await settle();
    expect(field(b, '100€').value).toBe('30');
    expect(field(b, '100€').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a presence tag on B while A is in a box', async () => {
    const { a, b } = await twoPhones();
    fireEvent.focus(field(a, '50€'));
    await settle();
    const row = field(b, '50€').closest('.row') as HTMLElement;
    // Visible name, read out as «Επεξεργάζεται: ΜΑΡΙΑ».
    expect(tags(row)).toEqual(['Επεξεργάζεται: ΜΑΡΙΑ']);
    expect(within(row).getByText('ΜΑΡΙΑ')).toBeTruthy();
    expect(tags(b.container)).toHaveLength(1);
    // Never on the phone's own view.
    expect(tags(a.container)).toEqual([]);
    fireEvent.blur(field(a, '50€'));
    await settle();
    expect(tags(b.container)).toEqual([]);
  });

  it('Υποβολή waits while an edit is not saved yet', async () => {
    const { a } = await twoPhones();
    fireEvent.change(field(a, '100€'), { target: { value: '500' } });
    expect(barSubmit(a).disabled).toBe(true);
    expect(a.q.getByText('Περιμένει αποθήκευση…')).toBeTruthy();
    fireEvent.blur(field(a, '100€'));
    await settle();
    expect(barSubmit(a).disabled).toBe(false);
  });

  it('an expense line is written as its own fields; removing it marks it removed', async () => {
    const { server, a, b } = await twoPhones();
    fireEvent.click(a.q.getByRole('button', { name: '+ Έξοδο' }));
    typeAndLeave(a, 'Περιγραφή εξόδου 1', 'Nice');
    typeAndLeave(a, 'Ποσό εξόδου 1', '12,50');
    await settle();
    const id = Object.keys(server.fields).find((k) => /^e:[^:]+$/.test(k))!;
    expect(server.fields[id]!.value).toEqual({ addedBy: { kind: 'staff', id: 'staff-maria' }, removed: false, order: new Date(2026, 10, 7, 22, 0).getTime() });
    expect(server.fields[`${id}:a`]!.value).toEqual({ text: '12.50' });
    expect(field(b, 'Περιγραφή εξόδου 1').value).toBe('Nice');
    fireEvent.click(b.q.getByRole('button', { name: 'Αφαίρεση εξόδου 1' }));
    await settle();
    expect(server.fields[id]!.value).toEqual({ addedBy: { kind: 'staff', id: 'staff-maria' }, removed: true, order: new Date(2026, 10, 7, 22, 0).getTime() });
    expect(a.q.queryByLabelText('Ποσό εξόδου 1')).toBeNull();
  });

  it('a change on B after A opened the sheet: draft_changed → resync, ask again, new key (Review Focus 3)', async () => {
    const { server, a, b } = await twoPhones();
    typeAndLeave(a, '100€', '500');
    await settle();
    fireEvent.click(barSubmit(a));
    typeAndLeave(b, '50€', '100');
    await settle();
    await tapSheetSubmit();
    expect(within(dialog()).getByRole('alert').textContent).toBe('Κάποιος άλλαξε κάτι — έλεγξε και πάτα ξανά Υποβολή');
    await settle();
    // The sheet now shows the server's closing (B's 100€ included).
    expect(dialog().textContent).toContain('600,00€');
    await tapSheetSubmit();
    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' })).toBeTruthy();
    const calls = vi.mocked(a.api.submit).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![4]).toBe(1);
    expect(calls[1]![4]).toBe(server.revision);
    expect(calls[1]![3].counts).toEqual({ '10000': 5, '5000': 2 });
    expect(calls[1]![5]).not.toBe(calls[0]![5]);
    expect(a.onServerError).not.toHaveBeenCalled();
  });

  it('after A submits, both phones show «Υποβλήθηκε HH:MM · name» and stay editable', async () => {
    const { a, b } = await twoPhones();
    typeAndLeave(a, '100€', '500');
    await settle();
    fireEvent.click(barSubmit(a));
    await tapSheetSubmit();
    await settle();
    expect(a.q.getByText('Υποβλήθηκε 21:42 · ΜΑΡΙΑ')).toBeTruthy();
    expect(b.q.getByText('Υποβλήθηκε 21:42 · ΜΑΡΙΑ')).toBeTruthy();
    expect(vi.mocked(a.api.submit).mock.calls[0]![4]).toBe(1);
    expect(a.q.queryByText(CHANGED_SINCE_SUBMIT)).toBeNull();
    typeAndLeave(b, '100€', '600');
    await settle();
    expect(field(b, '100€').value).toBe('600');
  });

  it('a change after the submit shows «Άλλαξε μετά την υποβολή» on both phones until the next submit', async () => {
    const { a, b } = await twoPhones();
    typeAndLeave(a, '100€', '500');
    await settle();
    fireEvent.click(barSubmit(a));
    await tapSheetSubmit();
    await settle();
    fireEvent.click(within(dialog()).getAllByRole('button', { name: 'Κλείσιμο' })[0]!);
    expect(a.q.queryByText(CHANGED_SINCE_SUBMIT)).toBeNull();
    typeAndLeave(b, '100€', '600');
    await settle();
    expect(a.q.getByText(CHANGED_SINCE_SUBMIT)).toBeTruthy();
    expect(b.q.getByText(CHANGED_SINCE_SUBMIT)).toBeTruthy();
    fireEvent.click(barSubmit(b));
    await tapSheetSubmit();
    await settle();
    expect(a.q.queryByText(CHANGED_SINCE_SUBMIT)).toBeNull();
    expect(b.q.queryByText(CHANGED_SINCE_SUBMIT)).toBeNull();
  });

  it('an edit queued for a past business day is dropped with the day-change toast', async () => {
    const store = memoryStore();
    savePending(store, FAKE_SHOP_ID, 'staff-maria', [
      { author: 'staff-maria', key: 'd:10000', value: { text: '900', mode: 'amount' }, businessDate: '2026-11-06', baseVersion: 0, queuedOffline: true, seq: 1 },
    ]);
    const server = fakeServer();
    const p = phone(server, MARIA, store);
    await settle();
    expect(p.q.getByRole('status').textContent).toBe('Η ημέρα άλλαξε — οι αλλαγές εκτός σύνδεσης δεν αποθηκεύτηκαν');
    expect(field(p, '100€').value).toBe('');
    expect(p.api.setField).not.toHaveBeenCalled();
  });

  it('an invalid config in the snapshot shows the config message, never a crash', async () => {
    const server = fakeServer({ config: { schema: 99 } });
    const p = phone(server, MARIA);
    await settle();
    expect(p.q.getByText('Οι ρυθμίσεις του καταστήματος δεν είναι έγκυρες')).toBeTruthy();
    expect(p.q.queryByLabelText('100€')).toBeNull();
  });

  it('under StrictMode holds one channel and edits still sync', async () => {
    const server = fakeServer();
    const api = fakeDeviceApi({}, server);
    const { container } = render(
      <StrictMode>
        <RegisterScreen
          ctx={CTX} session={MARIA} api={api} store={memoryStore()} now={() => new Date(2026, 10, 7, 22, 0)} newId={newId}
          share={vi.fn(async () => 'shared' as const)} themePref="system" active offline={false}
          onTheme={vi.fn()} onOwner={vi.fn()} onSignOut={vi.fn()} onServerError={vi.fn()}
        />
      </StrictMode>,
    );
    await settle();
    expect(server.openChannels()).toBe(1);
    const p: Phone = { api, store: memoryStore(), q: within(container), container, onServerError: vi.fn() };
    typeAndLeave(p, '100€', '200');
    await settle();
    expect(server.fields['d:10000']?.value).toEqual({ text: '200', mode: 'amount' });
  });

  it('closes its channel when it unmounts', async () => {
    const { server } = await twoPhones();
    expect(server.openChannels()).toBe(2);
    cleanup();
    expect(server.openChannels()).toBe(0);
  });
});

describe('after a failure the gate does not take over', () => {
  it('a failed first load shows the error and «Δοκίμασε ξανά»; the retry opens the register', async () => {
    const server = fakeServer();
    const getOpenClosing = vi.fn<DeviceApi['getOpenClosing']>(() => fail({ code: 'unknown', detail: '500' }));
    const p = phone(server, MARIA, memoryStore(), { getOpenClosing });
    await settle();
    expect(p.q.getByRole('alert').textContent).toContain('Κάτι πήγε στραβά.');
    expect(p.onServerError).toHaveBeenCalledWith({ code: 'unknown', detail: '500' });
    expect(p.q.queryByText('Το ταμείο θα φορτώσει μόλις υπάρξει σύνδεση.')).toBeNull();
    expect(p.q.queryByLabelText('100€')).toBeNull();
    getOpenClosing.mockImplementation(() => ok(server.snapshot()));
    fireEvent.click(p.q.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    await settle();
    expect(p.q.getByLabelText('100€')).toBeTruthy();
    expect(p.q.queryByRole('alert')).toBeNull();
    expect(server.openChannels()).toBe(1);
  });

  it('a write stopped mid-session blocks Υποβολή with «Δεν αποθηκεύεται»; the retry sends the queued edit', async () => {
    const server = fakeServer();
    const setField = vi.fn<DeviceApi['setField']>(() => fail({ code: 'unknown', detail: '503' }));
    const p = phone(server, MARIA, memoryStore(), { setField });
    await settle();
    typeAndLeave(p, '100€', '800');
    await settle();
    expect(p.q.getByRole('alert').textContent).toContain('Κάτι πήγε στραβά.');
    expect(barSubmit(p).disabled).toBe(true);
    expect(p.q.getByText('Δεν αποθηκεύεται — δοκίμασε ξανά')).toBeTruthy();
    expect(p.q.queryByText('Χρειάζεται σύνδεση για υποβολή')).toBeNull();
    setField.mockImplementation((...a) => server.setField(...a));
    fireEvent.click(p.q.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    await settle();
    expect(server.fields['d:10000']?.value).toEqual({ text: '800', mode: 'amount' });
    expect(field(p, '100€').value).toBe('800');
    expect(barSubmit(p).disabled).toBe(false);
    expect(server.openChannels()).toBe(1);
  });

  it('M2: online, a cached snapshot of another day shows no boxes until today\'s load arrives', async () => {
    const store = memoryStore();
    const server = fakeServer();
    saveSnapshot(store, FAKE_SHOP_ID, { ...server.snapshot(), id: 'oc-0', businessDate: '2026-11-06' });
    let answer!: (r: DResult<Snapshot>) => void;
    const getOpenClosing = vi.fn(() => new Promise<DResult<Snapshot>>((r) => { answer = r; }));
    const p = phone(server, MARIA, store, { getOpenClosing });
    await settle();
    expect(p.q.queryByLabelText('100€')).toBeNull();
    expect(p.q.getByText('Φόρτωση…')).toBeTruthy();
    await act(async () => { answer({ ok: true, data: server.snapshot() }); });
    await settle();
    expect(field(p, '100€')).toBeTruthy();
  });

  it("I1: another cashier's unsent edits on this phone are never sent as the signed-in one", async () => {
    const store = memoryStore();
    const server = fakeServer();
    savePending(store, FAKE_SHOP_ID, 'staff-maria', [
      { author: 'staff-maria', key: 'c:wolt', value: { text: '50' }, businessDate: '2026-11-07', baseVersion: 0, queuedOffline: true, seq: 1 },
    ]);
    const b = phone(server, NIKOS, store);
    await settle();
    expect(b.api.setField).not.toHaveBeenCalled();
    expect(field(b, 'WOLT').value).toBe('');
    expect(loadPending(store, FAKE_SHOP_ID, 'staff-maria')).toHaveLength(1);
    // ΝΙΚΟΣ's own edits go as him; Μαρία's stay stored.
    typeAndLeave(b, 'WOLT', '7');
    await settle();
    expect(vi.mocked(b.api.setField).mock.calls.map((c) => [c[0], c[3]])).toEqual([['token-2', { text: '7' }]]);
    expect(loadPending(store, FAKE_SHOP_ID, 'staff-maria')).toHaveLength(1);
  });

  it('I1: sign-out waits for the queued edit to be acknowledged before ending the session', async () => {
    const server = fakeServer();
    let ack!: () => void;
    const setField = vi.fn<DeviceApi['setField']>((...a) =>
      new Promise<DResult<FieldAck>>((resolve) => { ack = () => void server.setField(...a).then(resolve); }),
    );
    const onSignOut = vi.fn();
    const api = fakeDeviceApi({ setField }, server);
    const { container } = render(
      <RegisterScreen ctx={CTX} session={MARIA} api={api} store={memoryStore()} now={() => new Date(2026, 10, 7, 22, 0)} newId={newId}
        share={vi.fn(async () => 'shared' as const)} themePref="system" active offline={false} onTheme={vi.fn()} onOwner={vi.fn()}
        onSignOut={onSignOut} onServerError={vi.fn()} />,
    );
    const p = { api, store: memoryStore(), q: within(container), container, onServerError: vi.fn() };
    await settle();
    fireEvent.focus(field(p, 'WOLT'));
    fireEvent.change(field(p, 'WOLT'), { target: { value: '9' } }); // still typing: not sent yet
    fireEvent.click(p.q.getByRole('button', { name: /ΜΑΡΙΑ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Αλλαγή ατόμου' }));
    await settle();
    expect(setField).toHaveBeenCalledTimes(1); // the sign-out flushed it
    expect(api.signOut).not.toHaveBeenCalled();
    await act(async () => { ack(); });
    await settle();
    expect(api.signOut).toHaveBeenCalledWith('token-1');
    expect(vi.mocked(api.signOut).mock.invocationCallOrder[0]!).toBeGreaterThan(setField.mock.invocationCallOrder[0]!);
    expect(onSignOut).toHaveBeenCalled();
    expect(server.fields['c:wolt']?.updatedByName).toBe('ΜΑΡΙΑ');
  });

  it('while connecting, Υποβολή says «Σύνδεση…»', async () => {
    const server = fakeServer();
    // A channel that never reaches live.
    const p = phone(server, MARIA, memoryStore(), { live: vi.fn((_s, _m, h) => fakeLive(h)) });
    await settle();
    expect(barSubmit(p).disabled).toBe(true);
    expect(p.q.getByText('Σύνδεση…')).toBeTruthy();
  });
});

describe('a signed-out phone', () => {
  it('opens no live channel and loads no closing', async () => {
    const api = fakeDeviceApi();
    render(
      <PhoneApp
        api={api}
        store={memoryStore()}
        now={() => new Date(2026, 10, 7, 22, 0)}
        newId={newId}
        share={vi.fn(async () => 'shared' as const)}
        themePref="system"
        active
        onTheme={vi.fn()}
        onOwner={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    await settle();
    expect(api.live).not.toHaveBeenCalled();
    expect(api.getOpenClosing).not.toHaveBeenCalled();
  });
});
