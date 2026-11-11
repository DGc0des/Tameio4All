import { describe, expect, it } from 'vitest';
import { ownerHash, parseAppRoute, parseOwnerRoute, type OwnerRoute } from '../../src/app/router';

const ID = '3f2c1a9e-5b7d-4c8e-9f10-112233445566';

describe('owner routes', () => {
  it('parses every owner route', () => {
    expect(parseOwnerRoute('')).toEqual({ name: 'shops' });
    expect(parseOwnerRoute('/')).toEqual({ name: 'shops' });
    expect(parseOwnerRoute('/login')).toEqual({ name: 'login' });
    expect(parseOwnerRoute('/signup')).toEqual({ name: 'signup' });
    expect(parseOwnerRoute('/forgot')).toEqual({ name: 'forgot' });
    expect(parseOwnerRoute('/reset')).toEqual({ name: 'reset' });
    expect(parseOwnerRoute('/new')).toEqual({ name: 'new' });
    expect(parseOwnerRoute(`/shop/${ID}/staff`)).toEqual({ name: 'shop', shopId: ID, tab: 'staff' });
    expect(parseOwnerRoute(`/shop/${ID}`)).toEqual({ name: 'shop', shopId: ID, tab: 'settings' });
    expect(parseOwnerRoute(`/shop/${ID}/today`)).toEqual({ name: 'shop', shopId: ID, tab: 'today' });
    expect(parseOwnerRoute(`/shop/${ID.toUpperCase()}/devices`)).toEqual({ name: 'shop', shopId: ID, tab: 'devices' });
  });

  it('parses the history tab and its optional day', () => {
    expect(parseOwnerRoute(`/shop/${ID}/history`)).toEqual({ name: 'shop', shopId: ID, tab: 'history' });
    expect('date' in parseOwnerRoute(`/shop/${ID}/history`)).toBe(false);
    const day: OwnerRoute = { name: 'shop', shopId: ID, tab: 'history', date: '2026-11-09' };
    expect(parseOwnerRoute(`/shop/${ID}/history/2026-11-09`)).toEqual(day);
    expect(parseAppRoute(ownerHash(day))).toEqual({ area: 'owner', route: day });
    for (const bad of ['2026-02-30', 'abc']) {
      const r = parseOwnerRoute(`/shop/${ID}/history/${bad}`);
      expect(r).toEqual({ name: 'shop', shopId: ID, tab: 'history' });
      expect('date' in r).toBe(false);
    }
  });

  it('refuses a day segment on other tabs and extra segments', () => {
    expect(parseOwnerRoute(`/shop/${ID}/settings/2026-11-09`)).toEqual({ name: 'shops' });
    expect(parseOwnerRoute(`/shop/${ID}/history/2026-11-09/extra`)).toEqual({ name: 'shops' });
  });

  it('writes a day segment only for the history tab', () => {
    expect(ownerHash({ name: 'shop', shopId: ID, tab: 'settings', date: '2026-11-09' })).toBe(`#/owner/shop/${ID}/settings`);
    expect(ownerHash({ name: 'shop', shopId: ID, tab: 'history' })).toBe(`#/owner/shop/${ID}/history`);
  });

  it('falls back to the shops list for malformed owner paths', () => {
    expect(parseOwnerRoute('/shop/not-a-uuid/settings')).toEqual({ name: 'shops' });
    expect(parseOwnerRoute(`/shop/${ID}/nope`)).toEqual({ name: 'shops' });
    expect(parseOwnerRoute('/whatever')).toEqual({ name: 'shops' });
  });

  it('round-trips through ownerHash', () => {
    const routes: OwnerRoute[] = [
      { name: 'login' }, { name: 'signup' }, { name: 'forgot' }, { name: 'reset' }, { name: 'shops' }, { name: 'new' },
      { name: 'shop', shopId: ID, tab: 'settings' }, { name: 'shop', shopId: ID, tab: 'devices' }, { name: 'shop', shopId: ID, tab: 'today' },
    ];
    for (const r of routes) expect(parseAppRoute(ownerHash(r))).toEqual({ area: 'owner', route: r });
  });

  it('splits register and owner areas', () => {
    expect(parseAppRoute('')).toEqual({ area: 'register', route: 'register' });
    expect(parseAppRoute('#/tare')).toEqual({ area: 'register', route: 'register' });
    expect(parseAppRoute('#/owner')).toEqual({ area: 'owner', route: { name: 'shops' } });
    expect(parseAppRoute('#/ownerx')).toEqual({ area: 'register', route: 'register' });
  });
});
