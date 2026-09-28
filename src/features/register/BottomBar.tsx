import { formatEuro, type Cents } from '../../core/money';

interface Props {
  label: string;
  amountCents: Cents;
  envelopeBlocked: string | null;
  submitBlocked: string | null;
  onEnvelope: () => void;
  onSubmit: () => void;
}

export function BottomBar({ label, amountCents, envelopeBlocked, submitBlocked, onEnvelope, onSubmit }: Props) {
  const reason = envelopeBlocked ?? submitBlocked;
  return (
    <footer className="bar-wrap">
      {reason !== null && <p className="blocked">{reason}</p>}
      <div className="bar">
        <div className="bar-amt">
          <small>{label}</small>
          <strong>{formatEuro(amountCents)}</strong>
        </div>
        <button type="button" className="btn btn-text" disabled={envelopeBlocked !== null} onClick={onEnvelope}>
          Φάκελος
        </button>
        <button type="button" className="btn btn-primary" disabled={submitBlocked !== null} onClick={onSubmit}>
          Υποβολή
        </button>
      </div>
    </footer>
  );
}
