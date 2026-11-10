import type { ShopConfig } from '../../../core/config';
import { denomLabel } from '../../../core/denominations';
import type { Draft, ExpenseDraft } from '../draft';
import { isFieldValue, isExpenseMeta, parseKey, type FieldKey, type PendingEdit, type ServerField, type Snapshot } from './fields';

/**
 * The draft the person sees: server fields with their own not-yet-confirmed edits on top.
 * Per key the pending edit with the highest `seq` wins; malformed values (snapshot or pending) are
 * skipped, so a bad pending edit falls back to an older one or the server value. An expense line exists
 * only when its `e:<id>` meta is present and not removed; `:d`/`:a` without meta are ignored.
 */
export function draftFromFields(snapshot: Snapshot, pending: readonly PendingEdit[]): Draft {
  const values = new Map<FieldKey, unknown>();
  for (const [key, f] of Object.entries(snapshot.fields)) {
    if (isFieldValue(key, f.value)) values.set(key, f.value);
  }
  for (const p of [...pending].sort((a, b) => a.seq - b.seq)) {
    if (isFieldValue(p.key, p.value)) values.set(p.key, p.value);
  }

  const entries: Draft['entries'] = {};
  const channels: Draft['channels'] = {};
  const metas = new Map<string, { addedBy: ExpenseDraft['addedBy']; order: number }>();
  const descs = new Map<string, string>();
  const amounts = new Map<string, string>();
  for (const [key, value] of values) {
    const p = parseKey(key);
    if (p === null) continue;
    const v = value as Record<string, unknown>;
    switch (p.kind) {
      case 'denom': entries[String(p.denom)] = { text: v.text as string, mode: v.mode as 'amount' | 'count' }; break;
      case 'channel': channels[p.id] = v.text as string; break;
      case 'expense':
        if (isExpenseMeta(value) && !value.removed) metas.set(p.id, { addedBy: value.addedBy, order: value.order });
        break;
      case 'expenseDesc': descs.set(p.id, v.text as string); break;
      case 'expenseAmount': amounts.set(p.id, v.text as string); break;
    }
  }

  const expenses: ExpenseDraft[] = [...metas]
    .map(([id, m]) => ({ id, description: descs.get(id) ?? '', amountText: amounts.get(id) ?? '', addedBy: m.addedBy, order: m.order }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { businessDate: snapshot.businessDate, entries, channels, expenses };
}

/**
 * Applies a field from the server (an ack or a broadcast). The field follows its own version rule (older
 * or equal versions are ignored). The closing's revision follows the +1 rule: it advances only when the
 * incoming revision is exactly `revision + 1` — whether or not the field itself was newer (a superseded
 * write still counts) — so `revision` always means "every write up to here is in this snapshot". A
 * revision further ahead is a gap (`revisionGap`): the caller keeps the old revision and resyncs.
 */
export function applyServerField(s: Snapshot, f: ServerField & { revision: number }): Snapshot {
  const { revision, ...field } = f;
  const current = s.fields[f.key];
  const newer = current === undefined || f.version > current.version;
  const nextRevision = revision === s.revision + 1 ? revision : s.revision;
  if (!newer && nextRevision === s.revision) return s;
  return { ...s, revision: nextRevision, fields: newer ? { ...s.fields, [f.key]: field } : s.fields };
}

/** A write numbered past `revision + 1` means one in between has not reached us (late or lost broadcast). */
export const revisionGap = (s: Snapshot, revision: number): boolean => revision > s.revision + 1;

/**
 * Greek row label for toasts. An expense line is «Έξοδο N», N = its 1-based position in
 * `draft.expenses` (ordered by creation `order`, as ExpensesCard numbers visible lines); without a
 * draft, or for a line not in it (removed), the plain «Έξοδο».
 */
export function fieldLabel(key: FieldKey, config: ShopConfig, draft?: Draft): string {
  const p = parseKey(key);
  if (p === null) return key;
  switch (p.kind) {
    case 'denom': return denomLabel(p.denom);
    case 'channel': return config.channels.find((c) => c.id === p.id)?.label ?? p.id;
    default: {
      const i = draft?.expenses.findIndex((e) => e.id === p.id) ?? -1;
      return i >= 0 ? `Έξοδο ${i + 1}` : 'Έξοδο';
    }
  }
}

/**
 * Presence → tags: the names of the other clients in each box (a client in no box shows nowhere).
 * Names are kept in arrival order without repeats (one person on two devices shows once).
 */
export function presenceTags(presence: readonly { name: string; focus: FieldKey | null }[]): Record<FieldKey, string[]> {
  const out: Record<FieldKey, string[]> = {};
  for (const p of presence) {
    if (p.focus === null) continue;
    const names = (out[p.focus] ??= []);
    if (!names.includes(p.name)) names.push(p.name);
  }
  return out;
}
