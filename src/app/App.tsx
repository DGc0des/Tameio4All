import { useEffect, useState } from 'react';
import { loadTheme, saveTheme } from '../data/local/prefs';
import { loadStaff, normalizeStaff, saveStaff } from '../data/local/staff';
import { pickStore, type AppStore } from '../data/local/storage';
import { RegisterScreen } from '../features/register/RegisterScreen';
import { shareCard, type ShareFn } from '../features/register/share';
import { StaffScreen } from '../features/staff/StaffScreen';
import { TareScreen } from '../features/tare/TareScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { randomId } from './ids';
import { useRoute } from './router';
import { LOCAL_SHOP, type LocalShop } from './shop';
import { applyTheme, nextTheme } from './theme';

interface AppProps {
  appStore?: AppStore;
  shop?: LocalShop;
  now?: () => Date;
  newId?: () => string;
  share?: ShareFn;
}

const systemNow = (): Date => new Date();

export function App({ appStore, shop = LOCAL_SHOP, now = systemNow, newId = randomId, share = shareCard }: AppProps) {
  const [{ store, persistent }] = useState(() => appStore ?? pickStore());
  const [route, navigate] = useRoute();
  const [staff, setStaff] = useState(() => loadStaff(store, shop.id));
  const [themePref, setThemePref] = useState(() => loadTheme(store));

  useEffect(() => applyTheme(themePref), [themePref]);

  const cycleTheme = () => {
    const next = nextTheme(themePref);
    saveTheme(store, next);
    setThemePref(next);
  };
  const changeStaff = (names: string[]) => setStaff(saveStaff(store, shop.id, names) ?? normalizeStaff(names));

  return (
    <ErrorBoundary>
      {!persistent && (
        <p className="notice" role="alert">
          Η αποθήκευση στη συσκευή δεν είναι διαθέσιμη — τα στοιχεία χάνονται αν κλείσει η σελίδα.
        </p>
      )}
      {/* The register stays mounted (hidden) so switching screens never loses typing. */}
      <div hidden={route !== 'register'}>
        <RegisterScreen
          shop={shop}
          store={store}
          now={now}
          newId={newId}
          share={share}
          staff={staff}
          themePref={themePref}
          active={route === 'register'}
          onTheme={cycleTheme}
          onNavigate={navigate}
        />
      </div>
      {route === 'staff' && <StaffScreen staff={staff} onChange={changeStaff} onBack={() => navigate('register')} />}
      {route === 'tare' && <TareScreen items={shop.config.tareItems} onBack={() => navigate('register')} />}
    </ErrorBoundary>
  );
}
