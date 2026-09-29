import { useState } from 'react';
import type { ShopConfig } from '../../../core/config';
import { denomLabel, EUR_DENOMINATIONS } from '../../../core/denominations';
import { centsToPlain, parseAmount } from '../../../core/money';
import { Card } from '../../../ui/Card';
import type { SettingsAction } from '../model/settingsDraft';

export interface SectionProps {
  config: ShopConfig;
  dispatch: (action: SettingsAction) => void;
  /** Greek messages of the validation errors that belong to this section. */
  errors: string[];
}

export function SectionErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="form-error">
      {errors.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

export function GeneralSection({ config, dispatch, errors }: SectionProps) {
  const [floatText, setFloatText] = useState(() => centsToPlain(config.floatCents));
  const floatParsed = floatText.trim() === '' ? { ok: true as const, value: 0 } : parseAmount(floatText);
  const [maxExpensesText, setMaxExpensesText] = useState(() => String(config.maxExpenses));
  const maxExpensesValid = /^\d+$/.test(maxExpensesText.trim());

  return (
    <Card title="Γενικά">
      <div className="row">
        <span className="row-label">Αρχικό ταμείο (€)</span>
        <input
          className="field"
          aria-label="Αρχικό ταμείο (€)"
          aria-invalid={!floatParsed.ok || undefined}
          inputMode="decimal"
          value={floatText}
          onChange={(e) => {
            setFloatText(e.target.value);
            const p = e.target.value.trim() === '' ? { ok: true as const, value: 0 } : parseAmount(e.target.value);
            if (p.ok) dispatch({ type: 'setFloat', cents: p.value });
          }}
        />
      </div>
      {!floatParsed.ok && <p className="row-hint err">Γράψε ποσό, π.χ. 1000 ή 150,50.</p>}

      <p className="row-label">Χαρτονομίσματα και κέρματα στο ταμείο</p>
      <div className="chips">
        {EUR_DENOMINATIONS.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={config.denominations.includes(d)} onClick={() => dispatch({ type: 'toggleDenomination', cents: d })}>
            {denomLabel(d)}
          </button>
        ))}
      </div>

      <div className="row">
        <span className="row-label">Έξοδα ανά κλείσιμο (0–30)</span>
        <input
          className="field"
          aria-label="Έξοδα ανά κλείσιμο"
          aria-invalid={!maxExpensesValid || undefined}
          inputMode="numeric"
          value={maxExpensesText}
          onChange={(e) => {
            const text = e.target.value;
            setMaxExpensesText(text);
            const v = Number(text);
            if (text.trim() !== '' && Number.isInteger(v)) dispatch({ type: 'setMaxExpenses', value: v });
          }}
        />
      </div>

      <div className="row">
        <span className="row-label">Ο Φάκελος γεμίζει το</span>
        <select className="select" aria-label="Σύνολο Φακέλου" value={config.envelopeTotalId} onChange={(e) => dispatch({ type: 'setEnvelopeTotal', id: e.target.value })}>
          {!config.totals.some((t) => t.id === config.envelopeTotalId) && <option value={config.envelopeTotalId}>—</option>}
          {config.totals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <SectionErrors errors={errors} />
    </Card>
  );
}
