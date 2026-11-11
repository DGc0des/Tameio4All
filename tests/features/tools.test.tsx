// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinCalcSheet } from '../../src/features/register/CoinCalcSheet';
import { sumAmounts } from '../../src/features/register/coinCalc';

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

  it('removes a row (the others keep their amounts) and adds an empty one', () => {
    const onApply = vi.fn();
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={onApply} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ποσό 1'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Ποσό 2'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Ποσό 3'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση ποσού 2' }));
    expect((screen.getByLabelText('Ποσό 1') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Ποσό 2') as HTMLInputElement).value).toBe('30');
    expect(screen.getByText('40,00€')).toBeTruthy();
    const before = screen.getAllByLabelText(/^Ποσό \d+$/).length;
    fireEvent.click(screen.getByRole('button', { name: '+ Προσθήκη' }));
    expect(screen.getAllByLabelText(/^Ποσό \d+$/)).toHaveLength(before + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Καταχώρηση' }));
    expect(onApply).toHaveBeenCalledWith('40');
  });

  it('keeps at least three rows after removing', () => {
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση ποσού 1' }));
    expect(screen.getAllByLabelText(/^Ποσό \d+$/)).toHaveLength(3);
  });

  it('blocks applying while a row is invalid', () => {
    render(<CoinCalcSheet label="ΚΕΡΜΑΤΑ" onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ποσό 1'), { target: { value: '1.234' } });
    expect((screen.getByRole('button', { name: 'Καταχώρηση' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
