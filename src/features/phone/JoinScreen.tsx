import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatJoinKey, parseJoinKey } from '../../app/joinKey';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceApi } from '../../data/remote/deviceApi';
import { Card } from '../../ui/Card';
import { joinStore } from './model/join';
import { deviceErrorMessage } from './model/messages';

interface Props {
  api: DeviceApi;
  store: KeyValueStore;
  /** The device label sent with the join (from the platform; the owner can rename it). */
  label: string;
  /** Why the phone is here (revoked, link replaced, malformed link); null on a first entry. */
  notice: string | null;
  /** The key of a store link that was opened: filled in and tried once on mount. */
  initialKey: string | null;
  onJoined: () => void;
  onOwner: () => void;
}

/** The entry screen of a phone that is not in a store: a store link / QR opens it, or the code is typed here. */
export function JoinScreen({ api, store, label, notice, initialKey, onJoined, onOwner }: Props) {
  const [text, setText] = useState(() => (initialKey === null ? '' : formatJoinKey(initialKey)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerConfirm, setOwnerConfirm] = useState<string | null>(null);

  const join = async (key: string, force: boolean) => {
    setBusy(true);
    setError(null);
    const r = await joinStore(api, store, key, label, force ? { force: true } : undefined);
    setBusy(false);
    if (r.ok) return onJoined();
    if (r.error.code === 'owner_signed_in' && !force) return setOwnerConfirm(key);
    setOwnerConfirm(null);
    setError(deviceErrorMessage(r.error));
  };

  // A link's key is tried once (StrictMode runs effects twice; the ref keeps it to one join).
  const tried = useRef(false);
  useEffect(() => {
    if (initialKey === null || tried.current) return;
    tried.current = true;
    void join(initialKey, false);
    // Runs once per mount: a new link remounts the screen (PhoneApp keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || text.trim() === '') return;
    const key = parseJoinKey(text);
    if (key === null) {
      setOwnerConfirm(null);
      return setError('Ο κωδικός δεν είναι σωστός.');
    }
    void join(key, false);
  };

  return (
    <div className="app">
      <header className="top">
        <h1>Είσοδος στο κατάστημα</h1>
      </header>
      <main className="page">
        {notice !== null && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <Card>
          <p className="sub">Σκάναρε το QR του καταστήματος ή άνοιξε τον σύνδεσμό του. Αλλιώς γράψε εδώ τον κωδικό.</p>
          <form className="form" onSubmit={submit} noValidate>
            <input
              className="text-field"
              aria-label="Κωδικός καταστήματος"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {ownerConfirm !== null ? (
              <div className="notice" role="alert">
                <p>Είσαι συνδεδεμένος ως ιδιοκτήτης σε αυτόν τον browser. Η σύνδεση συσκευής θα σε αποσυνδέσει.</p>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void join(ownerConfirm, true)}>
                  Συνέχεια
                </button>{' '}
                <button type="button" className="btn btn-text" onClick={() => setOwnerConfirm(null)}>
                  Άκυρο
                </button>
              </div>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={busy || text.trim() === ''}>
                Είσοδος
              </button>
            )}
            {error !== null && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Card>
        <button type="button" className="link" onClick={onOwner}>
          Διαχείριση καταστήματος
        </button>
      </main>
    </div>
  );
}
