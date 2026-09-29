import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DeviceRow, OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { Sheet } from '../../ui/Sheet';
import { checkLabel, DEVICE_LABEL_MAX } from './model/limits';
import { ownerErrorMessage } from './model/messages';
import { formatCountdown, formatPairingCode, PAIRING_TTL_SECONDS, secondsLeft } from './model/pairing';
import { formatDate } from './model/time';
import { ErrorText } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  now: () => Date;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; devices: DeviceRow[] };

function PairingCard({ api, shopId, now }: Props) {
  const [code, setCode] = useState<{ code: string; expiresAtMs: number } | null>(null);
  const [, setTick] = useState(0);
  const action = useAction();

  useEffect(() => {
    if (code === null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [code]);

  const create = async () => {
    const r = await action.run(() => api.createPairingCode(shopId));
    if (r.ok) setCode({ code: r.data, expiresAtMs: now().getTime() + PAIRING_TTL_SECONDS * 1000 });
  };

  const left = code ? secondsLeft(code.expiresAtMs, now().getTime()) : 0;
  return (
    <Card title="Σύνδεση συσκευής ταμείου">
      {code === null && (
        <button type="button" className="btn btn-primary wide" disabled={action.busy} onClick={() => void create()}>
          Σύνδεση νέας συσκευής
        </button>
      )}
      {code !== null && left > 0 && (
        <>
          <p className="notice-soft">Άνοιξε την εφαρμογή στο κινητό του ταμείου και γράψε αυτόν τον κωδικό:</p>
          <p className="pair-code" aria-live="polite">
            {formatPairingCode(code.code)}
          </p>
          <p className="notice-soft">Λήγει σε {formatCountdown(left)} · ισχύει μία φορά.</p>
          <button type="button" className="btn btn-text" onClick={() => setCode(null)}>
            Κλείσιμο
          </button>
        </>
      )}
      {code !== null && left === 0 && (
        <>
          <p className="status-warn">Ο κωδικός έληξε.</p>
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void create()}>
            Νέος κωδικός
          </button>
        </>
      )}
      <ErrorText state={action.state} />
    </Card>
  );
}

function DeviceEditor({ api, device, onChanged }: { api: OwnerApi; device: DeviceRow; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const title = device.label || 'Χωρίς όνομα';

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const l = checkLabel(text, DEVICE_LABEL_MAX);
    if (!l.ok) return action.fail(`Έως ${DEVICE_LABEL_MAX} χαρακτήρες.`);
    const r = await action.run(() => api.updateDevice(device.userId, { label: l.value }));
    if (r.ok) {
      setRenaming(false);
      onChanged();
    }
  };
  const revoke = async () => {
    setConfirming(false);
    const r = await action.run(() => api.updateDevice(device.userId, { revoke: true }));
    if (r.ok) onChanged();
  };

  return (
    <fieldset className="card" aria-label={title} style={{ border: 0 }}>
      <div className="row">
        <span className="row-label">
          <b>{title}</b>
          <span className="row-hint">
            Συνδέθηκε {formatDate(device.createdAt)} · {device.revokedAt ? 'Ανακλήθηκε' : 'Ενεργή'}
          </span>
        </span>
      </div>
      {renaming ? (
        <form className="row" onSubmit={saveName} noValidate>
          <input className="field text" aria-label="Νέο όνομα συσκευής" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={action.busy}>
            OK
          </button>
        </form>
      ) : (
        <div className="choices">
          <button
            type="button"
            className="choice"
            onClick={() => {
              setText(device.label);
              setRenaming(true);
            }}
          >
            Μετονομασία
          </button>
          {!device.revokedAt && (
            <button type="button" className="choice" onClick={() => setConfirming(true)}>
              Ανάκληση
            </button>
          )}
        </div>
      )}
      <ErrorText state={action.state} />
      {confirming && (
        <Sheet title="Ανάκληση συσκευής" onClose={() => setConfirming(false)}>
          <p>Η συσκευή «{title}» δεν θα μπορεί να κάνει κλεισίματα. Για να ξανασυνδεθεί θα χρειαστεί νέος κωδικός.</p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={() => setConfirming(false)}>
              Άκυρο
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void revoke()}>
              Ανάκληση
            </button>
          </div>
        </Sheet>
      )}
    </fieldset>
  );
}

export function DevicesScreen({ api, shopId, now }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const reload = useCallback(async () => {
    const r = await api.listDevices(shopId);
    setLoad(r.ok ? { status: 'ready', devices: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
  }, [api, shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <PairingCard api={api} shopId={shopId} now={now} />
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <Card>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          <button type="button" className="btn btn-text" onClick={() => void reload()}>
            Ξανά
          </button>
        </Card>
      )}
      {load.status === 'ready' && load.devices.length === 0 && <p className="notice-soft">Καμία συνδεδεμένη συσκευή.</p>}
      {load.status === 'ready' && load.devices.map((d) => <DeviceEditor key={d.userId} api={api} device={d} onChanged={() => void reload()} />)}
    </>
  );
}
