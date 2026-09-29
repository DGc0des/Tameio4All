import { useCallback, useEffect, useState } from 'react';
import type { OwnerApi, ShopRow } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { ownerErrorMessage } from './model/messages';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

interface Props {
  api: OwnerApi;
  navigate: OwnerNavigate;
  /** true only for the first list load after sign-in — opening a single shop straight away. */
  autoOpen: boolean;
  onLoaded: () => void;
  onSignOut: () => void;
  /** Leaves the owner area back to the register — this is the top of the owner nav stack, so it lives in the header's back slot. */
  onExit: () => void;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; shops: ShopRow[] };

export function ShopsScreen({ api, navigate, autoOpen, onLoaded, onSignOut, onExit }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
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
        )}
      </main>
    </div>
  );
}
