import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closingsDoneLabel } from '../../../app/closingLabel';
import { formatDateEl } from '../../../app/dates';
import { randomId } from '../../../app/ids';
import { formatEuro } from '../../../core/money';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { ownerErrorMessage } from '../model/messages';
import type { OwnerNavigate } from '../OwnerUi';
import { ClosingView } from './ClosingView';
import { summarizeDetail } from './model';
import type { DayClosing, DayDetail } from './types';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; day: DayDetail };

export interface DayScreenProps {
  api: OwnerApi;
  shopId: string;
  date: string;
  /** The route's closing; one the day does not have (or none) shows the highest-numbered closing. */
  closingNo?: number;
  navigate: OwnerNavigate;
  now: () => Date;
  newId?: () => string;
}

/** The closing to show: the route's when the day has it, otherwise the highest-numbered one. */
const pickClosing = (day: DayDetail, closingNo: number | undefined): DayClosing | null =>
  day.closings.find((c) => c.closingNo === closingNo) ?? day.closings[day.closings.length - 1] ?? null;

export function DayScreen({ api, shopId, date, closingNo, navigate, now, newId = randomId }: DayScreenProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  /** Kept across a refetch, so «Φόρτωση νέας» reopens the editor on the new current version. */
  const [editing, setEditing] = useState(false);
  /** The newest request; an older response is dropped. */
  const latest = useRef(0);

  // Another day or another closing: edits never move with it.
  useEffect(() => {
    setEditing(false);
  }, [shopId, date, closingNo]);

  useEffect(() => {
    const request = ++latest.current;
    setLoad({ status: 'loading' });
    void api.closingDay(shopId, date).then((r) => {
      if (request !== latest.current) return; // superseded: the newer request settles the state
      setLoad(r.ok ? { status: 'ready', day: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
    });
    return () => {
      latest.current += 1; // unmounted or day changed: nothing may land
    };
  }, [api, shopId, date, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const saved = useCallback(() => {
    setEditing(false);
    setReload((n) => n + 1);
  }, []);
  const back = () => navigate({ name: 'shop', shopId, tab: 'history' });

  const day = load.status === 'ready' ? load.day : null;
  const shown = day === null ? null : pickClosing(day, closingNo);
  const multi = day !== null && (day.closings.length > 1 || day.closingsPlanned > 1);
  const result = useMemo(() => (day === null ? null : summarizeDetail(day)), [day]);

  return (
    <>
      <button type="button" className="link" onClick={back}>
        ← Ιστορικό
      </button>
      <h2 className="day-title">{formatDateEl(date)}</h2>
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          <button type="button" className="btn btn-text" onClick={retry}>
            Ξανά
          </button>
        </>
      )}
      {day !== null && shown === null && <p className="notice-soft">Δεν υπάρχει κλείσιμο για αυτή τη μέρα.</p>}
      {day !== null && multi && result !== null && (
        <>
          <Card title="Σύνολο ημέρας">
            {result.result === null ? (
              <p className="notice-soft">—</p>
            ) : (
              <>
                {result.result.totals.map((t) => (
                  <div className="tot" key={t.id}>
                    <span>{t.label}</span>
                    <b>{formatEuro(t.cents)}</b>
                  </div>
                ))}
                <div className="tot">
                  <span>Έξοδα</span>
                  <span>{formatEuro(result.result.expensesCents)}</span>
                </div>
              </>
            )}
            <p className="notice-soft">{closingsDoneLabel(result.done, result.planned)}</p>
          </Card>
          <div className="week-buttons" role="group" aria-label="Κλεισίματα">
            {day.closings.map((c) => (
              <button
                key={c.closingNo}
                type="button"
                className={c === shown ? 'pill pill-primary' : 'pill'}
                aria-current={c === shown ? 'true' : undefined}
                onClick={() => navigate({ name: 'shop', shopId, tab: 'history', date, closingNo: c.closingNo })}
              >
                {`${c.closingNo}ο`}
                {c.versions.length === 0 && (
                  <>
                    {' '}
                    <span className="badge">Δεν υποβλήθηκε</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {day !== null && shown !== null && (
        <ClosingView
          key={shown.closingNo}
          api={api}
          shopId={shopId}
          day={day}
          closing={shown}
          editing={editing}
          onEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onSaved={saved}
          onReload={retry}
          now={now}
          newId={newId}
        />
      )}
    </>
  );
}
