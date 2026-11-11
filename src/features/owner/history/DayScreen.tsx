import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateEl, formatStampEl, formatTimeEl } from '../../../app/dates';
import { denomLabel } from '../../../core/denominations';
import { formatEuro } from '../../../core/money';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { EnvelopeSheet } from '../../register/EnvelopeSheet';
import { ownerErrorMessage } from '../model/messages';
import type { OwnerNavigate } from '../OwnerUi';
import { breakdown, openInputs, type Breakdown } from './model';
import type { ClosingVersion, DayDetail } from './types';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; day: DayDetail };

/** What the correction editor (next task) is doing; null while the owner is only reading. */
type Editing = null | { kind: 'correct' } | { kind: 'file' };

export interface DayScreenProps {
  api: OwnerApi;
  shopId: string;
  date: string;
  navigate: OwnerNavigate;
  now: () => Date;
  newId?: () => string;
}

const stampOf = (v: ClosingVersion): string =>
  v.kind === 'staff'
    ? `Υποβλήθηκε ${formatTimeEl(v.createdAt)} · ${v.authorName}`
    : `${v.correctsId !== null ? 'Διορθώθηκε' : 'Καταχωρήθηκε'} από ιδιοκτήτη · ${formatStampEl(v.createdAt)}`;

// `now` and `newId` are part of the interface but not destructured yet: the business date comes from the
// response, never from the clock, and `newId` is for the correction editor (next task).
export function DayScreen({ api, shopId, date, navigate }: DayScreenProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  /** The newest request; an older response is dropped. */
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    setLoad({ status: 'loading' });
    setSelectedId(null);
    setEnvelopeOpen(false);
    setEditing(null);
    void api.closingDay(shopId, date).then((r) => {
      if (request !== latest.current) return; // superseded: the newer request settles the state
      setLoad(r.ok ? { status: 'ready', day: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
    });
    return () => {
      latest.current += 1; // unmounted or day changed: nothing may land
    };
  }, [api, shopId, date, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const back = () => navigate({ name: 'shop', shopId, tab: 'history' });

  const day = load.status === 'ready' ? load.day : null;
  const selected = day === null ? null : (day.versions.find((v) => v.id === selectedId) ?? day.versions[0] ?? null);
  const isCurrent = day !== null && selected !== null && selected === day.versions[0];

  /** What the screen shows: the selected version, or the open closing of an unsubmitted day. */
  const shown = useMemo((): Breakdown | null => {
    if (day === null) return null;
    if (selected !== null) return breakdown(day.configs[selected.configId], selected.inputs, day.staffNames);
    const o = day.open === null ? null : openInputs(day.open);
    return o === null ? null : breakdown(o.config, o.inputs, day.staffNames);
  }, [day, selected]);

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
      {day !== null && selected === null && day.open === null && <p className="notice-soft">Δεν υπάρχει κλείσιμο για αυτή τη μέρα.</p>}
      {day !== null && (selected !== null || day.open !== null) && (
        <>
          <p className="sub">{selected !== null ? stampOf(selected) : 'Δεν υποβλήθηκε'}</p>
          {selected !== null && !isCurrent && <p className="notice-soft">Βλέπεις παλαιότερη έκδοση</p>}
          {shown === null ? (
            <p className="notice-soft">Δεν διαβάζεται</p>
          ) : (
            <Numbers shown={shown} onEnvelope={() => setEnvelopeOpen(true)} />
          )}
          {editing !== null ? (
            <p data-testid="day-editing">{editing.kind}</p>
          ) : (
            shown !== null &&
            (selected === null ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: 'file' })}>
                Αποθήκευση ως κλείσιμο
              </button>
            ) : (
              isCurrent && (
                <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: 'correct' })}>
                  Διόρθωση
                </button>
              )
            ))
          )}
          {day.versions.length > 1 && (
            <Card title={`${day.versions.length} υποβολές`}>
              {day.versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="history-row"
                  aria-current={v === selected ? 'true' : undefined}
                  onClick={() => setSelectedId(v.id)}
                >
                  <span className="history-head">
                    <b>{formatTimeEl(v.createdAt)}</b>
                    <span className="history-meta">{v.authorName}</span>
                  </span>
                </button>
              ))}
            </Card>
          )}
        </>
      )}
      {envelopeOpen && shown !== null && (
        <EnvelopeSheet denominations={shown.config.denominations} envelope={shown.envelope} onClose={() => setEnvelopeOpen(false)} />
      )}
    </>
  );
}

function Numbers({ shown, onEnvelope }: { shown: Breakdown; onEnvelope: () => void }) {
  return (
    <>
      {shown.denominations.length > 0 && (
        <Card title="Καταμέτρηση">
          <ul className="list">
            {shown.denominations.map((d) => (
              <li className="list-row" key={d.denom}>
                <span>{`${denomLabel(d.denom)} × ${d.count}`}</span>
                <span>{formatEuro(d.cents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {shown.channels.length > 0 && (
        <Card title="Κανάλια">
          {shown.channels.map((c) => (
            <div className="tot" key={c.id}>
              <span>{c.label}</span>
              <span>{formatEuro(c.cents)}</span>
            </div>
          ))}
        </Card>
      )}
      {shown.expenses.length > 0 && (
        <Card title="Έξοδα">
          <ul className="list">
            {shown.expenses.map((e) => (
              <li className="list-row" key={e.key}>
                <span>
                  {e.description}
                  <span className="history-meta"> · {e.author}</span>
                </span>
                <span>{formatEuro(e.cents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Σύνολα">
        {shown.totals.map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <b>{formatEuro(t.cents)}</b>
          </div>
        ))}
      </Card>
      <button type="button" className="btn btn-primary" onClick={onEnvelope}>
        Φάκελος
      </button>
    </>
  );
}
