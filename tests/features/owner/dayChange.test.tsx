// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayChangeCard } from '../../../src/features/owner/settings/DayChangeCard';
import { fail, fakeApi, ok } from './fakeApi';

afterEach(cleanup);
const SHOP = '11111111-1111-4111-8111-111111111111';
const input = () => screen.getByLabelText('Ώρα αλλαγής ημέρας') as HTMLInputElement;

describe('DayChangeCard', () => {
  it('shows the current time from the server', async () => {
    render(<DayChangeCard api={fakeApi()} shopId={SHOP} />);
    await screen.findByText('Αλλαγή ημέρας');
    expect(input().value).toBe('04:00');
    expect(screen.getByText('Κλεισίματα πριν από αυτή την ώρα μετράνε για την προηγούμενη μέρα.')).toBeTruthy();
  });

  it('saves and shows when it takes effect', async () => {
    const setDayChange = vi.fn(() => ok('2026-11-08'));
    const api = fakeApi({ setDayChange });
    render(<DayChangeCard api={api} shopId={SHOP} />);
    await screen.findByText('Αλλαγή ημέρας');
    fireEvent.change(input(), { target: { value: '06:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Ισχύει από Κυρ 08/11')).toBeTruthy();
    expect(setDayChange).toHaveBeenCalledWith(SHOP, '06:00');
  });

  it('shows a pending switch date that came with the load', async () => {
    const api = fakeApi({ dayChange: vi.fn(() => ok({ time: '06:00', fromDate: '2026-11-08' })) });
    render(<DayChangeCard api={api} shopId={SHOP} />);
    expect(await screen.findByText('Ισχύει από Κυρ 08/11')).toBeTruthy();
    expect(input().value).toBe('06:00');
  });

  it('shows the owner error message', async () => {
    const api = fakeApi({ setDayChange: vi.fn(() => fail({ code: 'not_owner' })) });
    render(<DayChangeCard api={api} shopId={SHOP} />);
    await screen.findByText('Αλλαγή ημέρας');
    fireEvent.change(input(), { target: { value: '05:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    expect(screen.queryByText(/Ισχύει από/)).toBeNull();
  });
});
