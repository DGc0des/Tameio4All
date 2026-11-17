import { useCallback, useEffect, useState } from 'react';
import { isClosingNo } from '../features/register/live/fields';
import { isIsoDate } from './dates';

export type Route = 'register';

/** The phone area has one screen; any non-owner hash (including the retired `#/staff`) is the register. */
export function parseRoute(_hash: string): Route {
  return 'register';
}

export function routeHash(_route: Route): string {
  return '#/';
}

export type ShopTab = 'today' | 'history' | 'settings' | 'staff' | 'devices';

export type OwnerRoute =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'forgot' }
  | { name: 'reset' }
  | { name: 'shops' }
  | { name: 'new' }
  | {
      name: 'shop';
      shopId: string;
      tab: ShopTab;
      /** A day of the history tab (only with `tab: 'history'`). */
      date?: string;
      /** A numbered closing of that day, 1..6 (only with `tab: 'history'` and a date). */
      closingNo?: number;
    };

export type AppRoute = { area: 'register'; route: Route } | { area: 'owner'; route: OwnerRoute };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOP_TABS: readonly ShopTab[] = ['today', 'history', 'settings', 'staff', 'devices'];
const OWNER_PREFIX = '#/owner';
/** A closing number segment: a canonical integer (no sign, no leading zeros) that is a valid closing number. */
const CANONICAL_INT_RE = /^[1-9][0-9]*$/;
const closingSegment = (s: string): number | null => (CANONICAL_INT_RE.test(s) && isClosingNo(Number(s)) ? Number(s) : null);

/** `rest` is what follows `#/owner`. Anything malformed lands on the shops list. */
export function parseOwnerRoute(rest: string): OwnerRoute {
  const parts = rest.split('/').filter((p) => p !== '');
  const [first, id, tab, day, closing] = parts;
  if (parts.length === 1 && (first === 'login' || first === 'signup' || first === 'forgot' || first === 'reset' || first === 'new')) {
    return { name: first };
  }
  // A fifth part (a closing of a history day) is allowed only after a history day; checked below.
  if (first === 'shop' && id !== undefined && parts.length <= 5) {
    const shopId = id.toLowerCase();
    const shopTab = tab ?? 'settings';
    if (UUID_RE.test(shopId) && (SHOP_TABS as readonly string[]).includes(shopTab)) {
      if (day === undefined) return { name: 'shop', shopId, tab: shopTab as ShopTab };
      // A day (and closing) segment belongs to the history tab only; a malformed one is dropped, not an error.
      if (shopTab === 'history') {
        if (!isIsoDate(day)) return { name: 'shop', shopId, tab: 'history' };
        const closingNo = closing === undefined ? null : closingSegment(closing);
        if (closingNo === null) return { name: 'shop', shopId, tab: 'history', date: day };
        return { name: 'shop', shopId, tab: 'history', date: day, closingNo };
      }
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
  if (route.name === 'shop') {
    const base = `${OWNER_PREFIX}/shop/${route.shopId}/${route.tab}`;
    if (route.tab !== 'history' || route.date === undefined) return base;
    const closing = isClosingNo(route.closingNo) ? `/${route.closingNo}` : '';
    return `${base}/${route.date}${closing}`;
  }
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
