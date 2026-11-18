import { useEffect, useState } from 'react';
import { mapError } from '../../data/remote/errors';
import { clearPendingInvite } from '../../data/local/pendingInvite';
import type { KeyValueStore } from '../../data/local/storage';
import type { InviteInfo, OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { ownerErrorMessage } from './model/messages';
import { ROLE_LABEL } from './model/roles';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  /** null: the link had no valid token. */
  token: string | null;
  store: KeyValueStore;
  navigate: OwnerNavigate;
  /** Signs out, keeping the pending token and the invite route (the login then shows). */
  onSwitchAccount: () => Promise<void>;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; info: InviteInfo };

/** The invited person (signed in) sees what is offered and accepts it. */
export function InviteScreen({ api, token, store, navigate, onSwitchAccount }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const accept = useAction();
  /** The signed-in account is not the invited email: offer to sign in with another one. */
  const [wrongEmail, setWrongEmail] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (token === null) return;
    let live = true;
    void api.inviteInfo(token).then(
      (r) => {
        if (!live) return;
        if (r.ok) return setLoad({ status: 'ready', info: r.data });
        if (r.error.code === 'invite_expired' || r.error.code === 'invite_invalid') clearPendingInvite(store);
        setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      },
      (e: unknown) => {
        if (live) setLoad({ status: 'error', message: ownerErrorMessage(mapError(e)) });
      },
    );
    return () => {
      live = false;
    };
  }, [api, token, store]);

  const toShops = () => navigate({ name: 'shops' }, { replace: true });
  const leave = () => {
    clearPendingInvite(store);
    toShops();
  };

  const doAccept = async () => {
    if (token === null) return;
    const r = await accept.run(() => api.acceptInvite(token));
    if (r.ok) return leave();
    setWrongEmail(r.error.code === 'invite_wrong_email');
    if (r.error.code === 'invite_expired' || r.error.code === 'invite_invalid') clearPendingInvite(store);
  };

  const switchAccount = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      await onSwitchAccount();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="app">
      <OwnerHeader title="Πρόσκληση" />
      <main className="page">
        <Card>
          {token === null && (
            <>
              <p className="form-error" role="alert">
                Ο σύνδεσμος πρόσκλησης δεν είναι σωστός.
              </p>
              <button type="button" className="btn btn-text" onClick={toShops}>
                Στα καταστήματα
              </button>
            </>
          )}
          {token !== null && load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
          {token !== null && load.status === 'error' && (
            <>
              <p className="form-error" role="alert">
                {load.message}
              </p>
              <button type="button" className="btn btn-text" onClick={toShops}>
                Στα καταστήματα
              </button>
            </>
          )}
          {load.status === 'ready' && (
            <>
              <h2>Πρόσκληση</h2>
              <p>{load.info.shops.map((s) => s.name).join(', ')}</p>
              <p>ως {ROLE_LABEL[load.info.role]}</p>
              <p className="notice-soft">για {load.info.email}</p>
              <ErrorText state={accept.state} />
              {wrongEmail && (
                <button type="button" className="btn btn-text" disabled={switching} onClick={() => void switchAccount()}>
                  Σύνδεση με άλλο λογαριασμό
                </button>
              )}
              <div className="sheet-actions">
                <button type="button" className="btn btn-text" onClick={leave}>
                  Όχι τώρα
                </button>
                <button type="button" className="btn btn-primary" disabled={accept.busy} onClick={() => void doAccept()}>
                  Αποδοχή
                </button>
              </div>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
