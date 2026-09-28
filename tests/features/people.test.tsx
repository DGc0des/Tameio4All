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

  it('keeps typed input when a different row is removed (key stability)', () => {
    const onChange = vi.fn();
    const { rerender } = render(<StaffScreen staff={['A', 'B', 'C']} onChange={onChange} onBack={vi.fn()} />);
    const input2 = screen.getByLabelText('Όνομα 2');
    fireEvent.change(input2, { target: { value: 'B2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση A' }));
    expect(onChange).toHaveBeenLastCalledWith(['B', 'C']);
    rerender(<StaffScreen staff={['B', 'C']} onChange={onChange} onBack={vi.fn()} />);
    expect((screen.getByLabelText('Όνομα 1') as HTMLInputElement).value).toBe('B2');
  });

  it('rejects renaming to whitespace and restores original value', () => {
    const onChange = vi.fn();
    render(<StaffScreen staff={['ORIGINAL']} onChange={onChange} onBack={vi.fn()} />);
    const input = screen.getByLabelText('Όνομα 1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('ORIGINAL');
  });
});

describe('HeaderMenu closing', () => {
  it('closes on Escape key', () => {
    render(<HeaderMenu hasTare={false} themePref="system" onNavigate={vi.fn()} onTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on pointerdown outside the menu', () => {
    render(<HeaderMenu hasTare={false} themePref="system" onNavigate={vi.fn()} onTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not close when clicking a menu item (lets click handler run)', () => {
    const onNavigate = vi.fn();
    render(<HeaderMenu hasTare={false} themePref="system" onNavigate={onNavigate} onTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Προσωπικό' }));
    expect(onNavigate).toHaveBeenCalledWith('staff');
  });
});
