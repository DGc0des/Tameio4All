// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import type { ClosingInputs } from '../../src/core/formula';
import { loadDraft, loadUnsentDraft } from '../../src/data/local/drafts';
import { loadStaffSession, saveCachedContext, saveStaffSession } from '../../src/data/local/phone';
import { memoryStore, shopKey, type KeyValueStore } from '../../src/data/local/storage';
import type { DeviceApi } from '../../src/data/remote/deviceApi';
import type { OwnerAppProps } from '../../src/features/owner/OwnerApp';
import type { ShareFn } from '../../src/features/register/share';
import { joinJuicePreset } from '../../src/core/presets';
import { FAKE_CONFIG_ID, FAKE_SHOP_ID, fail, fakeDeviceApi, ok } from '../features/phone/fakeDeviceApi';

const NOW = () => new Date(2026, 10, 7, 22, 0);
let n = 0;
const newId = () => `id-${++n}`;
const share = vi.fn<ShareFn>(async () => 'shared');

beforeEach(() => {
  n = 0;
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const OwnerStub: ComponentType<Omit<OwnerAppProps, 'api'>> = ({ route, redirect, onRedirectHandled }) => (
  <div>
    <p>
      owner:{route.name}:{redirect?.kind ?? 'none'}
    </p>
    <button type="button" onClick={onRedirectHandled}>
      handle redirect
    </button>
  </div>
);

/** A paired phone with ΜΑΡΙΑ signed in for the fake context's business date. */
function signedIn(store: KeyValueStore): KeyValueStore {
  saveStaffSession(store, { token: 'token-1', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: FAKE_SHOP_ID });
  return store;
}

/** Renders the app and waits until the register is on screen. */
async function start(store: KeyValueStore = memoryStore(), persistent = true, api: DeviceApi = fakeDeviceApi()) {
  render(<App appStore={{ store: signedIn(store), persistent }} deviceApi={api} now={NOW} newId={newId} share={share} ownerArea={OwnerStub} />);
  await screen.findByLabelText('100€');
  return store;
}
const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const barAmount = () => document.querySelector('.bar strong')?.textContent;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const sheetSubmit = () =>
  act(async () => {
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
  });
/** Opens the submit sheet from the bottom bar and taps its Υποβολή. */
async function submitClosing() {
  fireEvent.click(button('Υποβολή'));
  await sheetSubmit();
}
const submitCalls = (api: DeviceApi) => vi.mocked(api.submit).mock.calls;

function typeV2Closing() {
  for (const [label, value] of [
    ['100€', '500'], ['50€', '300'], ['20€', '240'], ['10€', '90'], ['5€', '35'], ['2€', '24'], ['1€', '17'],
    ['50c', '6.5'], ['20c', '3.4'], ['10c', '1.2'], ['5c', '0.45'],
    ['ΚΕΡΜΑΤΑ', '150'], ['WOLT', '45,60'], ['EFOOD', '23.10'], ['myPos', '310.25'], ['Eurobank', '88.40'],
  ] as const) type(label, value);
  fireEvent.click(button('+ Έξοδο'));
  type('Περιγραφή εξόδου 1', 'Nice');
  type('Ποσό εξόδου 1', '12.50');
  fireEvent.click(button('+ Έξοδο'));
  type('Ποσό εξόδου 2', '7,80');
}

describe('register flows', () => {
  it('reproduces a tameioV2 closing end to end (comma decimals included)', async () => {
    await start();
    typeV2Closing();
    expect(barAmount()).toBe('367,55€');
    expect(screen.getByRole('region', { name: 'Σύνοψη' }).textContent).toContain('1.855,20€');
    expect(screen.getByRole('region', { name: 'Έξοδα' }).textContent).toContain('20,30€');
  });

  it('switching € → # converts what was typed and keeps the totals', async () => {
    await start();
    type('100€', '1500');
    fireEvent.click(button('# Κομμάτια'));
    const field = screen.getByLabelText('100€') as HTMLInputElement;
    expect(field.value).toBe('15');
    expect(within(field.closest('.row') as HTMLElement).getByText('1.500,00€')).toBeTruthy();
    expect(barAmount()).toBe('500,00€');
  });

  it('blocks Φάκελος and Υποβολή while a field is wrong, and names it', async () => {
    await start();
    type('10€', '95');
    expect(button('Φάκελος').disabled).toBe(true);
    expect(button('Υποβολή').disabled).toBe(true);
    expect(screen.getByText('Λάθος τιμή: 10€')).toBeTruthy();
  });

  it('flags a Greek thousands separator instead of reading it as 1,50€', async () => {
    await start();
    type('100€', '1.500');
    expect(screen.getByLabelText('100€').getAttribute('aria-invalid')).toBe('true');
    expect(button('Φάκελος').disabled).toBe(true);
  });

  it('opens the exact Φάκελος (60€ as 3×20€)', async () => {
    await start();
    type('50€', '50');
    type('20€', '60');
    type('ΚΕΡΜΑΤΑ', '950');
    fireEvent.click(button('Φάκελος'));
    const sheet = screen.getByRole('dialog', { name: 'Φάκελος' });
    expect(within(sheet).getByText('60,00€ σε 3 κομμάτια')).toBeTruthy();
    expect(within(sheet).getByText('✓ Ακριβές ποσό')).toBeTruthy();
  });

  it('shows the signed-in cashier in the header; «Αλλαγή ατόμου» signs out', async () => {
    const api = fakeDeviceApi();
    const store = await start(memoryStore(), true, api);
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Σαβ 07/11 · ΜΑΡΙΑ' }));
    const sheet = screen.getByRole('dialog', { name: 'ΜΑΡΙΑ' });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Αλλαγή ατόμου' }));
    });
    expect(api.signOut).toHaveBeenCalledWith('token-1');
    expect(await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
    expect(loadStaffSession(store)).toBeNull();
  });

  it('submits once to the server as the signed-in cashier and keeps the draft', async () => {
    const api = fakeDeviceApi();
    const store = await start(memoryStore(), true, api);
    type('100€', '1500');
    fireEvent.click(button('+ Έξοδο'));
    type('Περιγραφή εξόδου 1', 'Ντόντης');
    type('Ποσό εξόδου 1', '24');
    await submitClosing();

    expect(submitCalls(api)).toHaveLength(1);
    const [token, configId, businessDate, inputs, _revision, key] = submitCalls(api)[0]!;
    expect([token, configId, businessDate]).toEqual(['token-1', FAKE_CONFIG_ID, '2026-11-07']);
    expect(inputs).toEqual<ClosingInputs>({
      schema: 2,
      counts: { '10000': 15 },
      channelCents: {},
      expenses: [{ id: 'id-1', description: 'Ντόντης', cents: 2400, addedBy: { kind: 'staff', id: 'staff-maria' } }],
    });
    expect(typeof key).toBe('string');

    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' }).textContent).toContain('1.524,00€');
    expect(screen.getByText('Το κλείσιμο υποβλήθηκε')).toBeTruthy();
    fireEvent.click(button('Τέλος'));
    // The draft is kept: the numbers stay in the fields (and in storage) for a later resubmit.
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('1500');
    expect((screen.getByLabelText('Ποσό εξόδου 1') as HTMLInputElement).value).toBe('24');
    expect(screen.queryByRole('button', { name: 'Νέο κλείσιμο' })).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(loadDraft(store, FAKE_SHOP_ID, '2026-11-07')?.entries['10000']).toEqual({ text: '1500', mode: 'amount' });
  });

  it('retries inside the sheet with the same key; an edited closing gets a new key', async () => {
    const api = fakeDeviceApi({
      submit: vi.fn<DeviceApi['submit']>().mockReturnValueOnce(fail({ code: 'network' })).mockImplementation(() => ok({ closingId: 'c1', repeat: false })),
    });
    await start(memoryStore(), true, api);
    type('100€', '1500');
    await submitClosing();
    expect(screen.getByRole('alert').textContent).toBe('Δεν υπάρχει σύνδεση.');
    await sheetSubmit();
    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' })).toBeTruthy();
    fireEvent.click(button('Τέλος'));

    type('50€', '100');
    await submitClosing();
    const keys = submitCalls(api).map((c) => c[5]);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(submitCalls(api)[1]![3]).toEqual(submitCalls(api)[0]![3]);
  });

  it('reuses the key when the sheet is reopened for an unchanged closing after a failed submit', async () => {
    const api = fakeDeviceApi({
      submit: vi.fn<DeviceApi['submit']>().mockReturnValueOnce(fail({ code: 'network' })).mockImplementation(() => ok({ closingId: 'c1', repeat: true })),
    });
    await start(memoryStore(), true, api);
    type('100€', '1500');
    await submitClosing();
    fireEvent.keyDown(window, { key: 'Escape' });
    await submitClosing();
    const keys = submitCalls(api).map((c) => c[5]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('mints a new key after a successful submit, even for an unchanged closing', async () => {
    const api = fakeDeviceApi();
    await start(memoryStore(), true, api);
    type('100€', '1500');
    await submitClosing();
    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' })).toBeTruthy();
    fireEvent.click(button('Τέλος'));
    await submitClosing();
    const calls = submitCalls(api);
    expect(calls).toHaveLength(2);
    expect(calls[1]![3]).toEqual(calls[0]![3]);
    expect(calls[1]![5]).not.toBe(calls[0]![5]);
  });

  it('an expired session sends the cashier to sign in and keeps the typed draft', async () => {
    const api = fakeDeviceApi({ submit: vi.fn(() => fail<{ closingId: string; repeat: boolean }>({ code: 'session_invalid' })) });
    const store = await start(memoryStore(), true, api);
    type('100€', '1500');
    await submitClosing();
    expect(await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
    expect(loadStaffSession(store)).toBeNull();
    expect(loadDraft(store, FAKE_SHOP_ID, '2026-11-07')?.entries['10000']).toEqual({ text: '1500', mode: 'amount' });
  });

  it('disables Υποβολή while offline', async () => {
    const store = memoryStore();
    saveCachedContext(store, { shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: joinJuicePreset, businessDate: '2026-11-07' });
    await start(store, true, fakeDeviceApi({ context: vi.fn(() => fail<null>({ code: 'network' })) }));
    expect(screen.getByText('Εκτός σύνδεσης')).toBeTruthy();
    type('100€', '1500');
    expect(button('Υποβολή').disabled).toBe(true);
    expect(screen.getByText('Χρειάζεται σύνδεση για υποβολή')).toBeTruthy();
  });

  it('suggests a supplier from the server history and learns a submitted expense', async () => {
    const api = fakeDeviceApi({
      suggestionData: vi
        .fn<DeviceApi['suggestionData']>()
        .mockReturnValueOnce(ok([{ description: 'Nice', cents: 1300, date: '2026-11-06' }]))
        .mockImplementation(() =>
          ok([
            { description: 'Nice', cents: 1300, date: '2026-11-06' },
            { description: 'Ντόντης', cents: 2400, date: '2026-11-07' },
          ]),
        ),
    });
    await start(memoryStore(), true, api);
    fireEvent.click(button('+ Έξοδο'));
    type('Ποσό εξόδου 1', '13');
    expect(await screen.findByRole('button', { name: 'Nice' })).toBeTruthy();

    type('Περιγραφή εξόδου 1', 'Ντόντης');
    type('Ποσό εξόδου 1', '24');
    await submitClosing();
    fireEvent.click(button('Τέλος'));
    fireEvent.click(button('+ Έξοδο'));
    type('Ποσό εξόδου 2', '24');
    expect(await screen.findByRole('button', { name: 'Ντόντης' })).toBeTruthy();
  });
});

describe('persistence and resilience', () => {
  it('restores the draft after a reload', async () => {
    const store = await start();
    // Faked only after the async load: RTL's findBy polling needs the real setTimeout.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    type('100€', '500');
    act(() => {
      vi.advanceTimersByTime(350);
    });
    vi.useRealTimers();
    cleanup();
    await start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('500');
  });

  it('starts fresh when the stored draft is corrupt', async () => {
    const store = memoryStore();
    store.setItem(shopKey(FAKE_SHOP_ID, 'draft'), JSON.stringify({ savedAt: NOW().getTime(), draft: { id: 5 } }));
    await start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
  });

  it('warns when storage is unavailable', async () => {
    await start(memoryStore(), false);
    expect(screen.getByText('Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('the retired #/staff address opens the register', async () => {
    window.location.hash = '#/staff';
    await start();
    expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
    fireEvent.click(button('Μενού'));
    expect(screen.queryByRole('menuitem', { name: 'Προσωπικό' })).toBeNull();
  });

  it('keeps a stored draft from another business date aside and says so once', async () => {
    const store = memoryStore();
    store.setItem(
      shopKey(FAKE_SHOP_ID, 'draft'),
      JSON.stringify({ savedAt: NOW().getTime(), draft: { businessDate: '2026-11-06', entries: { '10000': { text: '500', mode: 'amount' } }, channels: {}, expenses: [] } }),
    );
    await start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText('Η ημέρα άλλαξε πριν υποβληθεί το κλείσιμο της 06/11. Ενημέρωσε τον ιδιοκτήτη.')).toBeTruthy();
    expect(loadUnsentDraft(store, FAKE_SHOP_ID)?.entries['10000']).toEqual({ text: '500', mode: 'amount' });
  });

  it('a day change found at submit reloads; the typed closing is kept aside with the notice', async () => {
    const tomorrow = { shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: joinJuicePreset, businessDate: '2026-11-08' };
    const context = vi
      .fn<DeviceApi['context']>()
      .mockReturnValueOnce(ok({ ...tomorrow, businessDate: '2026-11-07' }))
      .mockReturnValue(ok(tomorrow));
    const api = fakeDeviceApi({
      context,
      submit: vi.fn(() => fail<{ closingId: string; repeat: boolean }>({ code: 'wrong_day' })),
      signIn: vi.fn(() => ok({ token: 'token-2', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-08', shopId: FAKE_SHOP_ID })),
    });
    const store = await start(memoryStore(), true, api);
    type('100€', '1500');
    await submitClosing();
    fireEvent.click(await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' }));
    type('PIN', '1234');
    fireEvent.click(button('Είσοδος'));
    expect(await screen.findByText('Η ημέρα άλλαξε πριν υποβληθεί το κλείσιμο της 07/11. Ενημέρωσε τον ιδιοκτήτη.')).toBeTruthy();
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(loadUnsentDraft(store, FAKE_SHOP_ID)?.entries['10000']).toEqual({ text: '1500', mode: 'amount' });
  });

  it('a submitted, unedited draft is dropped on the next day without a notice', async () => {
    const tomorrow = { shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: joinJuicePreset, businessDate: '2026-11-08' };
    const context = vi
      .fn<DeviceApi['context']>()
      .mockReturnValueOnce(ok({ ...tomorrow, businessDate: '2026-11-07' }))
      .mockReturnValue(ok(tomorrow));
    const store = await start(memoryStore(), true, fakeDeviceApi({ context }));
    type('100€', '1500');
    await submitClosing();
    fireEvent.click(button('Τέλος'));
    cleanup();
    saveStaffSession(store, { token: 'token-2', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-08', shopId: FAKE_SHOP_ID });
    render(<App appStore={{ store, persistent: true }} deviceApi={fakeDeviceApi({ context })} now={NOW} newId={newId} share={share} ownerArea={OwnerStub} />);
    await screen.findByLabelText('100€');
    await act(async () => {}); // let the notice effect run
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/Η ημέρα άλλαξε/)).toBeNull();
    expect(loadUnsentDraft(store, FAKE_SHOP_ID)).toBeNull();
  });

  it('has no Αποβάρα in the menu and fills ΚΕΡΜΑΤΑ from the calculator', async () => {
    await start();
    fireEvent.click(button('Άθροισμα για ΚΕΡΜΑΤΑ'));
    type('Ποσό 1', '100');
    type('Ποσό 2', '50');
    fireEvent.click(button('Καταχώρηση'));
    expect((screen.getByLabelText('ΚΕΡΜΑΤΑ') as HTMLInputElement).value).toBe('150');
    fireEvent.click(button('Μενού'));
    expect(screen.queryByRole('menuitem', { name: 'Αποβάρα' })).toBeNull();
  });

  it('closes an open sheet when leaving the register via the URL', async () => {
    await start();
    fireEvent.click(button('Φάκελος'));
    expect(screen.getByRole('dialog', { name: 'Φάκελος' })).toBeTruthy();
    go('#/owner');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    go('#/');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
  });
});

describe('owner area', () => {
  it('opens from the menu and keeps the register mounted', async () => {
    await start();
    type('100€', '500');
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Διαχείριση καταστήματος' }));
    expect(await screen.findByText('owner:shops:none')).toBeTruthy();
    expect(window.location.hash).toBe('#/owner');
    go('#/');
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('500');
  });

  it('routes an email-link return to the owner area with the parsed redirect', async () => {
    window.history.replaceState(null, '', '/?auth=recovery&code=abc');
    await start();
    expect(await screen.findByText('owner:shops:recovery')).toBeTruthy();
    window.history.replaceState(null, '', '/');
  });

  it('does not keep offering the used-up redirect after leaving and returning to the owner area', async () => {
    window.history.replaceState(null, '', '/?auth=recovery&code=abc');
    await start();
    expect(await screen.findByText('owner:shops:recovery')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'handle redirect' }));
    go('#/');
    go('#/owner');
    expect(await screen.findByText('owner:shops:none')).toBeTruthy();
    window.history.replaceState(null, '', '/');
  });
});
