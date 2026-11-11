import { describe, expect, it } from 'vitest';
import { formatJoinKey, joinLink, parseJoinKey, parseJoinRoute } from '../../src/app/joinKey';

const K = 'ABCDEFGHJKLMNPQR';

describe('parseJoinKey', () => {
  it.each([
    [K, K],
    ['abcd-efgh-jklm-npqr', K],
    ['  ABCD EFGH JKLM NPQR \n', K],
    [`https://app.example/#/join/${K}`, K],
    ['https://app.example/sub/path/#/join/abcd-efgh-jklm-npqr', K],
  ])('accepts %s', (input, key) => expect(parseJoinKey(input)).toBe(key));

  it.each(['', 'ABCDEFGH', `${K}2`, 'ABCDEFGHJKLMNPQ0', 'ABCDEFGHIJKLMNPQ', 'ABCDEFGHJKLMNPO1', `https://app.example/#/owner/${K}x`])(
    'rejects %s',
    (input) => expect(parseJoinKey(input)).toBeNull(),
  );

  it('reads Greek capitals that look like the Latin ones (a Greek keyboard)', () => {
    // Α Β Ε Ζ Η Κ Μ Ν Ρ Τ Υ Χ typed on a Greek layout look the same as the Latin letters on the card.
    expect(parseJoinKey('ΑΒCD-ΕFGΗ-JΚLΜ-ΝPQR')).toBe(K);
    expect(parseJoinKey('αβcd-εfgη-jκlμ-νpqr')).toBe(K);
    expect(parseJoinKey('ΖΤΥΧ ΡΑΒΕ 2345 6789')).toBe('ZTYXPABE23456789');
  });
});

it('formatJoinKey groups by four', () => {
  expect(formatJoinKey(K)).toBe('ABCD-EFGH-JKLM-NPQR');
  expect(formatJoinKey('ABC')).toBe('ABC');
});

it('joinLink', () => expect(joinLink('https://a.b/app/', K)).toBe(`https://a.b/app/#/join/${K}`));

describe('parseJoinRoute', () => {
  it('reads a key', () => expect(parseJoinRoute(`#/join/${K}`)).toEqual({ key: K }));
  it('accepts dashes and lower case', () => expect(parseJoinRoute('#/join/abcd-efgh-jklm-npqr')).toEqual({ key: K }));
  it.each(['#/join', '#/join/', '#/join/short', `#/join/${K}/extra`])('malformed %s', (h) => expect(parseJoinRoute(h)).toEqual({ key: null }));
  it.each(['', '#/', '#/owner', '#/joined', '#/owner/join/x'])('not a join route: %s', (h) => expect(parseJoinRoute(h)).toBeNull());
});
