import { describe, expect, it } from 'vitest';
import { inviteLink, inviteMailto, parseInviteToken } from '../../src/app/inviteToken';

const T = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('invite token', () => {
  it('round-trips and normalizes', () => {
    expect(parseInviteToken(T)).toBe(T);
    expect(parseInviteToken(` ${T.toLowerCase()} `)).toBe(T);
    expect(parseInviteToken(T.slice(1))).toBeNull();
    expect(parseInviteToken(`${T}A`)).toBeNull();
    for (const c of ['O', '0', '1', 'I']) expect(parseInviteToken(c + T.slice(1))).toBeNull();
    expect(parseInviteToken('Α' + T.slice(1))).toBe(T); // Greek Α -> A
    expect(parseInviteToken('Β' + T.slice(1))).toBe('B' + T.slice(1));
  });
  it('maps Greek Α to A', () => {
    expect(parseInviteToken('Α' + 'A'.repeat(31))).toBe('A'.repeat(32));
  });
  it('builds the link', () => {
    expect(inviteLink('https://x.app/', T)).toBe(`https://x.app/#/owner/invite/${T}`);
  });
  it('builds the mailto', () => {
    const m = inviteMailto('m@test.gr', ['Α', 'Β'], 'accountant', 'L');
    expect(m.startsWith('mailto:m%40test.gr?subject=')).toBe(true);
    const body = decodeURIComponent(m.split('&body=')[1] ?? '');
    expect(body).toContain('L');
    expect(body).toContain('Λογιστής');
    expect(body).toContain('Α, Β');
  });
});
