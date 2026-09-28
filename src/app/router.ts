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

/** Hash routes keep the phone's back button working without a router dependency. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.location.hash = routeHash(next);
    setRoute(next);
  }, []);
  return [route, navigate];
}
