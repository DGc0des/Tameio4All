import { useCallback, useEffect, useReducer, useState, type ReactNode } from 'react';
import { isShopConfig } from '../../core/config';
import { clearCachedContext, clearStaffSession, loadCachedContext, loadStaffSession, saveCachedContext, saveStaffSession } from '../../data/local/phone';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceApi, DeviceError, StaffSession } from '../../data/remote/deviceApi';
import { RegisterScreen } from '../register/RegisterScreen';
import type { ShareFn } from '../register/share';
import { Card } from '../../ui/Card';
import { gateReducer } from './model/gate';
import { PairScreen } from './PairScreen';
import { SignInScreen } from './SignInScreen';

export interface PhoneAppProps {
  /** null = the server connection is not configured. */
  api: DeviceApi | null;
  store: KeyValueStore;
  now: () => Date;
  newId: () => string;
  share: ShareFn;
  themePref: ThemePref;
  /** false while the owner area is on screen (the phone stays mounted, hidden). */
  active: boolean;
  onTheme: () => void;
  onOwner: () => void;
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app">
      <header className="top">
        <h1>{title}</h1>
      </header>
      <main className="page">
        <Card>{children}</Card>
      </main>
    </div>
  );
}

function RetryScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Message title="Δεν υπάρχει σύνδεση">
      <p className="sub">Το ταμείο χρειάζεται σύνδεση την πρώτη φορά που ανοίγει σε αυτή τη συσκευή.</p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onRetry();
          setBusy(false);
        }}
      >
        Δοκίμασε ξανά
      </button>
    </Message>
  );
}

const OfflineBanner = () => (
  <p className="notice" role="status">
    Εκτός σύνδεσης
  </p>
);

/** The phone shell: pairing → staff sign-in → register, driven only by gateReducer. */
export function PhoneApp({ api, store, now, newId, share, themePref, active, onTheme, onOwner }: PhoneAppProps) {
  const [gate, dispatch] = useReducer(gateReducer, { s: 'loading' });

  const load = useCallback(async () => {
    if (api === null) return dispatch({ t: 'no_client' });
    const r = await api.context();
    if (r.ok) {
      if (r.data !== null) saveCachedContext(store, r.data);
      dispatch({ t: 'loaded', ctx: r.data, stored: loadStaffSession(store) });
    } else {
      dispatch({ t: 'load_failed', error: r.error, cached: loadCachedContext(store), stored: loadStaffSession(store) });
    }
  }, [api, store]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stored state follows the gate: the session lives exactly as long as `ready`.
  useEffect(() => {
    if (gate.s === 'ready') saveStaffSession(store, gate.session);
    if (gate.s === 'signed_out' || gate.s === 'unpaired') clearStaffSession(store);
    if (gate.s === 'unpaired') clearCachedContext(store);
  }, [gate, store]);

  const onPaired = useCallback(() => {
    dispatch({ t: 'paired' });
    void load();
  }, [load]);
  const onSignedIn = useCallback((session: StaffSession) => dispatch({ t: 'signed_in', session }), []);
  const onServerError = useCallback((error: DeviceError) => dispatch({ t: 'server_error', error }), []);

  switch (gate.s) {
    case 'loading':
      return <p className="notice-soft">Φόρτωση…</p>;
    case 'unconfigured':
      return (
        <Message title="Ταμείο">
          <p>Η σύνδεση με τον διακομιστή δεν έχει ρυθμιστεί (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).</p>
        </Message>
      );
    case 'offline_no_cache':
      return <RetryScreen onRetry={load} />;
    case 'unpaired':
      // api is non-null here: without a client the gate is `unconfigured`.
      return api && <PairScreen api={api} notice={gate.notice} onPaired={onPaired} onOwner={onOwner} />;
    case 'signed_out':
      return (
        api && (
          <>
            {gate.offline && <OfflineBanner />}
            <SignInScreen api={api} shopName={gate.ctx.shopName} onSignedIn={onSignedIn} onServerError={onServerError} onOwner={onOwner} />
          </>
        )
      );
    case 'ready': {
      const { ctx, session } = gate;
      if (!isShopConfig(ctx.config)) {
        return (
          <Message title={ctx.shopName}>
            <p role="alert">Οι ρυθμίσεις του καταστήματος δεν είναι έγκυρες</p>
          </Message>
        );
      }
      return (
        <>
          {gate.offline && <OfflineBanner />}
          <RegisterScreen
            key={`${ctx.shopId}:${ctx.businessDate}`}
            shop={{ id: ctx.shopId, name: ctx.shopName, config: ctx.config }}
            businessDate={ctx.businessDate}
            staffName={session.name}
            store={store}
            now={now}
            newId={newId}
            share={share}
            themePref={themePref}
            active={active}
            onTheme={onTheme}
            onOwner={onOwner}
          />
        </>
      );
    }
  }
}
