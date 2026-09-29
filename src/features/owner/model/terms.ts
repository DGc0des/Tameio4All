import { CHANNEL_TYPES, type ChannelType, type ShopConfig, type TermRef, type TotalDef } from '../../../core/config';

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  cash_extra: 'Μετρητά εκτός ταμείου',
  card: 'Κάρτα',
  delivery: 'Delivery',
  noncash_other: 'Άλλο (όχι μετρητά)',
};

const TYPE_GROUP_LABELS: Record<ChannelType, string> = {
  cash_extra: 'Όλα τα μετρητά εκτός ταμείου',
  card: 'Όλες οι κάρτες',
  delivery: 'Όλα τα delivery',
  noncash_other: 'Όλα τα άλλα μη μετρητά',
};

export function termKey(ref: TermRef): string {
  switch (ref.kind) {
    case 'counted':
    case 'float':
    case 'expenses':
      return ref.kind;
    case 'channel':
      return `channel:${ref.id}`;
    case 'type':
      return `type:${ref.type}`;
    case 'total':
      return `total:${ref.id}`;
  }
}

export function termLabel(config: ShopConfig, ref: TermRef): string {
  switch (ref.kind) {
    case 'counted':
      return 'Μετρημένα';
    case 'float':
      return 'Αρχικό ταμείο';
    case 'expenses':
      return 'Έξοδα';
    case 'channel':
      return config.channels.find((c) => c.id === ref.id)?.label ?? '(δεν υπάρχει)';
    case 'type':
      return TYPE_GROUP_LABELS[ref.type];
    case 'total':
      return config.totals.find((t) => t.id === ref.id)?.label ?? '(δεν υπάρχει)';
  }
}

export interface TermOption {
  key: string;
  label: string;
  ref: TermRef;
}

/** Everything a total can add or subtract; excludes the total itself (other cycles are reported by validateConfig). */
export function termOptions(config: ShopConfig, forTotalId: string): TermOption[] {
  const refs: TermRef[] = [
    { kind: 'counted' },
    { kind: 'float' },
    { kind: 'expenses' },
    ...config.channels.map((c): TermRef => ({ kind: 'channel', id: c.id })),
    ...CHANNEL_TYPES.map((type): TermRef => ({ kind: 'type', type })),
    ...config.totals.filter((t) => t.id !== forTotalId).map((t): TermRef => ({ kind: 'total', id: t.id })),
  ];
  return refs.map((ref) => ({ key: termKey(ref), label: termLabel(config, ref), ref }));
}

/** "ΤΑΜΕΙΟ − Αρχικό ταμείο − Έξοδα" — the first term shows its sign only when it is a minus. */
export function formulaText(config: ShopConfig, total: TotalDef): string {
  if (total.terms.length === 0) return '0';
  return total.terms
    .map((t, i) => {
      const label = termLabel(config, t.ref);
      if (i === 0) return t.sign === 1 ? label : `− ${label}`;
      return `${t.sign === 1 ? '+' : '−'} ${label}`;
    })
    .join(' ');
}
