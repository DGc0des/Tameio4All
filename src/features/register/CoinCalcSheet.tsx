import { useState } from 'react';
import { centsToPlain, formatEuro, sanitizeAmountInput } from '../../core/money';
import { AmountField } from '../../ui/AmountField';
import { Sheet } from '../../ui/Sheet';
import { sumAmounts } from './coinCalc';

interface Props {
  label: string;
  onApply: (text: string) => void;
  onClose: () => void;
}

export function CoinCalcSheet({ label, onApply, onClose }: Props) {
  const [rows, setRows] = useState<string[]>(['', '', '']);
  const { cents, invalidIndexes } = sumAmounts(rows);

  const set = (i: number, raw: string) => {
    const text = sanitizeAmountInput(raw);
    const next = rows.map((r, j) => (j === i ? text : r));
    if (i === next.length - 1 && text !== '') next.push('');
    setRows(next);
  };

  return (
    <Sheet title={`Άθροισμα · ${label}`} subtitle="Πρόσθεσε κάθε ποσό ξεχωριστά" onClose={onClose}>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <span className="row-label">{i + 1}.</span>
          <AmountField id={`calc-${i}`} label={`Ποσό ${i + 1}`} value={r} invalid={invalidIndexes.includes(i)} onChange={(t) => set(i, t)} />
        </div>
      ))}
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
