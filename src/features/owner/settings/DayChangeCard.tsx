import { useEffect, useState } from 'react';
import { formatDayEl } from '../../../app/dates';
import { mapError } from '../../../data/remote/errors';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { ownerErrorMessage } from '../model/messages';
import { ErrorText } from '../OwnerUi';
import { useAction } from '../useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

/** The day-change time saves on its own — it is not part of the published config. */
export function DayChangeCard({ api, shopId }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [time, setTime] = useState('');
  const [savedTime, setSavedTime] = useState('');
  const [fromDate, setFromDate] = useState<string | null>(null);
  const save = useAction();

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    api
      .dayChange(shopId)
      .catch((e: unknown) => ({ ok: false as const, error: mapError(e) }))
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
        setTime(r.data.time);
        setSavedTime(r.data.time);
        setFromDate(r.data.fromDate);
        setLoad({ status: 'ready' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, shopId, attempt]);

  const onSave = async () => {
    const r = await save.run(() => api.setDayChange(shopId, time));
    if (r.ok) {
      setSavedTime(time);
      setFromDate(r.data);
    }
  };

  if (load.status === 'loading') return <p className="notice-soft">Φόρτωση…</p>;
  if (load.status === 'error') {
    return (
      <Card title="Αλλαγή ημέρας">
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
    <Card title="Αλλαγή ημέρας">
      <div className="row">
        <span className="row-label">Ώρα</span>
        <input
          className="field"
          type="time"
          aria-label="Ώρα αλλαγής ημέρας"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            save.clear();
          }}
        />
        <button type="button" className="btn btn-primary" disabled={time === '' || time === savedTime || save.busy} onClick={() => void onSave()}>
          Αποθήκευση
        </button>
      </div>
      <p className="row-hint">Κλεισίματα πριν από αυτή την ώρα μετράνε για την προηγούμενη μέρα.</p>
      {fromDate !== null && <p className="row-hint">Ισχύει από {formatDayEl(fromDate)}</p>}
      <ErrorText state={save.state} />
    </Card>
  );
}
