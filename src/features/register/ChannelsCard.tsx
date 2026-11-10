import type { Channel } from '../../core/config';
import { AmountField } from '../../ui/AmountField';
import { Card } from '../../ui/Card';
import { fieldError, fieldId, type Derived } from './derive';
import type { Draft } from './draft';
import { boxEvents, PresenceTags, type FieldBinding } from './FieldBinding';
import { amountValue, channelKey } from './live/fields';

interface Props {
  channels: readonly Channel[];
  draft: Draft;
  derived: Derived;
  binding: FieldBinding;
  onCalculator?: (channelId: string) => void;
}

export function ChannelsCard({ channels, draft, derived, binding, onCalculator }: Props) {
  if (channels.length === 0) return null;
  return (
    <Card title="Άλλα ποσά">
      {channels.map((ch) => {
        const key = channelKey(ch.id);
        const error = fieldError(derived, fieldId.channel(ch.id));
        const errId = `channel-${ch.id}-err`;
        return (
          <div className="row" key={ch.id}>
            <span className="row-label">{ch.label}</span>
            <PresenceTags binding={binding} keys={[key]} />
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
              {...boxEvents(binding, key)}
              onChange={(text) => binding.edit(key, amountValue(text))}
            />
          </div>
        );
      })}
    </Card>
  );
}
