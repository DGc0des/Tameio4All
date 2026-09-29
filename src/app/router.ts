import { useCallback, useEffect, useState } from 'react';

export type Route = 'register' | 'tare' | 'staff';

export function parseRoute(hash: string): Route {
  if (hash === '#/tare') return 'tare';
  if (hash === '#/staff') return 'staff';
  return 'register';
}

export function routeHash(route: Route): string {
  return route === 'register' ? '#/' : `#/${route}`;
}

export type ShopTab = 'settings' | 'staff' | 'devices';

export type OwnerRoute =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'forgot' }
  | { name: 'reset' }
  | { name: 'shops' }
  | { name: 'new' }
  | { name: 'shop'; shopId: string; tab: ShopTab };

export type AppRoute = { area: 'register'; route: Route } | { area: 'owner'; route: OwnerRoute };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOP_TABS: readonly ShopTab[] = ['settings', 'staff', 'devices'];
const OWNER_PREFIX = '#/owner';

/** `rest` is what follows `#/owner`. Anything malformed lands on the shops list. */
export function parseOwnerRoute(rest: string): OwnerRoute {
  const parts = rest.split('/').filter((p) => p !== '');
  const [first, id, tab] = parts;
  if (parts.length === 1 && (first === 'login' || first === 'signup' || first === 'forgot' || first === 'reset' || first === 'new')) {
    return { name: first };
  }
  if (first === 'shop' && id !== undefined && parts.length <= 3) {
    const shopId = id.toLowerCase();
    const shopTab = tab ?? 'settings';
    if (UUID_RE.test(shopId) && (SHOP_TABS as readonly string[]).includes(shopTab)) {
      return { name: 'shop', shopId, tab: shopTab as ShopTab };
    }
  }
  return { name: 'shops' };
}

export function parseAppRoute(hash: string): AppRoute {
  if (hash === OWNER_PREFIX || hash.startsWith(`${OWNER_PREFIX}/`)) {
    return { area: 'owner', route: parseOwnerRoute(hash.slice(OWNER_PREFIX.length)) };
  }
  return { area: 'register', route: parseRoute(hash) };
}

export function ownerHash(route: OwnerRoute): string {
  if (route.name === 'shops') return OWNER_PREFIX;
  if (route.name === 'shop') return `${OWNER_PREFIX}/shop/${route.shopId}/${route.tab}`;
  return `${OWNER_PREFIX}/${route.name}`;
}

/** The current location hash; the setter can replace the history entry (redirects, auto-open). */
export function useHash(): [string, (hash: string, opts?: { replace?: boolean }) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = useCallback((next: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', next);
    else window.location.hash = next;
    setHash(next);
  }, []);
  return [hash, go];
}
