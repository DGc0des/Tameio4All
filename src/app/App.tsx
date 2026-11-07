import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { loadTheme, saveTheme } from '../data/local/prefs';
import { loadStaff, normalizeStaff, saveStaff } from '../data/local/staff';
import { pickStore, type AppStore } from '../data/local/storage';
import type { OwnerAppProps } from '../features/owner/OwnerApp';
import { RegisterScreen } from '../features/register/RegisterScreen';
import { shareCard, type ShareFn } from '../features/register/share';
import { StaffScreen } from '../features/staff/StaffScreen';
import { parseAuthRedirect } from './authRedirect';
import { ErrorBoundary } from './ErrorBoundary';
import { randomId } from './ids';
import { ownerHash, parseAppRoute, routeHash, useHash, type OwnerRoute, type Route } from './router';
import { LOCAL_SHOP, type LocalShop } from './shop';
import { applyTheme, nextTheme } from './theme';

type OwnerArea = ComponentType<Omit<OwnerAppProps, 'api'>>;

/** Loaded on first visit to #/owner, so supabase-js stays out of the register bundle. */
const LazyOwnerEntry = lazy(() => import('../features/owner/OwnerEntry'));

interface AppProps {
  appStore?: AppStore;
  shop?: LocalShop;
  now?: () => Date;
  newId?: () => string;
  share?: ShareFn;
  /** Tests pass a stub; the real area is lazy-loaded. */
  ownerArea?: OwnerArea;
}

const systemNow = (): Date => new Date();

export function App({ appStore, shop = LOCAL_SHOP, now = systemNow, newId = randomId, share = shareCard, ownerArea: OwnerAreaComponent = LazyOwnerEntry }: AppProps) {
  const [{ store, persistent }] = useState(() => appStore ?? pickStore());
  const [hash, setHash] = useHash();
  const [redirect, setRedirect] = useState(() => parseAuthRedirect(window.location.search));
  const [staff, setStaff] = useState(() => loadStaff(store, shop.id));
  const [themePref, setThemePref] = useState(() => loadTheme(store));
  const appRoute = parseAppRoute(hash);

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
  const changeStaff = (names: string[]) => setStaff(saveStaff(store, shop.id, names) ?? normalizeStaff(names));
  const navigate = (route: Route) => setHash(routeHash(route));
  const navigateOwner = (route: OwnerRoute, opts?: { replace?: boolean }) => setHash(ownerHash(route), opts);
  const registerRoute = appRoute.area === 'register' ? appRoute.route : null;

  return (
    <ErrorBoundary>
      {!persistent && (
        <p className="notice" role="alert">
          Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.
        </p>
      )}
      {/* The register stays mounted (hidden) so switching screens never loses typing. */}
      <div hidden={registerRoute !== 'register'}>
        <RegisterScreen
          shop={shop}
          store={store}
          now={now}
          newId={newId}
          share={share}
          staff={staff}
          themePref={themePref}
          active={registerRoute === 'register'}
          onTheme={cycleTheme}
          onNavigate={navigate}
          onOwner={() => setHash('#/owner')}
        />
      </div>
      {registerRoute === 'staff' && <StaffScreen staff={staff} onChange={changeStaff} onBack={() => navigate('register')} />}
      {appRoute.area === 'owner' && (
        <Suspense fallback={<p className="notice-soft">Φόρτωση…</p>}>
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
            onExit={() => navigate('register')}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}
