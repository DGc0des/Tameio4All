// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../../src/core/presets';
import type { PastExpense } from '../../../src/core/suggestions';
import { loadCachedContext, loadStaffSession, saveCachedContext, saveJoinKey, saveStaffSession } from '../../../src/data/local/phone';
import { saveSnapshot } from '../../../src/data/local/openClosing';
import { memoryStore, shopKey, type KeyValueStore } from '../../../src/data/local/storage';
import type { DeviceApi, DeviceContext, StaffSession } from '../../../src/data/remote/deviceApi';
import { platformLabel } from '../../../src/features/phone/model/platform';
import { PhoneApp, type PhoneAppProps } from '../../../src/features/phone/PhoneApp';
import type { Snapshot } from '../../../src/features/register/live/fields';
import { fail, FAKE_CONFIG_ID, FAKE_SHOP_ID, fakeDeviceApi, ok } from './fakeDeviceApi';

afterEach(cleanup);

const CTX: DeviceContext = {
  shopId: FAKE_SHOP_ID, shopName: 'Join Juice', configId: FAKE_CONFIG_ID, config: joinJuicePreset, businessDate: '2026-11-07',
};
const SNAPSHOT: Snapshot = { id: 'oc-1', businessDate: '2026-11-07', configId: FAKE_CONFIG_ID, config: joinJuicePreset, revision: 1, lastSubmit: null, fields: {} };
const SESSION: StaffSession = { token: 'token-1', staffId: 'staff-maria', name: 'ΜΑΡΙΑ', businessDate: '2026-11-07', shopId: FAKE_SHOP_ID };
const K = 'ABCDEFGHJKLMNPQR';
const LABEL = platformLabel(navigator.userAgent);
let n = 0;

type Extra = Partial<Pick<PhoneAppProps, 'link' | 'onLinkTaken'>> & { strict?: boolean };

function element(api: DeviceApi | null, store: KeyValueStore, extra: Extra): ReactElement {
  const app = (
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
      link={extra.link ?? null}
      onLinkTaken={extra.onLinkTaken ?? vi.fn()}
    />
  );
  return extra.strict ? <StrictMode>{app}</StrictMode> : app;
}

