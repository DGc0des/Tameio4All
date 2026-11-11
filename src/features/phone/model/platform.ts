/** The device label a phone gets when it joins (the owner can rename it). Pure: the caller passes the user agent. */
export function platformLabel(userAgent: string): string {
  if (/iPhone|iPod/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android';
  return 'Υπολογιστής';
}
