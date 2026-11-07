import { useEffect, useMemo, useReducer, useState } from 'react';
import { formatDayEl } from '../../app/dates';
import type { ShopConfig } from '../../core/config';
import { isBill } from '../../core/denominations';
import { buildSupplierHistory } from '../../core/suggestions';
import { loadDraft } from '../../data/local/drafts';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import { loadSubmissions, pastExpenses, saveSubmission, type SaveResult } from '../../data/local/submissions';
import { BottomBar } from './BottomBar';
import { ChannelsCard } from './ChannelsCard';
import { CoinCalcSheet } from './CoinCalcSheet';
import { CountCard } from './CountCard';
import { deriveClosing, envelopeBlockReason, submitBlockReason } from './derive';
import { draftReducer, newDraft, type Draft } from './draft';
import { EnvelopeSheet } from './EnvelopeSheet';
import { ExpensesCard } from './ExpensesCard';
import { HeaderMenu } from './HeaderMenu';
import { ModeSwitch } from './ModeSwitch';
import type { ShareFn } from './share';
import { SubmitSheet } from './SubmitSheet';
import { SummaryCard } from './SummaryCard';
import { useDraftAutosave } from './useDraftAutosave';

/** The shop the register works for; `config` has already passed `isShopConfig`. */
export interface RegisterShop {
  id: string;
  name: string;
  config: ShopConfig;
}

export interface RegisterProps {
  shop: RegisterShop;
  /** The server's business date (DeviceContext.businessDate); the draft belongs to it. */
  businessDate: string;
  /** The signed-in cashier, shown in the header. */
  staffName: string;
  store: KeyValueStore;
  now: () => Date;
  newId: () => string;
  share: ShareFn;
  themePref: ThemePref;
  active: boolean;
  onTheme: () => void;
  onOwner: () => void;
}

type SheetName = 'envelope' | 'submit';

export function RegisterScreen({ shop, businessDate, staffName, store, now, newId, share, themePref, active, onTheme, onOwner }: RegisterProps) {
  const { config } = shop;
  const [draft, dispatch] = useReducer(
    draftReducer,
    null,
    (): Draft => loadDraft(store, shop.id, businessDate) ?? newDraft(newId(), businessDate),
  );
  const derived = useMemo(() => deriveClosing(config, draft), [config, draft]);
  const [submissions, setSubmissions] = useState(() => loadSubmissions(store, shop.id));
  const history = useMemo(() => buildSupplierHistory(pastExpenses(submissions)), [submissions]);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [calcFor, setCalcFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useDraftAutosave(store, shop.id, draft, now);

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

  const save = (): SaveResult => {
    const submission = {
      id: draft.id,
      shopId: shop.id,
      staffName: '', // Task 6 replaces local submissions with the server submit
      businessDate: draft.businessDate,
      submittedAt: now().toISOString(),
      inputs: derived.inputs,
    };
    let result = saveSubmission(store, submission);
    // The draft id collided with a *different* stored closing (not a duplicate submit) — retry
    // once under a fresh id so the typed closing is never silently dropped.
    if (result === 'conflict') result = saveSubmission(store, { ...submission, id: newId() });
    if (result !== 'failed') {
      setSubmissions(loadSubmissions(store, shop.id));
      // Reset right away (new draft id): if the person leaves or reloads instead of tapping
      // "Νέο κλείσιμο", later edits must not be resubmitted under the saved id ('duplicate').
      dispatch({ type: 'resetInputs', id: newId() });
    }
    return result;
  };

  const closeSubmit = (saved: boolean) => {
    setSheet(null);
    if (saved) setToast('Το κλείσιμο αποθηκεύτηκε');
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Κλείσιμο ταμείου</h1>
          <span className="meta-btn">
            {formatDayEl(draft.businessDate)} · {staffName}
          </span>
        </div>
        {active && <HeaderMenu themePref={themePref} onTheme={onTheme} onOwner={onOwner} />}
      </header>
      <main className="page">
        <ModeSwitch mode={draft.mode} onChange={(mode) => dispatch({ type: 'setMode', mode, denominations: config.denominations })} />
        <CountCard title="Χαρτονομίσματα" denominations={bills} totalCents={derived.billsCents} draft={draft} derived={derived} dispatch={dispatch} />
        <CountCard title="Κέρματα" denominations={coins} totalCents={derived.coinsCents} draft={draft} derived={derived} dispatch={dispatch} />
        <ExpensesCard maxExpenses={config.maxExpenses} draft={draft} derived={derived} history={history} dispatch={dispatch} newId={newId} />
        <ChannelsCard channels={config.channels} draft={draft} derived={derived} dispatch={dispatch} onCalculator={setCalcFor} />
        <SummaryCard config={config} totals={derived.totals} />
      </main>
      <BottomBar
        label={envelopeDef?.label ?? ''}
        amountCents={derived.totals[config.envelopeTotalId] ?? 0}
        envelopeBlocked={envelopeBlockReason(derived)}
        submitBlocked={submitBlockReason(derived, draft)}
        onEnvelope={() => setSheet('envelope')}
        onSubmit={() => setSheet('submit')}
      />
      {active && sheet === 'envelope' && (
        <EnvelopeSheet denominations={config.denominations} envelope={derived.envelope} onClose={() => setSheet(null)} />
      )}
      {active && sheet === 'submit' && (
        <SubmitSheet config={config} draft={draft} derived={derived} onSave={save} onShare={share} onClose={closeSubmit} />
      )}
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
