// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { loadStaff, saveStaff } from '../../src/data/local/staff';
import { memoryStore, shopKey, type KeyValueStore } from '../../src/data/local/storage';
import { loadSubmissions } from '../../src/data/local/submissions';
import type { ShareFn } from '../../src/features/register/share';

const NOW = () => new Date(2026, 8, 28, 22, 0);
let n = 0;
const newId = () => `id-${++n}`;
const share = vi.fn<ShareFn>(async () => 'shared');

beforeEach(() => {
  n = 0;
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function start(store: KeyValueStore = memoryStore(), persistent = true) {
  render(<App appStore={{ store, persistent }} now={NOW} newId={newId} share={share} />);
  return store;
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const barAmount = () => document.querySelector('.bar strong')?.textContent;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

function typeV2Closing() {
  for (const [label, value] of [
    ['100€', '500'], ['50€', '300'], ['20€', '240'], ['10€', '90'], ['5€', '35'], ['2€', '24'], ['1€', '17'],
    ['50c', '6.5'], ['20c', '3.4'], ['10c', '1.2'], ['5c', '0.45'],
    ['ΚΕΡΜΑΤΑ', '150'], ['WOLT', '45,60'], ['EFOOD', '23.10'], ['myPos', '310.25'], ['Eurobank', '88.40'],
  ] as const) type(label, value);
  fireEvent.click(button('+ Έξοδο'));
  type('Περιγραφή εξόδου 1', 'Nice');
  type('Ποσό εξόδου 1', '12.50');
  fireEvent.click(button('+ Έξοδο'));
  type('Ποσό εξόδου 2', '7,80');
}

describe('register flows', () => {
  it('reproduces a tameioV2 closing end to end (comma decimals included)', () => {
    start();
    typeV2Closing();
    expect(barAmount()).toBe('367,55€');
    expect(screen.getByRole('region', { name: 'Σύνοψη' }).textContent).toContain('1.855,20€');
    expect(screen.getByRole('region', { name: 'Έξοδα' }).textContent).toContain('20,30€');
  });

  it('switching € → # converts what was typed and keeps the totals', () => {
    start();
    type('100€', '1500');
    fireEvent.click(button('# Κομμάτια'));
    const field = screen.getByLabelText('100€') as HTMLInputElement;
    expect(field.value).toBe('15');
    expect(within(field.closest('.row') as HTMLElement).getByText('1.500,00€')).toBeTruthy();
    expect(barAmount()).toBe('500,00€');
  });

  it('blocks Φάκελος and Υποβολή while a field is wrong, and names it', () => {
    start();
    type('10€', '95');
    expect(button('Φάκελος').disabled).toBe(true);
    expect(button('Υποβολή').disabled).toBe(true);
    expect(screen.getByText('Λάθος τιμή: 10€')).toBeTruthy();
  });

  it('flags a Greek thousands separator instead of reading it as 1,50€', () => {
    start();
    type('100€', '1.500');
    expect(screen.getByLabelText('100€').getAttribute('aria-invalid')).toBe('true');
    expect(button('Φάκελος').disabled).toBe(true);
  });

  it('opens the exact Φάκελος (60€ as 3×20€)', () => {
    start();
    type('50€', '50');
    type('20€', '60');
    type('ΚΕΡΜΑΤΑ', '950');
    fireEvent.click(button('Φάκελος'));
    const sheet = screen.getByRole('dialog', { name: 'Φάκελος' });
    expect(within(sheet).getByText('60,00€ σε 3 κομμάτια')).toBeTruthy();
    expect(within(sheet).getByText('✓ Ακριβές ποσό')).toBeTruthy();
  });

  it('submits once, resets the numbers but keeps staff and date, and learns the expense', () => {
    const store = memoryStore();
    saveStaff(store, 'local', ['ΓΚΡΕΖΙΟΣ']);
    start(store);
    expect(button('Υποβολή').disabled).toBe(true);
    expect(screen.getByText('Διάλεξε όνομα για υποβολή')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    fireEvent.click(button('Εντάξει'));

    type('100€', '1500');
    fireEvent.click(button('+ Έξοδο'));
    type('Περιγραφή εξόδου 1', 'Ντόντης');
    type('Ποσό εξόδου 1', '24');

    fireEvent.click(button('Υποβολή'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
    expect(loadSubmissions(store, 'local')).toHaveLength(1);
    // The form resets as soon as the closing is saved; the sheet keeps showing the saved closing.
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('dialog', { name: 'Αποθηκεύτηκε ✓' }).textContent).toContain('1.524,00€');
    fireEvent.click(button('Νέο κλείσιμο'));

    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Δευ 28/09 · ΓΚΡΕΖΙΟΣ' })).toBeTruthy();
    expect(screen.getByText('Το κλείσιμο αποθηκεύτηκε')).toBeTruthy();
    expect(loadSubmissions(store, 'local')).toHaveLength(1);

    fireEvent.click(button('+ Έξοδο'));
    type('Ποσό εξόδου 1', '24');
    expect(screen.getByRole('button', { name: 'Ντόντης' })).toBeTruthy();
  });

  it('says so and keeps the form when the device refuses to save', () => {
    const base = memoryStore();
    const failing: KeyValueStore = {
      getItem: (k) => base.getItem(k),
      removeItem: (k) => base.removeItem(k),
      setItem: (k, v) => {
        if (k.endsWith(':submissions')) throw new Error('QuotaExceededError');
        base.setItem(k, v);
      },
    };
    saveStaff(failing, 'local', ['ΓΚΡΕΖΙΟΣ']);
    start(failing);
    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    fireEvent.click(button('Εντάξει'));
    type('100€', '1500');
    fireEvent.click(button('Υποβολή'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Υποβολή' }));
    expect(screen.getByRole('alert').textContent).toBe('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
    expect(screen.queryByText('Το κλείσιμο αποθηκεύτηκε')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('1500');
  });
});

describe('persistence and resilience', () => {
  it('restores the draft after a reload', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = start();
    type('100€', '500');
    act(() => {
      vi.advanceTimersByTime(350);
    });
    cleanup();
    start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('500');
  });

  it('starts fresh when the stored draft is corrupt', () => {
    const store = memoryStore();
    store.setItem(shopKey('local', 'draft'), JSON.stringify({ savedAt: NOW().getTime(), draft: { id: 5 } }));
    start(store);
    expect((screen.getByLabelText('100€') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
  });

  it('warns when storage is unavailable', () => {
    start(memoryStore(), false);
    expect(screen.getByText('Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('adds a name in Προσωπικό and offers it back on the register', () => {
    const store = start();
    fireEvent.click(button('Μενού'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Προσωπικό' }));
    type('Νέο όνομα', 'ΜΑΡΙΑ');
    fireEvent.click(button('Προσθήκη'));
    expect(loadStaff(store, 'local')).toEqual(['ΜΑΡΙΑ']);
    fireEvent.click(button('Πίσω'));
    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    expect(screen.getByRole('radio', { name: 'ΜΑΡΙΑ' })).toBeTruthy();
  });

  it('opens Αποβάρα from the menu and fills ΚΕΡΜΑΤΑ from the calculator', () => {
    start();
    fireEvent.click(button('Άθροισμα για ΚΕΡΜΑΤΑ'));
    type('Ποσό 1', '100');
    type('Ποσό 2', '50');
    fireEvent.click(button('Καταχώρηση'));
    expect((screen.getByLabelText('ΚΕΡΜΑΤΑ') as HTMLInputElement).value).toBe('150');
    fireEvent.click(button('Μενού'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Αποβάρα' }));
    expect(screen.getByRole('heading', { name: 'Αποβάρα' })).toBeTruthy();
  });

  it('closes an open sheet when leaving the register via the URL (phone Back)', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    expect(screen.getByRole('dialog', { name: 'Ποιος κλείνει;' })).toBeTruthy();
    act(() => {
      window.location.hash = '#/staff';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => {
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
  });

  it('stores the next closing even when the person left without tapping Νέο κλείσιμο', () => {
    const store = memoryStore();
    saveStaff(store, 'local', ['ΓΚΡΕΖΙΟΣ']);
    start(store);
    fireEvent.click(screen.getByRole('button', { name: /Διάλεξε όνομα/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'ΓΚΡΕΖΙΟΣ' }));
    fireEvent.click(button('Εντάξει'));
    type('100€', '1500');
    fireEvent.click(button('Υποβολή'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
    act(() => {
      window.location.hash = '#/staff';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    act(() => {
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    type('100€', '2000');
    fireEvent.click(button('Υποβολή'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Υποβολή' })).getByRole('button', { name: 'Υποβολή' }));
    const subs = loadSubmissions(store, 'local');
    expect(subs).toHaveLength(2);
    expect(subs[1]?.inputs.counts['10000']).toBe(20);
  });
});
