// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newShopConfig, type ShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { loadOwnerDraft, saveOwnerDraft } from '../../../src/data/local/ownerDrafts';
import { memoryStore, type KeyValueStore } from '../../../src/data/local/storage';
import type { OwnerApi } from '../../../src/data/remote/ownerApi';
import { SettingsScreen } from '../../../src/features/owner/settings/SettingsScreen';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date(2026, 8, 29, 12, 0);
const jj = (): ShopConfig => structuredClone(joinJuicePreset) as ShopConfig;
const serverAt = (version: number, config: unknown = jj()) => vi.fn(() => ok({ id: `c${version}`, version, config }));
const publishButton = () => screen.getByRole('button', { name: 'Δημοσίευση' }) as HTMLButtonElement;

function start(api: OwnerApi, store: KeyValueStore = memoryStore()) {
  render(<SettingsScreen api={api} shopId={SHOP} store={store} now={NOW} />);
  return store;
}

describe('SettingsScreen', () => {
  it('loads the latest version; nothing to publish until something changes', async () => {
    start(fakeApi({ latestConfig: serverAt(3) }));
    expect(await screen.findByText(/Έκδοση 3/)).toBeTruthy();
    expect(publishButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    expect(publishButton().disabled).toBe(false);
  });

  it('publishes with the base version and clears the local draft', async () => {
    const api = fakeApi({ latestConfig: serverAt(3), publishConfig: vi.fn(() => ok(4)) });
    const store = start(api);
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    expect(loadOwnerDraft(store, SHOP)?.config.floatCents).toBe(50000);
    fireEvent.click(publishButton());
    expect(await screen.findByText(/Δημοσιεύτηκε η έκδοση 4/)).toBeTruthy();
    const [, version, config] = (api.publishConfig as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number, ShopConfig];
    expect(version).toBe(3);
    expect(config.floatCents).toBe(50000);
    expect(loadOwnerDraft(store, SHOP)).toBeNull();
  });

  it('blocks publishing while the config is invalid and says where', async () => {
    start(fakeApi({ latestConfig: serverAt(1) }));
    await screen.findByText(/Έκδοση 1/);
    fireEvent.change(screen.getByLabelText('Όνομα καναλιού WOLT'), { target: { value: '' } });
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByRole('region', { name: 'Κανάλια' }).textContent).toContain('χρειάζεται όνομα');
  });

  it('refuses to delete a channel a total uses', async () => {
    const config = jj();
    config.totals.push({ id: 't_1', label: 'ΜΟΝΟ WOLT', terms: [{ sign: 1, ref: { kind: 'channel', id: 'wolt' } }], showInSummary: true, showInShare: true });
    start(fakeApi({ latestConfig: serverAt(1, config) }));
    await screen.findByText(/Έκδοση 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση WOLT' }));
    expect(screen.getByText(/χρησιμοποιείται στο ΜΟΝΟ WOLT/)).toBeTruthy();
    expect(screen.getByLabelText('Όνομα καναλιού WOLT')).toBeTruthy();
  });

  it('conflict → «Φόρτωση νέας» discards the draft and shows the new version', async () => {
    const latestConfig = vi.fn().mockReturnValueOnce(ok({ id: 'c3', version: 3, config: jj() })).mockReturnValue(ok({ id: 'c5', version: 5, config: jj() }));
    const api = fakeApi({ latestConfig, publishConfig: vi.fn(() => fail<number>({ code: 'version_conflict', currentVersion: 5 })) });
    const store = start(api);
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    expect(await screen.findByRole('dialog', { name: 'Οι ρυθμίσεις άλλαξαν' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Φόρτωση νέας' }));
    expect(await screen.findByText(/Έκδοση 5/)).toBeTruthy();
    expect(loadOwnerDraft(store, SHOP)).toBeNull();
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe('1000');
    expect((api.publishConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('conflict → «Δημοσίευση πάνω της» republishes on the current version', async () => {
    const publishConfig = vi.fn().mockReturnValueOnce(fail({ code: 'version_conflict', currentVersion: 5 })).mockReturnValue(ok(6));
    start(fakeApi({ latestConfig: serverAt(3), publishConfig }));
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Δημοσίευση πάνω της' }));
    expect(await screen.findByText(/Δημοσιεύτηκε η έκδοση 6/)).toBeTruthy();
    expect(publishConfig.mock.calls[1]?.[1]).toBe(5);
  });

  it('session expired keeps draft: the error is shown and the edit is still stored', async () => {
    const api = fakeApi({ latestConfig: serverAt(3), publishConfig: vi.fn(() => fail<number>({ code: 'session_expired' })) });
    const store = start(api);
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Η σύνδεση έληξε');
    expect(loadOwnerDraft(store, SHOP)?.config.floatCents).toBe(50000);
  });

  it('continues a same-version draft silently; offers an older-version draft', async () => {
    const store = memoryStore();
    saveOwnerDraft(store, SHOP, { config: { ...jj(), floatCents: 777 }, baseVersion: 3, savedAt: 1 });
    start(fakeApi({ latestConfig: serverAt(3) }), store);
    await screen.findByText(/Έκδοση 3/);
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe('7.77');
    cleanup();

    const older = memoryStore();
    saveOwnerDraft(older, SHOP, { config: { ...jj(), floatCents: 777 }, baseVersion: 2, savedAt: 1 });
    start(fakeApi({ latestConfig: serverAt(3) }), older);
    expect(await screen.findByText(/πρόχειρο από την έκδοση 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Απόρριψη' }));
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe('1000');
    expect(loadOwnerDraft(older, SHOP)).toBeNull();
  });

  it('hides the editable sections while an older-version draft is offered; continuing keeps the edits', async () => {
    const older = memoryStore();
    saveOwnerDraft(older, SHOP, { config: { ...jj(), floatCents: 777 }, baseVersion: 2, savedAt: 1 });
    start(fakeApi({ latestConfig: serverAt(3) }), older);
    expect(await screen.findByText(/πρόχειρο από την έκδοση 2/)).toBeTruthy();
    expect(screen.queryByLabelText('Αρχικό ταμείο (€)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Δημοσίευση' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Συνέχεια πρόχειρου' }));
    const field = (await screen.findByLabelText('Αρχικό ταμείο (€)')) as HTMLInputElement;
    expect(field.value).toBe('7.77');
    expect(loadOwnerDraft(older, SHOP)?.config.floatCents).toBe(777);
  });

  it('opens a server config that fails validation, and starts blank from a broken one', async () => {
    start(fakeApi({ latestConfig: serverAt(2, { ...jj(), envelopeTotalId: 'gone' }) }));
    await screen.findByText(/Έκδοση 2/);
    expect(screen.getByText(/Διάλεξε ποιο σύνολο γεμίζει ο Φάκελος/)).toBeTruthy();
    cleanup();

    start(fakeApi({ latestConfig: serverAt(2, { schema: 1, junk: true }) }));
    expect(await screen.findByText(/δεν μπόρεσαν να διαβαστούν/)).toBeTruthy();
    expect((screen.getByLabelText('Αρχικό ταμείο (€)') as HTMLInputElement).value).toBe(String(newShopConfig().floatCents));
  });

  it('shows a load error with retry', async () => {
    const latestConfig = vi.fn().mockReturnValueOnce(fail({ code: 'network' })).mockReturnValue(ok({ id: 'c1', version: 1, config: jj() }));
    start(fakeApi({ latestConfig }));
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν υπάρχει σύνδεση');
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    expect(await screen.findByText(/Έκδοση 1/)).toBeTruthy();
  });

  it('overwrite: when the conflict version is unknown and re-checking it also fails, the sheet closes so the error is visible', async () => {
    const latestConfig = vi.fn().mockReturnValueOnce(ok({ id: 'c3', version: 3, config: jj() })).mockReturnValue(fail({ code: 'network' }));
    const publishConfig = vi.fn(() => fail<number>({ code: 'version_conflict', currentVersion: null }));
    start(fakeApi({ latestConfig, publishConfig }));
    await screen.findByText(/Έκδοση 3/);
    fireEvent.change(screen.getByLabelText('Αρχικό ταμείο (€)'), { target: { value: '500' } });
    fireEvent.click(publishButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Δημοσίευση πάνω της' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν βρέθηκε η τρέχουσα έκδοση');
    expect(screen.queryByRole('dialog', { name: 'Οι ρυθμίσεις άλλαξαν' })).toBeNull();
  });

  it('clearing the expenses-per-closing field then typing a digit does not snap back and dispatches the new value', async () => {
    const store = start(fakeApi({ latestConfig: serverAt(3) }));
    await screen.findByText(/Έκδοση 3/);
    const field = screen.getByLabelText('Έξοδα ανά κλείσιμο') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: '5' } });
    expect(field.value).toBe('5');
    expect(loadOwnerDraft(store, SHOP)?.config.maxExpenses).toBe(5);
  });

  it('clearing a tare weight field then typing a digit does not snap back and dispatches the new value', async () => {
    const store = start(fakeApi({ latestConfig: serverAt(3) }));
    await screen.findByText(/Έκδοση 3/);
    const field = screen.getByLabelText('Γραμμάρια 1') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: '5' } });
    expect(field.value).toBe('5');
    expect(loadOwnerDraft(store, SHOP)?.config.tareItems[0]?.tareGrams).toBe(5);
  });
});
