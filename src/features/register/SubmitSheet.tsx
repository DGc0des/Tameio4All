import { useRef, useState } from 'react';
import { formatDateEl } from '../../app/dates';
import type { ShopConfig } from '../../core/config';
import { denomLabel, isBill } from '../../core/denominations';
import { formatEuro } from '../../core/money';
import type { SaveResult } from '../../data/local/submissions';
import { Sheet } from '../../ui/Sheet';
import type { Derived } from './derive';
import type { Draft } from './draft';
import type { ShareFn } from './share';

interface Props {
  config: ShopConfig;
  draft: Draft;
  derived: Derived;
  onSave: () => SaveResult;
  onShare: ShareFn;
  onClose: (saved: boolean) => void;
}

export function SubmitSheet({ config, draft, derived, onSave, onShare, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    if (onSave() === 'failed') {
      setMessage('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
      return;
    }
    setMessage(null);
    setSaved(true);
  };

  const share = async () => {
    if (!cardRef.current) return;
    setBusy(true);
    const outcome = await onShare(cardRef.current, photo);
    setBusy(false);
    setMessage(outcome === 'failed' ? 'Η κοινοποίηση απέτυχε.' : null);
  };

  return (
    <Sheet title={saved ? 'Αποθηκεύτηκε ✓' : 'Υποβολή'} onClose={() => onClose(saved)}>
      <div ref={cardRef}>
        <ShareCard config={config} draft={draft} derived={derived} />
      </div>
      {message !== null && (
        <p className="status-warn" role="alert">
          {message}
        </p>
      )}
      <div className="sheet-actions">
        <label className="btn btn-text">
          {photo ? '✓ Φωτογραφία Ζ' : 'Φωτογραφία Ζ'}
          <input type="file" accept="image/*" aria-label="Φωτογραφία Ζ" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        {saved ? (
          <>
            <button type="button" className="btn btn-text" disabled={busy} onClick={() => void share()}>
              Κοινοποίηση
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onClose(true)}>
              Νέο κλείσιμο
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={save}>
            Υποβολή
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ShareCard({ config, draft, derived }: { config: ShopConfig; draft: Draft; derived: Derived }) {
  const sorted = [...config.denominations].sort((a, b) => b - a);
  const stays = (bills: boolean) =>
    sorted
      .filter((d) => isBill(d) === bills && (derived.envelope.remaining[String(d)] ?? 0) > 0)
      .map((d) => `${derived.envelope.remaining[String(d)]}×${denomLabel(d)}`)
      .join(' · ');
  const billsLeft = stays(true);
  const coinsLeft = stays(false);
  const channels = config.channels.filter((ch) => (derived.inputs.channelCents[ch.id] ?? 0) > 0);

  return (
    <div className="share-card">
      <div className="share-head">
        <strong>{draft.staffName}</strong>
        <span>{formatDateEl(draft.businessDate)}</span>
      </div>
      {config.totals
        .filter((t) => t.showInShare)
        .map((t) => (
          <div className="tot" key={t.id}>
            <span>{t.label}</span>
            <b>{formatEuro(derived.totals[t.id] ?? 0)}</b>
          </div>
        ))}
      {derived.inputs.expenses.map((e, i) => (
        <div className="tot" key={`e${i}`}>
          <span>{e.description || `Έξοδο ${i + 1}`}</span>
          <span>{formatEuro(e.cents)}</span>
        </div>
      ))}
      {channels.map((ch) => (
        <div className="tot" key={ch.id}>
          <span>{ch.label}</span>
          <span>{formatEuro(derived.inputs.channelCents[ch.id] ?? 0)}</span>
        </div>
      ))}
      {billsLeft !== '' && (
        <p className="share-left">
          <span>Χαρτονομίσματα</span> {billsLeft}
        </p>
      )}
      {coinsLeft !== '' && (
        <p className="share-left">
          <span>Κέρματα</span> {coinsLeft}
        </p>
      )}
    </div>
  );
}
