// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderMenu } from '../../src/features/register/HeaderMenu';

afterEach(cleanup);

describe('HeaderMenu', () => {
  it('has no Αποβάρα or Προσωπικό item and cycles theme', () => {
    const onTheme = vi.fn();
    render(<HeaderMenu themePref="system" onOwner={vi.fn()} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.queryByRole('menuitem', { name: 'Αποβάρα' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Προσωπικό' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Θέμα: Αυτόματο' }));
    expect(onTheme).toHaveBeenCalled();
  });
});

describe('HeaderMenu closing', () => {
  it('closes on Escape key', () => {
    render(<HeaderMenu themePref="system" onOwner={vi.fn()} onTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on pointerdown outside the menu', () => {
    render(<HeaderMenu themePref="system" onOwner={vi.fn()} onTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs a menu item and closes', () => {
    const onOwner = vi.fn();
    render(<HeaderMenu themePref="system" onOwner={onOwner} onTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Μενού' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Διαχείριση καταστήματος' }));
    expect(onOwner).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
