import { useState } from 'react';
import type { TareItem } from '../../../core/config';
import { Card } from '../../../ui/Card';
import type { SettingsAction } from '../model/settingsDraft';
import { SectionErrors, type SectionProps } from './GeneralSection';

function TareRow({ item, index, dispatch }: { item: TareItem; index: number; dispatch: (action: SettingsAction) => void }) {
  const [gramsText, setGramsText] = useState(() => String(item.tareGrams));
  const gramsValid = /^\d+$/.test(gramsText.trim());

  return (
    <div className="row">
      <input
        className="field text"
        aria-label={`Προϊόν αποβάρας ${index + 1}`}
        value={item.name}
        onChange={(e) => dispatch({ type: 'updateTare', index, name: e.target.value })}
      />
      <input
        className="field"
        aria-label={`Γραμμάρια ${index + 1}`}
        aria-invalid={!gramsValid || undefined}
        inputMode="numeric"
        value={gramsText}
        onChange={(e) => {
          const text = e.target.value;
          setGramsText(text);
          const v = Number(text);
          if (text.trim() !== '' && Number.isInteger(v)) dispatch({ type: 'updateTare', index, tareGrams: v });
        }}
      />
      <button type="button" className="icon-btn" aria-label={`Αφαίρεση προϊόντος ${index + 1}`} onClick={() => dispatch({ type: 'removeTare', index })}>
        ×
      </button>
    </div>
  );
}

export function TareSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Αποβάρα">
      {config.tareItems.map((item, i) => (
        <TareRow key={i} item={item} index={i} dispatch={dispatch} />
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addTare', name: '', tareGrams: 0 })}>
        + Προϊόν
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
