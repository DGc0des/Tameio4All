import { useState } from 'react';
import type { ShopConfig } from '../../core/config';
import { formatEuro, type Cents } from '../../core/money';
import { Card } from '../../ui/Card';

export function SummaryCard({ config, totals }: { config: ShopConfig; totals: Record<string, Cents> }) {
  const [open, setOpen] = useState(false);
  const envelope = config.totals.find((t) => t.id === config.envelopeTotalId);
  const [first, ...rest] = config.totals.filter((t) => t.showInSummary && t.id !== config.envelopeTotalId);
  const value = (id: string) => formatEuro(totals[id] ?? 0);

  return (
    <Card title="Σύνοψη">
      {first !== undefined && (
        <div className="tot">
          <span>{first.label}</span>
          <span>{value(first.id)}</span>
        </div>
      )}
      {envelope !== undefined && (
        <div className="tot main">
          <span>{envelope.label}</span>
          <span>{value(envelope.id)}</span>
        </div>
      )}
      {rest.length > 0 && (
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          Περισσότερα {open ? '▴' : '▾'}
        </button>
      )}
      {open &&
        rest.map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <span>{value(t.id)}</span>
          </div>
        ))}
    </Card>
  );
}
