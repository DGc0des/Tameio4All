import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthRedirect } from '../../app/authRedirect';
import type { OwnerRoute } from '../../app/router';
import { loadPendingInvite, savePendingInvite } from '../../data/local/pendingInvite';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi, Result, SessionInfo } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { ForgotScreen, LinkErrorScreen, LoginScreen, ResetScreen, SignupScreen } from './AuthScreens';
import { InviteScreen } from './InviteScreen';
import { NewShopScreen } from './NewShopScreen';
import { Go, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { ShopLayout } from './ShopLayout';
import { ShopsScreen } from './ShopsScreen';

export interface OwnerAppProps {
  route: OwnerRoute;
  navigate: OwnerNavigate;
  api: OwnerApi | null;
  store: KeyValueStore;
  now?: () => Date;
  /** Parsed `?auth=…` of an email link, if the app was opened from one. */
  redirect?: AuthRedirect | null;
  /** Strips `?auth=…&code=…` from the address bar. */
  onRedirectHandled?: () => void;
  /** origin + pathname, used to build email-link redirect URLs. */
  redirectBase: string;
  onExit: () => void;
}

const systemNow = (): Date => new Date();

export function OwnerApp(props: OwnerAppProps) {
  if (props.api === null) {
    return (
      <div className="app">
        <OwnerHeader title="Διαχείριση" onBack={props.onExit} />
        <main className="page">
          <Card>
            <p>
              Η σύνδεση με τον διακομιστή δεν έχει ρυθμιστεί (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
            </p>
          </Card>
        </main>
      </div>
    );
  }
  return <ConnectedOwnerApp {...props} api={props.api} />;
}

function ConnectedOwnerApp({ route, navigate, api, store, now = systemNow, redirect = null, onRedirectHandled, redirectBase, onExit }: OwnerAppProps & { api: OwnerApi }) {
  const [session, setSession] = useState<SessionInfo | null | 'loading'>('loading');
  const [linkError, setLinkError] = useState(false);
  // Shared across StrictMode's double effect run so the one-time code is exchanged exactly once.
  const exchange = useRef<Promise<Result<void>> | null>(null);
  const autoOpen = useRef(true);

  const refresh = useCallback(async () => setSession(await api.session()), [api]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = api.onAuthChange((s) => {
      if (!cancelled) setSession(s);
    });
    void (async () => {
      if (redirect !== null) {
        onRedirectHandled?.();
        if (redirect.kind === 'error') {
          setLinkError(true);
        } else {
          exchange.current ??= api.exchangeCode(redirect.code);
          const r = await exchange.current;
          if (cancelled) return;
          if (!r.ok) setLinkError(true);
          else if (redirect.kind === 'recovery') navigate({ name: 'reset' }, { replace: true });
          else {
            // A signup confirmation resumes an invite opened before the account existed.
            const pending = redirect.kind === 'signup' ? loadPendingInvite(store) : null;
            navigate(pending !== null ? { name: 'invite', token: pending } : { name: 'shops' }, { replace: true });
          }
        }
      }
      const s = await api.session();
      if (!cancelled) setSession(s);
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Runs once per mount: the redirect is read from the URL at start-up only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owner = session !== 'loading' && session !== null && !session.anonymous ? session : null;
  const ownerId = owner?.userId ?? null;

  // Keep an invite opened while signed out across login / signup (and the confirmation email's round trip).
  const inviteToken = route.name === 'invite' ? route.token : null;
  const signedOutOnInvite = route.name === 'invite' && session !== 'loading' && owner === null;
  useEffect(() => {
    if (signedOutOnInvite && inviteToken !== null) savePendingInvite(store, inviteToken);
  }, [signedOutOnInvite, inviteToken, store]);

  // After any sign-in (not only a signup confirmation), a stored invite resumes: once per signed-in person and mount,
  // so «Στα καταστήματα» from an invite that cannot be accepted yet does not bounce back to it.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ownerId === null) {
      resumedFor.current = null;
      return;
    }
    if (resumedFor.current === ownerId) return;
    resumedFor.current = ownerId;
    if (route.name !== 'login' && route.name !== 'shops') return;
    const pending = loadPendingInvite(store);
    if (pending !== null) navigate({ name: 'invite', token: pending }, { replace: true });
  }, [ownerId, route.name, store, navigate]);

  /** «Σύνδεση με άλλο λογαριασμό»: signs out but stays on the invite route (which then shows the login). */
  const switchAccount = useCallback(async () => {
    await api.signOut();
    setSession(null);
  }, [api]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null);
    navigate({ name: 'login' }, { replace: true });
  }, [api, navigate]);

  if (linkError) {
    return (
      <LinkErrorScreen
        onLogin={() => {
          setLinkError(false);
          navigate({ name: 'login' });
        }}
        onResend={() => {
          setLinkError(false);
          navigate({ name: 'forgot' });
        }}
      />
    );
  }
  if (session === 'loading') {
    return (
      <div className="app">
        <main className="page">
          <p className="notice-soft">Φόρτωση…</p>
        </main>
      </div>
    );
  }

  const login = <LoginScreen api={api} session={session} navigate={navigate} onSignedIn={() => void refresh()} />;

  switch (route.name) {
    case 'login':
      return owner ? <Go to={{ name: 'shops' }} navigate={navigate} /> : login;
    case 'signup':
      return owner ? <Go to={{ name: 'shops' }} navigate={navigate} /> : <SignupScreen api={api} session={session} navigate={navigate} redirectBase={redirectBase} />;
    case 'invite':
      if (owner) return <InviteScreen api={api} token={route.token} store={store} navigate={navigate} onSwitchAccount={switchAccount} />;
      return login;
    case 'forgot':
      return <ForgotScreen api={api} navigate={navigate} redirectBase={redirectBase} />;
    case 'reset':
      return owner ? (
        <ResetScreen api={api} navigate={navigate} />
      ) : (
        <LinkErrorScreen onLogin={() => navigate({ name: 'login' })} onResend={() => navigate({ name: 'forgot' })} />
      );
    case 'shops':
      if (!owner) return login;
      return (
        <ShopsScreen
          api={api}
          store={store}
          navigate={navigate}
          autoOpen={autoOpen.current}
          onLoaded={() => {
            autoOpen.current = false;
          }}
          onSignOut={() => void signOut()}
          onExit={onExit}
        />
      );
    case 'new':
      return owner ? <NewShopScreen api={api} navigate={navigate} /> : login;
    case 'shop':
      if (!owner) return login;
      autoOpen.current = false;
      return (
        <ShopLayout
          api={api}
          shopId={route.shopId}
          tab={route.tab}
          date={route.date}
          closingNo={route.closingNo}
          navigate={navigate}
          store={store}
          now={now}
          redirectBase={redirectBase}
          email={owner.email}
          userId={owner.userId}
          onSignOut={() => void signOut()}
          onExit={onExit}
        />
      );
  }
}
