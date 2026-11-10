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
import type { FieldBinding } from '../../../src/features/register/FieldBinding';
import { boxes } from './boxes';

afterEach(cleanup);

const BILLS = [10000, 5000, 2000, 1000, 500];
const draft = (changes: Partial<Draft>): Draft => ({ ...newDraft('2026-09-28'), ...changes });
const binding = (editing: FieldBinding['editing'] = {}) => ({ edit: vi.fn(), flush: vi.fn(), focus: vi.fn(), editing });

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
    const d = draft({ entries: boxes({ '10000': '500' }) });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={50000} draft={d} derived={deriveClosing(cfg, d)} binding={binding()} viewMode="amount" />);
    const row = screen.getByLabelText('100€').closest('.row') as HTMLElement;
    expect(row.querySelector('.row-hint')).toBeNull();
    expect(screen.getByRole('region', { name: 'Χαρτονομίσματα' }).textContent).toContain('500,00€');
  });

  it('in # mode shows the row value in euros beside the count', () => {
    const d = draft({ entries: boxes({ '10000': '5' }, 'count') });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={50000} draft={d} derived={deriveClosing(cfg, d)} binding={binding()} viewMode="count" />);
    const row = screen.getByLabelText('100€').closest('.row') as HTMLElement;
    expect(within(row).getByText('500,00€')).toBeTruthy();
    expect(screen.getByLabelText('100€').getAttribute('inputmode')).toBe('numeric');
  });

  it('marks an invalid row and shows why', () => {
    const d = draft({ entries: boxes({ '1000': '95' }) });
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} binding={binding()} viewMode="amount" />);
    const input = screen.getByLabelText('10€');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const hint = within(input.closest('.row') as HTMLElement).getByText('όχι πολλαπλάσιο');
    expect(hint).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('writes the box (sanitized text + mode) on typing; focus/blur drive presence and flush', () => {
    const b = binding();
    const d = draft({});
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} binding={b} viewMode="amount" />);
    fireEvent.focus(screen.getByLabelText('50€'));
    expect(b.focus).toHaveBeenCalledWith('d:5000');
    fireEvent.change(screen.getByLabelText('50€'), { target: { value: '3,00' } });
    expect(b.edit).toHaveBeenCalledWith('d:5000', { text: '3.00', mode: 'amount' });
    fireEvent.blur(screen.getByLabelText('50€'));
    expect(b.focus).toHaveBeenLastCalledWith(null);
    expect(b.flush).toHaveBeenCalledWith('d:5000');
  });

  it('shows who else is in a box, inside its row', () => {
    const d = draft({});
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} binding={binding({ 'd:2000': ['ΝΙΚΟΣ'] })} viewMode="amount" />);
    const row = screen.getByLabelText('20€').closest('.row') as HTMLElement;
    const tag = row.querySelector('.presence') as HTMLElement;
    expect(tag.textContent).toBe('Επεξεργάζεται: ΝΙΚΟΣ');
    expect(within(tag).getByText('Επεξεργάζεται:').className).toBe('sr-only');
    expect(document.querySelectorAll('.presence')).toHaveLength(1);
  });
});

describe('CountCard per-box mode', () => {
  const show = (d: Draft, viewMode: 'amount' | 'count', b = binding()) =>
    render(<CountCard title="Χαρτονομίσματα" denominations={BILLS} totalCents={0} draft={d} derived={deriveClosing(cfg, d)} binding={b} viewMode={viewMode} />);

  it('shows an amount-mode box converted to pieces in count view, and derives from its own mode', () => {
    const d = draft({ entries: boxes({ '10000': '300' }) });
    show(d, 'count');
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('3');
    expect(deriveClosing(cfg, d).inputs.counts).toEqual({ '10000': 3 });
    expect(deriveClosing(cfg, d).rowCents['10000']).toBe(30000);
  });

  it('keeps an invalid box as typed in the other view and shows its error', () => {
    const d = draft({ entries: boxes({ '10000': '30' }) });
    show(d, 'count');
    const input = screen.getByLabelText('100€') as HTMLInputElement;
    expect(input.value).toBe('30');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(within(input.closest('.row') as HTMLElement).getByText('όχι πολλαπλάσιο')).toBeTruthy();
  });

  it('typing stores the text in the current view mode', () => {
    const b = binding();
    show(draft({}), 'count', b);
    fireEvent.change(screen.getByLabelText('50€'), { target: { value: '4' } });
    expect(b.edit).toHaveBeenCalledWith('d:5000', { text: '4', mode: 'count' });
  });
});

describe('ChannelsCard', () => {
  it('lists channels, offers the calculator only for cash_extra, writes the channel box', () => {
    const b = binding({ 'c:efood': ['Ιδιοκτήτης'] });
    const onCalculator = vi.fn();
    const d = draft({});
    render(<ChannelsCard channels={cfg.channels} draft={d} derived={deriveClosing(cfg, d)} binding={b} onCalculator={onCalculator} />);
    fireEvent.change(screen.getByLabelText('WOLT'), { target: { value: '45,60' } });
    expect(b.edit).toHaveBeenCalledWith('c:wolt', { text: '45.60' });
    fireEvent.blur(screen.getByLabelText('WOLT'));
    expect(b.flush).toHaveBeenCalledWith('c:wolt');
    expect((screen.getByLabelText('EFOOD').closest('.row') as HTMLElement).querySelector('.presence')?.textContent).toBe('Επεξεργάζεται: Ιδιοκτήτης');
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
