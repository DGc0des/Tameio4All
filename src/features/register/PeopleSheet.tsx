import { Sheet } from '../../ui/Sheet';

interface Props {
  staff: readonly string[];
  staffName: string;
  businessDate: string;
  onStaff: (name: string) => void;
  onDate: (date: string) => void;
  onManage: () => void;
  onClose: () => void;
}

export function PeopleSheet({ staff, staffName, businessDate, onStaff, onDate, onManage, onClose }: Props) {
  return (
    <Sheet title="Ποιος κλείνει;" onClose={onClose}>
      {staff.length === 0 ? (
        <p className="sub">Δεν υπάρχουν ονόματα ακόμα.</p>
      ) : (
        <div className="choices" role="radiogroup" aria-label="Όνομα">
          {staff.map((name) => (
            <button type="button" role="radio" aria-checked={name === staffName} key={name} className="choice" onClick={() => onStaff(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="link" onClick={onManage}>
        Διαχείριση ονομάτων
      </button>
      <label className="date-label">
        Ημερομηνία
        <input type="date" className="field text" value={businessDate} onChange={(e) => onDate(e.target.value)} />
      </label>
      <button type="button" className="btn btn-primary wide" onClick={onClose}>
        Εντάξει
      </button>
    </Sheet>
  );
}
