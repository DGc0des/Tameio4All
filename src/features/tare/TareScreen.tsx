import { useState } from 'react';
import type { TareItem } from '../../core/config';
import { sanitizeAmountInput } from '../../core/money';
import { formatKg, netWeightGrams } from '../../core/tare';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';

export function TareScreen({ items, onBack }: { items: readonly TareItem[]; onBack: () => void }) {
  const [weights, setWeights] = useState<Record<number, string>>({});
  return (
    <div className="app">
      <header className="top">
        <button type="button" className="icon-btn" aria-label="Πίσω" onClick={onBack}>
          ←
        </button>
        <h1>Αποβάρα</h1>
        <span />
      </header>
      <main className="page">
        <Card>
          {items.map((item, i) => {
            const net = netWeightGrams(weights[i] ?? '', item.tareGrams);
            return (
              <div className="row" key={item.name}>
                <span className="row-label">
                  {item.name}
                  <br />
                  <small className="row-hint">αποβάρο {formatKg(item.tareGrams)}</small>
                </span>
                <AmountField
                  id={`tare-${i}`}
                  label={`Βάρος ${item.name} (kg)`}
                  placeholder="0.000"
                  value={weights[i] ?? ''}
                  onChange={(t) => setWeights({ ...weights, [i]: sanitizeAmountInput(t) })}
                />
                <strong className="tare-net" aria-label={`Καθαρό ${item.name}`}>
                  {net === null ? '—' : formatKg(net)}
                </strong>
              </div>
            );
          })}
        </Card>
      </main>
    </div>
  );
}
