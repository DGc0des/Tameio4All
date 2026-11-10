import { useCallback, useEffect, useReducer, type ReactNode } from 'react';
import { clearCachedContext, clearStaffSession, loadCachedContext, loadStaffSession, saveCachedContext, saveStaffSession } from '../../data/local/phone';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceApi, DeviceError, StaffSession } from '../../data/remote/deviceApi';
import { RegisterScreen } from '../register/RegisterScreen';
import type { ShareFn } from '../register/share';
import { Card } from '../../ui/Card';
import { gateReducer } from './model/gate';
import { deviceErrorMessage } from './model/messages';
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

function RetryScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Message title="Δεν υπάρχει σύνδεση">
      <p className="sub">Το ταμείο χρειάζεται σύνδεση την πρώτη φορά που ανοίγει σε αυτή τη συσκευή.</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Δοκίμασε ξανά
      </button>
    </Message>
  );
}

function LoadErrorScreen({ error, onRetry }: { error: DeviceError; onRetry: () => void }) {
  return (
    <Message title="Ταμείο">
      <p role="alert">{deviceErrorMessage(error)}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Δοκίμασε ξανά
      </button>
    </Message>
  );
}

const OfflineBanner = ({ onRetry }: { onRetry: () => void }) => (
  <p className="notice" role="status">
    Εκτός σύνδεσης{' '}
    <button type="button" className="btn btn-text" onClick={onRetry}>
      Δοκίμασε ξανά
    </button>
  </p>
);

/** The phone shell: pairing → staff sign-in → register, driven only by gateReducer. */
export function PhoneApp({ api, store, now, newId, share, themePref, active, onTheme, onOwner }: PhoneAppProps) {
  const [gate, dispatch] = useReducer(gateReducer, { s: 'loading' });

  const load = useCallback(async () => {
    if (api === null) return dispatch({ t: 'no_client' });
    // Definitely no auth session (e.g. an owner signed in here and out again): not a paired device, whatever
    // the cache says. As `loaded ctx:null` the gate goes to pairing and the cached session/context are cleared.
    // A failed lookup only means "couldn't tell" (offline with an expired access token): context() decides,
    // falling back to the cached register when offline.
    const auth = await api.session();
    if (auth.ok && auth.data === null) return dispatch({ t: 'loaded', ctx: null, stored: null });
    const r = await api.context();
    if (r.ok) {
      if (r.data !== null) saveCachedContext(store, r.data);
      dispatch({ t: 'loaded', ctx: r.data, stored: loadStaffSession(store) });
    } else {
      dispatch({ t: 'load_failed', error: r.error, cached: loadCachedContext(store), stored: loadStaffSession(store) });
    }
  }, [api, store]);

  // The one load path: runs on mount and whenever the gate asks for a reload by entering `loading`.
  const reloading = gate.s === 'loading';
  useEffect(() => {
    if (reloading) void load();
  }, [reloading, load]);

  // Stored state follows the gate: the session lives exactly as long as `ready`.
  useEffect(() => {
    if (gate.s === 'ready') saveStaffSession(store, gate.session);
    if (gate.s === 'signed_out' || gate.s === 'unpaired') clearStaffSession(store);
    if (gate.s === 'unpaired') clearCachedContext(store);
  }, [gate, store]);

  // While offline, re-check the server when the browser regains its connection or comes back into view.
  // The retry enters `loading` (the one reload path); the register's unsent edits stay in its persisted queue.
  const offline = gate.s === 'offline_no_cache' || ((gate.s === 'ready' || gate.s === 'signed_out') && gate.offline);
  const retry = useCallback(() => dispatch({ t: 'retry' }), []);
  useEffect(() => {
    if (!offline) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [offline, retry]);

  const onPaired = useCallback(() => dispatch({ t: 'paired' }), []);
  const signedOutShopId = gate.s === 'signed_out' ? gate.ctx.shopId : '';
  const onSignedIn = useCallback(
    (signed: StaffSession) => {
      // device.ts only knows the shop after a successful context(); offline it comes from the cached one.
      const session = signed.shopId === '' ? { ...signed, shopId: signedOutShopId } : signed;
      // Stored before the event: if the gate reloads, the fresh context finds it and opens the register.
      saveStaffSession(store, session);
      dispatch({ t: 'signed_in', session });
    },
    [store, signedOutShopId],
  );
  const onServerError = useCallback(
    (error: DeviceError) => {
      if (error.code === 'session_invalid' || error.code === 'wrong_day') clearStaffSession(store);
      dispatch({ t: 'server_error', error });
    },
    [store],
  );

  const onSignOut = useCallback(() => dispatch({ t: 'signed_out' }), []);

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
      return <RetryScreen onRetry={retry} />;
    case 'load_error':
      return <LoadErrorScreen error={gate.error} onRetry={retry} />;
    case 'unpaired':
      // api is non-null here: without a client the gate is `unconfigured`.
      return api && <PairScreen api={api} notice={gate.notice} onPaired={onPaired} onOwner={onOwner} />;
    case 'signed_out':
      return (
        api && (
          <>
            {gate.offline && <OfflineBanner onRetry={retry} />}
            <SignInScreen api={api} shopName={gate.ctx.shopName} onSignedIn={onSignedIn} onServerError={onServerError} onOwner={onOwner} />
          </>
        )
      );
    case 'ready': {
      const { ctx, session } = gate;
      // api is non-null here: without a client the gate is `unconfigured`.
      if (api === null) return null;
      // The register computes with the open closing's pinned config (from its snapshot), not ctx.config.
      return (
        <>
          {gate.offline && <OfflineBanner onRetry={retry} />}
          <RegisterScreen
            key={`${ctx.shopId}:${ctx.businessDate}`}
            ctx={ctx}
            session={session}
            api={api}
            store={store}
            now={now}
            newId={newId}
            share={share}
            themePref={themePref}
            active={active}
            offline={gate.offline}
            onTheme={onTheme}
            onOwner={onOwner}
            onSignOut={onSignOut}
            onServerError={onServerError}
          />
        </>
      );
    }
  }
}
