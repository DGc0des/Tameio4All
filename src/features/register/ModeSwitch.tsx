import type { EntryMode } from '../../core/denominations';

export function ModeSwitch({ mode, onChange }: { mode: EntryMode; onChange: (mode: EntryMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Τρόπος καταμέτρησης">
      <button type="button" aria-pressed={mode === 'amount'} onClick={() => onChange('amount')}>
        € Ποσό
      </button>
      <button type="button" aria-pressed={mode === 'count'} onClick={() => onChange('count')}>
        # Κομμάτια
      </button>
    </div>
  );
}
