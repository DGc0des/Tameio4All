import { CHANNEL_TYPES, type ChannelType } from '../../../core/config';
import { Card } from '../../../ui/Card';
import { CHANNEL_TYPE_LABELS } from '../model/terms';
import { SectionErrors, type SectionProps } from './GeneralSection';

export function ChannelsSection({ config, dispatch, errors }: SectionProps) {
  return (
    <Card title="Κανάλια">
      {config.channels.map((c) => (
        <div className="row" key={c.id}>
          <input className="field text" aria-label={`Όνομα καναλιού ${c.label}`} value={c.label} onChange={(e) => dispatch({ type: 'renameChannel', id: c.id, label: e.target.value })} />
          <select className="select" aria-label={`Είδος ${c.label}`} value={c.type} onChange={(e) => dispatch({ type: 'setChannelType', id: c.id, channelType: e.target.value as ChannelType })}>
            {CHANNEL_TYPES.map((t) => (
              <option key={t} value={t}>
                {CHANNEL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button type="button" className="icon-btn" aria-label={`Αφαίρεση ${c.label}`} onClick={() => dispatch({ type: 'removeChannel', id: c.id })}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-text" onClick={() => dispatch({ type: 'addChannel', label: 'Νέο κανάλι', channelType: 'card' })}>
        + Κανάλι
      </button>
      <SectionErrors errors={errors} />
    </Card>
  );
}
