import { useEffect, useMemo, useReducer, useState } from 'react';
import { formatDayEl, todayIso } from '../../app/dates';
import type { Route } from '../../app/router';
import type { LocalShop } from '../../app/shop';
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
import { PeopleSheet } from './PeopleSheet';
import type { ShareFn } from './share';
import { SubmitSheet } from './SubmitSheet';
import { SummaryCard } from './SummaryCard';
import { useDraftAutosave } from './useDraftAutosave';

export interface RegisterProps {
  shop: LocalShop;
  store: KeyValueStore;
  now: () => Date;
  newId: () => string;
  share: ShareFn;
  staff: readonly string[];
  themePref: ThemePref;
  onTheme: () => void;
  onNavigate: (route: Route) => void;
}

type SheetName = 'envelope' | 'submit' | 'people';

export function RegisterScreen({ shop, store, now, newId, share, staff, themePref, onTheme, onNavigate }: RegisterProps) {
  const { config } = shop;
  const [draft, dispatch] = useReducer(
    draftReducer,
    null,
    (): Draft => loadDraft(store, shop.id, now().getTime()) ?? newDraft(newId(), todayIso(now())),
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

  const bills = config.denominations.filter(isBill);
  const coins = config.denominations.filter((d) => !isBill(d));
  const envelopeDef = config.totals.find((t) => t.id === config.envelopeTotalId);
  const calcChannel = config.channels.find((c) => c.id === calcFor);

  const save = (): SaveResult => {
    const result = saveSubmission(store, {
      id: draft.id,
      shopId: shop.id,
      staffName: draft.staffName,
      businessDate: draft.businessDate,
      submittedAt: now().toISOString(),
      inputs: derived.inputs,
    });
    if (result !== 'failed') setSubmissions(loadSubmissions(store, shop.id));
    return result;
  };

  const closeSubmit = (saved: boolean) => {
    setSheet(null);
    if (!saved) return;
    dispatch({ type: 'resetInputs', id: newId() });
    setToast('Το κλείσιμο αποθηκεύτηκε');
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Κλείσιμο ταμείου</h1>
          <button type="button" className="meta-btn" onClick={() => setSheet('people')}>
            {formatDayEl(draft.businessDate)} · {draft.staffName || 'Διάλεξε όνομα'}
          </button>
        </div>
        <HeaderMenu hasTare={config.tareItems.length > 0} themePref={themePref} onNavigate={onNavigate} onTheme={onTheme} />
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
      {sheet === 'envelope' && <EnvelopeSheet denominations={config.denominations} envelope={derived.envelope} onClose={() => setSheet(null)} />}
      {sheet === 'submit' && <SubmitSheet config={config} draft={draft} derived={derived} onSave={save} onShare={share} onClose={closeSubmit} />}
      {sheet === 'people' && (
        <PeopleSheet
          staff={staff}
          staffName={draft.staffName}
          businessDate={draft.businessDate}
          onStaff={(name) => dispatch({ type: 'setStaff', name })}
          onDate={(date) => dispatch({ type: 'setDate', date })}
          onManage={() => {
            setSheet(null);
            onNavigate('staff');
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {calcChannel !== undefined && (
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
