/**
 * The store key: 16 characters of the pairing alphabet, made in SQL by `private.new_join_key`.
 * Cross-file invariant: KEY_RE here and the `shop_join_keys.key` CHECK in the migration are the same format.
 * Every client input path (link route, pasted link, typed code) goes through parseJoinKey.
 */
const KEY_RE = /^[A-HJ-NP-Z2-9]{16}$/;
const JOIN_MARK = '#/join/';
const ROUTE_RE = /^#\/join(?:\/(.*))?$/;

/** Greek capitals that look like Latin ones on the printed card (a cashier on a Greek keyboard types these). */
const GREEK_LOOKALIKES: Record<string, string> = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
};

/** The canonical 16-character key, or null. Accepts a full link, dashes, spaces and lower case. */
export function parseJoinKey(text: string): string | null {
  const at = text.lastIndexOf(JOIN_MARK);
  let rest: string;
  if (at >= 0) rest = text.slice(at + JOIN_MARK.length);
  else if (text.includes('#')) return null;
  else rest = text;
  const key = Array.from(rest.toUpperCase(), (c) => GREEK_LOOKALIKES[c] ?? c)
    .join('')
    .replace(/[^A-Z0-9]/g, '');
  return KEY_RE.test(key) ? key : null;
}

/** 'ABCDEFGHJKLMNPQR' → 'ABCD-EFGH-JKLM-NPQR'; other lengths unchanged. */
export function formatJoinKey(key: string): string {
  return key.length === 16 ? (key.match(/.{4}/g) ?? []).join('-') : key;
}

/** `base` is origin + pathname; the key sits in the hash so it never reaches the hosting server. */
export function joinLink(base: string, key: string): string {
  return `${base}${JOIN_MARK}${key}`;
}

/** null = not a join route; `{key: null}` = a join route whose key is malformed. */
export function parseJoinRoute(hash: string): { key: string | null } | null {
  const m = ROUTE_RE.exec(hash);
  if (m === null) return null;
  const rest = m[1] ?? '';
  return { key: rest.includes('/') ? null : parseJoinKey(rest) };
}
