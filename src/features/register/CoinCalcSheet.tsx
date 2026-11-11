import { useRef, useState } from 'react';
import { centsToPlain, formatEuro, sanitizeAmountInput } from '../../core/money';
import { AmountField } from '../../ui/AmountField';
import { Sheet } from '../../ui/Sheet';
import { sumAmounts } from './coinCalc';

interface Props {
  label: string;
  onApply: (text: string) => void;
  onClose: () => void;
}

interface Row {
  id: number;
  text: string;
}

const MIN_ROWS = 3;

/** At least MIN_ROWS rows, and always one empty row at the end to type into (V2). */
function withTrailingRow(rows: Row[], nextId: () => number): Row[] {
  const out = [...rows];
  while (out.length < MIN_ROWS) out.push({ id: nextId(), text: '' });
  if (out[out.length - 1]?.text !== '') out.push({ id: nextId(), text: '' });
  return out;
}

export function CoinCalcSheet({ label, onApply, onClose }: Props) {
  const counter = useRef(0);
  const nextId = () => ++counter.current;
  const [rows, setRows] = useState<Row[]>(() => withTrailingRow([], nextId));
  const { cents, invalidIndexes } = sumAmounts(rows.map((r) => r.text));

  const set = (id: number, raw: string) => {
    const text = sanitizeAmountInput(raw);
    setRows(withTrailingRow(rows.map((r) => (r.id === id ? { ...r, text } : r)), nextId));
  };
  const remove = (id: number) => setRows(withTrailingRow(rows.filter((r) => r.id !== id), nextId));
  const add = () => setRows([...rows, { id: nextId(), text: '' }]);

  return (
    <Sheet title={`Άθροισμα · ${label}`} subtitle="Πρόσθεσε κάθε ποσό ξεχωριστά" onClose={onClose}>
      {rows.map((r, i) => (
        <div className="row" key={r.id}>
          <span className="row-label">{i + 1}.</span>
          <AmountField id={`calc-${r.id}`} label={`Ποσό ${i + 1}`} value={r.text} invalid={invalidIndexes.includes(i)} onChange={(t) => set(r.id, t)} />
          <button type="button" className="icon-btn" aria-label={`Αφαίρεση ποσού ${i + 1}`} onClick={() => remove(r.id)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="link" onClick={add}>
        + Προσθήκη
      </button>
      <div className="tot main">
        <span>Σύνολο</span>
        <span>{formatEuro(cents)}</span>
      </div>
      <button type="button" className="btn btn-primary wide" disabled={invalidIndexes.length > 0} onClick={() => onApply(cents === 0 ? '' : centsToPlain(cents))}>
        Καταχώρηση
      </button>
    </Sheet>
  );
}
