import { useState } from 'react';
import { minus, plus, type TotalDef } from '../../../core/config';
import { Card } from '../../../ui/Card';
import { formulaText, termLabel, termOptions } from '../model/terms';
import { SectionErrors, type SectionProps } from './GeneralSection';

function TotalEditor({ total, config, dispatch }: Omit<SectionProps, 'errors'> & { total: TotalDef }) {
  const options = termOptions(config, total.id);
  const [pick, setPick] = useState(options[0]?.key ?? '');
  const chosen = options.find((o) => o.key === pick) ?? options[0];

  return (
    <fieldset className="card" aria-label={total.label} style={{ border: 0 }}>
      <div className="row">
        <input className="field text" aria-label={`Όνομα συνόλου ${total.label}`} value={total.label} onChange={(e) => dispatch({ type: 'renameTotal', id: total.id, label: e.target.value })} />
        <button type="button" className="icon-btn" aria-label={`Πάνω ${total.label}`} onClick={() => dispatch({ type: 'moveTotal', id: total.id, delta: -1 })}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={`Κάτω ${total.label}`} onClick={() => dispatch({ type: 'moveTotal', id: total.id, delta: 1 })}>
          ↓
        </button>
        <button type="button" className="icon-btn" aria-label={`Διαγραφή συνόλου ${total.label}`} onClick={() => dispatch({ type: 'removeTotal', id: total.id })}>
          ×
        </button>
      </div>
      <p className="formula">= {formulaText(config, total)}</p>
      {total.terms.map((term, i) => {
        const label = termLabel(config, term.ref);
        return (
          <div className="term" key={`${i}-${label}`}>
            <button type="button" className="sign" aria-label={`Αλλαγή πρόσημου ${label}`} onClick={() => dispatch({ type: 'flipTerm', totalId: total.id, index: i })}>
              {term.sign === 1 ? '+' : '−'}
            </button>
            <span className="row-label">{label}</span>
            <button type="button" className="icon-btn" aria-label={`Διαγραφή όρου ${label}`} onClick={() => dispatch({ type: 'removeTerm', totalId: total.id, index: i })}>
              ×
            </button>
          </div>
        );
      })}
      <div className="term">
        <select className="select" aria-label={`Όρος για ${total.label}`} value={chosen?.key ?? ''} onChange={(e) => setPick(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="sign" aria-label="Πρόσθεση όρου" disabled={!chosen} onClick={() => chosen && dispatch({ type: 'addTerm', totalId: total.id, term: plus(chosen.ref) })}>
          +
        </button>
        <button type="button" className="sign" aria-label="Αφαίρεση όρου" disabled={!chosen} onClick={() => chosen && dispatch({ type: 'addTerm', totalId: total.id, term: minus(chosen.ref) })}>
          −
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={total.showInSummary} onChange={(e) => dispatch({ type: 'setTotalFlag', id: total.id, flag: 'showInSummary', value: e.target.checked })} />
        Στη σύνοψη
      </label>
      <label className="check">
        <input type="checkbox" checked={total.showInShare} onChange={(e) => dispatch({ type: 'setTotalFlag', id: total.id, flag: 'showInShare', value: e.target.checked })} />
        Στην κοινοποίηση
      </label>
    </fieldset>
  );
}

export function TotalsSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Σύνολα">
      <p className="notice-soft">Κάθε σύνολο είναι όροι που προστίθενται (+) ή αφαιρούνται (−).</p>
      {config.totals.map((t) => (
        <TotalEditor key={t.id} total={t} config={config} dispatch={dispatch} />
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addTotal', label: 'Νέο σύνολο' })}>
        + Σύνολο
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
