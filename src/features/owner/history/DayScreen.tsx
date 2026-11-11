import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateEl, formatStampEl, formatTimeEl } from '../../../app/dates';
import { randomId } from '../../../app/ids';
import { denomLabel } from '../../../core/denominations';
import { formatEuro, type Cents } from '../../../core/money';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { EnvelopeSheet } from '../../register/EnvelopeSheet';
import type { Snapshot } from '../../register/live/fields';
import { ownerErrorMessage } from '../model/messages';
import type { OwnerNavigate } from '../OwnerUi';
import { CorrectionEditor } from './CorrectionEditor';
import { breakdown, diffBreakdown, openInputs, originalOf, snapshotFromInputs, type Breakdown, type BreakdownDiff } from './model';
import type { ClosingVersion, DayDetail } from './types';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; day: DayDetail };

/** What the correction editor starts from: the current version, or the open closing of an unsubmitted day. */
interface EditBase {
  base: Snapshot;
  expectedCurrentId: string | null;
  /** Remounts the editor when the current version changes («Φόρτωση νέας»). */
  key: string;
}

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

const configOf = (day: DayDetail, id: string): unknown => (Object.hasOwn(day.configs, id) ? day.configs[id] : undefined);

export function DayScreen({ api, shopId, date, navigate, now, newId = randomId }: DayScreenProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  /** Kept across a refetch, so «Φόρτωση νέας» reopens the editor on the new current version. */
  const [editing, setEditing] = useState(false);
  /** The newest request; an older response is dropped. */
  const latest = useRef(0);

  useEffect(() => {
    setEditing(false);
  }, [shopId, date]);

  useEffect(() => {
    const request = ++latest.current;
    setLoad({ status: 'loading' });
    setSelectedId(null);
    setEnvelopeOpen(false);
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
  const current = day?.versions[0] ?? null;
  const isCurrent = selected !== null && selected === current;
  /** Today's versions come only from the live closing («Σήμερα»), so a cashier resubmit cannot drop an owner change. */
  const isToday = day !== null && day.businessDate === day.today;

  /** What the screen shows: the selected version, or the open closing of an unsubmitted day. */
  const shown = useMemo((): Breakdown | null => {
    if (day === null) return null;
    if (selected !== null) return breakdown(configOf(day, selected.configId), selected.inputs, day.staffNames);
    const o = day.open === null ? null : openInputs(day.open);
    return o === null ? null : breakdown(o.config, o.inputs, day.staffNames);
  }, [day, selected]);

  /** An owner correction is shown against the cashier's submission it replaced. */
  const original = day === null || selected === null ? null : originalOf(day.versions, day.versions.indexOf(selected));
  const diff = useMemo((): BreakdownDiff | null => {
    if (day === null || original === null || shown === null) return null;
    const o = breakdown(configOf(day, original.configId), original.inputs, day.staffNames);
    return o === null ? null : diffBreakdown(shown, o);
  }, [day, original, shown]);

  /** «Επαναφορά»: an older version saved again as the newest (the versions in between stay in the log). */
  const revertible =
    day !== null && !isToday && current !== null && selected !== null && !isCurrent && shown !== null &&
    selected.configId === current.configId && shown.inputs.schema === 2 &&
    JSON.stringify(shown.inputs) !== JSON.stringify(current.inputs);
  const revertKey = useMemo(() => newId(), [newId, selected?.id, current?.id]);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  useEffect(() => setRevertError(null), [selected?.id, current?.id]);
  const revert = async () => {
    if (!revertible || reverting || day === null || selected === null || current === null || shown === null) return;
    setReverting(true);
    setRevertError(null);
    const r = await api.saveClosing(shopId, {
      businessDate: day.businessDate, configId: selected.configId, inputs: shown.inputs, expectedCurrentId: current.id, key: revertKey,
    });
    setReverting(false);
    if (r.ok) {
      setReload((n) => n + 1);
    } else {
      setRevertError(ownerErrorMessage(r.error));
    }
  };

  /** Editing always starts from the current version (or the open closing), never from a selected older one. */
  const editBase = useMemo((): EditBase | null => {
    if (day === null) return null;
    const current = day.versions[0];
    if (current !== undefined) {
      const b = breakdown(configOf(day, current.configId), current.inputs, day.staffNames);
      if (b === null) return null;
      const base = snapshotFromInputs({ config: b.config, configId: current.configId, businessDate: day.businessDate, inputs: b.inputs, newId });
      return { base, expectedCurrentId: current.id, key: current.id };
    }
    if (day.open === null || openInputs(day.open) === null) return null;
    return { base: day.open, expectedCurrentId: null, key: 'file' };
  }, [day, newId]);

  const showEditor = editing && editBase !== null;
  const saved = useCallback(() => {
    setEditing(false);
    setReload((n) => n + 1);
  }, []);

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
      {day !== null && showEditor && (
        <>
          <p className="sub">{editBase.expectedCurrentId !== null ? 'Διόρθωση' : 'Αποθήκευση ως κλείσιμο'}</p>
          <CorrectionEditor
            key={editBase.key}
            api={api}
            shopId={shopId}
            base={editBase.base}
            expectedCurrentId={editBase.expectedCurrentId}
            onSaved={saved}
            onReload={retry}
            onCancel={() => setEditing(false)}
            now={now}
            newId={newId}
          />
        </>
      )}
      {day !== null && !showEditor && (selected !== null || day.open !== null) && (
        <>
          <p className="sub">{selected !== null ? stampOf(selected) : 'Δεν υποβλήθηκε'}</p>
          {original !== null && (
            <p className="sub">
              {`Αρχική υποβολή: ${original.authorName} · ${formatTimeEl(original.createdAt)}`}{' '}
              <button type="button" className="link" onClick={() => setSelectedId(original.id)}>
                Προβολή
              </button>
            </p>
          )}
          {selected !== null && !isCurrent && <p className="notice-soft">Βλέπεις παλαιότερη έκδοση</p>}
          {revertible && (
            <button type="button" className="btn btn-primary" disabled={reverting} onClick={() => void revert()}>
              Επαναφορά αυτής της έκδοσης
            </button>
          )}
          {revertError !== null && (
            <p className="form-error" role="alert">
              {revertError}{' '}
              <button type="button" className="btn btn-text" onClick={retry}>
                Φόρτωση νέας
              </button>
            </p>
          )}
          {shown === null ? (
            <p className="notice-soft">Δεν διαβάζεται</p>
          ) : (
            <Numbers shown={shown} diff={diff} onEnvelope={() => setEnvelopeOpen(true)} />
          )}
          {shown !== null &&
            (selected === null ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                Αποθήκευση ως κλείσιμο
              </button>
            ) : (
              isCurrent &&
              (isToday ? (
                <p className="notice-soft">Οι σημερινές αλλαγές γίνονται από «Σήμερα».</p>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                  Διόρθωση
                </button>
              ))
            ))}
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
                    <span>
                      {/* A correction may be made on a later day than the business day: it gets the full stamp. */}
                      <b>{v.kind === 'owner_correction' ? formatStampEl(v.createdAt) : formatTimeEl(v.createdAt)}</b>
                      {' · '}
                      <span className="history-meta">{v.authorName}</span>
                    </span>
                    {v.kind === 'owner_correction' && <span className="badge">διόρθωση</span>}
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

const Changed = ({ text = 'Αλλαγή' }: { text?: string }) => <span className="badge">{text}</span>;
/** The cashier's original value, struck through, before the corrected one. */
const Was = ({ cents }: { cents: Cents | undefined }) =>
  cents === undefined ? null : (
    <>
      <s className="history-meta" aria-label={`αρχικά ${formatEuro(cents)}`}>
        {formatEuro(cents)}
      </s>{' '}
    </>
  );

function Numbers({ shown, diff, onEnvelope }: { shown: Breakdown; diff: BreakdownDiff | null; onEnvelope: () => void }) {
  const denominations = [...shown.denominations, ...(diff?.removedDenominations ?? []).map((d) => ({ ...d, removed: true }))];
  const channels = [...shown.channels, ...(diff?.removedChannels ?? []).map((c) => ({ ...c, removed: true }))];
  const expenses = [...shown.expenses, ...(diff?.removedExpenses ?? []).map((e) => ({ ...e, removed: true }))];
  return (
    <>
      {denominations.length > 0 && (
        <Card title="Καταμέτρηση">
          <ul className="list">
            {denominations.map((d) =>
              'removed' in d ? (
                <li className="list-row" key={d.denom}>
                  <span>
                    <s>{`${denomLabel(d.denom)} × ${d.count}`}</s> <Changed text="Αφαιρέθηκε" />
                  </span>
                  <s className="history-meta">{formatEuro(d.cents)}</s>
                </li>
              ) : (
                <li className="list-row" key={d.denom}>
                  <span>
                    {`${denomLabel(d.denom)} × ${d.count}`} {diff?.denominations.has(d.denom) && <Changed />}
                  </span>
                  <span>
                    <Was cents={diff?.denominations.get(d.denom)} />
                    {formatEuro(d.cents)}
                  </span>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}
      {channels.length > 0 && (
        <Card title="Κανάλια">
          {channels.map((c) =>
            'removed' in c ? (
              <div className="tot" key={c.id}>
                <span>
                  <s>{c.label}</s> <Changed text="Αφαιρέθηκε" />
                </span>
                <s>{formatEuro(c.cents)}</s>
              </div>
            ) : (
              <div className="tot" key={c.id}>
                <span>
                  {c.label} {diff?.channels.has(c.id) && <Changed />}
                </span>
                <span>
                  <Was cents={diff?.channels.get(c.id)} />
                  {formatEuro(c.cents)}
                </span>
              </div>
            ),
          )}
        </Card>
      )}
      {expenses.length > 0 && (
        <Card title="Έξοδα">
          <ul className="list">
            {expenses.map((e) => {
              const removed = 'removed' in e;
              const was = diff?.expenses.get(e.key);
              return (
                <li className="list-row" key={e.key}>
                  <span>
                    {removed ? <s>{e.description}</s> : e.description}
                    {was !== undefined && was.description !== e.description && (
                      <>
                        {' '}
                        <s className="history-meta">{was.description}</s>
                      </>
                    )}
                    <span className="history-meta"> · {e.author}</span>{' '}
                    {removed ? <Changed text="Αφαιρέθηκε" /> : diff?.addedExpenses.has(e.key) ? <Changed text="Νέο" /> : was !== undefined && <Changed />}
                  </span>
                  <span>
                    {removed ? (
                      <s>{formatEuro(e.cents)}</s>
                    ) : (
                      <>
                        <Was cents={was !== undefined && was.cents !== e.cents ? was.cents : undefined} />
                        {formatEuro(e.cents)}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title="Σύνολα">
        {shown.totals.map((t) => (
          <div className="tot" key={t.id}>
            <span>
              {t.label} {diff?.totals.has(t.id) && <Changed />}
            </span>
            <b>
              <Was cents={diff?.totals.get(t.id)} />
              {formatEuro(t.cents)}
            </b>
          </div>
        ))}
      </Card>
      <button type="button" className="btn btn-primary" onClick={onEnvelope}>
        Φάκελος
      </button>
    </>
  );
}
