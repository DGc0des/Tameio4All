import { useEffect, useState } from 'react';
import { mapError } from '../../../data/remote/errors';
import type { ClosingPlan, OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import type { CashMode } from '../../register/live/fields';
import { MAX_CLOSINGS_PER_DAY } from '../model/limits';
import { ownerErrorMessage } from '../model/messages';
import { ErrorText } from '../OwnerUi';
import { useAction } from '../useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

const MODES: { value: CashMode; title: string; hint: string }[] = [
  {
    value: 'separate',
    title: 'Φεύγουν από το ταμείο',
    hint: 'Κάθε κλείσιμο ξεκινά από την αρχή. Το αποτέλεσμα της ημέρας είναι το άθροισμα των κλεισιμάτων.',
  },
  {
    value: 'running',
    title: 'Μένουν στο ταμείο',
    hint: 'Κάθε κλείσιμο δείχνει το σύνολο της ημέρας ως εκείνη τη στιγμή. Το αποτέλεσμα της ημέρας είναι το τελευταίο κλείσιμο.',
  },
];

/** Closings per day and the cash mode save on their own — they are not part of the published config. */
export function ClosingPlanCard({ api, shopId }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [count, setCount] = useState(1);
  const [cashMode, setCashMode] = useState<CashMode>('separate');
  const [saved, setSaved] = useState<ClosingPlan>({ count: 1, cashMode: 'separate' });
  const [justSaved, setJustSaved] = useState(false);
  const save = useAction();

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    api
      .closingPlan(shopId)
      .catch((e: unknown) => ({ ok: false as const, error: mapError(e) }))
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
        setCount(r.data.count);
        setCashMode(r.data.cashMode);
        setSaved(r.data);
        setLoad({ status: 'ready' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, shopId, attempt]);

  // At 1 closing the mode is meaningless and always stored as 'separate'.
  const effective: ClosingPlan = { count, cashMode: count === 1 ? 'separate' : cashMode };
  const unchanged = effective.count === saved.count && effective.cashMode === saved.cashMode;

  const edit = (fn: () => void) => {
    fn();
    setJustSaved(false);
    save.clear();
  };

  const onSave = async () => {
    const plan = effective;
    const r = await save.run(() => api.setClosingPlan(shopId, plan));
    if (r.ok) {
      setSaved(plan);
      setJustSaved(true);
    }
  };

  if (load.status === 'loading') return <p className="notice-soft">Φόρτωση…</p>;
  if (load.status === 'error') {
    return (
      <Card title="Κλεισίματα ανά ημέρα">
        <p className="form-error" role="alert">
          {load.message}
        </p>
        <button type="button" className="btn btn-text" onClick={() => setAttempt((n) => n + 1)}>
          Ξανά
        </button>
      </Card>
    );
  }

  return (
    <Card title="Κλεισίματα ανά ημέρα">
      <p className="row-hint">Πόσες φορές κλείνει το ταμείο μέσα σε μία ημέρα (π.χ. μία σε κάθε αλλαγή βάρδιας).</p>
      <div className="row">
        <span className="row-label">Κλεισίματα</span>
        <button
          type="button"
          className="btn"
          aria-label="Λιγότερα κλεισίματα"
          disabled={count <= 1}
          onClick={() => edit(() => setCount((n) => Math.max(1, n - 1)))}
        >
          −
        </button>
        <span aria-label="Κλεισίματα" role="status">
          {count}
        </span>
        <button
          type="button"
          className="btn"
          aria-label="Περισσότερα κλεισίματα"
          disabled={count >= MAX_CLOSINGS_PER_DAY}
          onClick={() => edit(() => setCount((n) => Math.min(MAX_CLOSINGS_PER_DAY, n + 1)))}
        >
          +
        </button>
      </div>
      {count > 1 && (
        <fieldset className="plan-modes">
          <legend className="row-label">Τα μετρητά σε κάθε κλείσιμο</legend>
          {MODES.map((m) => (
            <label key={m.value} className="row">
              <input
                type="radio"
                name="cash-mode"
                checked={cashMode === m.value}
                onChange={() => edit(() => setCashMode(m.value))}
              />
              <span>
                <span className="row-label">{m.title}</span>
                <span className="row-hint">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <button type="button" className="btn btn-primary" disabled={unchanged || save.busy} onClick={() => void onSave()}>
        Αποθήκευση
      </button>
      {justSaved && <p className="row-hint">Αποθηκεύτηκε. Μια ημέρα που έχει ήδη ξεκινήσει μένει όπως ξεκίνησε.</p>}
      <ErrorText state={save.state} />
    </Card>
  );
}
