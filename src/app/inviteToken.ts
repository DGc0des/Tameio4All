import { GREEK_LOOKALIKES } from './joinKey';
import { ROLE_LABEL, type MemberRole } from '../features/owner/model/roles';

/**
 * Invite token: 32 characters of the pairing alphabet, made only in SQL.
 * Cross-file invariant: this format and the SQL invite token CHECK/generator are the same.
 */
export const INVITE_TOKEN_RE = /^[A-HJ-NP-Z2-9]{32}$/;

/** The canonical token, or null. Accepts surrounding spaces, lower case and Greek look-alike capitals. */
export function parseInviteToken(s: string): string | null {
  const t = Array.from(s.trim().toUpperCase(), (c) => GREEK_LOOKALIKES[c] ?? c).join('');
  return INVITE_TOKEN_RE.test(t) ? t : null;
}

/** `base` is origin + pathname; the token sits in the hash. */
export function inviteLink(base: string, token: string): string {
  return `${base}#/owner/invite/${token}`;
}

export function inviteMailto(email: string, shopNames: string[], role: MemberRole, link: string): string {
  const subject = 'Πρόσκληση στο Tameio4All';
  const body = `Σε προσκαλώ ως ${ROLE_LABEL[role]} στο κατάστημα: ${shopNames.join(', ')}.\n\nΆνοιξε τον σύνδεσμο και συνδέσου με αυτό το email:\n${link}`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
