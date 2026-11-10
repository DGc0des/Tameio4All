// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import type { ClosingInputs } from '../../../src/core/formula';
import type { DResult } from '../../../src/data/remote/deviceApi';
import { deriveClosing } from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';
import type { ShareFn } from '../../../src/features/register/share';
import { SubmitSheet } from '../../../src/features/register/SubmitSheet';
import { boxes } from './boxes';

afterEach(cleanup);

const d: Draft = {
  ...newDraft('2026-09-28'),
  entries: boxes({ '10000': '1500', '5000': '50' }),
  channels: { wolt: '45,60' },
  expenses: [
    { id: 'e1', description: 'Nice', amountText: '13', addedBy: { kind: 'owner' }, order: 1 },
    { id: 'e2', description: '', amountText: '2', addedBy: { kind: 'owner' }, order: 1 },
  ],
};
const derived = deriveClosing(cfg, d);

type SubmitFn = (inputs: ClosingInputs, revision: number) => Promise<DResult<{ closingId: string; repeat: boolean }>>;
const submitted: SubmitFn = async () => ({ ok: true, data: { closingId: 'c1', repeat: false } });

function setup(onSubmit: SubmitFn = vi.fn(submitted), onShare: ShareFn = vi.fn(async () => 'shared' as const)) {
  const onClose = vi.fn();
  render(<SubmitSheet config={cfg} draft={d} derived={derived} revision={7} blocked={null} onSubmit={onSubmit} onShare={onShare} onClose={onClose} />);
  return { onSubmit, onShare, onClose, dialog: () => screen.getByRole('dialog') };
}
const tapSubmit = () =>
  act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
  });

