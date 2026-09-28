// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderMenu } from '../../src/features/register/HeaderMenu';
import { PeopleSheet } from '../../src/features/register/PeopleSheet';
import { StaffScreen } from '../../src/features/staff/StaffScreen';

afterEach(cleanup);

describe('PeopleSheet', () => {
  it('picks a name and a date', () => {
    const onStaff = vi.fn();
    const onDate = vi.fn();
    const onManage = vi.fn();
    render(<PeopleSheet staff={['ΓΚΡΕΖΙΟΣ', 'ΜΑΡΙΑ']} staffName="ΜΑΡΙΑ" businessDate="2026-09-28" onStaff={onStaff} onDate={onDate} onManage={onManage} onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'ΜΑΡΙΑ' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    expect(onStaff).toHaveBeenCalledWith('ΓΚΡΕΖΙΟΣ');
    fireEvent.change(screen.getByLabelText('Ημερομηνία'), { target: { value: '2026-09-27' } });
    expect(onDate).toHaveBeenCalledWith('2026-09-27');
    fireEvent.click(screen.getByRole('button', { name: 'Διαχείριση ονομάτων' }));
    expect(onManage).toHaveBeenCalled();
  });

  it('says when there are no names yet', () => {
    render(<PeopleSheet staff={[]} staffName="" businessDate="2026-09-28" onStaff={vi.fn()} onDate={vi.fn()} onManage={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Δεν υπάρχουν ονόματα ακόμα.')).toBeTruthy();
  });
});

describe('HeaderMenu', () => {
  it('hides Αποβάρα without tare items and navigates / cycles theme', () => {
    const onNavigate = vi.fn();
    const onTheme = vi.fn();
    const { rerender } = render(<HeaderMenu hasTare={false} themePref="system" onNavigate={onNavigate} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.queryByRole('menuitem', { name: 'Αποβάρα' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Θέμα: Αυτόματο' }));
    expect(onTheme).toHaveBeenCalled();
    rerender(<HeaderMenu hasTare themePref="dark" onNavigate={onNavigate} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Αποβάρα' }));
    expect(onNavigate).toHaveBeenCalledWith('tare');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('StaffScreen', () => {
  it('adds, renames and removes names', () => {
    const onChange = vi.fn();
    render(<StaffScreen staff={['ΓΚΡΕΖΙΟΣ', 'ΜΑΡΙΑ']} onChange={onChange} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Νέο όνομα'), { target: { value: 'ΝΙΚΟΣ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(onChange).toHaveBeenLastCalledWith(['ΓΚΡΕΖΙΟΣ', 'ΜΑΡΙΑ', 'ΝΙΚΟΣ']);
    expect((screen.getByLabelText('Νέο όνομα') as HTMLInputElement).value).toBe('');

    const first = screen.getByLabelText('Όνομα 1');
    fireEvent.change(first, { target: { value: 'ΓΚΡΕΖΙΟΣ Δ' } });
    fireEvent.blur(first);
    expect(onChange).toHaveBeenLastCalledWith(['ΓΚΡΕΖΙΟΣ Δ', 'ΜΑΡΙΑ']);

    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση ΜΑΡΙΑ' }));
    expect(onChange).toHaveBeenLastCalledWith(['ΓΚΡΕΖΙΟΣ']);
  });

  it('ignores an empty new name and goes back', () => {
    const onChange = vi.fn();
    const onBack = vi.fn();
    render(<StaffScreen staff={[]} onChange={onChange} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText('Προσωρινό: τα ονόματα αποθηκεύονται μόνο σε αυτή τη συσκευή.')).toBeTruthy();
  });
});
