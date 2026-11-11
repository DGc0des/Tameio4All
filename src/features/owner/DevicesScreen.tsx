import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DeviceRow, OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { Sheet } from '../../ui/Sheet';
import { checkLabel, DEVICE_LABEL_MAX } from './model/limits';
import { ownerErrorMessage } from './model/messages';
import { formatDate } from './model/time';
import { ErrorText } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  now: () => Date;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; devices: DeviceRow[] };

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
    const r = await action.run(() => api.renameDevice(device.userId, l.value));
    if (r.ok) {
      setRenaming(false);
      onChanged();
    }
  };
  const remove = async () => {
    setConfirming(false);
    const r = await action.run(() => api.removeDevice(device.userId));
    if (r.ok) onChanged();
  };

  return (
    <fieldset className="card" aria-label={title}>
      <div className="row">
        <span className="row-label">
          <b>{title}</b>
          <span className="row-hint">
            Συνδέθηκε {formatDate(device.createdAt)}
          </span>
        </span>
      </div>
      {renaming ? (
        <form className="row" onSubmit={saveName} noValidate>
          <input className="field text" aria-label="Νέο όνομα συσκευής" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={action.busy}>
            OK
          </button>
          <button type="button" className="btn btn-text" onClick={() => setRenaming(false)}>
            Άκυρο
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
          <button type="button" className="choice" onClick={() => setConfirming(true)}>
            Αφαίρεση
          </button>
        </div>
      )}
      <ErrorText state={action.state} />
      {confirming && (
        <Sheet title="Αφαίρεση συσκευής" onClose={() => setConfirming(false)}>
          <p>Η συσκευή «{title}» θα φύγει από τη λίστα.</p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={() => setConfirming(false)}>
              Άκυρο
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void remove()}>
              Αφαίρεση
            </button>
          </div>
        </Sheet>
      )}
    </fieldset>
  );
}

/** Placeholder until the store-link card lands (stage 4, Task 6); `now` is unused meanwhile. */
export function DevicesScreen({ api, shopId }: Props) {
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
