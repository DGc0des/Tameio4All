// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmountField } from '../../src/ui/AmountField';
import { Card } from '../../src/ui/Card';
import { Sheet } from '../../src/ui/Sheet';

afterEach(cleanup);

describe('AmountField', () => {
  it('reports typed text and marks invalid state', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AmountField id="f" label="100€" value="" onChange={onChange} />);
    const input = screen.getByLabelText('100€');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(input, { target: { value: '500' } });
    expect(onChange).toHaveBeenCalledWith('500');
    rerender(<AmountField id="f" label="100€" value="95" invalid inputMode="numeric" onChange={onChange} />);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });
});

describe('Card', () => {
  it('renders a titled section with an aside', () => {
    render(<Card title="Κέρματα" aside="52,55€"><p>body</p></Card>);
    const section = screen.getByRole('region', { name: 'Κέρματα' });
    expect(section.textContent).toContain('52,55€');
    expect(section.textContent).toContain('body');
  });
});

describe('Sheet', () => {
  it('closes on Escape and on backdrop click, not on content click', () => {
    const onClose = vi.fn();
    render(<Sheet title="Φάκελος" subtitle="60,00€" onClose={onClose}><p>inside</p></Sheet>);
    const dialog = screen.getByRole('dialog', { name: 'Φάκελος' });
    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByText('60,00€')).toBeTruthy();
  });
});
