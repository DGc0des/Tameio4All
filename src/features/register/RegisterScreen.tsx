import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDayEl, formatTimeEl } from '../../app/dates';
import { isShopConfig } from '../../core/config';
import type { EntryMode } from '../../core/denominations';
import type { ClosingInputs } from '../../core/formula';
import { buildSupplierHistory, type SupplierHistory } from '../../core/suggestions';
import { loadEntryMode, saveEntryMode } from '../../data/local/openClosing';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceApi, DeviceContext, DeviceError, StaffSession } from '../../data/remote/deviceApi';
import { Card } from '../../ui/Card';
import { deviceErrorMessage } from '../phone/model/messages';
import { BottomBar } from './BottomBar';
import { CoinCalcSheet } from './CoinCalcSheet';
import { deriveClosing, envelopeBlockReason, submitBlockReason } from './derive';
import { EnvelopeSheet } from './EnvelopeSheet';
import { CashierSheet, HeaderMenu } from './HeaderMenu';
import { amountValue, channelKey } from './live/fields';
import { useLiveClosing } from './live/useLiveClosing';
import { SIGN_OUT_DRAIN_MS, type Writer } from './live/syncEngine';
import { LiveClosingView } from './LiveClosingView';
import { INVALID_CONFIG_MESSAGE } from './messages';
import type { ShareFn } from './share';
import { SubmitSheet } from './SubmitSheet';

export interface RegisterProps {
  /** The server's view of this phone (shop, business date). The closing itself comes from the live snapshot. */
  ctx: DeviceContext;
  /** The signed-in cashier: shown in the header, author of new expense lines, token for every call. */
  session: StaffSession;
  api: DeviceApi;
  /** Must be a stable object: the live engine remounts when it changes. */
  store: KeyValueStore;
  now: () => Date;
  newId: () => string;
  share: ShareFn;
  themePref: ThemePref;
  active: boolean;
  /** Showing a cached context: submitting needs the server. */
  offline: boolean;
  onTheme: () => void;
  onOwner: () => void;
  onSignOut: () => void;
  /** Every server failure goes here; the phone gate decides what it means (sign in again, unpair, nothing). */
  onServerError: (e: DeviceError) => void;
}

type SheetName = 'envelope' | 'submit' | 'cashier';

export const OFFLINE_SUBMIT_REASON = 'Χρειάζεται σύνδεση για υποβολή';
export const PENDING_SUBMIT_REASON = 'Περιμένει αποθήκευση…';
export const CONNECTING_SUBMIT_REASON = 'Σύνδεση…';
/** The engine stopped after a failure the gate did not take over: nothing is saved until «Δοκίμασε ξανά». */
export const HALTED_SUBMIT_REASON = 'Δεν αποθηκεύεται — δοκίμασε ξανά';

