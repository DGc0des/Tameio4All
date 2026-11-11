import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomId } from '../../../app/ids';
import { isShopConfig } from '../../../core/config';
import type { EntryMode } from '../../../core/denominations';
import type { SupplierHistory } from '../../../core/suggestions';
import type { OwnerError } from '../../../data/remote/errors';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { Sheet } from '../../../ui/Sheet';
import { deriveClosing, envelopeBlockReason } from '../../register/derive';
import type { FieldKey, Snapshot } from '../../register/live/fields';
import { draftFromFields } from '../../register/live/merge';
import type { Presence } from '../../register/live/syncEngine';
import { LiveClosingView } from '../../register/LiveClosingView';
import { INVALID_CONFIG_MESSAGE } from '../../register/messages';
import { ownerErrorMessage } from '../model/messages';
import { applyLocalEdit } from './model';

export interface CorrectionEditorProps {
  api: OwnerApi;
  shopId: string;
  /** Local starting point: snapshotFromInputs(current) or the unsubmitted day's open snapshot. */
  base: Snapshot;
  /** The version being corrected; null when filing an unsubmitted day. */
  expectedCurrentId: string | null;
  /** The parent refetches the day and leaves edit mode. */
  onSaved: () => void;
  /** «Φόρτωση νέας»: the parent refetches; the editor remounts on the new current. */
  onReload: () => void;
  onCancel: () => void;
  now: () => Date;
  newId?: () => string;
}

/** A save refused because the day moved on; the owner decides (never retried automatically). */
type Conflict = Extract<OwnerError, { code: 'closing_changed' } | { code: 'config_mismatch' }>;

const OWNER_AUTHOR = { kind: 'owner' } as const;
const NO_PRESENCE: Presence = [];
const NO_HISTORY: SupplierHistory = {};
const noop = (): void => {};

/** A past closing edited locally (nothing live, nothing sent per field) and saved as a new version. */
export function CorrectionEditor({ api, shopId, base, expectedCurrentId, onSaved, onReload, onCancel, now, newId = randomId }: CorrectionEditorProps) {
  const config = isShopConfig(base.config) ? base.config : null;
  const [snapshot, setSnapshot] = useState(base);
  const [viewMode, setViewMode] = useState<EntryMode>('count');
  /** Idempotency key: kept across retries of the same inputs, re-minted by every edit and after closing_changed. */
  const [key, setKey] = useState(newId);
  /** The version the next save is guarded on (moves to the newer one after «Αποθήκευση πάνω της»). */
  const [expected, setExpected] = useState(expectedCurrentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OwnerError | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const edit = useCallback(
    (k: FieldKey, v: unknown) => {
      setSnapshot((s) => applyLocalEdit(s, k, v));
      setKey(newId());
      setError(null);
    },
    [newId],
  );

  const draft = useMemo(() => draftFromFields(snapshot, []), [snapshot]);
  const derived = useMemo(() => (config === null ? null : deriveClosing(config, draft)), [config, draft]);
  const baseInputs = useMemo(
    () => (config === null ? '' : JSON.stringify(deriveClosing(config, draftFromFields(base, [])).inputs)),
    [config, base],
  );

  if (config === null || derived === null) {
    return (
      <Card>
        <p role="alert">{INVALID_CONFIG_MESSAGE}</p>
        <button type="button" className="btn btn-text" onClick={onCancel}>
          Άκυρο
        </button>
      </Card>
    );
  }

  const changed = JSON.stringify(derived.inputs) !== baseInputs;
  const blocked = envelopeBlockReason(derived) ?? (expectedCurrentId !== null && !changed ? 'Δεν άλλαξε κάτι' : null);

  const save = async (guard: string | null, k: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setConflict(null);
    const r = await api.saveClosing(shopId, {
      businessDate: base.businessDate, configId: base.configId, inputs: derived.inputs, expectedCurrentId: guard, key: k,
    });
    inFlight.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (r.ok) {
      onSaved();
    } else if (r.error.code === 'closing_changed') {
      setKey(newId());
      setConflict(r.error);
    } else if (r.error.code === 'config_mismatch') {
      setConflict(r.error);
    } else {
      setError(r.error);
    }
  };

  /** «Αποθήκευση πάνω της» is offered only when there is a newer version to save over. */
  const overId = conflict?.code === 'closing_changed' ? conflict.currentId : null;
  const saveOver = (currentId: string) => {
    setExpected(currentId);
    void save(currentId, key);
  };

  return (
    <>
      <LiveClosingView
        config={config}
        draft={draft}
        derived={derived}
        viewMode={viewMode}
        onViewMode={setViewMode}
        presence={NO_PRESENCE}
        edit={edit}
        flush={noop}
        focus={noop}
        author={OWNER_AUTHOR}
        newId={newId}
        now={now}
        history={NO_HISTORY}
      />
      {blocked !== null && <p className="notice-soft">{blocked}</p>}
      {error !== null && (
        <p className="form-error" role="alert">
          {ownerErrorMessage(error)}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={busy || blocked !== null} onClick={() => void save(expected, key)}>
        Αποθήκευση
      </button>
      <button type="button" className="btn btn-text" disabled={busy} onClick={onCancel}>
        Άκυρο
      </button>
      {conflict !== null && (
        <Sheet title="Το κλείσιμο άλλαξε" onClose={() => setConflict(null)}>
          <p>{ownerErrorMessage(conflict)}</p>
          <button type="button" className="btn btn-primary" onClick={onReload}>
            Φόρτωση νέας
          </button>
          {overId !== null && (
            <button type="button" className="btn btn-text" onClick={() => saveOver(overId)}>
              Αποθήκευση πάνω της
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}
