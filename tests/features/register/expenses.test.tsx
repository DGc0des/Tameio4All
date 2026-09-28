// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import type { SupplierHistory } from '../../../src/core/suggestions';
import { deriveClosing } from '../../../src/features/register/derive';
import { draftReducer, newDraft } from '../../../src/features/register/draft';
import { ExpensesCard } from '../../../src/features/register/ExpensesCard';

afterEach(cleanup);

let n = 0;
const nextId = () => `e${++n}`;
const HISTORY: SupplierHistory = { 'Ντόντης': [2400, 1800], 'Nice': [1300] };

function Harness({ max = 10, history = HISTORY }: { max?: number; history?: SupplierHistory }) {
  const [draft, dispatch] = useReducer(draftReducer, null, () => newDraft('d1', '2026-09-28'));
  const derived = deriveClosing(cfg, draft);
  return <ExpensesCard maxExpenses={max} draft={draft} derived={derived} history={history} dispatch={dispatch} newId={nextId} />;
}

const add = () => fireEvent.click(screen.getByRole('button', { name: '+ Έξοδο' }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ExpensesCard', () => {
  it('adds rows one at a time and totals them in the header', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '12,50');
    add();
    type('Ποσό εξόδου 2', '7.80');
    expect(screen.getByRole('region', { name: 'Έξοδα' }).textContent).toContain('20,30€');
  });

  it('suggests learned suppliers for the amount and fills the description on tap', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '24');
    expect(screen.getByRole('button', { name: 'Ντόντης' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ντόντης' }));
    expect((screen.getByLabelText('Περιγραφή εξόδου 1') as HTMLInputElement).value).toBe('Ντόντης');
    expect(screen.queryByRole('button', { name: 'Ντόντης' })).toBeNull();
  });

  it('auto-fills a unique exact match when leaving the amount field', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '13');
    fireEvent.blur(screen.getByLabelText('Ποσό εξόδου 1'));
    expect((screen.getByLabelText('Περιγραφή εξόδου 1') as HTMLInputElement).value).toBe('Nice');
  });

  it('never overwrites a description the person typed', () => {
    render(<Harness />);
    add();
    type('Περιγραφή εξόδου 1', 'Γάλα');
    type('Ποσό εξόδου 1', '13');
    fireEvent.blur(screen.getByLabelText('Ποσό εξόδου 1'));
    expect((screen.getByLabelText('Περιγραφή εξόδου 1') as HTMLInputElement).value).toBe('Γάλα');
  });

  it('a new shop with no history shows no chips', () => {
    render(<Harness history={{}} />);
    add();
    type('Ποσό εξόδου 1', '24');
    expect(screen.queryAllByRole('button').filter((b) => b.classList.contains('chip'))).toHaveLength(0);
  });

  it('stops at the maximum and removes rows', () => {
    render(<Harness max={2} />);
    add();
    add();
    expect(screen.queryByRole('button', { name: '+ Έξοδο' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση εξόδου 1' }));
    expect(screen.queryByLabelText('Ποσό εξόδου 2')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Έξοδο' })).toBeTruthy();
  });

  it('shows why an amount is invalid', () => {
    render(<Harness />);
    add();
    type('Ποσό εξόδου 1', '1.234');
    expect(screen.getByLabelText('Ποσό εξόδου 1').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('πολλά δεκαδικά')).toBeTruthy();
  });
});
