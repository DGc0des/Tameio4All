import { useCallback, useEffect, useState } from 'react';
import { clearShop } from '../../data/local/openClosing';
import { clearOwnerDraft } from '../../data/local/ownerDrafts';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi, ShopRow } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { Sheet } from '../../ui/Sheet';
import { ownerErrorMessage } from './model/messages';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  store: KeyValueStore;
  navigate: OwnerNavigate;
  /** true only for the first list load after sign-in — opening a single shop straight away. */
  autoOpen: boolean;
  onLoaded: () => void;
  onSignOut: () => void;
  /** Leaves the owner area back to the register — this is the top of the owner nav stack, so it lives in the header's back slot. */
  onExit: () => void;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; shops: ShopRow[] };

const sameEmail = (a: string, b: string | null): boolean => b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

function DeleteAccountSheet({ api, store, shops, onDeleted, onClose }: {
  api: OwnerApi;
  store: KeyValueStore;
  shops: ShopRow[];
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void api.session().then((s) => {
      if (!cancelled) setEmail(s?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const remove = async () => {
    if (!(await action.run(() => api.deleteAccount())).ok) return;
    for (const s of shops) {
      clearShop(store, s.id);
      clearOwnerDraft(store, s.id);
    }
    onDeleted();
  };

  return (
    <Sheet title="Διαγραφή λογαριασμού" onClose={onClose}>
      <p>Σβήνονται οριστικά ο λογαριασμός σου και όλα τα καταστήματά σου. Γράψε το email σου για επιβεβαίωση.</p>
      <input
        className="text-field"
        aria-label="Email για επιβεβαίωση"
        type="email"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <div className="sheet-actions">
        <button type="button" className="btn btn-text" onClick={onClose}>
          Άκυρο
        </button>
        <button type="button" className="btn btn-primary" disabled={!sameEmail(typed, email) || action.busy} onClick={() => void remove()}>
          Διαγραφή
        </button>
      </div>
      <ErrorText state={action.state} />
    </Sheet>
  );
}

export function ShopsScreen({ api, store, navigate, autoOpen, onLoaded, onSignOut, onExit }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void api.listShops().then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      setLoad({ status: 'ready', shops: r.data });
      const only = r.data.length === 1 ? r.data[0] : undefined;
      if (autoOpen && only) navigate({ name: 'shop', shopId: only.id, tab: 'settings' }, { replace: true });
      onLoaded();
    });
    return () => {
      cancelled = true;
    };
    // autoOpen/onLoaded are read at load time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, attempt]);

  return (
    <div className="app">
      <OwnerHeader
        title="Καταστήματα"
        onBack={onExit}
        backLabel="← Ταμείο"
        right={
          <button type="button" className="link" onClick={onSignOut}>
            Αποσύνδεση
          </button>
        }
      />
      <main className="page">
        {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
        {load.status === 'error' && (
          <Card>
            <p className="form-error" role="alert">
              {load.message}
            </p>
            <button type="button" className="btn btn-text" onClick={retry}>
              Ξανά
            </button>
          </Card>
        )}
        {load.status === 'ready' && (
          <>
            <Card>
              {load.shops.length === 0 && <p className="notice-soft">Δεν έχεις ακόμα κατάστημα.</p>}
              {load.shops.map((s) => (
                <button key={s.id} type="button" className="choice wide" onClick={() => navigate({ name: 'shop', shopId: s.id, tab: 'settings' })}>
                  {s.name}
                </button>
              ))}
              <button type="button" className="btn btn-primary wide" onClick={() => navigate({ name: 'new' })}>
                + Νέο κατάστημα
              </button>
            </Card>
            <footer className="notice-soft" style={{ padding: '0 12px 16px' }}>
              <button type="button" className="link" onClick={() => setDeleting(true)}>
                Διαγραφή λογαριασμού
              </button>
            </footer>
            {deleting && (
              <DeleteAccountSheet api={api} store={store} shops={load.shops} onDeleted={onSignOut} onClose={() => setDeleting(false)} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
