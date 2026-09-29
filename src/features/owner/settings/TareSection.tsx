import { Card } from '../../../ui/Card';
import { SectionErrors, type SectionProps } from './GeneralSection';

export function TareSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Αποβάρα">
      {config.tareItems.map((item, i) => (
        <div className="row" key={i}>
          <input className="field text" aria-label={`Προϊόν αποβάρας ${i + 1}`} value={item.name} onChange={(e) => dispatch({ type: 'updateTare', index: i, name: e.target.value })} />
          <input
            className="field"
            aria-label={`Γραμμάρια ${i + 1}`}
            inputMode="numeric"
            value={String(item.tareGrams)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isInteger(v)) dispatch({ type: 'updateTare', index: i, tareGrams: v });
            }}
          />
          <button type="button" className="icon-btn" aria-label={`Αφαίρεση προϊόντος ${i + 1}`} onClick={() => dispatch({ type: 'removeTare', index: i })}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addTare', name: '', tareGrams: 0 })}>
        + Προϊόν
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
