import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { clearCachedContext, clearStaffSession, saveStaffSession } from '../../data/local/phone';
import type { ThemePref } from '../../data/local/prefs';
import type { KeyValueStore } from '../../data/local/storage';
import type { DeviceApi, DeviceError, StaffSession } from '../../data/remote/deviceApi';
import { RegisterScreen } from '../register/RegisterScreen';
import type { ShareFn } from '../register/share';
import { Card } from '../../ui/Card';
import { Sheet } from '../../ui/Sheet';
import { JoinScreen } from './JoinScreen';
import { gateReducer } from './model/gate';
import { joinStore } from './model/join';
import { loadGate } from './model/load';
import { deviceErrorMessage } from './model/messages';
import { platformLabel } from './model/platform';
import { SignInScreen } from './SignInScreen';

/** A store link that was opened (`#/join/<key>`); `key: null` = the link was malformed. */
export type JoinLink = { key: string | null };

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
  /** The store link in the address bar right now (App parses it), or null. Taken once, then `onLinkTaken`. */
  link: JoinLink | null;
  /** The link has been taken: App replaces the hash with `#/` (so a reload does not run it again). */
  onLinkTaken: () => void;
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

/** The phone shell: store entry → staff sign-in → register, driven only by gateReducer. */
export function PhoneApp({ api, store, now, newId, share, themePref, active, onTheme, onOwner, link: linkProp, onLinkTaken }: PhoneAppProps) {
  const [gate, dispatch] = useReducer(gateReducer, { s: 'loading' });
  const label = useMemo(() => platformLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);

  // The one load path (incl. the silent re-join with a stored key: model/load.ts).
  const load = useCallback(async () => {
    if (api === null) return dispatch({ t: 'no_client' });
    dispatch(await loadGate(api, store, label));
  }, [api, store, label]);

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

  // Link intake: the link is copied into state once (a re-render or StrictMode's second effect run with the
  // same link must not take it twice) and App clears the hash. A later, new link is taken again.
  const [link, setLink] = useState<JoinLink | null>(null);
  const linkTaken = useRef(false);
  useEffect(() => {
    if (linkProp === null) {
      linkTaken.current = false;
      return;
    }
    if (linkTaken.current) return;
    linkTaken.current = true;
    setLink({ key: linkProp.key });
    onLinkTaken();
  }, [linkProp, onLinkTaken]);

  // A link on a phone that is already in a store: same store → nothing to do; another store → ask first.
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [switchKey, setSwitchKey] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const inStore = gate.s === 'signed_out' || gate.s === 'ready';
  const actedOn = useRef<JoinLink | null>(null);
  useEffect(() => {
    if (link === null || !inStore || api === null || actedOn.current === link) return;
    actedOn.current = link;
    const key = link.key;
    if (key === null) return setLink(null);
    void joinStore(api, store, key, label).then((r) => {
      if (!r.ok && r.error.code === 'other_shop') return setSwitchKey(key);
      setLink(null);
      if (!r.ok) setLinkNotice(deviceErrorMessage(r.error));
    });
  }, [link, inStore, api, store, label]);

  const cancelSwitch = useCallback(() => {
    setSwitchKey(null);
    setLink(null);
  }, []);
  const confirmSwitch = async () => {
    if (api === null || switchKey === null) return;
    setSwitching(true);
    const r = await joinStore(api, store, switchKey, label, { switchShop: true });
    setSwitching(false);
    setSwitchKey(null);
    setLink(null);
    // Reload: the stored staff session is for the old store and is cleared by the gate's rules.
    if (r.ok) dispatch({ t: 'paired' });
    else setLinkNotice(deviceErrorMessage(r.error));
  };

  const onPaired = useCallback(() => {
    setLink(null);
    dispatch({ t: 'paired' });
  }, []);
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

  /** Above the sign-in screen / register: what became of a link, and the switch-store question. */
  const linkOverlay = (shopName: string) => (
    <>
      {linkNotice !== null && (
        <p className="notice" role="alert">
          {linkNotice}{' '}
          <button type="button" className="btn btn-text" onClick={() => setLinkNotice(null)}>
            Κλείσιμο
          </button>
        </p>
      )}
      {switchKey !== null && (
        <Sheet title="Αλλαγή καταστήματος" onClose={cancelSwitch}>
          <p>{`Η συσκευή είναι στο «${shopName}». Να μπει στο κατάστημα του συνδέσμου;`}</p>
          <button type="button" className="btn btn-text" onClick={cancelSwitch}>
            Άκυρο
          </button>{' '}
          <button type="button" className="btn btn-primary" disabled={switching} onClick={() => void confirmSwitch()}>
            Αλλαγή
          </button>
        </Sheet>
      )}
    </>
  );

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
      // A new link remounts the screen, so its key is filled in and tried once.
      return (
        api && (
          <JoinScreen
            key={link === null ? 'typed' : `link:${link.key ?? ''}`}
            api={api}
            store={store}
            label={label}
            notice={link !== null && link.key === null ? 'Ο σύνδεσμος δεν είναι σωστός.' : gate.notice}
            initialKey={link?.key ?? null}
            onJoined={onPaired}
            onOwner={onOwner}
          />
        )
      );
    case 'signed_out':
      return (
        api && (
          <>
            {gate.offline && <OfflineBanner onRetry={retry} />}
            {linkOverlay(gate.ctx.shopName)}
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
          {linkOverlay(ctx.shopName)}
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
