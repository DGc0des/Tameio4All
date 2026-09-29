import { useState, type FormEvent } from 'react';
import { authRedirectUrl } from '../../app/authRedirect';
import type { OwnerApi, SessionInfo } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { isEmail, PASSWORD_MIN } from './model/limits';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

/** A paired phone is an anonymous session; signing in here would silently unpair it. */
function AnonymousWarning({ confirmed, onChange }: { confirmed: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="notice" role="note">
      <p>Αυτή η συσκευή είναι συνδεδεμένη ως ταμείο — αν συνδεθείς ως ιδιοκτήτης θα αποσυνδεθεί από το κατάστημα.</p>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} />
        Κατάλαβα, να αποσυνδεθεί το ταμείο
      </label>
    </div>
  );
}

interface AuthProps {
  api: OwnerApi;
  session: SessionInfo | null;
  navigate: OwnerNavigate;
}

export function LoginScreen({ api, session, navigate, onSignedIn }: AuthProps & { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const action = useAction();
  const phone = session?.anonymous === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email.trim())) return action.fail('Γράψε ένα έγκυρο email.');
    if (password === '') return action.fail('Γράψε τον κωδικό σου.');
    const r = await action.run(() => api.signIn(email.trim(), password));
    if (r.ok) onSignedIn();
  };

  return (
    <div className="app">
      <OwnerHeader title="Σύνδεση ιδιοκτήτη" />
      <main className="page">
        {phone && <AnonymousWarning confirmed={confirmed} onChange={setConfirmed} />}
        <Card>
          <form className="form" onSubmit={submit} noValidate>
            <input className="text-field" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="text-field" aria-label="Κωδικός" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={action.busy || (phone && !confirmed)}>
              Σύνδεση
            </button>
            <ErrorText state={action.state} />
          </form>
        </Card>
        <button type="button" className="link" onClick={() => navigate({ name: 'signup' })}>
          Νέος λογαριασμός
        </button>{' '}
        <button type="button" className="link" onClick={() => navigate({ name: 'forgot' })}>
          Ξέχασα τον κωδικό
        </button>
      </main>
    </div>
  );
}

export function SignupScreen({ api, session, navigate, redirectBase }: AuthProps & { redirectBase: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const action = useAction();
  const phone = session?.anonymous === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!isEmail(address)) return action.fail('Γράψε ένα έγκυρο email.');
    if (password.length < PASSWORD_MIN) return action.fail(`Ο κωδικός θέλει τουλάχιστον ${PASSWORD_MIN} χαρακτήρες.`);
    if (password !== repeat) return action.fail('Οι δύο κωδικοί δεν ταιριάζουν.');
    const r = await action.run(() => api.signUp(address, password, authRedirectUrl(redirectBase, 'signup')));
    if (r.ok) setSentTo(address);
  };

  return (
    <div className="app">
      <OwnerHeader title="Νέος λογαριασμός" onBack={() => navigate({ name: 'login' })} />
      <main className="page">
        {sentTo !== null ? (
          <Card>
            <p className="form-ok">
              Σου στείλαμε email επιβεβαίωσης στο {sentTo}. Άνοιξε τον σύνδεσμο σε αυτή τη συσκευή και σε αυτόν τον browser.
            </p>
          </Card>
        ) : (
          <>
            {phone && <AnonymousWarning confirmed={confirmed} onChange={setConfirmed} />}
            <Card>
              <form className="form" onSubmit={submit} noValidate>
                <input className="text-field" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input className="text-field" aria-label="Κωδικός" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <input className="text-field" aria-label="Επανάληψη κωδικού" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
                <button type="submit" className="btn btn-primary" disabled={action.busy || (phone && !confirmed)}>
                  Δημιουργία λογαριασμού
                </button>
                <ErrorText state={action.state} />
              </form>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

export function ForgotScreen({ api, navigate, redirectBase }: Omit<AuthProps, 'session'> & { redirectBase: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email.trim())) return action.fail('Γράψε ένα έγκυρο email.');
    const r = await action.run(() => api.sendReset(email.trim(), authRedirectUrl(redirectBase, 'recovery')));
    if (r.ok) setSent(true);
  };

  return (
    <div className="app">
      <OwnerHeader title="Ξέχασα τον κωδικό" onBack={() => navigate({ name: 'login' })} />
      <main className="page">
        <Card>
          {sent ? (
            <p className="form-ok">Αν υπάρχει λογαριασμός με αυτό το email, στάλθηκε σύνδεσμος. Άνοιξέ τον σε αυτή τη συσκευή.</p>
          ) : (
            <form className="form" onSubmit={submit} noValidate>
              <input className="text-field" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="submit" className="btn btn-primary" disabled={action.busy}>
                Αποστολή συνδέσμου
              </button>
              <ErrorText state={action.state} />
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}

export function ResetScreen({ api, navigate }: Omit<AuthProps, 'session'>) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return action.fail(`Ο κωδικός θέλει τουλάχιστον ${PASSWORD_MIN} χαρακτήρες.`);
    if (password !== repeat) return action.fail('Οι δύο κωδικοί δεν ταιριάζουν.');
    const r = await action.run(() => api.updatePassword(password));
    if (r.ok) navigate({ name: 'shops' }, { replace: true });
  };

  return (
    <div className="app">
      <OwnerHeader title="Νέος κωδικός" />
      <main className="page">
        <Card>
          <form className="form" onSubmit={submit} noValidate>
            <input className="text-field" aria-label="Νέος κωδικός" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="text-field" aria-label="Επανάληψη κωδικού" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={action.busy}>
              Αποθήκευση
            </button>
            <ErrorText state={action.state} />
          </form>
        </Card>
      </main>
    </div>
  );
}

export function LinkErrorScreen({ onLogin, onResend }: { onLogin: () => void; onResend: () => void }) {
  return (
    <div className="app">
      <OwnerHeader title="Σύνδεσμος email" />
      <main className="page">
        <Card>
          <p>Ο σύνδεσμος δεν λειτούργησε.</p>
          <p className="notice-soft">
            Μπορεί να έληξε ή να χρησιμοποιήθηκε ήδη. Άνοιξέ τον στη συσκευή και τον browser όπου τον ζήτησες, ή ζήτησε νέο
            σύνδεσμο με «Ξέχασα τον κωδικό» — επιβεβαιώνει ξανά και το email σου.
          </p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={onLogin}>
              Σύνδεση
            </button>
            <button type="button" className="btn btn-primary" onClick={onResend}>
              Νέος σύνδεσμος
            </button>
          </div>
        </Card>
      </main>
    </div>
  );
}
