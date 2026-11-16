import type { CashMode, Snapshot } from './live/fields';
import { changedSinceSubmit } from './live/fields';
import { Sheet } from '../../ui/Sheet';

/** «Έναρξη 2ου κλεισίματος» — the button and the sheet title. */
export const startNextLabel = (nextNo: number): string => `Έναρξη ${nextNo}ου κλεισίματος`;

const BODY: Record<CashMode, string> = {
  separate: 'Τα κουτιά θα αδειάσουν για το νέο κλείσιμο. Το προηγούμενο δεν αλλάζει πια από το ταμείο.',
  running:
    'Τα έξοδα μένουν. Η καταμέτρηση και τα ποσά ξεκινούν κενά για νέα καταγραφή. Το προηγούμενο κλείσιμο δεν αλλάζει πια από το ταμείο.',
};

/** Pure: may the cashier start the next closing from this snapshot? */
export function canStartNext(s: Snapshot, hasUnsent: boolean): boolean {
  return s.closingNo < s.closingsPlanned && s.lastSubmit !== null && !changedSinceSubmit(s) && !hasUnsent;
}

interface Props {
  nextNo: number;
  cashMode: CashMode;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function StartNextSheet({ nextNo, cashMode, busy, error, onConfirm, onClose }: Props) {
  return (
    <Sheet title={startNextLabel(nextNo)} onClose={onClose}>
      <p>{BODY[cashMode]}</p>
      {error !== null && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          Έναρξη
        </button>
        <button type="button" className="btn btn-text" onClick={onClose}>
          Άκυρο
        </button>
      </div>
    </Sheet>
  );
}
