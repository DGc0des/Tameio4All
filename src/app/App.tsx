import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { loadTheme, saveTheme } from '../data/local/prefs';
import { pickStore, type AppStore } from '../data/local/storage';
import type { DeviceApi } from '../data/remote/deviceApi';
import type { OwnerAppProps } from '../features/owner/OwnerApp';
import { PhoneApp, type PhoneAppProps } from '../features/phone/PhoneApp';
import { shareCard, type ShareFn } from '../features/register/share';
import { parseAuthRedirect } from './authRedirect';
import { ErrorBoundary } from './ErrorBoundary';
import { parseJoinRoute } from './joinKey';
import { randomId } from './ids';
import { ownerHash, parseAppRoute, routeHash, useHash, type OwnerRoute } from './router';
import { applyTheme, nextTheme } from './theme';

type OwnerArea = ComponentType<Omit<OwnerAppProps, 'api'>>;

/** Loaded on first visit to #/owner, so the owner screens stay out of the register bundle. */
const LazyOwnerEntry = lazy(() => import('../features/owner/OwnerEntry'));
/** Builds the real DeviceApi; lazy so supabase-js loads in its own chunk. */
const LazyPhoneEntry = lazy(() => import('../features/phone/PhoneEntry'));

interface AppProps {
  appStore?: AppStore;
  /** Tests pass a fake (null = not configured); omitted, the real one comes from the lazy PhoneEntry. */
  deviceApi?: DeviceApi | null;
  now?: () => Date;
  newId?: () => string;
  share?: ShareFn;
  /** Tests pass a stub; the real area is lazy-loaded. */
  ownerArea?: OwnerArea;
}

const systemNow = (): Date => new Date();
const loadingText = <p className="notice-soft">Φόρτωση…</p>;

export function App({ appStore, deviceApi, now = systemNow, newId = randomId, share = shareCard, ownerArea: OwnerAreaComponent = LazyOwnerEntry }: AppProps) {
  const [{ store, persistent }] = useState(() => appStore ?? pickStore());
  const [hash, setHash] = useHash();
  const [redirect, setRedirect] = useState(() => parseAuthRedirect(window.location.search));
  const [themePref, setThemePref] = useState(() => loadTheme(store));
  const appRoute = parseAppRoute(hash);
  // A store link (#/join/<key>) is in the register area; the phone takes the key once and the hash becomes #/.
  const joinRoute = parseJoinRoute(hash);

  useEffect(() => applyTheme(themePref), [themePref]);

  // An email link (confirm / reset) returns to `/?auth=…`; send it to the owner area once.
  useEffect(() => {
    if (redirect !== null && parseAppRoute(window.location.hash).area !== 'owner') setHash('#/owner', { replace: true });
  }, [redirect, setHash]);

  const cycleTheme = () => {
    const next = nextTheme(themePref);
    saveTheme(store, next);
    setThemePref(next);
  };
  const navigateOwner = (route: OwnerRoute, opts?: { replace?: boolean }) => setHash(ownerHash(route), opts);
  const onRegister = appRoute.area === 'register';
  const phoneProps: Omit<PhoneAppProps, 'api'> = {
    store,
    now,
    newId,
    share,
    themePref,
    active: onRegister,
    onTheme: cycleTheme,
    onOwner: () => setHash('#/owner'),
    link: joinRoute,
    onLinkTaken: () => setHash(routeHash('register'), { replace: true }),
  };

  return (
    <ErrorBoundary>
      {!persistent && (
        <p className="notice" role="alert">
          Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.
        </p>
      )}
      {/* The phone stays mounted (hidden) so visiting the owner area never loses typing. */}
      <div hidden={!onRegister}>
        {deviceApi !== undefined ? (
          <PhoneApp {...phoneProps} api={deviceApi} />
        ) : (
          <Suspense fallback={loadingText}>
            <LazyPhoneEntry {...phoneProps} />
          </Suspense>
        )}
      </div>
      {appRoute.area === 'owner' && (
        <Suspense fallback={loadingText}>
          <OwnerAreaComponent
            route={appRoute.route}
            navigate={navigateOwner}
            store={store}
            now={now}
            redirect={redirect}
            onRedirectHandled={() => {
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
              setRedirect(null);
            }}
            redirectBase={`${window.location.origin}${window.location.pathname}`}
            onExit={() => setHash(routeHash('register'))}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}
