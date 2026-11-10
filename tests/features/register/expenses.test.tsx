// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinJuicePreset as cfg } from '../../../src/core/presets';
import type { SupplierHistory } from '../../../src/core/suggestions';
import { deriveClosing } from '../../../src/features/register/derive';
import type { Draft } from '../../../src/features/register/draft';
import { ExpensesCard } from '../../../src/features/register/ExpensesCard';
import type { FieldBinding } from '../../../src/features/register/FieldBinding';
import type { FieldKey, PendingEdit, Snapshot } from '../../../src/features/register/live/fields';
import { draftFromFields } from '../../../src/features/register/live/merge';

afterEach(cleanup);

let n = 0;
const nextId = () => `e${++n}`;
const HISTORY: SupplierHistory = { 'Ντόντης': [2400, 1800], 'Nice': [1300] };
const EMPTY: Snapshot = { id: 'oc', businessDate: '2026-09-28', configId: 'c', config: cfg, revision: 0, lastSubmit: null, fields: {} };

let lastDraft: Draft | null = null;
let edits: { key: FieldKey; value: unknown }[] = [];
const flush = vi.fn();

/** The card over the real merge: every edit becomes a pending edit of an empty snapshot. */
function Harness({ max = 10, history = HISTORY }: { max?: number; history?: SupplierHistory }) {
  const [pending, setPending] = useState<PendingEdit[]>([]);
  const draft = draftFromFields(EMPTY, pending);
  lastDraft = draft;
  const binding: FieldBinding = {
    edit: (key, value) => {
      edits.push({ key, value });
      setPending((p) => [...p, { author: 'staff-maria', key, value, businessDate: EMPTY.businessDate, baseVersion: null, queuedOffline: false, seq: p.length + 1 }]);
    },
    flush,
    focus: vi.fn(),
    editing: {},
  };
  return (
    <ExpensesCard
      maxExpenses={max}
      draft={draft}
      derived={deriveClosing(cfg, draft)}
      history={history}
      author={{ kind: 'staff', id: 'staff-maria' }}
      binding={binding}
      newId={nextId}
      nowMs={() => 42}
    />
  );
}

const add = () => fireEvent.click(screen.getByRole('button', { name: '+ Έξοδο' }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ExpensesCard', () => {
  it('a new line writes its meta at once, with the signed-in author and its creation order', () => {
    edits = [];
    render(<Harness />);
    add();
    const id = lastDraft!.expenses[0]!.id;
    expect(edits).toEqual([{ key: `e:${id}`, value: { addedBy: { kind: 'staff', id: 'staff-maria' }, removed: false, order: 42 } }]);
    expect(flush).toHaveBeenCalledWith(`e:${id}`);
    type('Περιγραφή εξόδου 1', 'Γάλα');
    type('Ποσό εξόδου 1', '1,5');
    expect(edits.slice(1)).toEqual([
      { key: `e:${id}:d`, value: { text: 'Γάλα' } },
      { key: `e:${id}:a`, value: { text: '1.5' } },
    ]);
  });

  it('removing a line keeps its meta and marks it removed', () => {
    edits = [];
    render(<Harness />);
    add();
    const id = lastDraft!.expenses[0]!.id;
    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση εξόδου 1' }));
    expect(edits.at(-1)).toEqual({ key: `e:${id}`, value: { addedBy: { kind: 'staff', id: 'staff-maria' }, removed: true, order: 42 } });
    expect(lastDraft!.expenses).toHaveLength(0);
  });

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
    const input = screen.getByLabelText('Ποσό εξόδου 1');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const hint = screen.getByText('πολλά δεκαδικά');
    expect(hint).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });
});
