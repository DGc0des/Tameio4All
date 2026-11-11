import { useEffect, useMemo, useState } from 'react';
import type { ShopConfig } from '../../core/config';
import { isBill, type EntryMode } from '../../core/denominations';
import type { ExpenseAuthor } from '../../core/formula';
import type { SupplierHistory } from '../../core/suggestions';
import { ChannelsCard } from './ChannelsCard';
import { CoinCalcSheet } from './CoinCalcSheet';
import { CountCard } from './CountCard';
import type { Derived } from './derive';
import type { Draft } from './draft';
import { editNow, type FieldBinding } from './FieldBinding';
import { amountValue, channelKey, type FieldKey } from './live/fields';
import { presenceTags } from './live/merge';
import type { Presence } from './live/syncEngine';
import { ModeSwitch } from './ModeSwitch';
import { ExpensesCard } from './ExpensesCard';
import { SummaryCard } from './SummaryCard';

export interface LiveClosingViewProps {
  /** The open closing's pinned config (already checked with isShopConfig). */
  config: ShopConfig;
  draft: Draft;
  derived: Derived;
  viewMode: EntryMode;
  onViewMode: (m: EntryMode) => void;
  /** Other clients and the box each is in. */
  presence: Presence;
  edit(key: FieldKey, value: unknown): void;
  flush(key?: FieldKey): void;
  focus(key: FieldKey | null): void;
  /** Author of a line added here (the server stamps the real one). */
  author: ExpenseAuthor;
  newId: () => string;
  now: () => Date;
  history: SupplierHistory;
  /** False while the screen is mounted but hidden: the calculator sheet (portaled to <body>) closes. Default true. */
  active?: boolean;
}

/** The register's cards bound to the live closing, without a header or bottom bar (phone and owner). */
export function LiveClosingView(props: LiveClosingViewProps) {
  const { config, draft, derived, viewMode, onViewMode, presence, edit, flush, focus, author, newId, now, history, active = true } = props;
  const editing = useMemo(() => presenceTags(presence), [presence]);
  const binding = useMemo<FieldBinding>(() => ({ edit, flush, focus, editing }), [edit, flush, focus, editing]);
  const bills = config.denominations.filter(isBill);
  const coins = config.denominations.filter((d) => !isBill(d));
  const [calcFor, setCalcFor] = useState<string | null>(null);
  useEffect(() => {
    if (!active) setCalcFor(null);
  }, [active]);
  const calcChannel = config.channels.find((c) => c.id === calcFor);
  return (
    <>
      <ModeSwitch mode={viewMode} onChange={onViewMode} />
      <CountCard title="Χαρτονομίσματα" denominations={bills} totalCents={derived.billsCents} draft={draft} derived={derived} binding={binding} viewMode={viewMode} />
      <CountCard title="Κέρματα" denominations={coins} totalCents={derived.coinsCents} draft={draft} derived={derived} binding={binding} viewMode={viewMode} />
      <ExpensesCard
        maxExpenses={config.maxExpenses}
        draft={draft}
        derived={derived}
        history={history}
        author={author}
        binding={binding}
        newId={newId}
        nowMs={() => now().getTime()}
      />
      <ChannelsCard channels={config.channels} draft={draft} derived={derived} binding={binding} onCalculator={setCalcFor} />
      <SummaryCard config={config} totals={derived.totals} />
      {active && calcChannel !== undefined && (
        <CoinCalcSheet
          label={calcChannel.label}
          onApply={(text) => {
            editNow(binding, channelKey(calcChannel.id), amountValue(text));
            setCalcFor(null);
          }}
          onClose={() => setCalcFor(null)}
        />
      )}
    </>
  );
}
