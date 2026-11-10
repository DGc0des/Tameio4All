import type { ExpenseAuthor } from '../../core/formula';
import { formatEuro } from '../../core/money';
import { exactExpenseMatch, suggestExpenseDescriptions, type SupplierHistory } from '../../core/suggestions';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, ExpenseDraft } from './draft';
import { boxEvents, editNow, PresenceTags, type FieldBinding } from './FieldBinding';
import { amountValue, expenseAmountKey, expenseDescKey, expenseKey, expenseMetaValue, textValue } from './live/fields';

interface Props {
  maxExpenses: number;
  draft: Draft;
  derived: Derived;
  history: SupplierHistory;
  /** Who a line added now is recorded as (the server stamps the real author on creation). */
  author: ExpenseAuthor;
  binding: FieldBinding;
  newId: () => string;
  /** Clock for a new line's `order` (client ms). */
  nowMs: () => number;
}

export function ExpensesCard({ maxExpenses, draft, derived, history, author, binding, newId, nowMs }: Props) {
  // The line meta is sent at once, so its description/amount never reach the server before it.
  const add = () => editNow(binding, expenseKey(newId()), expenseMetaValue(author, nowMs(), false));
  return (
    <Card title="Έξοδα" aside={derived.expensesCents > 0 ? formatEuro(derived.expensesCents) : undefined}>
      {draft.expenses.map((expense, index) => (
        <ExpenseRow key={expense.id} expense={expense} index={index} derived={derived} history={history} author={author} binding={binding} />
      ))}
      {draft.expenses.length < maxExpenses && (
        <button type="button" className="link" onClick={add}>
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
  author: ExpenseAuthor;
  binding: FieldBinding;
}

function ExpenseRow({ expense, index, derived, history, author, binding }: RowProps) {
  const n = index + 1;
  const descKey = expenseDescKey(expense.id);
  const amountKey = expenseAmountKey(expense.id);
  const error = fieldError(derived, fieldId.expense(expense.id));
  const errId = `expense-${expense.id}-err`;
  const cents = derived.expenseRowCents[expense.id] ?? 0;
  const described = expense.description.trim() !== '';
  const chips = described ? [] : suggestExpenseDescriptions(history, cents);
  const pickDescription = (description: string) => editNow(binding, descKey, textValue(description));
  // After leaving the amount: fill the name only when exactly one supplier has this exact amount (V2).
  const amountEvents = boxEvents(binding, amountKey);
  const leaveAmount = () => {
    amountEvents.onBlur();
    if (described) return;
    const name = exactExpenseMatch(history, cents);
    if (name !== null) pickDescription(name);
  };
  // Removing keeps the line's meta (author, order) and marks it removed.
  const remove = () => editNow(binding, expenseKey(expense.id), expenseMetaValue(expense.addedBy ?? author, expense.order, true));

  return (
    <div className="expense">
      <div className="row">
        <PresenceTags binding={binding} keys={[descKey, amountKey]} />
        <input
          className="field text"
          aria-label={`Περιγραφή εξόδου ${n}`}
          placeholder="Περιγραφή"
          autoComplete="off"
          value={expense.description}
          {...boxEvents(binding, descKey)}
          onChange={(e) => binding.edit(descKey, textValue(e.target.value))}
        />
        <AmountField
          id={`expense-${expense.id}`}
          label={`Ποσό εξόδου ${n}`}
          value={expense.amountText}
          invalid={error !== undefined}
          describedBy={error !== undefined ? errId : undefined}
          onFocus={amountEvents.onFocus}
          onBlur={leaveAmount}
          onChange={(text) => binding.edit(amountKey, amountValue(text))}
        />
        <button type="button" className="icon-btn" aria-label={`Αφαίρεση εξόδου ${n}`} onClick={remove}>
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
            <button type="button" key={name} className="chip" onClick={() => pickDescription(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
