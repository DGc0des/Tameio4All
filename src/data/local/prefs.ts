import { readJson, writeJson, type KeyValueStore } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'tameio4all:v1:prefs:theme';

export function loadTheme(store: KeyValueStore): ThemePref {
  const v = readJson(store, THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function saveTheme(store: KeyValueStore, pref: ThemePref): boolean {
  return writeJson(store, THEME_KEY, pref);
}
