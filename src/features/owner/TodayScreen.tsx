import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTimeEl } from '../../app/dates';
import { randomId } from '../../app/ids';
import { isShopConfig } from '../../core/config';
import type { EntryMode } from '../../core/denominations';
import type { SupplierHistory } from '../../core/suggestions';
import { loadEntryMode, saveEntryMode } from '../../data/local/openClosing';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceError } from '../../data/remote/deviceApi';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { deviceErrorMessage } from '../phone/model/messages';
import { BottomBar } from '../register/BottomBar';
import { deriveClosing, envelopeBlockReason } from '../register/derive';
import { EnvelopeSheet } from '../register/EnvelopeSheet';
import { OWNER_QUEUE_AUTHOR, changedSinceSubmit } from '../register/live/fields';
import { useLiveClosing } from '../register/live/useLiveClosing';
import { LiveClosingView } from '../register/LiveClosingView';
import { CHANGED_SINCE_SUBMIT, CONNECTING_SUBMIT_REASON, INVALID_CONFIG_MESSAGE, PENDING_SUBMIT_REASON } from '../register/messages';
import { ownerErrorMessage } from './model/messages';
import { OWNER_PRESENCE_NAME, createTodayWriter } from './todayWriter';

export interface TodayScreenProps {
  api: OwnerApi;
  shopId: string;
  /** Must be a stable object (the live engine remounts when it changes). */
  store: KeyValueStore;
  now: () => Date;
  newId?: () => string;
}

const OWNER = { name: OWNER_PRESENCE_NAME, id: OWNER_QUEUE_AUTHOR };
const OWNER_AUTHOR = { kind: 'owner' } as const;
const NO_HISTORY: SupplierHistory = {};

/** The shop's open closing, live: same boxes, totals and Φάκελος as the register, edited as «Ιδιοκτήτης». No submit here. */
export function TodayScreen({ api, shopId, store, now, newId = randomId }: TodayScreenProps) {
  const writer = useMemo(() => createTodayWriter(api, shopId), [api, shopId]);
  const [fatal, setFatal] = useState<DeviceError | null>(null);
  const { state, draft, edit, flush, focus, resync, clearNotice, restart } = useLiveClosing(writer, store, shopId, OWNER, now, { onFatal: setFatal });
  const snapshot = state.snapshot;
  const config = snapshot !== null && isShopConfig(snapshot.config) ? snapshot.config : null;
  const derived = useMemo(() => (config !== null && draft !== null ? deriveClosing(config, draft) : null), [config, draft]);

  const [viewMode, setViewModeState] = useState<EntryMode>(() => loadEntryMode(store, shopId));
  const setViewMode = (m: EntryMode) => {
    setViewModeState(m);
    saveEntryMode(store, shopId, m);
  };

  const [toast, setToast] = useState<string | null>(null);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Idempotency key of «Καταχώρηση αλλαγών», kept while the inputs are unchanged and not yet acknowledged (like the phone's submit).
  const saveKey = useRef<{ key: string; inputs: string } | null>(null);
  // The current version the next save is guarded on, when the server named a newer one than last_submit.
  const [expectedOverride, setExpectedOverride] = useState<string | null>(null);
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

  const retry = () => {
    setFatal(null);
    restart();
  };
  const banner =
    fatal !== null ? (
      <p className="notice" role="alert">
        {fatal.code === 'unknown' ? fatal.detail : deviceErrorMessage(fatal)}{' '}
        <button type="button" className="btn btn-text" onClick={retry}>
          Δοκίμασε ξανά
        </button>
      </p>
    ) : (
      state.status === 'offline' && (
        <p className="notice" role="status">
          Εκτός σύνδεσης
        </p>
      )
    );

  if (snapshot === null || draft === null || config === null || derived === null) {
    return (
      <>
        {banner}
        {snapshot !== null && config === null ? (
          <Card>
            <p role="alert">{INVALID_CONFIG_MESSAGE}</p>
          </Card>
        ) : (
          fatal === null && <p className="notice-soft">{state.status === 'offline' ? 'Το ταμείο θα φορτώσει μόλις υπάρξει σύνδεση.' : 'Φόρτωση…'}</p>
        )}
      </>
    );
  }

  const lastSubmit = snapshot.lastSubmit;
  const changed = changedSinceSubmit(snapshot);
  const saveBlocked =
    envelopeBlockReason(derived) ??
    (state.status !== 'live' ? CONNECTING_SUBMIT_REASON : null) ??
    (state.pending.some((p) => p.businessDate === snapshot.businessDate) ? PENDING_SUBMIT_REASON : null);

  /** Records today's live numbers as a new version (the server checks they are the latest: `revision`). */
  const saveLive = async () => {
    if (lastSubmit === null || saving || saveBlocked !== null) return;
    const inputs = derived.inputs;
    const json = JSON.stringify(inputs);
    if (saveKey.current?.inputs !== json) saveKey.current = { key: newId(), inputs: json };
    setSaving(true);
    setSaveError(null);
    const r = await api.saveClosing(shopId, {
      businessDate: snapshot.businessDate, configId: snapshot.configId, inputs,
      expectedCurrentId: expectedOverride ?? lastSubmit.closingId, key: saveKey.current.key, revision: snapshot.revision,
    });
    setSaving(false);
    if (r.ok) {
      saveKey.current = null;
      setExpectedOverride(null);
      setToast('Οι αλλαγές καταχωρήθηκαν');
    } else {
      if (r.error.code === 'draft_changed') saveKey.current = null;
      if (r.error.code === 'closing_changed' && r.error.currentId !== null) setExpectedOverride(r.error.currentId);
      setSaveError(ownerErrorMessage(r.error));
    }
    void resync();
  };

  return (
    <>
      {banner}
      <p className="sub">
        {lastSubmit ? `Υποβλήθηκε ${formatTimeEl(lastSubmit.at)} · ${lastSubmit.staffName}` : 'Δεν έχει υποβληθεί ακόμα'}
      </p>
      {changed && (
        <Card>
          <p>
            <span className="badge">{CHANGED_SINCE_SUBMIT}</span>
          </p>
          <p className="notice-soft">Οι αριθμοί άλλαξαν μετά την τελευταία υποβολή. Καταχώρησέ τους ως νέα έκδοση στο Ιστορικό.</p>
          {saveBlocked !== null && <p className="notice-soft">{saveBlocked}</p>}
          {saveError !== null && (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={saving || saveBlocked !== null} onClick={() => void saveLive()}>
            Καταχώρηση αλλαγών
          </button>
        </Card>
      )}
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
        author={OWNER_AUTHOR}
        newId={newId}
        now={now}
        history={NO_HISTORY}
      />
      <BottomBar
        label={config.totals.find((t) => t.id === config.envelopeTotalId)?.label ?? ''}
        amountCents={derived.totals[config.envelopeTotalId] ?? 0}
        envelopeBlocked={envelopeBlockReason(derived)}
        submitBlocked={null}
        onEnvelope={() => setEnvelopeOpen(true)}
      />
      {envelopeOpen && (
        <EnvelopeSheet denominations={config.denominations} envelope={derived.envelope} onClose={() => setEnvelopeOpen(false)} />
      )}
      {toast !== null && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
