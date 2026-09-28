/** The only module family that touches localStorage. Every call is failure-safe. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AppStore {
  store: KeyValueStore;
  /** false when the browser refused storage (private mode, blocked) — data lives only in memory. */
  persistent: boolean;
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

/** window.localStorage if it exists and accepts a write, else null. */
export function browserStore(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = 'tameio4all:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function pickStore(): AppStore {
  const browser = browserStore();
  return browser ? { store: browser, persistent: true } : { store: memoryStore(), persistent: false };
}

export const shopKey = (shopId: string, name: string): string => `tameio4all:v1:${shopId}:${name}`;

export function readJson(store: KeyValueStore, key: string): unknown {
  try {
    const raw = store.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // nothing to do: a key we cannot delete will be overwritten or expire
  }
}
