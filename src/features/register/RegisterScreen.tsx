import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { formatDayEl, formatDayMonth } from '../../app/dates';
import type { ShopConfig } from '../../core/config';
import { isBill, type EntryMode } from '../../core/denominations';
import type { ClosingInputs } from '../../core/formula';
import { buildSupplierHistory, type SupplierHistory } from '../../core/suggestions';
import { loadDraft, markDraftSubmitted, saveDraft, takeUnsentNotice } from '../../data/local/drafts';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceApi, DeviceContext, DeviceError, StaffSession } from '../../data/remote/deviceApi';
import { BottomBar } from './BottomBar';
import { ChannelsCard } from './ChannelsCard';
import { CoinCalcSheet } from './CoinCalcSheet';
import { CountCard } from './CountCard';
import { deriveClosing, envelopeBlockReason, submitBlockReason } from './derive';
import { draftReducer, newDraft, type Draft } from './draft';
import { EnvelopeSheet } from './EnvelopeSheet';
import { ExpensesCard } from './ExpensesCard';
import { CashierSheet, HeaderMenu } from './HeaderMenu';
import { ModeSwitch } from './ModeSwitch';
import type { ShareFn } from './share';
import { SubmitSheet } from './SubmitSheet';
import { SummaryCard } from './SummaryCard';
import { useDraftAutosave } from './useDraftAutosave';

export interface RegisterProps {
  /** The server's view of this phone; the draft belongs to `ctx.businessDate`. */
  ctx: DeviceContext;
  /** `ctx.config`, already checked with `isShopConfig` by PhoneApp. */
  config: ShopConfig;
  /** The signed-in cashier: shown in the header, author of new expense lines, token for submit. */
  session: StaffSession;
  api: DeviceApi;
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

const OFFLINE_SUBMIT_REASON = 'Χρειάζεται σύνδεση για υποβολή';

export function RegisterScreen(props: RegisterProps) {
  const { ctx, config, session, api, store, now, newId, share, themePref, active, offline, onTheme, onOwner, onSignOut, onServerError } = props;
  const [draft, dispatch] = useReducer(
    draftReducer,
    null,
    (): Draft => loadDraft(store, ctx.shopId, ctx.businessDate) ?? newDraft(ctx.businessDate),
  );
  // Display/typing mode of the denomination boxes; each box remembers the mode it was typed in.
  const [viewMode, setViewMode] = useState<EntryMode>('amount');
  const derived = useMemo(() => deriveClosing(config, draft), [config, draft]);
  const [history, setHistory] = useState<SupplierHistory>({});
  // Bumped after each successful submit so the just-submitted expense lines start suggesting.
  const [historyRound, setHistoryRound] = useState(0);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [calcFor, setCalcFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Idempotency key of the submit sheet, with the inputs it was minted for. Until the server acknowledges
  // a submit, reopening the sheet for an unchanged closing keeps the key (a lost answer is then answered
  // `repeat`); any edit, or an acknowledged submit, makes the next opening mint a new one.
  const submitKey = useRef<{ key: string; inputs: string } | null>(null);
  // Business date of a draft that a day change kept aside before it was submitted (loadDraft moved it).
  const [unsentDate, setUnsentDate] = useState<string | null>(null);
  useDraftAutosave(store, ctx.shopId, draft, now);

  // In an effect, not the draft initializer: StrictMode runs initializers twice and keeps only one result.
  useEffect(() => {
    const date = takeUnsentNotice(store, ctx.shopId);
    if (date !== null) setUnsentDate(date);
  }, [store, ctx.shopId]);

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

  const bills = config.denominations.filter(isBill);
  const coins = config.denominations.filter((d) => !isBill(d));
  const envelopeDef = config.totals.find((t) => t.id === config.envelopeTotalId);
  const calcChannel = config.channels.find((c) => c.id === calcFor);

  // The autosave is debounced; anything that may unmount the register writes the draft first.
  const persistDraft = () => saveDraft(store, ctx.shopId, draft, now().getTime());

  const openSubmit = () => {
    const inputs = JSON.stringify(derived.inputs);
    if (submitKey.current?.inputs !== inputs) submitKey.current = { key: newId(), inputs };
    setSheet('submit');
  };

  const submit = async (inputs: ClosingInputs) => {
    const key = submitKey.current?.key ?? newId();
    const r = await api.submit(session.token, ctx.configId, ctx.businessDate, inputs, key);
    if (r.ok) {
      submitKey.current = null;
      // An acknowledged, unedited draft needs no warning when the day changes.
      markDraftSubmitted(store, ctx.shopId, draft);
      setToast('Το κλείσιμο υποβλήθηκε');
      setHistoryRound((n) => n + 1);
    } else {
      persistDraft();
      onServerError(r.error);
    }
    return r;
  };

  const signOut = async () => {
    persistDraft();
    await api.signOut(session.token);
    onSignOut();
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Κλείσιμο ταμείου</h1>
          <button type="button" className="meta-btn" onClick={() => setSheet('cashier')}>
            {formatDayEl(ctx.businessDate)} · {session.name}
          </button>
        </div>
        {active && <HeaderMenu themePref={themePref} onTheme={onTheme} onOwner={onOwner} />}
      </header>
      <main className="page">
        {unsentDate !== null && (
          <p className="notice" role="alert">
            {`Η ημέρα άλλαξε πριν υποβληθεί το κλείσιμο της ${formatDayMonth(unsentDate)}. Ενημέρωσε τον ιδιοκτήτη.`}
          </p>
        )}
        <ModeSwitch mode={viewMode} onChange={setViewMode} />
        <CountCard title="Χαρτονομίσματα" denominations={bills} totalCents={derived.billsCents} draft={draft} derived={derived} dispatch={dispatch} viewMode={viewMode} />
        <CountCard title="Κέρματα" denominations={coins} totalCents={derived.coinsCents} draft={draft} derived={derived} dispatch={dispatch} viewMode={viewMode} />
        <ExpensesCard
          maxExpenses={config.maxExpenses}
          draft={draft}
          derived={derived}
          history={history}
          author={{ kind: 'staff', id: session.staffId }}
          dispatch={dispatch}
          newId={newId}
          nowMs={() => now().getTime()}
        />
        <ChannelsCard channels={config.channels} draft={draft} derived={derived} dispatch={dispatch} onCalculator={setCalcFor} />
        <SummaryCard config={config} totals={derived.totals} />
      </main>
      <BottomBar
        label={envelopeDef?.label ?? ''}
        amountCents={derived.totals[config.envelopeTotalId] ?? 0}
        envelopeBlocked={envelopeBlockReason(derived)}
        submitBlocked={submitBlockReason(derived, draft) ?? (offline ? OFFLINE_SUBMIT_REASON : null)}
        onEnvelope={() => setSheet('envelope')}
        onSubmit={openSubmit}
      />
      {active && sheet === 'envelope' && (
        <EnvelopeSheet denominations={config.denominations} envelope={derived.envelope} onClose={() => setSheet(null)} />
      )}
      {active && sheet === 'submit' && (
        <SubmitSheet config={config} draft={draft} derived={derived} onSubmit={submit} onShare={share} onClose={() => setSheet(null)} />
      )}
      {active && sheet === 'cashier' && <CashierSheet name={session.name} onSignOut={signOut} onClose={() => setSheet(null)} />}
      {active && calcChannel !== undefined && (
        <CoinCalcSheet
          label={calcChannel.label}
          onApply={(text) => {
            dispatch({ type: 'setChannel', id: calcChannel.id, text });
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
