import { useEffect, useMemo, useState } from 'react';
import { formatStampEl, formatTimeEl } from '../../../app/dates';
import { randomId } from '../../../app/ids';
import { denomLabel } from '../../../core/denominations';
import { formatEuro, type Cents } from '../../../core/money';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { EnvelopeSheet } from '../../register/EnvelopeSheet';
import type { Snapshot } from '../../register/live/fields';
import { ownerErrorMessage } from '../model/messages';
import { CorrectionEditor } from './CorrectionEditor';
import { breakdown, diffBreakdown, openInputs, originalOf, snapshotFromInputs, type Breakdown, type BreakdownDiff } from './model';
import type { ClosingVersion, DayClosing, DayDetail } from './types';

/** What the correction editor starts from: the current version, or the open closing of an unsubmitted closing. */
interface EditBase {
  base: Snapshot;
  expectedCurrentId: string | null;
  /** Remounts the editor when the closing or its current version changes («Φόρτωση νέας»). */
  key: string;
}

export interface ClosingViewProps {
  api: OwnerApi;
  shopId: string;
  day: DayDetail;
  /** The closing of `day` shown here; the parent remounts this view (key) when another closing is selected. */
  closing: DayClosing;
  /** Edit mode lives in the parent, so it survives the refetch after «Φόρτωση νέας». */
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** The parent leaves edit mode and refetches the day. */
  onSaved: () => void;
  /** The parent refetches the day. */
  onReload: () => void;
  now: () => Date;
  /** Owner and manager only; the server refuses everyone else. */
  canCorrect: boolean;
  newId?: () => string;
}

/** Who filed a version: the name comes from the server (`author_name`; office names only from SQL). */
const stampOf = (v: ClosingVersion): string =>
  v.kind === 'staff'
    ? `Υποβλήθηκε ${formatTimeEl(v.createdAt)} · ${v.authorName}`
    : `${v.correctsId !== null ? 'Διορθώθηκε' : 'Καταχωρήθηκε'} · ${v.authorName} · ${formatStampEl(v.createdAt)}`;

const configOf = (day: DayDetail, id: string): unknown => (Object.hasOwn(day.configs, id) ? day.configs[id] : undefined);

/** One closing of a history day: its versions, breakdown, change marks, Φάκελος and corrections. */
export function ClosingView({ api, shopId, day, closing, editing, onEdit, onCancelEdit, onSaved, onReload, now, canCorrect, newId = randomId }: ClosingViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const { versions, open } = closing;

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;
  const current = versions[0] ?? null;
  const isCurrent = selected !== null && selected === current;
  /** The live closing's versions come only from «Σήμερα», so a cashier resubmit cannot drop an owner change. */
  const isLive = day.businessDate === day.today && closing.closingNo === day.liveClosingNo;

  /** What the screen shows: the selected version, or the open closing of an unsubmitted closing. */
  const shown = useMemo((): Breakdown | null => {
    if (selected !== null) return breakdown(configOf(day, selected.configId), selected.inputs, day.staffNames);
    const o = open === null ? null : openInputs(open);
    return o === null ? null : breakdown(o.config, o.inputs, day.staffNames);
  }, [day, selected, open]);

  /** An owner correction is shown against the cashier's submission it replaced. */
  const original = selected === null ? null : originalOf(versions, versions.indexOf(selected));
  const diff = useMemo((): BreakdownDiff | null => {
    if (original === null || shown === null) return null;
    const o = breakdown(configOf(day, original.configId), original.inputs, day.staffNames);
    return o === null ? null : diffBreakdown(shown, o);
  }, [day, original, shown]);

  /** «Επαναφορά»: an older version saved again as the newest (the versions in between stay in the log). */
  const revertible =
    canCorrect && !isLive && current !== null && selected !== null && !isCurrent && shown !== null &&
    selected.configId === current.configId && shown.inputs.schema === 2 &&
    JSON.stringify(shown.inputs) !== JSON.stringify(current.inputs);
  const revertKey = useMemo(() => newId(), [newId, selected?.id, current?.id]);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  useEffect(() => setRevertError(null), [selected?.id, current?.id]);
  const revert = async () => {
    if (!revertible || reverting || selected === null || current === null || shown === null) return;
    setReverting(true);
    setRevertError(null);
    const r = await api.saveClosing(shopId, {
      businessDate: day.businessDate, configId: selected.configId, inputs: shown.inputs, expectedCurrentId: current.id, key: revertKey,
      closingNo: closing.closingNo,
    });
    setReverting(false);
    if (r.ok) {
      onReload();
    } else {
      setRevertError(ownerErrorMessage(r.error));
    }
  };

  /** Editing always starts from the current version (or the open closing), never from a selected older one. */
  const editBase = useMemo((): EditBase | null => {
    const head = versions[0];
    if (head !== undefined) {
      const b = breakdown(configOf(day, head.configId), head.inputs, day.staffNames);
      if (b === null) return null;
      const base = snapshotFromInputs({ config: b.config, configId: head.configId, businessDate: day.businessDate, inputs: b.inputs, newId });
      return { base, expectedCurrentId: head.id, key: `${closing.closingNo}:${head.id}` };
    }
    if (open === null || openInputs(open) === null) return null;
    return { base: open, expectedCurrentId: null, key: `${closing.closingNo}:file` };
  }, [day, versions, open, closing.closingNo, newId]);

  if (editing && editBase !== null) {
    return (
      <>
        <p className="sub">{editBase.expectedCurrentId !== null ? 'Διόρθωση' : 'Αποθήκευση ως κλείσιμο'}</p>
        <CorrectionEditor
          key={editBase.key}
          api={api}
          shopId={shopId}
          base={editBase.base}
          expectedCurrentId={editBase.expectedCurrentId}
          closingNo={closing.closingNo}
          onSaved={onSaved}
          onReload={onReload}
          onCancel={onCancelEdit}
          now={now}
          newId={newId}
        />
      </>
    );
  }

  if (selected === null && open === null) return <p className="notice-soft">Δεν υπάρχει κλείσιμο για αυτή τη μέρα.</p>;

  return (
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
          <button type="button" className="btn btn-text" onClick={onReload}>
            Φόρτωση νέας
          </button>
        </p>
      )}
      {shown === null ? (
        <p className="notice-soft">Δεν διαβάζεται</p>
      ) : (
        <Numbers shown={shown} diff={diff} onEnvelope={() => setEnvelopeOpen(true)} />
      )}
      {shown !== null && canCorrect &&
        (selected === null ? (
          <button type="button" className="btn btn-primary" onClick={onEdit}>
            Αποθήκευση ως κλείσιμο
          </button>
        ) : (
          isCurrent &&
          (isLive ? (
            <p className="notice-soft">Οι σημερινές αλλαγές γίνονται από «Σήμερα».</p>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onEdit}>
              Διόρθωση
            </button>
          ))
        ))}
      {versions.length > 1 && (
        <Card title={`${versions.length} υποβολές`}>
          {versions.map((v) => (
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
