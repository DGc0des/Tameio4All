// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
import { loadCachedContext, loadStaffSession, saveCachedContext, saveStaffSession } from '../../../src/data/local/phone';
import { saveSnapshot } from '../../../src/data/local/openClosing';
import { memoryStore, type KeyValueStore } from '../../../src/data/local/storage';
import type { DeviceApi, DeviceContext, StaffSession } from '../../../src/data/remote/deviceApi';
import { PhoneApp } from '../../../src/features/phone/PhoneApp';
import type { Snapshot } from '../../../src/features/register/live/fields';
import { fail, FAKE_CONFIG_ID, FAKE_SHOP_ID, fakeDeviceApi, ok } from './fakeDeviceApi';

afterEach(cleanup);

const CTX: DeviceContext = {
  shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: joinJuicePreset, businessDate: '2026-11-07',
};
const SNAPSHOT: Snapshot = { id: 'oc-1', businessDate: '2026-11-07', configId: FAKE_CONFIG_ID, config: joinJuicePreset, revision: 1, lastSubmit: null, fields: {} };
const SESSION: StaffSession = { token: 'token-1', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: FAKE_SHOP_ID };
let n = 0;

function start(api: DeviceApi | null, store: KeyValueStore = memoryStore()) {
  render(
    <PhoneApp
      api={api}
      store={store}
      now={() => new Date(2026, 10, 7, 22, 0)}
      newId={() => `id-${++n}`}
      share={vi.fn(async () => 'shared' as const)}
      themePref="system"
      active
      onTheme={vi.fn()}
      onOwner={vi.fn()}
    />,
  );
  return store;
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function signIn(pin: string) {
  fireEvent.click(await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' }));
  type('PIN', pin);
  fireEvent.click(button('Είσοδος'));
}

describe('PhoneApp', () => {
  it('pairs, then signs in; a wrong PIN stays on the sign-in screen', async () => {
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(ok(null)).mockReturnValue(ok(CTX));
    const api = fakeDeviceApi({ context });
    const store = start(api);

    await screen.findByLabelText('Κωδικός σύζευξης');
    type('Κωδικός σύζευξης', 'abcd-efgh');
    type('Όνομα συσκευής (προαιρετικό)', 'Ταμείο 1');
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση συσκευής' }));
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(api.join).toHaveBeenCalledWith('ABCDEFGH', 'Ταμείο 1');

    await signIn('9999');
    expect(await screen.findByText('Λάθος PIN.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();

    type('PIN', '1234');
    fireEvent.click(button('Είσοδος'));
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('Σαβ 07/11 · ΜΑΡΙΑ')).toBeTruthy();
    expect(api.signIn).toHaveBeenLastCalledWith('staff-maria', '1234');
    expect(loadStaffSession(store)).toEqual(SESSION);
  });

  it('a signed-out phone shows no register fields and no amounts', async () => {
    start(fakeDeviceApi());
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
    expect(document.querySelector('input.field')).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
    expect(screen.getByLabelText('PIN').getAttribute('inputmode')).toBe('numeric');
  });

  it('goes straight to the register after a reload with a stored session of the same day', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    const api = fakeDeviceApi();
    start(api, store);
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    expect(api.signIn).not.toHaveBeenCalled();
  });

  it('a stored session from another day is dropped', async () => {
    const store = memoryStore();
    saveStaffSession(store, { ...SESSION, businessDate: '2026-11-06' });
    start(fakeDeviceApi(), store);
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(loadStaffSession(store)).toBeNull();
  });

  it('asks before signing an owner out, then pairs with force', async () => {
    const pair = vi.fn<DeviceApi['join']>((_c, _l, opts) => (opts?.force ? ok(undefined) : fail({ code: 'owner_signed_in' })));
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(ok(null)).mockReturnValue(ok(CTX));
    const api = fakeDeviceApi({ join: pair, context });
    start(api);
    await screen.findByLabelText('Κωδικός σύζευξης');
    type('Κωδικός σύζευξης', 'ABCDEFGH');
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση συσκευής' }));
    expect(
      await screen.findByText('Είσαι συνδεδεμένος ως ιδιοκτήτης σε αυτόν τον browser. Η σύνδεση συσκευής θα σε αποσυνδέσει.'),
    ).toBeTruthy();
    fireEvent.click(button('Συνέχεια'));
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(pair).toHaveBeenLastCalledWith('ABCDEFGH', '', { force: true });
  });

  it('shows a pairing error and stays on the pairing screen', async () => {
    const api = fakeDeviceApi({ context: vi.fn(() => ok(null)), join: vi.fn(() => fail<void>({ code: 'invalid_code' })) });
    start(api);
    await screen.findByLabelText('Κωδικός σύζευξης');
    type('Κωδικός σύζευξης', 'ZZZZZZZZ');
    fireEvent.click(await screen.findByRole('button', { name: 'Σύνδεση συσκευής' }));
    expect(await screen.findByText('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.')).toBeTruthy();
    expect(button('Σύνδεση συσκευής')).toBeTruthy();
  });

  it('a revoked phone shows the pairing screen and forgets the stored session (Review Focus 4)', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    start(fakeDeviceApi({ context: vi.fn(() => fail<DeviceContext | null>({ code: 'device_revoked' })) }), store);
    expect(await screen.findByText('Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.')).toBeTruthy();
    expect(button('Σύνδεση συσκευής')).toBeTruthy();
    expect(loadStaffSession(store)).toBeNull();
  });

  it('a revoked phone found while signing in goes to the pairing screen', async () => {
    start(fakeDeviceApi({ signIn: vi.fn(() => fail<StaffSession>({ code: 'device_revoked' })) }));
    await signIn('1234');
    expect(await screen.findByText('Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.')).toBeTruthy();
    expect(button('Σύνδεση συσκευής')).toBeTruthy();
  });

  it('opens offline from the cache with a valid stored session (Review Focus 5)', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    saveSnapshot(store, FAKE_SHOP_ID, { ...SNAPSHOT, fields: { 'd:10000': { key: 'd:10000', value: { text: '500', mode: 'amount' }, version: 1, updatedByName: 'ΝΙΚΟΣ', updatedAt: '' } } });
    const api = fakeDeviceApi({
      context: vi.fn(() => fail<DeviceContext | null>({ code: 'network' })),
      getOpenClosing: vi.fn(() => fail<Snapshot>({ code: 'network' })),
    });
    start(api, store);
    expect(await screen.findByText('Εκτός σύνδεσης')).toBeTruthy();
    // The register shows the last closing it saw, from the device's cache.
    expect(((await screen.findByLabelText('100€')) as HTMLInputElement).value).toBe('500');
    expect(screen.getAllByText('Εκτός σύνδεσης')).toHaveLength(1);
  });

  it('offline with no cached closing says it will load once connected (no boxes)', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    start(fakeDeviceApi({
      context: vi.fn(() => fail<DeviceContext | null>({ code: 'network' })),
      getOpenClosing: vi.fn(() => fail<Snapshot>({ code: 'network' })),
    }), store);
    expect(await screen.findByText('Το ταμείο θα φορτώσει μόλις υπάρξει σύνδεση.')).toBeTruthy();
    expect(document.querySelector('input.field')).toBeNull();
  });

  it('signing in offline reloads the context: today replaces yesterday\'s cache', async () => {
    const store = memoryStore();
    saveCachedContext(store, { ...CTX, businessDate: '2026-11-06' });
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok(CTX));
    // As in device.ts: no context() has succeeded yet, so the session does not know its shop.
    const signInFn = vi.fn<DeviceApi['signIn']>(() => ok({ ...SESSION, shopId: '' }));
    start(fakeDeviceApi({ context, signIn: signInFn }), store);
    expect(await screen.findByText('Εκτός σύνδεσης')).toBeTruthy();
    await signIn('1234');
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    expect(context).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole('banner')).getByText('Σαβ 07/11 · ΜΑΡΙΑ')).toBeTruthy();
    expect(screen.queryByText('Εκτός σύνδεσης')).toBeNull();
    expect(loadStaffSession(store)).toEqual(SESSION);
    expect(signInFn).toHaveBeenCalledTimes(1);
  });

  it('without a cache shows a retry screen, never a blank page (Review Focus 5)', async () => {
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok(CTX));
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    start(fakeDeviceApi({ context }), store);
    expect(await screen.findByText('Δεν υπάρχει σύνδεση')).toBeTruthy();
    fireEvent.click(button('Δοκίμασε ξανά'));
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    expect(screen.queryByText('Εκτός σύνδεσης')).toBeNull();
    expect(context).toHaveBeenCalledTimes(2);
  });

  it('a browser with no auth session goes to pairing and forgets the cached session and context', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    const api = fakeDeviceApi({ session: vi.fn(() => ok(null)) });
    start(api, store);
    expect(await screen.findByRole('button', { name: 'Σύνδεση συσκευής' })).toBeTruthy();
    expect(api.context).not.toHaveBeenCalled();
    expect(loadStaffSession(store)).toBeNull();
    expect(loadCachedContext(store)).toBeNull();
  });

  it('offline with an expired access token: the failed session lookup opens the cached register, caches kept', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    const api = fakeDeviceApi({
      session: vi.fn(() => fail<{ anonymous: boolean } | null>({ code: 'network' })),
      context: vi.fn(() => fail<DeviceContext | null>({ code: 'network' })),
    });
    start(api, store);
    expect(await screen.findByText('Εκτός σύνδεσης')).toBeTruthy();
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Σύνδεση συσκευής' })).toBeNull();
    expect(loadStaffSession(store)).toEqual(SESSION);
    expect(loadCachedContext(store)).toEqual(CTX);
  });

  it('a non-network load error shows an error screen with retry, never the cached register', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(fail({ code: 'unknown', detail: 'boom' })).mockReturnValue(ok(CTX));
    start(fakeDeviceApi({ context }), store);
    expect(await screen.findByText('Κάτι πήγε στραβά.')).toBeTruthy();
    expect(document.querySelector('input.field')).toBeNull();
    expect(screen.queryByText('Εκτός σύνδεσης')).toBeNull();
    fireEvent.click(button('Δοκίμασε ξανά'));
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    expect(context).toHaveBeenCalledTimes(2);
  });

  it('an offline register comes back online on the online event: banner gone, Υποβολή enabled', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok(CTX));
    start(fakeDeviceApi({ context }), store);
    expect(await screen.findByText('Εκτός σύνδεσης')).toBeTruthy();
    await screen.findByLabelText('100€');
    type('100€', '1500');
    expect(button('Υποβολή').disabled).toBe(true);
    fireEvent(window, new Event('online'));
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Εκτός σύνδεσης')).toBeNull());
    expect(context).toHaveBeenCalledTimes(2);
    // What was typed survives the reload (saved to the live closing, or still in the persisted queue).
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('1500');
    await waitFor(() => expect(button('Υποβολή').disabled).toBe(false));
  });

  it('an offline phone re-checks when it becomes visible again, and from the banner button', async () => {
    const store = memoryStore();
    saveCachedContext(store, CTX);
    const context = vi
      .fn<DeviceApi['context']>()
      .mockReturnValueOnce(fail({ code: 'network' }))
      .mockReturnValueOnce(fail({ code: 'network' }))
      .mockReturnValue(ok(CTX));
    start(fakeDeviceApi({ context }), store);
    expect(await screen.findByText('Εκτός σύνδεσης')).toBeTruthy();
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(context).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Εκτός σύνδεσης')).toBeTruthy();
    fireEvent.click(button('Δοκίμασε ξανά'));
    await waitFor(() => expect(screen.queryByText('Εκτός σύνδεσης')).toBeNull());
    expect(context).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
  });

  it('an online phone does not reload on online / visibility events', async () => {
    const api = fakeDeviceApi();
    start(api);
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    fireEvent(window, new Event('online'));
    fireEvent(document, new Event('visibilitychange'));
    expect(api.context).toHaveBeenCalledTimes(1);
  });

  it('caches the context after a successful load', async () => {
    const store = memoryStore();
    start(fakeDeviceApi(), store);
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(loadCachedContext(store)).toEqual(CTX);
  });

  it('refuses to open the register on an invalid config pinned to the open closing', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    start(fakeDeviceApi({ getOpenClosing: vi.fn(() => ok<Snapshot>({ ...SNAPSHOT, config: { schema: 99 } })) }), store);
    expect(await screen.findByText('Οι ρυθμίσεις του καταστήματος δεν είναι έγκυρες')).toBeTruthy();
    expect(document.querySelector('input.field')).toBeNull();
  });

  it('says the server is not configured when there is no client', async () => {
    start(null);
    expect(await screen.findByText(/δεν έχει ρυθμιστεί/)).toBeTruthy();
  });
});
