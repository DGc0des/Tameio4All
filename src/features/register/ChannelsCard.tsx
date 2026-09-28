import type { Channel } from '../../core/config';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft, DraftDispatch } from './draft';

interface Props {
  channels: readonly Channel[];
  draft: Draft;
  derived: Derived;
  dispatch: DraftDispatch;
  onCalculator?: (channelId: string) => void;
}

export function ChannelsCard({ channels, draft, derived, dispatch, onCalculator }: Props) {
  if (channels.length === 0) return null;
  return (
    <Card title="Άλλα ποσά">
      {channels.map((ch) => {
        const error = fieldError(derived, fieldId.channel(ch.id));
        const errId = `channel-${ch.id}-err`;
        return (
          <div className="row" key={ch.id}>
            <span className="row-label">{ch.label}</span>
            {error !== undefined && (
              <span id={errId} className="row-hint err">
                {error}
              </span>
            )}
            {ch.type === 'cash_extra' && onCalculator !== undefined && (
              <button type="button" className="icon-btn" aria-label={`Άθροισμα για ${ch.label}`} onClick={() => onCalculator(ch.id)}>
                🧮
              </button>
            )}
            <AmountField
              id={`channel-${ch.id}`}
              label={ch.label}
              value={draft.channels[ch.id] ?? ''}
              invalid={error !== undefined}
              describedBy={error !== undefined ? errId : undefined}
              onChange={(text) => dispatch({ type: 'setChannel', id: ch.id, text })}
            />
          </div>
        );
      })}
    </Card>
  );
}
