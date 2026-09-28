// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import { BottomBar } from '../../../src/features/register/BottomBar';
import { ChannelsCard } from '../../../src/features/register/ChannelsCard';
import { CountCard } from '../../../src/features/register/CountCard';
import { deriveClosing } from '../../../src/features/register/derive';
import { newDraft, type Draft } from '../../../src/features/register/draft';
import { ModeSwitch } from '../../../src/features/register/ModeSwitch';
import { SummaryCard } from '../../../src/features/register/SummaryCard';

afterEach(cleanup);

const BILLS = [10000, 5000, 2000, 1000, 500];
const draft = (changes: Partial<Draft>): Draft => ({ ...newDraft('d1', '2026-09-28'), ...changes });

describe('ModeSwitch', () => {
  it('marks the active mode and reports changes', () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="amount" onChange={onChange} />);
    expect(screen.getByRole('button', { name: '€ Ποσό' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '# Κομμάτια' }));
    expect(onChange).toHaveBeenCalledWith('count');
  });
});

describe('CountCard', () => {
  it('in € mode shows only the typed amount — no piece count beside it', () => {
    const d = draft({ entries: { '10000': '500' } });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={50000} draft={d} derived={deriveClosing(cfg, d)} dispatch={vi.fn()} />);
    const row = screen.getByLabelText('100€').closest('.row') as HTMLElement;
    expect(row.querySelector('.row-hint')).toBeNull();
    expect(screen.getByRole('region', { name: 'Χαρτονομίσματα' }).textContent).toContain('500,00€');
  });

  it('in # mode shows the row value in euros beside the count', () => {
    const d = draft({ mode: 'count', entries: { '10000': '5' } });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={50000} draft={d} derived={deriveClosing(cfg, d)} dispatch={vi.fn()} />);
    const row = screen.getByLabelText('100€').closest('.row') as HTMLElement;
    expect(within(row).getByText('500,00€')).toBeTruthy();
    expect(screen.getByLabelText('100€').getAttribute('inputmode')).toBe('numeric');
  });

  it('marks an invalid row and shows why', () => {
    const d = draft({ entries: { '1000': '95' } });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} dispatch={vi.fn()} />);
    const input = screen.getByLabelText('10€');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const hint = within(input.closest('.row') as HTMLElement).getByText('όχι πολλαπλάσιο');
    expect(hint).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('dispatches setEntry on typing', () => {
    const dispatch = vi.fn();
    const d = draft({});
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText('50€'), { target: { value: '300' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setEntry', denom: 5000, text: '300' });
  });
});

describe('ChannelsCard', () => {
  it('lists channels, offers the calculator only for cash_extra, dispatches setChannel', () => {
    const dispatch = vi.fn();
    const onCalculator = vi.fn();
    const d = draft({});
    render(<ChannelsCard channels={cfg.channels} draft={d} derived={deriveClosing(cfg, d)} dispatch={dispatch} onCalculator={onCalculator} />);
    fireEvent.change(screen.getByLabelText('WOLT'), { target: { value: '45,60' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setChannel', id: 'wolt', text: '45,60' });
    expect(screen.getAllByRole('button', { name: /^Άθροισμα για/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Άθροισμα για ΚΕΡΜΑΤΑ' }));
    expect(onCalculator).toHaveBeenCalledWith('kermata');
  });
});

describe('SummaryCard', () => {
  it('shows ΤΑΜΕΙΟ and the envelope total, the rest behind Περισσότερα', () => {
    const totals = { tameio: 185520, expenses_total: 2030, cash: 36755, cash_lim: 38785, income_lim: 78650 };
    render(<SummaryCard config={cfg} totals={totals} />);
    const card = screen.getByRole('region', { name: 'Σύνοψη' });
    expect(card.textContent).toContain('ΤΑΜΕΙΟ');
    expect(card.textContent).toContain('1.855,20€');
    expect(card.querySelector('.tot.main')?.textContent).toContain('367,55€');
    expect(card.textContent).not.toContain('ΕΣΟΔΑ LIM');
    fireEvent.click(screen.getByRole('button', { name: /Περισσότερα/ }));
    expect(card.textContent).toContain('ΕΣΟΔΑ LIM');
    expect(card.textContent).toContain('786,50€');
  });
});

describe('BottomBar', () => {
  it('shows the amount, disables blocked actions and explains why', () => {
    const onEnvelope = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <BottomBar label="ΜΕΤΡΗΤΑ" amountCents={36755} envelopeBlocked={null} submitBlocked="Διάλεξε όνομα για υποβολή" onEnvelope={onEnvelope} onSubmit={onSubmit} />,
    );
    expect(screen.getByText('367,55€')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Διάλεξε όνομα για υποβολή');
    fireEvent.click(screen.getByRole('button', { name: 'Φάκελος' }));
    expect(onEnvelope).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Υποβολή' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<BottomBar label="ΜΕΤΡΗΤΑ" amountCents={0} envelopeBlocked="Λάθος τιμή: 10€" submitBlocked="Λάθος τιμή: 10€" onEnvelope={onEnvelope} onSubmit={onSubmit} />);
    expect((screen.getByRole('button', { name: 'Φάκελος' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Λάθος τιμή: 10€')).toBeTruthy();
  });
});