export function RegisterScreen(props: RegisterProps) {
  const { ctx, session, api, store, now, newId, share, themePref, active, offline, onTheme, onOwner, onSignOut, onServerError } = props;

  // The phone's side of the shared closing: every call carries the staff token (server-side identity).
  const writer = useMemo<Writer>(
    () => ({
      load: () => api.getOpenClosing(session.token),
      write: (e) => api.setField(session.token, e.businessDate, e.key, e.value, e.baseVersion),
      live: (h) => api.live(ctx.shopId, { name: session.name }, h),
    }),
    [api, session.token, session.name, ctx.shopId],
  );
  const [fatal, setFatal] = useState<DeviceError | null>(null);
  // The queue's author is this cashier: another cashier's unsent edits on this phone are never sent with our token.
  const me = useMemo(() => ({ name: session.name, id: session.staffId }), [session.name, session.staffId]);
  const live = useLiveClosing(writer, store, ctx.shopId, me, now, {
    onFatal: (e) => {
      setFatal(e);
      onServerError(e);
    },
  });
  const { state, draft, edit, flush, focus, resync, drain, clearNotice, restart } = live;
  const snapshot = state.snapshot;
  // The closing's pinned config, never device_context's (an older/newer config would compute other totals).
  const config = snapshot !== null && isShopConfig(snapshot.config) ? snapshot.config : null;
  const derived = useMemo(() => (config !== null && draft !== null ? deriveClosing(config, draft) : null), [config, draft]);

  // How this phone shows/types the denomination boxes (a per-shop preference, not part of the closing).
  const [viewMode, setViewModeState] = useState<EntryMode>(() => loadEntryMode(store, ctx.shopId));
  const setViewMode = (m: EntryMode) => {
    setViewModeState(m);
    saveEntryMode(store, ctx.shopId, m);
  };

  const [history, setHistory] = useState<SupplierHistory>({});
  // Bumped after each successful submit so the just-submitted expense lines start suggesting.
  const [historyRound, setHistoryRound] = useState(0);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [calcFor, setCalcFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Idempotency key of the submit sheet, with the inputs it was minted for. Until the server acknowledges
  // a submit, reopening the sheet for an unchanged closing keeps the key (a lost answer is then answered
  // `repeat`); any edit, an acknowledged submit or a `draft_changed` refusal makes the next send mint a new one.
  const submitKey = useRef<{ key: string; inputs: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.suggestionData().then((r) => {
      if (cancelled) return;
      if (r.ok) setHistory(buildSupplierHistory(r.data));
      else onServerError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [api, onServerError, historyRound]);

  // The engine's notices (an offline edit lost to someone else, a day change) show once as a toast.
  useEffect(() => {
    if (state.notice === null) return;
    setToast(state.notice);
    clearNotice();
  }, [state.notice, clearNotice]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Leaving the register (e.g. into the owner area) must not leave a sheet mounted-but-hidden
  // with its listeners (Escape, outside click) still live.
  useEffect(() => {
    if (!active) {
      setSheet(null);
      setCalcFor(null);
    }
  }, [active]);

  // Our queued edits go out with our token before the session ends (bounded wait). Whatever is not sent by
  // then stays stored under this cashier and is never sent as the next one.
  const signOut = async () => {
    await drain(SIGN_OUT_DRAIN_MS);
    await api.signOut(session.token);
    onSignOut();
  };

  const header = (
    <header className="top">
      <div>
        <h1>Κλείσιμο ταμείου</h1>
        <button type="button" className="meta-btn" onClick={() => setSheet('cashier')}>
          {formatDayEl(snapshot?.businessDate ?? ctx.businessDate)} · {session.name}
        </button>
        {snapshot?.lastSubmit && (
          <p className="sub">{`Υποβλήθηκε ${formatTimeEl(snapshot.lastSubmit.at)} · ${snapshot.lastSubmit.staffName}`}</p>
        )}
      </div>
      {active && <HeaderMenu themePref={themePref} onTheme={onTheme} onOwner={onOwner} />}
    </header>
  );
  const cashierSheet = active && sheet === 'cashier' && <CashierSheet name={session.name} onSignOut={signOut} onClose={() => setSheet(null)} />;
  // The engine stopped after a failure the gate did not take over (it would have unmounted us): offer a
  // fresh engine. Otherwise the engine is offline; the gate's own banner covers a cached context.
  const retryLive = () => {
    setFatal(null);
    restart();
  };
  const banner =
    fatal !== null ? (
      <p className="notice" role="alert">
        {deviceErrorMessage(fatal)}{' '}
        <button type="button" className="btn btn-text" onClick={retryLive}>
          Δοκίμασε ξανά
        </button>
      </p>
    ) : (
      !offline &&
      state.status === 'offline' && (
        <p className="notice" role="status">
          Εκτός σύνδεσης
        </p>
      )
    );

  // No boxes before there is a snapshot: the engine ignores edits without one.
  if (snapshot === null || draft === null || config === null || derived === null) {
    return (
      <div className="app">
        {header}
        {banner}
        <main className="page">
          {snapshot !== null && config === null ? (
            <Card>
              <p role="alert">{INVALID_CONFIG_MESSAGE}</p>
            </Card>
          ) : (
            fatal === null && (
              <p className="notice-soft">
                {state.status === 'offline' ? 'Το ταμείο θα φορτώσει μόλις υπάρξει σύνδεση.' : 'Φόρτωση…'}
              </p>
            )
          )}
        </main>
        {cashierSheet}
      </div>
    );
  }

  const envelopeDef = config.totals.find((t) => t.id === config.envelopeTotalId);
  const calcChannel = config.channels.find((c) => c.id === calcFor);
  const unsaved = state.pending.some((p) => p.businessDate === snapshot.businessDate);
  const submitBlocked =
    submitBlockReason(derived, draft) ??
    (fatal !== null ? HALTED_SUBMIT_REASON : null) ??
    (offline || state.status === 'offline' ? OFFLINE_SUBMIT_REASON : null) ??
    (unsaved ? PENDING_SUBMIT_REASON : null) ??
    (state.status !== 'live' ? CONNECTING_SUBMIT_REASON : null);

  const openSubmit = () => {
    const inputs = JSON.stringify(derived.inputs);
    if (submitKey.current?.inputs !== inputs) submitKey.current = { key: newId(), inputs };
    setSheet('submit');
  };

  const submit = async (inputs: ClosingInputs, revision: number) => {
    const json = JSON.stringify(inputs);
    if (submitKey.current?.inputs !== json) submitKey.current = { key: newId(), inputs: json };
    const key = submitKey.current.key;
    const r = await api.submit(session.token, snapshot.configId, snapshot.businessDate, inputs, revision, key);
    if (r.ok) {
      submitKey.current = null;
      setToast('Το κλείσιμο υποβλήθηκε');
      setHistoryRound((n) => n + 1);
      // «Υποβλήθηκε …» also arrives by broadcast; the load covers a missed one.
      void resync();
    } else if (r.error.code === 'draft_changed') {
      // Someone changed the closing after this sheet's snapshot: fetch it; the next tap is a new submit.
      submitKey.current = null;
      void resync();
    } else {
      onServerError(r.error);
    }
    return r;
  };

  return (
    <div className="app">
      {header}
      {banner}
      <main className="page">
        <LiveClosingView
          config={config}
          draft={draft}
          derived={derived}
          viewMode={viewMode}
          onViewMode={setViewMode}
          presence={state.presence}
          edit={edit}
          flush={flush}
          focus={focus}
          author={{ kind: 'staff', id: session.staffId }}
          newId={newId}
          now={now}
          history={history}
          onCalculator={setCalcFor}
        />
      </main>
      <BottomBar
        label={envelopeDef?.label ?? ''}
        amountCents={derived.totals[config.envelopeTotalId] ?? 0}
        envelopeBlocked={envelopeBlockReason(derived)}
        submitBlocked={submitBlocked}
        onEnvelope={() => setSheet('envelope')}
        onSubmit={openSubmit}
      />
      {active && sheet === 'envelope' && (
        <EnvelopeSheet denominations={config.denominations} envelope={derived.envelope} onClose={() => setSheet(null)} />
      )}
      {active && sheet === 'submit' && (
        <SubmitSheet
          config={config}
          draft={draft}
          derived={derived}
          revision={snapshot.revision}
          blocked={submitBlocked}
          onSubmit={submit}
          onShare={share}
          onClose={() => setSheet(null)}
        />
      )}
      {cashierSheet}
      {active && calcChannel !== undefined && (
        <CoinCalcSheet
          label={calcChannel.label}
          onApply={(text) => {
            edit(channelKey(calcChannel.id), amountValue(text));
            flush(channelKey(calcChannel.id));
            setCalcFor(null);
          }}
          onClose={() => setCalcFor(null)}
        />
      )}
      {toast !== null && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
