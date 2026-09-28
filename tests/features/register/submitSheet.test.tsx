// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import type { SaveResult } from '../../../src/data/local/submissions';
import { deriveClosing } from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';
import type { ShareFn } from '../../../src/features/register/share';
import { SubmitSheet } from '../../../src/features/register/SubmitSheet';

afterEach(cleanup);

const d: Draft = {
  ...newDraft('d1', '2026-09-28', 'ΓΚΡΕΖΙΟΣ'),
  entries: { '10000': '1500', '5000': '50' },
  channels: { wolt: '45,60' },
  expenses: [
    { id: 'e1', description: 'Nice', amountText: '13' },
    { id: 'e2', description: '', amountText: '2' },
  ],
};
const derived = deriveClosing(cfg, d);

function setup(onSave: () => SaveResult = vi.fn(() => 'saved' as const), onShare: ShareFn = vi.fn(async () => 'shared' as const)) {
  const onClose = vi.fn();
  render(<SubmitSheet config={cfg} draft={d} derived={derived} onSave={onSave} onShare={onShare} onClose={onClose} />);
  return { onSave, onShare, onClose, dialog: () => screen.getByRole('dialog') };
}

describe('SubmitSheet', () => {
  it('shows the share card: staff, date, shared totals, expenses, channels, what stays', () => {
    const { dialog } = setup();
    const text = dialog().textContent ?? '';
    expect(text).toContain('ΓΚΡΕΖΙΟΣ');
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

  it('keeps showing the closing it was opened with after the form underneath resets', () => {
    const noop = vi.fn();
    const { rerender } = render(
      <SubmitSheet config={cfg} draft={d} derived={derived} onSave={() => 'saved'} onShare={vi.fn<ShareFn>(async () => 'shared')} onClose={noop} />,
    );
    const fresh = newDraft('d2', '2026-09-29', 'ΜΑΡΙΑ');
    rerender(
      <SubmitSheet config={cfg} draft={fresh} derived={deriveClosing(cfg, fresh)} onSave={() => 'saved'} onShare={vi.fn<ShareFn>(async () => 'shared')} onClose={noop} />,
    );
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain('ΓΚΡΕΖΙΟΣ');
    expect(text).toContain('28/09/2026');
    expect(text).not.toContain('ΜΑΡΙΑ');
  });

  it('saves, then offers sharing and a new closing', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = screen.getByRole('dialog', { name: 'Αποθηκεύτηκε ✓' });
    expect(within(saved).queryByRole('button', { name: 'Υποβολή' })).toBeNull();
    fireEvent.click(within(saved).getByRole('button', { name: 'Νέο κλείσιμο' }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('keeps the form and says so when saving fails', () => {
    const { onClose } = setup(vi.fn(() => 'failed' as const));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    expect(screen.getByRole('alert').textContent).toBe('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
    expect(screen.getByRole('dialog', { name: 'Υποβολή' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('shares the card with the picked Z photo (never stored by the sheet)', async () => {
    const onShare = vi.fn<ShareFn>(async () => 'shared');
    setup(undefined, onShare);
    const photo = new File(['z'], 'z.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('Φωτογραφία Ζ');
    fireEvent.change(fileInput, { target: { files: [photo] } });
    expect(screen.getByText('✓ Φωτογραφία Ζ')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(onShare).toHaveBeenCalledTimes(1);
    const [card, file] = onShare.mock.calls[0]!;
    expect(card.textContent).toContain('ΓΚΡΕΖΙΟΣ');
    expect(file).toBe(photo);
  });

  it('reports a failed share', async () => {
    setup(undefined, vi.fn<ShareFn>(async () => 'failed'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Κοινοποίηση' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Η κοινοποίηση απέτυχε.');
  });
});
