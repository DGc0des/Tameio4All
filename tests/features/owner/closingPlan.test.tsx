// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClosingPlanCard } from '../../../src/features/owner/settings/ClosingPlanCard';
import type { ClosingPlan } from '../../../src/data/remote/ownerApi';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '11111111-1111-4111-8111-111111111111';
const plan = (count: number, cashMode: ClosingPlan['cashMode'] = 'separate') => vi.fn(() => ok<ClosingPlan>({ count, cashMode }));
const number = () => screen.getByLabelText('Κλεισίματα');
const plus = () => screen.getByRole('button', { name: 'Περισσότερα κλεισίματα' }) as HTMLButtonElement;
const minus = () => screen.getByRole('button', { name: 'Λιγότερα κλεισίματα' }) as HTMLButtonElement;
const save = () => screen.getByRole('button', { name: 'Αποθήκευση' }) as HTMLButtonElement;
const MODE = 'Τα μετρητά σε κάθε κλείσιμο';

describe('ClosingPlanCard', () => {
  it('loads and shows the stored plan', async () => {
    render(<ClosingPlanCard api={fakeApi({ closingPlan: plan(2, 'running') })} shopId={SHOP} />);
    await screen.findByText('Κλεισίματα ανά ημέρα');
    expect(number().textContent).toBe('2');
    expect((screen.getByRole('radio', { name: /Μένουν στο ταμείο/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('hides the mode choice at 1 and shows it at 2', async () => {
    render(<ClosingPlanCard api={fakeApi()} shopId={SHOP} />);
    await screen.findByText('Κλεισίματα ανά ημέρα');
    expect(screen.queryByText(MODE)).toBeNull();
    fireEvent.click(plus());
    expect(screen.getByText(MODE)).toBeTruthy();
  });

  it('stops at 1 and at 6', async () => {
    render(<ClosingPlanCard api={fakeApi()} shopId={SHOP} />);
    await screen.findByText('Κλεισίματα ανά ημέρα');
    expect(minus().disabled).toBe(true);
    for (let i = 0; i < 10; i++) if (!plus().disabled) fireEvent.click(plus());
    expect(number().textContent).toBe('6');
    expect(plus().disabled).toBe(true);
  });

  it('saves count and cash mode', async () => {
    const setClosingPlan = vi.fn(() => ok(undefined));
    render(<ClosingPlanCard api={fakeApi({ setClosingPlan })} shopId={SHOP} />);
    await screen.findByText('Κλεισίματα ανά ημέρα');
    expect(save().disabled).toBe(true);
    fireEvent.click(plus());
    fireEvent.click(plus());
    fireEvent.click(screen.getByRole('radio', { name: /Μένουν στο ταμείο/ }));
    fireEvent.click(save());
    expect(await screen.findByText('Αποθηκεύτηκε. Μια ημέρα που έχει ήδη ξεκινήσει μένει όπως ξεκίνησε.')).toBeTruthy();
    expect(setClosingPlan).toHaveBeenCalledWith(SHOP, { count: 3, cashMode: 'running' });
    expect(save().disabled).toBe(true);
  });

  it('saves separate when going back to 1', async () => {
    const setClosingPlan = vi.fn(() => ok(undefined));
    render(<ClosingPlanCard api={fakeApi({ closingPlan: plan(2, 'running'), setClosingPlan })} shopId={SHOP} />);
    await screen.findByText('Κλεισίματα ανά ημέρα');
    fireEvent.click(minus());
    fireEvent.click(save());
    await screen.findByText(/Αποθηκεύτηκε/);
    expect(setClosingPlan).toHaveBeenCalledWith(SHOP, { count: 1, cashMode: 'separate' });
  });

  it('shows the error with a retry when the load fails', async () => {
    const closingPlan = vi.fn()
      .mockImplementationOnce(() => fail<ClosingPlan>({ code: 'network' }))
      .mockImplementation(() => ok<ClosingPlan>({ count: 2, cashMode: 'separate' }));
    render(<ClosingPlanCard api={fakeApi({ closingPlan })} shopId={SHOP} />);
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    expect(screen.queryByLabelText('Κλεισίματα')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ξανά' }));
    await screen.findByLabelText('Κλεισίματα');
    expect(number().textContent).toBe('2');
  });

  it('shows the message and re-enables the button when saving fails', async () => {
    const api = fakeApi({ setClosingPlan: vi.fn(() => fail<void>({ code: 'bad_closing_plan' })) });
    render(<ClosingPlanCard api={api} shopId={SHOP} />);
    await screen.findByText('Κλεισίματα ανά ημέρα');
    fireEvent.click(plus());
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe('Τα κλεισίματα ανά ημέρα πρέπει να είναι από 1 έως 6.');
    expect(save().disabled).toBe(false);
    expect(screen.queryByText(/Αποθηκεύτηκε/)).toBeNull();
  });
});
