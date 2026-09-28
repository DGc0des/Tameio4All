// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash } from '../../src/app/router';
import { applyTheme, nextTheme, THEME_LABELS } from '../../src/app/theme';

describe('router', () => {
  it('maps hashes to routes and back', () => {
    expect(parseRoute('#/tare')).toBe('tare');
    expect(parseRoute('#/staff')).toBe('staff');
    expect(parseRoute('')).toBe('register');
    expect(parseRoute('#/anything')).toBe('register');
    expect(routeHash('register')).toBe('#/');
    expect(routeHash('staff')).toBe('#/staff');
  });
});

describe('theme', () => {
  it('cycles system → light → dark → system with Greek labels', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(THEME_LABELS.system).toBe('Αυτόματο');
  });

  it('sets or clears data-theme on the root element', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
