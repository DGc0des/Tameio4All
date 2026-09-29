import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthRedirect } from '../../app/authRedirect';
import type { OwnerRoute } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi, Result, SessionInfo } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { ForgotScreen, LinkErrorScreen, LoginScreen, ResetScreen, SignupScreen } from './AuthScreens';
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
          else navigate(redirect.kind === 'recovery' ? { name: 'reset' } : { name: 'shops' }, { replace: true });
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

  const owner = session !== null && !session.anonymous ? session : null;
  const login = <LoginScreen api={api} session={session} navigate={navigate} onSignedIn={() => void refresh()} />;

  switch (route.name) {
    case 'login':
      return owner ? <Go to={{ name: 'shops' }} navigate={navigate} /> : login;
    case 'signup':
      return owner ? <Go to={{ name: 'shops' }} navigate={navigate} /> : <SignupScreen api={api} session={session} navigate={navigate} redirectBase={redirectBase} />;
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
          navigate={navigate}
          store={store}
          now={now}
          email={owner.email}
          onSignOut={() => void signOut()}
          onExit={onExit}
        />
      );
  }
}
