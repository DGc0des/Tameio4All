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

  it('parses a closing of a history day and round-trips it', () => {
    const r: OwnerRoute = { name: 'shop', shopId: ID, tab: 'history', date: '2026-11-16', closingNo: 2 };
    expect(parseOwnerRoute(`/shop/${ID}/history/2026-11-16/2`)).toEqual(r);
    expect(ownerHash(r)).toBe(`#/owner/shop/${ID}/history/2026-11-16/2`);
    expect(parseAppRoute(ownerHash(r))).toEqual({ area: 'owner', route: r });
    expect(parseOwnerRoute(`/shop/${ID}/history/2026-11-16/6`)).toEqual({ ...r, closingNo: 6 });
  });

  it('drops a malformed closing segment: the route is the day without a closing', () => {
    for (const bad of ['0', '7', '02', 'x', '+2', '2.0', '1e0', '60']) {
      const r = parseOwnerRoute(`/shop/${ID}/history/2026-11-16/${bad}`);
      expect(r).toEqual({ name: 'shop', shopId: ID, tab: 'history', date: '2026-11-16' });
      expect('closingNo' in r).toBe(false);
    }
  });

  it('writes a closing segment only with a history day', () => {
    expect(ownerHash({ name: 'shop', shopId: ID, tab: 'history', closingNo: 2 })).toBe(`#/owner/shop/${ID}/history`);
    expect(ownerHash({ name: 'shop', shopId: ID, tab: 'settings', date: '2026-11-16', closingNo: 2 })).toBe(`#/owner/shop/${ID}/settings`);
  });

  it('refuses a day segment on other tabs and extra segments', () => {
    expect(parseOwnerRoute(`/shop/${ID}/settings/2026-11-09`)).toEqual({ name: 'shops' });
    expect(parseOwnerRoute(`/shop/${ID}/settings/2026-11-09/2`)).toEqual({ name: 'shops' });
    expect(parseOwnerRoute(`/shop/${ID}/today/2026-11-09/2`)).toEqual({ name: 'shops' });
    expect(parseOwnerRoute(`/shop/${ID}/history/2026-11-09/2/extra`)).toEqual({ name: 'shops' });
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
