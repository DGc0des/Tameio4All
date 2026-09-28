import { denomLabel } from '../../core/denominations';
import { formatEuro, type Cents } from '../../core/money';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, DraftDispatch } from './draft';

interface Props {
  title: string;
  denominations: readonly Cents[];
  totalCents: Cents;
  draft: Draft;
  derived: Derived;
  dispatch: DraftDispatch;
}

export function CountCard({ title, denominations, totalCents, draft, derived, dispatch }: Props) {
  if (denominations.length === 0) return null;
  return (
    <Card title={title} aside={totalCents > 0 ? formatEuro(totalCents) : undefined}>
      {denominations.map((d) => {
        const key = String(d);
        const label = denomLabel(d);
        const error = fieldError(derived, fieldId.denom(d));
        const rowCents = derived.rowCents[key];
        // € mode: no hint. # mode: the row's euro value. An error always wins.
        const hint = error ?? (draft.mode === 'count' && rowCents !== undefined ? formatEuro(rowCents) : undefined);
        return (
          <div className="row" key={key}>
            <span className="row-label">{label}</span>
            {hint !== undefined && <span className={error !== undefined ? 'row-hint err' : 'row-hint'}>{hint}</span>}
            <AmountField
              id={`denom-${key}`}
              label={label}
              value={draft.entries[key] ?? ''}
              invalid={error !== undefined}
              inputMode={draft.mode === 'count' ? 'numeric' : 'decimal'}
              onChange={(text) => dispatch({ type: 'setEntry', denom: d, text })}
            />
          </div>
        );
      })}
    </Card>
  );
}
