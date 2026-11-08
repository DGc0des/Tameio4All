import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DeviceApi, DeviceError, StaffSession } from '../../data/remote/deviceApi';
import { Card } from '../../ui/Card';
import { deviceErrorMessage } from './model/messages';

interface Props {
  api: DeviceApi;
  shopName: string;
  onSignedIn: (session: StaffSession) => void;
  /** Failures that change the gate (e.g. the phone was revoked). */
  onServerError: (error: DeviceError) => void;
  onOwner: () => void;
}

type StaffList = { s: 'loading' } | { s: 'error'; message: string } | { s: 'ok'; staff: { id: string; name: string }[] };

const PIN_LENGTH = 4;
const unpairs = (e: DeviceError): boolean => e.code === 'device_revoked' || e.code === 'not_a_device';

/** Paired phone, nobody signed in: names and a PIN only — never a number from the register. */
export function SignInScreen({ api, shopName, onSignedIn, onServerError, onOwner }: Props) {
  const [list, setList] = useState<StaffList>({ s: 'loading' });
  const [staffId, setStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setList({ s: 'loading' });
    const r = await api.listStaff();
    if (r.ok) return setList({ s: 'ok', staff: r.data });
    if (unpairs(r.error)) return onServerError(r.error);
    setList({ s: 'error', message: deviceErrorMessage(r.error) });
  }, [api, onServerError]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (staffId === null || pin.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.signIn(staffId, pin);
    setBusy(false);
    if (r.ok) return onSignedIn(r.data);
    if (unpairs(r.error)) return onServerError(r.error);
    setPin('');
    setError(deviceErrorMessage(r.error));
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Ποιος είσαι;</h1>
          <p className="sub">{shopName}</p>
        </div>
      </header>
      <main className="page">
        <Card>
          {list.s === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
          {list.s === 'error' && (
            <>
              <p className="form-error" role="alert">
                {list.message}
              </p>
              <button type="button" className="btn btn-text" onClick={() => void loadStaff()}>
                Δοκίμασε ξανά
              </button>
            </>
          )}
          {list.s === 'ok' && list.staff.length === 0 && (
            <p className="sub">Δεν υπάρχει προσωπικό ακόμα. Ο ιδιοκτήτης προσθέτει άτομα από τη Διαχείριση.</p>
          )}
          {list.s === 'ok' && list.staff.length > 0 && (
            <form className="form" onSubmit={submit} noValidate>
              <div className="choices" role="radiogroup" aria-label="Όνομα">
                {list.staff.map((p) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={p.id === staffId}
                    key={p.id}
                    className="choice"
                    onClick={() => {
                      setStaffId(p.id);
                      setError(null);
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <input
                className="text-field"
                aria-label="PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || staffId === null || pin.length !== PIN_LENGTH}>
                Είσοδος
              </button>
              {error !== null && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </Card>
        <button type="button" className="link" onClick={onOwner}>
          Διαχείριση καταστήματος
        </button>
      </main>
    </div>
  );
}