describe('SubmitSheet', () => {
  it('shows the share card: date, shared totals, expenses, channels, what stays', () => {
    const { dialog } = setup();
    const text = dialog().textContent ?? '';
    expect(text).toContain('28/09/2026');
    expect(text).toContain('ΤΑΜΕΙΟ');
    expect(text).toContain('ΜΕΤΡΗΤΑ');
    expect(text).not.toContain('ΜΕΤΡΗΤΑ LIM');
    expect(text).toContain('Nice');
    expect(text).toContain('Έξοδο 2');
    expect(text).toContain('WOLT');
    expect(text).toContain('45,60€');
    expect(text).toContain('Χαρτονομίσματα');
  });

  it('submits the closing it was opened with, even if the draft underneath changes', async () => {
    const onSubmit = vi.fn(submitted);
    const noop = vi.fn();
    const share: ShareFn = async () => 'shared';
    const { rerender } = render(<SubmitSheet config={cfg} draft={d} derived={derived} revision={7} blocked={null} onSubmit={onSubmit} onShare={share} onClose={noop} />);
    const fresh = newDraft('2026-09-29');
    rerender(<SubmitSheet config={cfg} draft={fresh} derived={deriveClosing(cfg, fresh)} revision={8} blocked={null} onSubmit={onSubmit} onShare={share} onClose={noop} />);
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain('28/09/2026');
    expect(text).not.toContain('29/09/2026');
    await tapSubmit();
    expect(onSubmit).toHaveBeenCalledWith(derived.inputs, 7);
  });

  it('after draft_changed shows the live closing, asks to check, and sends it with its revision on the next tap', async () => {
    const onSubmit = vi
      .fn<SubmitFn>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'draft_changed', revision: 8 } })
      .mockImplementation(submitted);
    const noop = vi.fn();
    const share: ShareFn = async () => 'shared';
    const { rerender } = render(<SubmitSheet config={cfg} draft={d} derived={derived} revision={7} blocked={null} onSubmit={onSubmit} onShare={share} onClose={noop} />);
    await tapSubmit();
    expect(screen.getByRole('alert').textContent).toBe('Κάποιος άλλαξε κάτι — έλεγξε και πάτα ξανά Υποβολή');
    const fresh: Draft = { ...d, entries: boxes({ '10000': '100' }) };
    const freshDerived = deriveClosing(cfg, fresh);
    rerender(<SubmitSheet config={cfg} draft={fresh} derived={freshDerived} revision={8} blocked="Περιμένει αποθήκευση…" onSubmit={onSubmit} onShare={share} onClose={noop} />);
    // Following the live closing: the card shows it, and a blocked closing can't be sent.
    expect(screen.getByRole('status').textContent).toBe('Περιμένει αποθήκευση…');
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SubmitSheet config={cfg} draft={fresh} derived={freshDerived} revision={8} blocked={null} onSubmit={onSubmit} onShare={share} onClose={noop} />);
    await tapSubmit();
    expect(onSubmit).toHaveBeenLastCalledWith(freshDerived.inputs, 8);
    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' })).toBeTruthy();
    // Frozen again after the tap: a later change underneath doesn't change the submitted card.
    const card = () => document.querySelector('.share-card')?.textContent;
    const sent = card();
    rerender(<SubmitSheet config={cfg} draft={d} derived={derived} revision={9} blocked={null} onSubmit={onSubmit} onShare={share} onClose={noop} />);
    expect(card()).toBe(sent);
    expect(sent).not.toBe(undefined);
  });

  it('submits, then offers sharing and closing the sheet', async () => {
    const { onSubmit, onClose } = setup();
    await tapSubmit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const done = screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' });
    expect(within(done).queryByRole('button', { name: 'Υποβολή' })).toBeNull();
    expect(within(done).queryByRole('button', { name: 'Νέο κλείσιμο' })).toBeNull();
    fireEvent.click(within(done).getByRole('button', { name: 'Τέλος' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says why a submit failed and lets the person try again', async () => {
    const onSubmit = vi.fn<SubmitFn>().mockResolvedValueOnce({ ok: false, error: { code: 'network' } }).mockImplementation(submitted);
    setup(onSubmit);
    await tapSubmit();
    expect(screen.getByRole('alert').textContent).toBe('Δεν υπάρχει σύνδεση.');
    expect(screen.getByRole('dialog', { name: 'Υποβολή' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Κοινοποίηση' })).toBeNull();
    await tapSubmit();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a second tap while the submit is in flight', async () => {
    let resolve: (r: DResult<{ closingId: string; repeat: boolean }>) => void = () => {};
    const onSubmit = vi.fn<SubmitFn>(() => new Promise((r) => (resolve = r)));
    setup(onSubmit);
    const btn = within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, data: { closingId: 'c1', repeat: true } }));
    expect(screen.getByRole('dialog', { name: 'Υποβλήθηκε ✓' })).toBeTruthy();
  });

  it('keeps the photo picker keyboard-reachable instead of removing it from the tab order', () => {
    setup();
    const fileInput = screen.getByLabelText('Φωτογραφία Ζ') as HTMLInputElement;
    // `hidden` drops the control from the accessibility tree and tab order entirely; a visually
    // hidden class keeps it focusable/reachable while off-screen.
    expect(fileInput.hidden).toBe(false);
    expect(fileInput.className).toContain('sr-only');
    // The accessible name must come from the label text (which flips to '✓ …'), not a fixed
    // aria-label that would go stale once a photo is picked.
    expect(fileInput.getAttribute('aria-label')).toBeNull();
  });

  it('shares the card with the picked Z photo (never stored by the sheet)', async () => {
    const onShare = vi.fn<ShareFn>(async () => 'shared');
    setup(undefined, onShare);
    const photo = new File(['z'], 'z.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('Φωτογραφία Ζ');
    fireEvent.change(fileInput, { target: { files: [photo] } });
    expect(screen.getByText('✓ Φωτογραφία Ζ')).toBeTruthy();
    await tapSubmit();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(onShare).toHaveBeenCalledTimes(1);
    const [card, file] = onShare.mock.calls[0]!;
    expect(card.textContent).toContain('28/09/2026');
    expect(file).toBe(photo);
  });

  it('reports a failed share', async () => {
    setup(undefined, vi.fn<ShareFn>(async () => 'failed'));
    await tapSubmit();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Η κοινοποίηση απέτυχε.');
  });
});
