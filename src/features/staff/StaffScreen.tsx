import { useState } from 'react';
import { Card } from '../../ui/Card';

interface Props {
  staff: readonly string[];
  onChange: (names: string[]) => void;
  onBack: () => void;
}

/** DEV ONLY (Plan 2): device-local staff list. Replaced by server staff + PIN in Plan 4. */
export function StaffScreen({ staff, onChange, onBack }: Props) {
  const [newName, setNewName] = useState('');
  const add = () => {
    if (newName.trim() === '') return;
    onChange([...staff, newName]);
    setNewName('');
  };
  return (
    <div className="app">
      <header className="top">
        <button type="button" className="icon-btn" aria-label="Πίσω" onClick={onBack}>
          ←
        </button>
        <h1>Προσωπικό</h1>
        <span />
      </header>
      <main className="page">
        <p className="notice-soft">Προσωρινό: τα ονόματα αποθηκεύονται μόνο σε αυτή τη συσκευή.</p>
        <Card>
          {staff.map((name, i) => (
            <div className="row" key={`${i}-${name}`}>
              <input
                className="field text"
                aria-label={`Όνομα ${i + 1}`}
                defaultValue={name}
                onBlur={(e) => {
                  if (e.target.value !== name) onChange(staff.map((n, j) => (j === i ? e.target.value : n)));
                }}
              />
              <button type="button" className="icon-btn" aria-label={`Αφαίρεση ${name}`} onClick={() => onChange(staff.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <div className="row">
            <input
              className="field text"
              aria-label="Νέο όνομα"
              placeholder="Νέο όνομα"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <button type="button" className="btn btn-text" onClick={add}>
              Προσθήκη
            </button>
          </div>
        </Card>
      </main>
    </div>
  );
}
