import { useState, type FormEvent } from 'react';
import { CHANNEL_TYPES, validateConfig, type ChannelType } from '../../core/config';
import { parseAmount } from '../../core/money';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { buildFirstConfig, type FirstSetupChannel } from './model/firstSetup';
import { checkName, SHOP_NAME_MAX } from './model/limits';
import { nameProblemMessage } from './model/messages';
import { CHANNEL_TYPE_LABELS } from './model/terms';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { useAction } from './useAction';

export function NewShopScreen({ api, navigate }: { api: OwnerApi; navigate: OwnerNavigate }) {
  const [name, setName] = useState('');
  const [float, setFloat] = useState('');
  const [channels, setChannels] = useState<FirstSetupChannel[]>([]);
  const action = useAction();

  const setChannel = (i: number, patch: Partial<FirstSetupChannel>) =>
    setChannels(channels.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(name, SHOP_NAME_MAX);
    if (!n.ok) return action.fail(`Όνομα καταστήματος: ${nameProblemMessage(n.problem, SHOP_NAME_MAX)}`);
    const f = float.trim() === '' ? { ok: true as const, value: 0 } : parseAmount(float);
    if (!f.ok) return action.fail('Το αρχικό ταμείο πρέπει να είναι ποσό, π.χ. 1000 ή 150,50.');
    if (channels.some((c) => c.label.trim() === '')) return action.fail('Δώσε όνομα σε κάθε κανάλι ή αφαίρεσέ το.');
    const config = buildFirstConfig({ floatCents: f.value, channels });
    if (validateConfig(config).length > 0) return action.fail('Οι ρυθμίσεις δεν είναι έγκυρες.');
    const r = await action.run(() => api.createShop(n.value, config));
    if (r.ok) navigate({ name: 'shop', shopId: r.data, tab: 'settings' }, { replace: true });
  };

  return (
    <div className="app">
      <OwnerHeader title="Νέο κατάστημα" onBack={() => navigate({ name: 'shops' })} />
      <main className="page">
        <form className="form" onSubmit={submit} noValidate>
          <Card title="Βασικά">
            <input className="text-field" aria-label="Όνομα καταστήματος" placeholder="Όνομα καταστήματος" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="row">
              <span className="row-label">Αρχικό ταμείο (€)</span>
              <input className="field" aria-label="Αρχικό ταμείο (€)" inputMode="decimal" placeholder="0" value={float} onChange={(e) => setFloat(e.target.value)} />
            </div>
          </Card>
          <Card title="Κανάλια πληρωμής">
            <p className="notice-soft">Κάρτες, πλατφόρμες delivery, κέρματα εκτός ταμείου. Αλλάζουν αργότερα από τις Ρυθμίσεις.</p>
            {channels.map((c, i) => (
              <div className="row" key={i}>
                <input className="field text" aria-label={`Όνομα καναλιού ${i + 1}`} value={c.label} onChange={(e) => setChannel(i, { label: e.target.value })} />
                <select className="select" aria-label={`Είδος καναλιού ${i + 1}`} value={c.type} onChange={(e) => setChannel(i, { type: e.target.value as ChannelType })}>
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CHANNEL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" aria-label={`Αφαίρεση καναλιού ${i + 1}`} onClick={() => setChannels(channels.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-text" onClick={() => setChannels([...channels, { label: '', type: 'card' }])}>
              + Κανάλι
            </button>
          </Card>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            Δημιουργία
          </button>
          <ErrorText state={action.state} />
        </form>
      </main>
    </div>
  );
}
