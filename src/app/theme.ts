import type { ThemePref } from '../data/local/prefs';

export const THEME_LABELS: Record<ThemePref, string> = { system: 'Αυτόματο', light: 'Ανοιχτό', dark: 'Σκούρο' };

export function nextTheme(pref: ThemePref): ThemePref {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

/** 'system' removes the override so prefers-color-scheme decides (see theme.css). */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}
