import { useCallback, useEffect, useRef, useState } from 'react';
import { addDaysIso, formatDayMonthLongEl, formatTimeEl, formatWeekRangeEl, formatWeekdayEl, weekStartIso } from '../../../app/dates';
import { formatEuro } from '../../../core/money';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { ownerErrorMessage } from '../model/messages';
import type { OwnerNavigate } from '../OwnerUi';
import { summarizeInputs, summarizeOpen, weekCells, type Summary, type WeekCell } from './model';
import type { HistoryList } from './types';

type Shown = { list: HistoryList; monday: string };
type Load =
  /** `previous`: the week on screen while the next one loads (null on the first load or after an error). */
  | { status: 'loading'; previous: Shown | null }
  | { status: 'error'; message: string; retryable: boolean }
  | ({ status: 'ready' } & Shown);

/** The week shown, as the Monday and Sunday that were fetched. */
export interface HistoryRange {
  from: string;
  to: string;
}

export interface HistoryScreenProps {
  api: OwnerApi;
  shopId: string;
  navigate: OwnerNavigate;
  /** The week to open (its Monday is `from`; read once, at mount); without it the server's default applies and the week of its `today` is shown. */
  initialRange?: HistoryRange | null;
  /** Called after a successful load with the shown week's Monday and Sunday. */
  onRangeLoaded?: (from: string, to: string) => void;
}

export function HistoryScreen({ api, shopId, navigate, initialRange = null, onRangeLoaded }: HistoryScreenProps) {
  /** Only the mount-time value counts: later changes of the prop must not refetch or move the week. */
  const initial = useRef(initialRange);
  const reportRange = useRef(onRangeLoaded);
  reportRange.current = onRangeLoaded;
  /** The Monday of the week on screen (or being fetched); null until the server has told us «today». */
  const [shown, setShown] = useState<string | null>(initial.current === null ? null : weekStartIso(initial.current.from));
  /** The shop's today from the last successful answer; every «this week» / «yesterday» comes from it. */
  const [today, setToday] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading', previous: null });
  /** The newest request; an older response is dropped. */
  const latest = useRef(0);
  /** What «Ξανά» repeats: a Monday, or null for the server default. */
  const last = useRef<string | null>(null);

  const fetchWeek = useCallback(
    (monday: string | null) => {
      const request = ++latest.current;
      last.current = monday;
      if (monday !== null) setShown(monday);
      setLoad((l) => ({ status: 'loading', previous: l.status === 'ready' ? { list: l.list, monday: l.monday } : l.status === 'loading' ? l.previous : null }));
      void api.listClosings(shopId, monday, monday === null ? null : addDaysIso(monday, 6)).then((r) => {
        if (request !== latest.current) return; // superseded: the newer request settles the state
        if (!r.ok) {
          return setLoad({ status: 'error', message: ownerErrorMessage(r.error), retryable: r.error.code !== 'bad_range' });
        }
        const shownMonday = monday ?? weekStartIso(r.data.today);
        setShown(shownMonday);
        setToday(r.data.today);
        setLoad({ status: 'ready', list: r.data, monday: shownMonday });
        reportRange.current?.(shownMonday, addDaysIso(shownMonday, 6));
      });
    },
    [api, shopId],
  );

  useEffect(() => {
    fetchWeek(initial.current === null ? null : weekStartIso(initial.current.from));
    return () => {
      latest.current += 1; // unmounted or shop changed: nothing may land
    };
  }, [fetchWeek]);

  const thisMonday = today === null ? null : weekStartIso(today);
  const onCurrentWeek = shown !== null && shown === thisMonday;

  return (
    <div className="history-week">
      {shown !== null && (
        <div className="week-nav">
          <span className="week-range">{formatWeekRangeEl(shown)}</span>
          <span className="week-buttons">
            <button type="button" className="pill" aria-label="Προηγούμενη εβδομάδα" onClick={() => fetchWeek(addDaysIso(shown, -7))}>
              ←
            </button>
            <button type="button" className="pill" disabled={today === null} onClick={() => today !== null && navigate({ name: 'shop', shopId, tab: 'history', date: addDaysIso(today, -1) })}>
              Χθες
            </button>
            <button type="button" className="pill pill-primary" disabled={thisMonday === null || onCurrentWeek} onClick={() => thisMonday !== null && fetchWeek(thisMonday)}>
              Αυτή η εβδομάδα
            </button>
            <button type="button" className="pill" aria-label="Επόμενη εβδομάδα" disabled={thisMonday === null || shown >= thisMonday} onClick={() => fetchWeek(addDaysIso(shown, 7))}>
              →
            </button>
          </span>
        </div>
      )}
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          {load.retryable && (
            <button type="button" className="btn btn-text" onClick={() => fetchWeek(last.current)}>
              Ξανά
            </button>
          )}
        </>
      )}
      {(load.status === 'ready' || (load.status === 'loading' && load.previous !== null)) && (
        <WeekGrid shown={load.status === 'ready' ? load : load.previous!} dimmed={load.status === 'loading'} navigate={navigate} shopId={shopId} />
      )}
    </div>
  );
}

