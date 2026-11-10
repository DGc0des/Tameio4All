import { describe, expect, it } from 'vitest';
import { joinJuicePreset as cfg } from '../../../../src/core/presets';
import { deriveClosing } from '../../../../src/features/register/derive';
import { applyServerField, draftFromFields, fieldLabel, presenceTags, revisionGap } from '../../../../src/features/register/live/merge';
import type { PendingEdit, ServerField, Snapshot } from '../../../../src/features/register/live/fields';

const field = (key: string, value: unknown, version = 1): ServerField => ({ key, value, version, updatedByName: 'Μαρία', updatedAt: '2026-11-08T10:00:00Z' });
const owner = { kind: 'owner' } as const;
const meta = (order: number, removed = false) => ({ addedBy: owner, removed, order });

function snap(fields: ServerField[] = []): Snapshot {
  return {
    id: 'oc1', businessDate: '2026-11-08', configId: 'cfg1', config: {}, revision: 3, lastSubmit: null,
    fields: Object.fromEntries(fields.map((f) => [f.key, f])),
  };
}
let seq = 0;
const edit = (key: string, value: unknown): PendingEdit => ({ author: 'staff-maria', key, value, businessDate: '2026-11-08', baseVersion: null, queuedOffline: false, seq: ++seq });

describe('draftFromFields', () => {
  it('builds entries, channels and expense lines from the snapshot', () => {
    const d = draftFromFields(snap([
      field('d:10000', { text: '300', mode: 'amount' }),
      field('c:wolt', { text: '5' }),
      field('e:b', meta(20)), field('e:b:d', { text: 'Γάλα' }), field('e:b:a', { text: '2' }),
      field('e:a', meta(10)),
    ]), []);
    expect(d.businessDate).toBe('2026-11-08');
    expect(d.entries).toEqual({ '10000': { text: '300', mode: 'amount' } });
    expect(d.channels).toEqual({ wolt: '5' });
    expect(d.expenses).toEqual([
      { id: 'a', description: '', amountText: '', addedBy: owner, order: 10 },
      { id: 'b', description: 'Γάλα', amountText: '2', addedBy: owner, order: 20 },
    ]);
  });

  it('the latest pending edit per key overrides the snapshot', () => {
    const d = draftFromFields(snap([field('c:wolt', { text: '5' })]), [
      edit('c:wolt', { text: '6' }), edit('c:wolt', { text: '7' }), edit('d:5000', { text: '2', mode: 'count' }),
    ]);
    expect(d.channels.wolt).toBe('7');
    expect(d.entries['5000']).toEqual({ text: '2', mode: 'count' });
  });

  it('applies pending edits by seq, not array order', () => {
    const late = edit('c:wolt', { text: 'late' });
    const early = { ...edit('c:wolt', { text: 'early' }), seq: late.seq - 1 };
    expect(draftFromFields(snap(), [late, early]).channels.wolt).toBe('late');
  });

  it('ignores malformed snapshot values and malformed pending edits', () => {
    const d = draftFromFields(snap([field('c:wolt', { text: '5' }), field('d:5000', { text: '1' }), field('c:bad key', { text: 'x' })]), [
      edit('c:wolt', { text: 99 }), edit('d:1000', 'nope'),
    ]);
    expect(d.channels).toEqual({ wolt: '5' });
    expect(d.entries).toEqual({});
  });

  it('a pending new line appears from its pending meta; :d/:a without meta are ignored', () => {
    const d = draftFromFields(snap([field('e:orphan:a', { text: '9' })]), [
      edit('e:n', meta(5)), edit('e:n:a', { text: '4' }),
    ]);
    expect(d.expenses.map((e) => [e.id, e.amountText])).toEqual([['n', '4']]);
  });

  it('removed lines are excluded entirely, even with a pending amount edit (Review Focus 5)', () => {
    const d = draftFromFields(snap([field('e:x', meta(1, true)), field('e:x:a', { text: '5' })]), [edit('e:x:a', { text: '8' })]);
    expect(d.expenses).toEqual([]);
    const derived = deriveClosing(cfg, d);
    expect(derived.inputs.expenses).toEqual([]);
    expect(derived.expensesCents).toBe(0);
  });

  it('a pending removal hides a line the server still has', () => {
    const d = draftFromFields(snap([field('e:x', meta(1)), field('e:x:a', { text: '5' })]), [edit('e:x', meta(1, true))]);
    expect(d.expenses).toEqual([]);
  });

  it('an amount-mode box shows 300 for 100€ and derives 30000 cents; 30 is an error (Review Focus 4)', () => {
    const ok = deriveClosing(cfg, draftFromFields(snap([field('d:10000', { text: '300', mode: 'amount' })]), []));
    expect(ok.rowCents['10000']).toBe(30000);
    const bad = deriveClosing(cfg, draftFromFields(snap([field('d:10000', { text: '30', mode: 'amount' })]), []));
    expect(bad.errors.map((e) => e.field)).toEqual(['denom:10000']);
  });
});

