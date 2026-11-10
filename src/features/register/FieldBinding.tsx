import type { FieldKey } from './live/fields';

/**
 * How the register's cards talk to the live closing: every box writes its own field through `edit`
 * (the engine debounces and queues it), sends it at once on blur (`flush`), and reports which box this
 * client is in (`focus`, for the others' presence tags). `editing` = other clients' names per box.
 */
export interface FieldBinding {
  edit(key: FieldKey, value: unknown): void;
  flush(key?: FieldKey): void;
  focus(key: FieldKey | null): void;
  editing: Record<FieldKey, string[]>;
}

/** Focus/blur handlers of one box: presence follows the focus; leaving the box sends it. */
export function boxEvents(b: FieldBinding, key: FieldKey): { onFocus: () => void; onBlur: () => void } {
  return {
    onFocus: () => b.focus(key),
    onBlur: () => {
      b.focus(null);
      b.flush(key);
    },
  };
}

/** Writes a value and sends it at once (taps: add/remove a line, a chip, the calculator). */
export function editNow(b: FieldBinding, key: FieldKey, value: unknown): void {
  b.edit(key, value);
  b.flush(key);
}

/** «who is in this box»: a small pill per other client. Not a lock. */
export function PresenceTags({ binding, keys }: { binding: FieldBinding; keys: readonly FieldKey[] }) {
  const names = [...new Set(keys.flatMap((k) => binding.editing[k] ?? []))];
  if (names.length === 0) return null;
  return (
    <>
      {names.map((name) => (
        <span key={name} className="presence" aria-label={`Επεξεργάζεται: ${name}`}>
          {name}
        </span>
      ))}
    </>
  );
}
