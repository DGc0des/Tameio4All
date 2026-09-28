import { readJson, shopKey, writeJson, type KeyValueStore } from './storage';

/** Trims, collapses spaces, drops empties and case-insensitive duplicates (first spelling wins). */
export function normalizeStaff(names: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const name = n.trim().replace(/\s+/g, ' ');
    if (name === '') continue;
    const key = name.toLocaleLowerCase('el');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function loadStaff(store: KeyValueStore, shopId: string): string[] {
  const raw = readJson(store, shopKey(shopId, 'staff'));
  return Array.isArray(raw) ? normalizeStaff(raw) : [];
}

/** Returns the stored (normalized) list, or null if the device refused the write. */
export function saveStaff(store: KeyValueStore, shopId: string, names: readonly string[]): string[] | null {
  const clean = normalizeStaff(names);
  return writeJson(store, shopKey(shopId, 'staff'), clean) ? clean : null;
}