describe('applyServerField', () => {
  const f = (version: number, revision: number, text = 'v' + version) => ({ ...field('c:wolt', { text }, version), revision });

  it('adds a new field and bumps the revision', () => {
    const s = applyServerField(snap(), f(1, 4));
    expect(s.fields['c:wolt']?.value).toEqual({ text: 'v1' });
    expect(s.revision).toBe(4);
    expect('revision' in (s.fields['c:wolt'] as object)).toBe(false);
  });

  it('ignores older and equal versions (same object back when the revision does not move either)', () => {
    const s = applyServerField(snap(), f(2, 4));
    expect(applyServerField(s, f(1, 9))).toBe(s);
    expect(applyServerField(s, f(2, 9, 'other'))).toBe(s);
    expect(applyServerField(s, f(2, 4, 'other'))).toBe(s);
    expect(applyServerField(s, f(3, 5, 'new')).fields['c:wolt']?.value).toEqual({ text: 'new' });
  });

  it('+1 rule (I2): the revision advances only to exactly revision + 1', () => {
    // in order: 4 then 5
    const a = applyServerField(applyServerField(snap(), f(1, 4)), { ...field('c:efood', { text: '1' }), revision: 5 });
    expect(a.revision).toBe(5);
    // a gap (5 while at 3): the field is applied, the revision stays
    const g = applyServerField(snap(), f(1, 5));
    expect(g.fields['c:wolt']?.value).toEqual({ text: 'v1' });
    expect(g.revision).toBe(3);
    expect(revisionGap(snap(), 5)).toBe(true);
    expect(revisionGap(snap(), 4)).toBe(false);
    expect(revisionGap(snap(), 3)).toBe(false);
    expect(revisionGap(snap(), 1)).toBe(false);
    // an old (superseded) field numbered revision + 1 still advances the revision — its write is accounted for
    const held = applyServerField(snap(), f(3, 2)); // we hold v3 (revision stays 3: not 4)
    const late = applyServerField(held, f(2, 4));   // the late v2 write was revision 4
    expect(late.fields['c:wolt']?.value).toEqual({ text: 'v3' });
    expect(late.revision).toBe(4);
    // a revision at or below ours never moves it back
    expect(applyServerField(snap(), f(1, 2)).revision).toBe(3);
  });

  it('does not mutate its input', () => {
    const s = snap();
    applyServerField(s, f(1, 4));
    expect(s.fields).toEqual({});
    expect(s.revision).toBe(3);
  });
});

describe('fieldLabel', () => {
  it('labels denominations, channels and expense lines', () => {
    expect(fieldLabel('d:5000', cfg)).toBe('50€');
    expect(fieldLabel('d:50', cfg)).toBe('50c');
    const wolt = cfg.channels.find((c) => c.id === 'wolt');
    expect(fieldLabel('c:wolt', cfg)).toBe(wolt?.label);
    const d = draftFromFields(snap([field('e:b', meta(20)), field('e:a', meta(10))]), []);
    expect(fieldLabel('e:a', cfg, d)).toBe('Έξοδο 1');
    expect(fieldLabel('e:b:a', cfg, d)).toBe('Έξοδο 2');
    expect(fieldLabel('e:b:d', cfg, d)).toBe('Έξοδο 2');
    expect(fieldLabel('e:gone', cfg, d)).toBe('Έξοδο');
  });
});

describe('presenceTags', () => {
  it('maps each box to the names of the other clients in it, without repeats; no box → no tag', () => {
    expect(
      presenceTags([
        { name: 'ΝΙΚΟΣ', focus: 'd:5000' },
        { name: 'Ιδιοκτήτης', focus: 'd:5000' },
        { name: 'ΝΙΚΟΣ', focus: 'd:5000' },
        { name: 'ΕΛΕΝΗ', focus: 'c:wolt' },
        { name: 'ΑΝΝΑ', focus: null },
      ]),
    ).toEqual({ 'd:5000': ['ΝΙΚΟΣ', 'Ιδιοκτήτης'], 'c:wolt': ['ΕΛΕΝΗ'] });
    expect(presenceTags([])).toEqual({});
  });
});
