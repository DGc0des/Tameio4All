import type { ExpenseAuthor } from '../../core/formula';
import { formatEuro } from '../../core/money';
import { exactExpenseMatch, suggestExpenseDescriptions, type SupplierHistory } from '../../core/suggestions';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, DraftDispatch, ExpenseDraft } from './draft';

interface Props {
  maxExpenses: number;
  draft: Draft;
  derived: Derived;
  history: SupplierHistory;
  /** Who a line added now is recorded as (the signed-in cashier). */
  author: ExpenseAuthor;
  dispatch: DraftDispatch;
  newId: () => string;
  /** Clock for a new line's `order` (client ms); defaults to Date.now. */
  nowMs?: () => number;
}

export function ExpensesCard({ maxExpenses, draft, derived, history, author, dispatch, newId, nowMs = Date.now }: Props) {
  return (
    <Card title="Έξοδα" aside={derived.expensesCents > 0 ? formatEuro(derived.expensesCents) : undefined}>
      {draft.expenses.map((expense, index) => (
        <ExpenseRow key={expense.id} expense={expense} index={index} derived={derived} history={history} dispatch={dispatch} />
      ))}
      {draft.expenses.length < maxExpenses && (
        <button type="button" className="link" onClick={() => dispatch({ type: 'addExpense', id: newId(), max: maxExpenses, addedBy: author, order: nowMs() })}>
          + Έξοδο
        </button>
      )}
    </Card>
  );
}

interface RowProps {
  expense: ExpenseDraft;
  index: number;
  derived: Derived;
  history: SupplierHistory;
  dispatch: DraftDispatch;
}

function ExpenseRow({ expense, index, derived, history, dispatch }: RowProps) {
  const n = index + 1;
  const error = fieldError(derived, fieldId.expense(expense.id));
  const errId = `expense-${expense.id}-err`;
  const cents = derived.expenseRowCents[expense.id] ?? 0;
  const described = expense.description.trim() !== '';
  const chips = described ? [] : suggestExpenseDescriptions(history, cents);
  const setDescription = (description: string) => dispatch({ type: 'setExpense', id: expense.id, description });
  // After leaving the amount: fill the name only when exactly one supplier has this exact amount (V2).
  const autoFill = () => {
    if (described) return;
    const name = exactExpenseMatch(history, cents);
    if (name !== null) setDescription(name);
  };

  return (
    <div className="expense">
      <div className="row">
        <input
          className="field text"
          aria-label={`Περιγραφή εξόδου ${n}`}
          placeholder="Περιγραφή"
          autoComplete="off"
          value={expense.description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <AmountField
          id={`expense-${expense.id}`}
          label={`Ποσό εξόδου ${n}`}
          value={expense.amountText}
          invalid={error !== undefined}
          describedBy={error !== undefined ? errId : undefined}
          onBlur={autoFill}
          onChange={(text) => dispatch({ type: 'setExpense', id: expense.id, amountText: text })}
        />
        <button type="button" className="icon-btn" aria-label={`Αφαίρεση εξόδου ${n}`} onClick={() => dispatch({ type: 'removeExpense', id: expense.id })}>
          ×
        </button>
      </div>
      {error !== undefined && (
        <div>
          <span id={errId} className="row-hint err">
            {error}
          </span>
        </div>
      )}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((name) => (
            <button type="button" key={name} className="chip" onClick={() => setDescription(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
