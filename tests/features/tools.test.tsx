// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset } from '../../src/core/presets';
import { CoinCalcSheet } from '../../src/features/register/CoinCalcSheet';
import { sumAmounts } from '../../src/features/register/coinCalc';
import { TareScreen } from '../../src/features/tare/TareScreen';

afterEach(cleanup);

describe('sumAmounts', () => {
  it('adds valid rows, ignores empty ones, reports invalid ones', () => {
    expect(sumAmounts(['100', '', '50,50'])).toEqual({ cents: 15050, invalidIndexes: [] });
    expect(sumAmounts(['1.234', '5'])).toEqual({ cents: 500, invalidIndexes: [0] });
    expect(sumAmounts([])).toEqual({ cents: 0, invalidIndexes: [] });
  });
});

describe('CoinCalcSheet', () => {
  it('sums batches, grows a new row, and applies the total', () => {
    const onApply = vi.fn();
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Άθροισμα · ΚΕΡΜΑΤΑ' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ποσό 1'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Ποσό 3'), { target: { value: '50' } });
    expect(screen.getByLabelText('Ποσό 4')).toBeTruthy();
    expect(screen.getByText('150,00€')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Καταχώρηση' }));
    expect(onApply).toHaveBeenCalledWith('150');
  });

  it('blocks applying while a row is invalid', () => {
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ποσό 1'), { target: { value: '1.234' } });
    expect((screen.getByRole('button', { name: 'Καταχώρηση' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TareScreen', () => {
  it('shows net weight per product', () => {
    const onBack = vi.fn();
    render(<TareScreen items={joinJuicePreset.tareItems} onBack={onBack} />);
    fireEvent.change(screen.getByLabelText('Βάρος Σολομός μπροστά (kg)'), { target: { value: '1,2' } });
    expect(screen.getByLabelText('Καθαρό Σολομός μπροστά').textContent).toBe('0.840');
    fireEvent.change(screen.getByLabelText('Βάρος Κοτόπουλο (kg)'), { target: { value: '0.1' } });
    expect(screen.getByLabelText('Καθαρό Κοτόπουλο').textContent).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(onBack).toHaveBeenCalled();
  });
});
