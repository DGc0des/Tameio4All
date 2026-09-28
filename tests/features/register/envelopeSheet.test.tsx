// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planEnvelope } from '../../../src/core/envelope';
import { EnvelopeSheet } from '../../../src/features/register/EnvelopeSheet';

afterEach(cleanup);
const DENOMS = [5000, 2000, 1000];

describe('EnvelopeSheet', () => {
  it('lists what goes in and confirms an exact amount (60€ = 3×20€)', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(6000, { '5000': 1, '2000': 3 }, DENOMS)} onClose={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Φάκελος' });
    expect(within(sheet).getByText('60,00€ σε 3 κομμάτια')).toBeTruthy();
    const item = within(sheet).getByText('× 3').closest('li') as HTMLElement;
    expect(item.textContent).toContain('20€');
    expect(within(sheet).getByText('✓ Ακριβές ποσό')).toBeTruthy();
    expect(within(sheet).getByText('Τι μένει στο ταμείο')).toBeTruthy();
  });

  it('says how much is missing when the till cannot cover it', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(1000, { '5000': 1 }, DENOMS)} onClose={vi.fn()} />);
    expect(screen.getByText('Λείπουν 10,00€')).toBeTruthy();
  });

  it('uses the singular for one piece', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(5000, { '5000': 1 }, DENOMS)} onClose={vi.fn()} />);
    expect(screen.getByText('50,00€ σε 1 κομμάτι')).toBeTruthy();
  });

  it('explains when there is no cash for an envelope', () => {
    render(<EnvelopeSheet denominations={DENOMS} envelope={planEnvelope(-100000, { '5000': 1 }, DENOMS)} onClose={vi.fn()} />);
    expect(screen.getByText('Δεν υπάρχουν μετρητά για φάκελο.')).toBeTruthy();
  });
});
