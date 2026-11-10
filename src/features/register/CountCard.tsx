import { convertEntry, denomLabel, type EntryMode } from '../../core/denominations';
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
  /** How the boxes are displayed and typed into; stored per box as it is typed. */
  viewMode: EntryMode;
}

export function CountCard({ title, denominations, totalCents, draft, derived, dispatch, viewMode }: Props) {
  if (denominations.length === 0) return null;
  return (
    <Card title={title} aside={totalCents > 0 ? formatEuro(totalCents) : undefined}>
      {denominations.map((d) => {
        const key = String(d);
        const label = denomLabel(d);
        const error = fieldError(derived, fieldId.denom(d));
        const box = draft.entries[key];
        const rowCents = derived.rowCents[key];
        // € mode: no hint. # mode: the row's euro value. An error always wins.
        const hint = error ?? (viewMode === 'count' && rowCents !== undefined ? formatEuro(rowCents) : undefined);
        const errId = `denom-${key}-err`;
        return (
          <div className="row" key={key}>
            <span className="row-label">{label}</span>
            {hint !== undefined && (
              <span id={error !== undefined ? errId : undefined} className={error !== undefined ? 'row-hint err' : 'row-hint'}>
                {hint}
              </span>
            )}
            <AmountField
              id={`denom-${key}`}
              label={label}
              value={box === undefined ? '' : convertEntry(box.text, d, box.mode, viewMode)}
              invalid={error !== undefined}
              describedBy={error !== undefined ? errId : undefined}
              inputMode={viewMode === 'count' ? 'numeric' : 'decimal'}
              onChange={(text) => dispatch({ type: 'setEntry', denom: d, text, mode: viewMode })}
            />
          </div>
        );
      })}
    </Card>
  );
}
