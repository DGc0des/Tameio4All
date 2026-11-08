import { useState, type FormEvent } from 'react';
import type { DeviceApi } from '../../data/remote/deviceApi';
import { Card } from '../../ui/Card';
import { deviceErrorMessage } from './model/messages';

interface Props {
  api: DeviceApi;
  /** Why the phone is here (e.g. revoked by the owner); null on a first pairing. */
  notice: string | null;
  onPaired: () => void;
  onOwner: () => void;
}

/** The owner reads the code aloud as ABCD-EFGH; the server compares letters and digits only. */
const normalizeCode = (text: string): string => text.replace(/[^0-9a-z]/gi, '').toUpperCase();

export function PairScreen({ api, notice, onPaired, onOwner }: Props) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerConfirm, setOwnerConfirm] = useState(false);
  const clean = normalizeCode(code);

  const pair = async (force: boolean) => {
    setBusy(true);
    setError(null);
    const r = force ? await api.pair(clean, label.trim(), { force: true }) : await api.pair(clean, label.trim());
    setBusy(false);
    if (r.ok) return onPaired();
    if (r.error.code === 'owner_signed_in' && !force) return setOwnerConfirm(true);
    setOwnerConfirm(false);
    setError(deviceErrorMessage(r.error));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (clean !== '' && !busy) void pair(false);
  };

  return (
    <div className="app">
      <header className="top">
        <h1>Σύνδεση συσκευής</h1>
      </header>
      <main className="page">
        {notice !== null && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <Card>
          <p className="sub">Ζήτα από τον ιδιοκτήτη έναν κωδικό σύζευξης (Διαχείριση → Συσκευές).</p>
          <form className="form" onSubmit={submit} noValidate>
            <input
              className="text-field"
              aria-label="Κωδικός σύζευξης"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              className="text-field"
              aria-label="Όνομα συσκευής (προαιρετικό)"
              placeholder="π.χ. Ταμείο 1"
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {ownerConfirm ? (
              <div className="notice" role="alert">
                <p>Είσαι συνδεδεμένος ως ιδιοκτήτης σε αυτόν τον browser. Η σύνδεση συσκευής θα σε αποσυνδέσει.</p>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void pair(true)}>
                  Συνέχεια
                </button>{' '}
                <button type="button" className="btn btn-text" onClick={() => setOwnerConfirm(false)}>
                  Άκυρο
                </button>
              </div>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={busy || clean === ''}>
                Σύνδεση συσκευής
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
