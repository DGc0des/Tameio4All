import { useState } from 'react';
import type { ShopConfig } from '../../../core/config';
import { formatEuro } from '../../../core/money';
import { Card } from '../../../ui/Card';
import { previewTotals, type PreviewSample } from '../model/preview';

/** Live check of the formulas with made-up amounts. All maths is previewTotals → evaluateTotals. */
export function PreviewCard({ config }: { config: ShopConfig }) {
  const [sample, setSample] = useState<PreviewSample>({ counted: '', expenses: '', channels: {} });
  const result = previewTotals(config, sample);
  const bad = new Set(!result.ok && result.reason === 'bad_sample' ? result.fields : []);

  const field = (key: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="row" key={key}>
      <span className="row-label">{label}</span>
      <input className="field" aria-label={`Δοκιμή: ${label}`} aria-invalid={bad.has(key) || undefined} inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <Card title="Δοκιμή με ποσά">
      {field('counted', 'Μετρημένα', sample.counted, (v) => setSample({ ...sample, counted: v }))}
      {config.channels.map((c) =>
        field(c.id, c.label, sample.channels[c.id] ?? '', (v) => setSample({ ...sample, channels: { ...sample.channels, [c.id]: v } })),
      )}
      {field('expenses', 'Έξοδα', sample.expenses, (v) => setSample({ ...sample, expenses: v }))}
      {result.ok ? (
        result.totals.map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <b aria-label={`Αποτέλεσμα ${t.label}`}>{formatEuro(t.cents)}</b>
          </div>
        ))
      ) : result.reason === 'invalid_config' ? (
        <p className="notice-soft">Διόρθωσε τα λάθη των ρυθμίσεων για να δεις αποτελέσματα.</p>
      ) : (
        <p className="row-hint err">Τα μετρημένα πρέπει να βγαίνουν με τα κέρματα του ταμείου· τα ποσά ≥ 0.</p>
      )}
    </Card>
  );
}
