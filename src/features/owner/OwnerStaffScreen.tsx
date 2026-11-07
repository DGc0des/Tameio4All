import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { OwnerApi, StaffRow } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { checkName, isPin, STAFF_NAME_MAX } from './model/limits';
import { nameProblemMessage, ownerErrorMessage } from './model/messages';
import { formatClock, isLocked } from './model/time';
import { ErrorText } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  now: () => Date;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; staff: StaffRow[] };

const PIN_HINT = 'Το PIN πρέπει να είναι 4 ψηφία.';

function StaffEditor({ api, person, now, onChanged }: { api: OwnerApi; person: StaffRow; now: () => Date; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'pin'>('view');
  const [text, setText] = useState('');
  const action = useAction();
  const locked = isLocked(person.lockedUntil, now().getTime());

  const after = async (p: Promise<{ ok: boolean }>) => {
    if ((await p).ok) {
      setMode('view');
      // A typed PIN shouldn't linger in state once it's been saved.
      setText('');
      onChanged();
    }
  };
  const saveName = (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(text, STAFF_NAME_MAX);
    if (!n.ok) return action.fail(nameProblemMessage(n.problem, STAFF_NAME_MAX));
    void after(action.run(() => api.updateStaff(person.id, { name: n.value })));
  };
  const savePin = (e: FormEvent) => {
    e.preventDefault();
    if (!isPin(text)) return action.fail(PIN_HINT);
    void after(action.run(() => api.setStaffPin(person.id, text)));
  };

  return (
    <fieldset className="card" aria-label={person.name}>
      <div className="row">
        <span className="row-label">
          <b>{person.name}</b>
          {locked && person.lockedUntil !== null && <span className="row-hint err"> · Κλειδωμένος έως {formatClock(person.lockedUntil)}</span>}
        </span>
        <label className="check">
          <input type="checkbox" checked={person.active} disabled={action.busy} onChange={(e) => void after(action.run(() => api.updateStaff(person.id, { active: e.target.checked })))} />
          Ενεργός
        </label>
      </div>
      {mode === 'view' && (
        <div className="choices">
          {locked && (
            <button type="button" className="choice" disabled={action.busy} onClick={() => void after(action.run(() => api.unlockStaff(person.id)))}>
              Ξεκλείδωμα
            </button>
          )}
          <button type="button" className="choice" onClick={() => { setText(''); setMode('pin'); }}>
            Αλλαγή PIN
          </button>
          <button type="button" className="choice" onClick={() => { setText(person.name); setMode('rename'); }}>
            Μετονομασία
          </button>
        </div>
      )}
      {mode === 'rename' && (
        <form className="row" onSubmit={saveName} noValidate>
          <input className="field text" aria-label={`Νέο όνομα ${person.name}`} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={action.busy}>
            OK
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('view')}>
            Άκυρο
          </button>
        </form>
      )}
      {mode === 'pin' && (
        <form className="row" onSubmit={savePin} noValidate>
          <input className="field" aria-label={`Νέο PIN ${person.name}`} type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση PIN" disabled={action.busy}>
            OK
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('view')}>
            Άκυρο
          </button>
        </form>
      )}
      <ErrorText state={action.state} />
    </fieldset>
  );
}

export function OwnerStaffScreen({ api, shopId, now }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const add = useAction();

  const reload = useCallback(async () => {
    const r = await api.listStaff(shopId);
    setLoad(r.ok ? { status: 'ready', staff: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
  }, [api, shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(name, STAFF_NAME_MAX);
    if (!n.ok) return add.fail(nameProblemMessage(n.problem, STAFF_NAME_MAX));
    if (!isPin(pin)) return add.fail(PIN_HINT);
    const r = await add.run(() => api.createStaff(shopId, n.value, pin));
    if (r.ok) {
      setName('');
      setPin('');
      await reload();
    }
  };

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
      {load.status === 'ready' && load.staff.length === 0 && <p className="notice-soft">Δεν υπάρχει ακόμα προσωπικό.</p>}
      {load.status === 'ready' && load.staff.map((p) => <StaffEditor key={p.id} api={api} person={p} now={now} onChanged={() => void reload()} />)}
      <Card title="Νέο άτομο">
        <form className="form" onSubmit={submit} noValidate>
          <input className="text-field" aria-label="Όνομα νέου ατόμου" placeholder="Όνομα" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="text-field" aria-label="PIN νέου ατόμου" placeholder="PIN (4 ψηφία)" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
          <p className="notice-soft">Πες το PIN στο άτομο — δεν εμφανίζεται ξανά.</p>
          <button type="submit" className="btn btn-primary" disabled={add.busy}>
            Προσθήκη
          </button>
          <ErrorText state={add.state} />
        </form>
      </Card>
    </>
  );
}