function start(api: DeviceApi | null, store: KeyValueStore = memoryStore(), extra: Extra = {}) {
  const r = render(element(api, store, extra));
  return Object.assign(store, { rerender: () => r.rerender(element(api, store, extra)) });
}
/** context() answers «not in a store» until a join succeeds, then the shop. */
function notInStore(overrides: Partial<DeviceApi> = {}, after: DeviceContext = CTX): DeviceApi {
  let joined = false;
  const inner = overrides.join ?? fakeDeviceApi().join;
  const join = vi.fn<DeviceApi['join']>(async (...a) => {
    const r = await inner(...a);
    if (r.ok) joined = true;
    return r;
  });
  return fakeDeviceApi({ ...overrides, join, context: vi.fn(() => ok<DeviceContext | null>(joined ? after : null)) });
}
const ENTRY = { name: 'Είσοδος στο κατάστημα' };
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function signIn(pin: string) {
  fireEvent.click(await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' }));
  type('PIN', pin);
  fireEvent.click(button('Είσοδος'));
}

describe('PhoneApp', () => {
  it('enters a store by typed code, then signs in; a wrong PIN stays on the sign-in screen', async () => {
    const api = notInStore();
    const store = start(api);

    expect(await screen.findByRole('heading', ENTRY)).toBeTruthy();
    expect(screen.queryByLabelText(/Όνομα συσκευής/)).toBeNull();
    type('Κωδικός καταστήματος', 'abcd-efgh-jklm-npqr');
    fireEvent.click(button('Είσοδος'));
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(api.join).toHaveBeenCalledWith(K, LABEL, undefined);

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

  it('a malformed typed code is refused without a server call', async () => {
    const api = notInStore();
    start(api);
    await screen.findByRole('heading', ENTRY);
    expect(button('Είσοδος').disabled).toBe(true);
    type('Κωδικός καταστήματος', 'abc');
    fireEvent.click(button('Είσοδος'));
    expect(await screen.findByText('Ο κωδικός δεν είναι σωστός.')).toBeTruthy();
    expect(api.join).not.toHaveBeenCalled();
  });

  it('a link on a phone not in a store: taken once, joined once (StrictMode, re-render), then sign-in (Review Focus 3)', async () => {
    const api = notInStore();
    const onLinkTaken = vi.fn();
    const app = start(api, memoryStore(), { link: { key: K }, onLinkTaken, strict: true });
    app.rerender();
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    app.rerender();
    await screen.findByRole('radio', { name: 'ΜΑΡΙΑ' });
    expect(onLinkTaken).toHaveBeenCalledTimes(1);
    expect(api.join).toHaveBeenCalledTimes(1);
    expect(api.join).toHaveBeenCalledWith(K, LABEL, undefined);
  });

  it('a malformed link shows the entry screen with «Ο σύνδεσμος δεν είναι σωστός.»', async () => {
    const api = notInStore();
    start(api, memoryStore(), { link: { key: null } });
    expect(await screen.findByText('Ο σύνδεσμος δεν είναι σωστός.')).toBeTruthy();
    expect(screen.getByRole('heading', ENTRY)).toBeTruthy();
    expect(api.join).not.toHaveBeenCalled();
  });

  it('a link opened offline: «Δεν υπάρχει σύνδεση.» with the code still filled in (Review Focus 2)', async () => {
    const join = vi.fn<DeviceApi['join']>().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok(undefined));
    const api = notInStore({ join });
    start(api, memoryStore(), { link: { key: K } });
    expect(await screen.findByText('Δεν υπάρχει σύνδεση.')).toBeTruthy();
    expect((screen.getByLabelText('Κωδικός καταστήματος') as HTMLInputElement).value).toBe('ABCD-EFGH-JKLM-NPQR');
    fireEvent.click(button('Είσοδος'));
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(api.join).toHaveBeenCalledTimes(2);
  });

  it('a link of the same store on a signed-in phone: nothing changes, no sheet', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    const api = fakeDeviceApi();
    start(api, store, { link: { key: K } });
    expect(await screen.findByLabelText('100€')).toBeTruthy();
    await waitFor(() => expect(api.join).toHaveBeenCalledTimes(1));
    expect(api.join).toHaveBeenCalledWith(K, LABEL, undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('100€')).toBeTruthy();
    expect(api.context).toHaveBeenCalledTimes(1);
  });

  it('a link of another store on a signed-in phone asks first; «Αλλαγή» switches and lands on sign-in', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    const other: DeviceContext = { ...CTX, shopId: 'shop-2', shopName: 'Άλλο' };
    const join = vi.fn<DeviceApi['join']>((_k, _l, opts) => (opts?.switchShop ? ok(undefined) : fail({ code: 'other_shop' })));
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(ok(CTX)).mockReturnValue(ok(other));
    const api = fakeDeviceApi({ join, context });
    start(api, store, { link: { key: K } });
    const sheet = await screen.findByRole('dialog', { name: 'Αλλαγή καταστήματος' });
    expect(within(sheet).getByText('Η συσκευή είναι στο «Join Juice». Να μπει στο κατάστημα του συνδέσμου;')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Αλλαγή' }));
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(join).toHaveBeenLastCalledWith(K, LABEL, { switchShop: true });
    expect(join).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadStaffSession(store)).toBeNull();
  });

  it('«Άκυρο» on the switch sheet keeps the register', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    const api = fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'other_shop' })) });
    start(api, store, { link: { key: K } });
    const sheet = await screen.findByRole('dialog', { name: 'Αλλαγή καταστήματος' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Άκυρο' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('100€')).toBeTruthy();
    expect(api.join).toHaveBeenCalledTimes(1);
  });

  it('a malformed link on a signed-in phone is not dropped silently', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    const api = fakeDeviceApi();
    start(api, store, { link: { key: null } });
    expect(await screen.findByText('Ο σύνδεσμος δεν είναι σωστός.')).toBeTruthy();
    expect(screen.getByLabelText('100€')).toBeTruthy();
    expect(api.join).not.toHaveBeenCalled();
  });

  it('a refused link on a signed-in phone shows a dismissible notice', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    start(fakeDeviceApi({ join: vi.fn(() => fail<void>({ code: 'invalid_code' })) }), store, { link: { key: K } });
    expect(await screen.findByText('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.')).toBeTruthy();
    expect(screen.getByLabelText('100€')).toBeTruthy();
    fireEvent.click(button('Κλείσιμο'));
    expect(screen.queryByText('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.')).toBeNull();
  });

  it('a replaced link with unsent edits: entry screen with the new-link message, pending queue untouched (Review Focus 5)', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveJoinKey(store, K);
    const pendingKey = shopKey(FAKE_SHOP_ID, 'pending');
    const queued = JSON.stringify([
      { author: 'staff-maria', key: 'd:10000', value: { text: '3', mode: 'count' }, businessDate: '2026-11-07', baseVersion: 0, queuedOffline: true, seq: 1 },
    ]);
    store.setItem(pendingKey, queued);
    const context = vi.fn<DeviceApi['context']>().mockReturnValueOnce(ok(CTX)).mockReturnValue(fail({ code: 'not_a_device' }));
    const api = fakeDeviceApi({
      context,
      getOpenClosing: vi.fn(() => fail<Snapshot>({ code: 'not_a_device' })),
      suggestionData: vi.fn(() => fail<PastExpense[]>({ code: 'not_a_device' })),
      join: vi.fn(() => fail<void>({ code: 'invalid_code' })),
    });
    start(api, store);
    expect(await screen.findByText('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.')).toBeTruthy();
    expect(screen.getByRole('heading', ENTRY)).toBeTruthy();
    expect(api.join).toHaveBeenCalledTimes(1);
    expect(store.getItem(pendingKey)).toBe(queued);
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

  it('asks before signing an owner out, then joins with force', async () => {
    const api = notInStore({ join: vi.fn<DeviceApi['join']>((_c, _l, opts) => (opts?.force ? ok(undefined) : fail({ code: 'owner_signed_in' }))) });
    start(api);
    await screen.findByRole('heading', ENTRY);
    type('Κωδικός καταστήματος', K);
    fireEvent.click(button('Είσοδος'));
    expect(
      await screen.findByText('Είσαι συνδεδεμένος ως ιδιοκτήτης σε αυτόν τον browser. Η σύνδεση συσκευής θα σε αποσυνδέσει.'),
    ).toBeTruthy();
    fireEvent.click(button('Συνέχεια'));
    expect(await screen.findByRole('heading', { name: 'Ποιος είσαι;' })).toBeTruthy();
    expect(api.join).toHaveBeenLastCalledWith(K, LABEL, { force: true });
  });

  it('shows a join error and stays on the entry screen', async () => {
    const api = fakeDeviceApi({ context: vi.fn(() => ok(null)), join: vi.fn(() => fail<void>({ code: 'invalid_code' })) });
    start(api);
    await screen.findByRole('heading', ENTRY);
    type('Κωδικός καταστήματος', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    fireEvent.click(button('Είσοδος'));
    expect(await screen.findByText('Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.')).toBeTruthy();
    expect(screen.getByRole('heading', ENTRY)).toBeTruthy();
    expect((screen.getByLabelText('Κωδικός καταστήματος') as HTMLInputElement).value).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  });

  it('a revoked phone shows the entry screen and forgets the stored session (Review Focus 4)', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    start(fakeDeviceApi({ context: vi.fn(() => fail<DeviceContext | null>({ code: 'device_revoked' })) }), store);
    expect(await screen.findByText('Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.')).toBeTruthy();
    expect(screen.getByRole('heading', ENTRY)).toBeTruthy();
    expect(loadStaffSession(store)).toBeNull();
  });

  it('a revoked phone found while signing in goes to the entry screen', async () => {
    start(fakeDeviceApi({ signIn: vi.fn(() => fail<StaffSession>({ code: 'device_revoked' })) }));
    await signIn('1234');
    expect(await screen.findByText('Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.')).toBeTruthy();
    expect(screen.getByRole('heading', ENTRY)).toBeTruthy();
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

  it('a browser with no auth session goes to the entry screen and forgets the cached session and context', async () => {
    const store = memoryStore();
    saveStaffSession(store, SESSION);
    saveCachedContext(store, CTX);
    const api = fakeDeviceApi({ session: vi.fn(() => ok(null)) });
    start(api, store);
    expect(await screen.findByRole('heading', ENTRY)).toBeTruthy();
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
    expect(screen.queryByRole('heading', ENTRY)).toBeNull();
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
