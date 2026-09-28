/** crypto.randomUUID exists only in secure contexts (https, localhost); plain-HTTP LAN testing needs a fallback. */
export function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
