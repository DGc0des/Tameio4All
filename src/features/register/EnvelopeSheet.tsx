import { denomLabel } from '../../core/denominations';
import type { EnvelopePlan } from '../../core/envelope';
import { formatEuro, type Cents } from '../../core/money';
import { Sheet } from '../../ui/Sheet';

interface Props {
  denominations: readonly Cents[];
  envelope: EnvelopePlan;
  onClose: () => void;
}

const pieces = (n: number): string => (n === 1 ? '1 κομμάτι' : `${n} κομμάτια`);

export function EnvelopeSheet({ denominations, envelope, onClose }: Props) {
  if (envelope.targetCents <= 0) {
    return (
      <Sheet title="Φάκελος" onClose={onClose}>
        <p>Δεν υπάρχουν μετρητά για φάκελο.</p>
      </Sheet>
    );
  }
  const sorted = [...denominations].sort((a, b) => b - a);
  const count = (plan: Record<string, number>, d: Cents) => plan[String(d)] ?? 0;
  const put = sorted.filter((d) => count(envelope.put, d) > 0);
  const left = sorted.filter((d) => count(envelope.remaining, d) > 0);
  const total = put.reduce((n, d) => n + count(envelope.put, d), 0);

  const subtitle =
    envelope.shortCents === 0
      ? `${formatEuro(envelope.targetCents)} σε ${pieces(total)}`
      : `${formatEuro(envelope.putCents)} σε ${pieces(total)} · στόχος ${formatEuro(envelope.targetCents)}`;

  return (
    <Sheet title="Φάκελος" subtitle={subtitle} onClose={onClose}>
      <ul className="list">
        {put.map((d) => (
          <li className="list-row" key={d}>
            <span>{denomLabel(d)}</span>
            <b>× {count(envelope.put, d)}</b>
          </li>
        ))}
      </ul>
      {envelope.shortCents === 0 ? (
        <p className="status-ok">✓ Ακριβές ποσό</p>
      ) : (
        <p className="status-warn">Λείπουν {formatEuro(envelope.shortCents)}</p>
      )}
      {left.length > 0 && (
        <details className="rest">
          <summary>Τι μένει στο ταμείο</summary>
          <ul className="list">
            {left.map((d) => (
              <li className="list-row" key={d}>
                <span>{denomLabel(d)}</span>
                <span>× {count(envelope.remaining, d)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Sheet>
  );
}
