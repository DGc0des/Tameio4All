import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDayEl, isIsoDate } from '../../../app/dates';
import { formatEuro } from '../../../core/money';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { ownerErrorMessage } from '../model/messages';
import type { OwnerNavigate } from '../OwnerUi';
import { summarizeInputs, summarizeOpen, type Summary } from './model';
import type { HistoryDay, HistoryList } from './types';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean }
  | { status: 'ready'; list: HistoryList };

const EMPTY_MESSAGE = 'Δεν υπάρχουν κλεισίματα σε αυτό το διάστημα.';

/** The server's own default range applies to a side that is not a valid date. */
const validOrNull = (s: string): string | null => (isIsoDate(s) ? s : null);

export function HistoryScreen({ api, shopId, navigate }: { api: OwnerApi; shopId: string; navigate: OwnerNavigate }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  /** The newest request; an older response is dropped. */
  const latest = useRef(0);
  /** What «Ξανά» repeats. */
  const last = useRef<{ from: string | null; to: string | null }>({ from: null, to: null });

  const fetchRange = useCallback(
    (f: string | null, t: string | null) => {
      const request = ++latest.current;
      last.current = { from: f, to: t };
      setLoad({ status: 'loading' });
      void api.listClosings(shopId, f, t).then((r) => {
        if (request !== latest.current) return; // superseded: the newer request settles the state
        if (!r.ok) {
          return setLoad({ status: 'error', message: ownerErrorMessage(r.error), retryable: r.error.code !== 'bad_range' });
        }
        // A side we left to the server shows the server's value.
        if (f === null) setFrom(r.data.from);
        if (t === null) setTo(r.data.to);
        setLoad({ status: 'ready', list: r.data });
      });
    },
    [api, shopId],
  );

  useEffect(() => {
    fetchRange(null, null);
    return () => {
      latest.current += 1; // unmounted or shop changed: nothing may land
    };
  }, [fetchRange]);

  const change = (side: 'from' | 'to', value: string) => {
    if (side === 'from') setFrom(value);
    else setTo(value);
    if (!isIsoDate(value)) return;
    fetchRange(validOrNull(side === 'from' ? value : from), validOrNull(side === 'to' ? value : to));
  };

  return (
    <>
      <Card>
        <div className="history-range">
          <label className="date-label">
            Από
            <input type="date" className="text-field" value={from} onChange={(e) => change('from', e.target.value)} />
          </label>
          <label className="date-label">
            Έως
            <input type="date" className="text-field" value={to} onChange={(e) => change('to', e.target.value)} />
          </label>
        </div>
      </Card>
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          {load.retryable && (
            <button type="button" className="btn btn-text" onClick={() => fetchRange(last.current.from, last.current.to)}>
              Ξανά
            </button>
          )}
        </>
      )}
      {load.status === 'ready' &&
        (load.list.days.length === 0 ? (
          <p className="notice-soft">{EMPTY_MESSAGE}</p>
        ) : (
          <Card>
            {load.list.days.map((day) => (
              <DayRow key={day.businessDate} day={day} list={load.list} onOpen={() => navigate({ name: 'shop', shopId, tab: 'history', date: day.businessDate })} />
            ))}
          </Card>
        ))}
    </>
  );
}

function summaryOf(day: HistoryDay, list: HistoryList): Summary | null {
  return day.status === 'submitted' ? summarizeInputs(list.configs[day.current.configId], day.current.inputs) : summarizeOpen(day.open);
}

function DayRow({ day, list, onOpen }: { day: HistoryDay; list: HistoryList; onOpen: () => void }) {
  const summary = summaryOf(day, list);
  return (
    <button type="button" className="history-row" onClick={onOpen}>
      <span className="history-head">
        <b>{formatDayEl(day.businessDate)}</b>
        {day.status === 'submitted' ? (
          <span className="history-meta">
            {day.current.authorName}
            {day.versionCount > 1 && ` · ${day.versionCount} υποβολές`}
            {day.current.kind === 'owner_correction' && <span className="badge">διορθωμένο</span>}
          </span>
        ) : (
          <span className="history-meta">Δεν υποβλήθηκε</span>
        )}
      </span>
      {summary === null ? (
        <span className="history-meta">Δεν διαβάζεται</span>
      ) : (
        <>
          {summary.totals.map((t) => (
            <span key={t.id} className="history-line">
              <span>{t.label}</span>
              <span>{formatEuro(t.cents)}</span>
            </span>
          ))}
          <span className="history-line">
            <span>Έξοδα</span>
            <span>{formatEuro(summary.expensesCents)}</span>
          </span>
        </>
      )}
    </button>
  );
}
