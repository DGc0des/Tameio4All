// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClosingInputs } from '../../../../src/core/formula';
import { centsToPlain } from '../../../../src/core/money';
import { joinJuicePreset } from '../../../../src/core/presets';
import type { OwnerApi, Result } from '../../../../src/data/remote/ownerApi';
import { DayScreen } from '../../../../src/features/owner/history/DayScreen';
import { applyLocalEdit, snapshotFromInputs } from '../../../../src/features/owner/history/model';
import type { ClosingVersion, DayDetail, SaveClosingArgs } from '../../../../src/features/owner/history/types';
import { ownerErrorMessage } from '../../../../src/features/owner/model/messages';
import { deriveClosing, envelopeBlockReason } from '../../../../src/features/register/derive';
import { amountValue, type Snapshot } from '../../../../src/features/register/live/fields';
import { draftFromFields } from '../../../../src/features/register/live/merge';
import { fail, fakeApi, ok } from '../fakeApi';

afterEach(cleanup);

const SHOP = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';
const DATE = '2026-11-09';
const STAFF = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NAMES = { [STAFF]: 'ΜΑΡΙΑ' };
const NOW = () => new Date(2026, 10, 11, 12);

const currentInputs: ClosingInputs = {
  schema: 2,
  counts: { '10000': 3 },
  channelCents: { wolt: 1000 },
  expenses: [{ id: 'x1', description: 'Γάλα', cents: 850, addedBy: { kind: 'staff', id: STAFF } }],
};
const version = (id: string, over: Partial<ClosingVersion> = {}): ClosingVersion => ({
  id, kind: 'staff', authorName: 'ΜΑΡΙΑ', createdAt: '2026-11-09T19:42:00Z', configId: 'cfg1', inputs: currentInputs, correctsId: null, ...over,
});
const v1 = version('v1', { createdAt: '2026-11-09T17:05:00Z', inputs: { ...currentInputs, counts: { '10000': 1 } } });
const v2 = version('v2');
const v3 = version('v3', { kind: 'owner_correction', authorName: 'Ιδιοκτήτης', correctsId: 'v2', inputs: { ...currentInputs, counts: { '10000': 7 } } });
const day = (over: Partial<DayDetail> = {}): DayDetail => ({
  today: '2026-11-11', businessDate: DATE, versions: [v2, v1], configs: { cfg1: joinJuicePreset }, staffNames: NAMES, open: null, ...over,
});
const openSnap: Snapshot = {
  id: 'oc-1', businessDate: DATE, configId: 'cfg-open', config: joinJuicePreset, revision: 2, lastSubmit: null,
  fields: { 'd:10000': { key: 'd:10000', value: { text: '2', mode: 'count' }, version: 1, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-09T20:00:00Z' } },
};

type Save = OwnerApi['saveClosing'];
function setup(o: { days?: DayDetail[]; saveClosing?: Save } = {}) {
  const days = o.days ?? [day()];
  let n = 0;
  const closingDay = vi.fn(() => ok(days[Math.min(n++, days.length - 1)]!));
  let id = 0;
  const newId = () => `n${++id}`;
  const api = fakeApi({ closingDay, ...(o.saveClosing ? { saveClosing: o.saveClosing } : {}) });
  render(<DayScreen api={api} shopId={SHOP} date={DATE} navigate={vi.fn()} now={NOW} newId={newId} />);
  return { api, closingDay };
}

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(box(label), { target: { value } });
const saveButton = () => screen.getByRole('button', { name: 'Αποθήκευση' }) as HTMLButtonElement;
const savedArgs = (api: OwnerApi, call = 0) => vi.mocked(api.saveClosing).mock.calls[call]![1] as SaveClosingArgs;

async function startCorrection() {
  fireEvent.click(await screen.findByRole('button', { name: 'Διόρθωση' }));
  return screen.findByLabelText('100€');
}

const noLiveWrites = (api: OwnerApi) => {
  expect(api.setTodayField).not.toHaveBeenCalled();
  expect(api.live).not.toHaveBeenCalled();
};

describe('CorrectionEditor', () => {
  it('prefills the boxes and expense lines from the current version and hides the versions list', async () => {
    const { api } = setup();
    await startCorrection();
    expect(box('100€').value).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: '€ Ποσό' }));
    expect(box('100€').value).toBe('300');
    expect(box('WOLT').value).toBe(centsToPlain(1000));
    expect(box('Περιγραφή εξόδου 1').value).toBe('Γάλα');
    expect(box('Ποσό εξόδου 1').value).toBe(centsToPlain(850));
    expect(screen.queryByRole('region', { name: /υποβολές/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Φάκελος' })).toBeNull();
    noLiveWrites(api);
  });

  it('fills ΚΕΡΜΑΤΑ from the calculator, locally (no live write)', async () => {
    const { api } = setup();
    await startCorrection();
    fireEvent.click(screen.getByRole('button', { name: 'Άθροισμα για ΚΕΡΜΑΤΑ' }));
    type('Ποσό 1', '20');
    type('Ποσό 2', '5,50');
    fireEvent.click(screen.getByRole('button', { name: 'Καταχώρηση' }));
    expect(box('ΚΕΡΜΑΤΑ').value).toBe(centsToPlain(2550));
    expect(saveButton().disabled).toBe(false);
    noLiveWrites(api);
  });

  it('«Αποθήκευση» is disabled with «Δεν άλλαξε κάτι» until a box changes', async () => {
    setup();
    await startCorrection();
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText('Δεν άλλαξε κάτι')).toBeTruthy();
    type('100€', '4');
    expect(saveButton().disabled).toBe(false);
    expect(screen.queryByText('Δεν άλλαξε κάτι')).toBeNull();
    type('100€', '3');
    expect(saveButton().disabled).toBe(true);
  });

  it('saves the corrected inputs as a new version, keeping the staff line id and author, then refetches', async () => {
    const { api, closingDay } = setup({ days: [day(), day({ versions: [v3, v2, v1] })] });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    expect(api.saveClosing).toHaveBeenCalledWith(SHOP, {
      businessDate: DATE, configId: 'cfg1', inputs: expect.anything(), expectedCurrentId: 'v2', key: expect.any(String),
    });
    const { inputs } = savedArgs(api);
    expect(inputs.schema).toBe(2);
    expect(inputs.counts['10000']).toBe(4);
    expect(inputs.channelCents).toEqual({ wolt: 1000 });
    expect(inputs.expenses).toEqual([{ id: 'x1', description: 'Γάλα', cents: 850, addedBy: { kind: 'staff', id: STAFF } }]);
    await waitFor(() => expect(closingDay).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Διόρθωση' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Αποθήκευση' })).toBeNull();
    expect(screen.queryByLabelText('100€')).toBeNull();
    noLiveWrites(api);
  });

  it('a line added in the editor is sent with addedBy owner', async () => {
    const { api } = setup();
    await startCorrection();
    fireEvent.click(screen.getByRole('button', { name: '+ Έξοδο' }));
    type('Περιγραφή εξόδου 2', 'Πάγος');
    type('Ποσό εξόδου 2', '5');
    fireEvent.click(saveButton());
    const { inputs } = savedArgs(api);
    expect(inputs.expenses).toHaveLength(2);
    expect(inputs.expenses[0]).toEqual({ id: 'x1', description: 'Γάλα', cents: 850, addedBy: { kind: 'staff', id: STAFF } });
    expect(inputs.expenses[1]).toEqual({ id: expect.any(String), description: 'Πάγος', cents: 500, addedBy: { kind: 'owner' } });
    await screen.findByRole('button', { name: 'Διόρθωση' });
  });

  it('an invalid box blocks «Αποθήκευση» with the envelope block reason', async () => {
    const { api } = setup();
    await startCorrection();
    // The box sanitizes what is typed (`5-3` becomes `53`), so too many decimals is the invalid value a box can hold.
    type('WOLT', '1.234');
    expect(box('WOLT').value).toBe('1.234');
    const local = applyLocalEdit(
      snapshotFromInputs({ config: joinJuicePreset, configId: 'cfg1', businessDate: DATE, inputs: currentInputs, newId: () => 'z' }),
      'c:wolt', amountValue('1.234'),
    );
    const reason = envelopeBlockReason(deriveClosing(joinJuicePreset, draftFromFields(local, [])));
    expect(reason).not.toBeNull();
    expect(screen.getByText(reason!)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(api.saveClosing).not.toHaveBeenCalled();
  });

  it('a network failure keeps the typed values; a retry reuses the key, an edit mints a new one', async () => {
    const saveClosing = vi.fn<Save>(() => fail({ code: 'network' }));
    const { api } = setup({ saveClosing });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(ownerErrorMessage({ code: 'network' }));
    expect(box('100€').value).toBe('4');
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(saveClosing).toHaveBeenCalledTimes(2));
    await screen.findByRole('alert');
    expect(savedArgs(api, 1).key).toBe(savedArgs(api, 0).key);

    type('100€', '5');
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveClosing).toHaveBeenCalledTimes(3));
    await screen.findByRole('alert');
    expect(savedArgs(api, 2).key).not.toBe(savedArgs(api, 0).key);
    expect(savedArgs(api, 2).inputs.counts['10000']).toBe(5);
  });

  it('while a save is in flight the button is disabled (two quick clicks → one call)', async () => {
    let settle: (r: Result<{ closingId: string; repeat: boolean }>) => void = () => {};
    const saveClosing = vi.fn<Save>(() => new Promise((res) => { settle = res; }));
    setup({ saveClosing });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    fireEvent.click(saveButton());
    expect(saveClosing).toHaveBeenCalledTimes(1);
    expect(saveButton().disabled).toBe(true);
    settle({ ok: false, error: { code: 'network' } });
    await screen.findByRole('alert');
    expect(saveButton().disabled).toBe(false);
  });

  it('closing_changed opens «Το κλείσιμο άλλαξε»; «Αποθήκευση πάνω της» saves over v3 with the same inputs and a new key', async () => {
    const saveClosing = vi.fn<Save>()
      .mockImplementationOnce(() => fail({ code: 'closing_changed', currentId: 'v3' }))
      .mockImplementation(() => ok({ closingId: 'c-new', repeat: false }));
    const { api, closingDay } = setup({ saveClosing });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Το κλείσιμο άλλαξε' });
    expect(within(dialog).getByText(ownerErrorMessage({ code: 'closing_changed', currentId: 'v3' }))).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Φόρτωση νέας' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Αποθήκευση πάνω της' }));
    await waitFor(() => expect(saveClosing).toHaveBeenCalledTimes(2));
    const first = savedArgs(api, 0);
    const second = savedArgs(api, 1);
    expect(second.expectedCurrentId).toBe('v3');
    expect(second.inputs).toEqual(first.inputs);
    expect(second.key).not.toBe(first.key);
    await waitFor(() => expect(closingDay).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Διόρθωση' })).toBeTruthy();
    noLiveWrites(api);
  });

  it('«Φόρτωση νέας» refetches the day and the editor shows the new current version', async () => {
    const saveClosing = vi.fn<Save>(() => fail({ code: 'closing_changed', currentId: 'v3' }));
    const { api, closingDay } = setup({ days: [day(), day({ versions: [v3, v2, v1] })], saveClosing });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Φόρτωση νέας' }));
    await waitFor(() => expect(closingDay).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box('100€').value).toBe('7'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saveButton().disabled).toBe(true);
    type('100€', '8');
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveClosing).toHaveBeenCalledTimes(2));
    expect(savedArgs(api, 1).expectedCurrentId).toBe('v3');
    await screen.findByRole('dialog');
    noLiveWrites(api);
  });

  it('closing_changed with no current version only offers «Φόρτωση νέας»', async () => {
    const saveClosing = vi.fn<Save>(() => fail({ code: 'closing_changed', currentId: null }));
    setup({ saveClosing });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Το κλείσιμο άλλαξε' });
    expect(within(dialog).getByRole('button', { name: 'Φόρτωση νέας' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Αποθήκευση πάνω της' })).toBeNull();
  });

  it('config_mismatch shows its message and only offers «Φόρτωση νέας»', async () => {
    const saveClosing = vi.fn<Save>(() => fail({ code: 'config_mismatch' }));
    setup({ saveClosing });
    await startCorrection();
    type('100€', '4');
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(ownerErrorMessage({ code: 'config_mismatch' }))).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Φόρτωση νέας' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Αποθήκευση πάνω της' })).toBeNull();
  });

  it('«Άκυρο» returns to the detail without saving', async () => {
    const { api } = setup();
    await startCorrection();
    type('100€', '4');
    fireEvent.click(screen.getByRole('button', { name: 'Άκυρο' }));
    expect(screen.getByRole('button', { name: 'Διόρθωση' })).toBeTruthy();
    expect(screen.queryByLabelText('100€')).toBeNull();
    expect(screen.getByText('100€ × 3')).toBeTruthy();
    expect(api.saveClosing).not.toHaveBeenCalled();
  });

  it('an unsubmitted day is filed from its open closing: enabled without changes, no expected version, the open config', async () => {
    const { api } = setup({ days: [day({ versions: [], configs: {}, open: openSnap })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Αποθήκευση ως κλείσιμο' }));
    expect(box('100€').value).toBe('2');
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(api.saveClosing).toHaveBeenCalledWith(SHOP, {
      businessDate: DATE, configId: 'cfg-open', inputs: expect.anything(), expectedCurrentId: null, key: expect.any(String),
    });
    expect(savedArgs(api).inputs.counts).toEqual({ '10000': 2 });
    await waitFor(() => expect(api.closingDay).toHaveBeenCalledTimes(2));
    noLiveWrites(api);
  });
});