/** While the next week loads the previous cards stay (dimmed) so the page does not jump. */
function WeekGrid({ shown, dimmed, navigate, shopId }: { shown: Shown; dimmed: boolean; navigate: OwnerNavigate; shopId: string }) {
  return (
    <div className={dimmed ? 'week-grid is-loading' : 'week-grid'} aria-busy={dimmed}>
      {weekCells(shown.list, shown.monday).map((cell) => (
        <DayCard key={cell.date} cell={cell} list={shown.list} today={shown.list.today} navigate={navigate} shopId={shopId} />
      ))}
    </div>
  );
}

function summaryOf(cell: WeekCell, list: HistoryList): Summary | null {
  const day = cell.day;
  if (day === undefined) return null;
  return day.status === 'submitted'
    ? summarizeInputs(Object.hasOwn(list.configs, day.current.configId) ? list.configs[day.current.configId] : undefined, day.current.inputs)
    : summarizeOpen(day.open);
}

function DayCard({ cell, list, today, navigate, shopId }: { cell: WeekCell; list: HistoryList; today: string; navigate: OwnerNavigate; shopId: string }) {
  const head = (
    <span className="week-head">
      <span className="week-day">
        <b>{formatWeekdayEl(cell.date)}</b>
        {cell.date === today && cell.kind === 'submitted' && <span className="badge">Σήμερα</span>}
      </span>
      <span className="week-date">{formatDayMonthLongEl(cell.date)}</span>
    </span>
  );

  if (cell.kind === 'future') {
    return (
      <div className="week-card is-faded">
        {head}
        <span className="week-empty">—</span>
      </div>
    );
  }

  const open = () => navigate({ name: 'shop', shopId, tab: 'history', date: cell.date });
  if (cell.kind === 'in_progress') {
    return (
      <button type="button" className="week-card" onClick={() => navigate({ name: 'shop', shopId, tab: 'today' })}>
        {head}
        <span className="week-note">Σε εξέλιξη</span>
      </button>
    );
  }
  if (cell.kind === 'empty') {
    return (
      <button type="button" className="week-card is-faded" onClick={open}>
        {head}
        <span className="week-empty">—</span>
      </button>
    );
  }

  const summary = summaryOf(cell, list);
  const day = cell.day;
  return (
    <button type="button" className={cell.kind === 'unsubmitted' ? 'week-card is-unsubmitted' : 'week-card'} onClick={open}>
      {head}
      {summary === null ? (
        <span className="week-note">Δεν διαβάζεται</span>
      ) : (
        <>
          {summary.totals.map((t) => (
            <span key={t.id} className="week-line">
              <span>{t.label}</span>
              <span>{formatEuro(t.cents)}</span>
            </span>
          ))}
          <span className="week-line">
            <span>Έξοδα</span>
            <span>{formatEuro(summary.expensesCents)}</span>
          </span>
        </>
      )}
      <span className="week-foot">
        {day?.status === 'submitted' ? (
          <>
            <span>{`${day.current.authorName} · ${formatTimeEl(day.current.createdAt)}`}</span>
            {day.current.kind === 'owner_correction' ? <span className="badge">διορθωμένο</span> : day.versionCount > 1 ? <span className="badge">{day.versionCount} υποβολές</span> : null}
          </>
        ) : (
          <span>Δεν υποβλήθηκε</span>
        )}
      </span>
    </button>
  );
}
