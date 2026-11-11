import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatJoinKey, joinLink } from '../../app/joinKey';
import { mapError } from '../../data/remote/errors';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { Sheet } from '../../ui/Sheet';
import { ownerErrorMessage } from './model/messages';
import { ErrorText } from './OwnerUi';
import { QrCode } from './QrCode';
import { useAction } from './useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  shopName: string;
  /** Called after the key was replaced (every device left the shop: the list should reload). */
  onRotated: () => void;
}

type KeyLoad = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; key: string };
/** `fallback`: the clipboard is missing or refused, so the link is shown selected for a manual copy. */
type Copy = 'idle' | 'copied' | 'fallback';

const COPIED_MS = 2000;
const QR_LABEL = 'QR εισόδου στο κατάστημα';

/** The same base the phone's link route is served from; the key goes in the hash. */
const linkFor = (key: string) => joinLink(window.location.origin + window.location.pathname, key);

export function StoreLinkCard({ api, shopId, shopName, onRotated }: Props) {
  const [load, setLoad] = useState<KeyLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [copy, setCopy] = useState<Copy>('idle');
  const [confirming, setConfirming] = useState(false);
  const rotate = useAction();
  /** Guards «Νέος σύνδεσμος» against a double tap that lands before `disabled` re-renders. */
  const rotating = useRef(false);
  const copiedTimer = useRef<number | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    void api.joinKey(shopId).then(
      (r) => {
        if (live) setLoad(r.ok ? { status: 'ready', key: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
      },
      (e: unknown) => {
        if (live) setLoad({ status: 'error', message: ownerErrorMessage(mapError(e)) });
      },
    );
    return () => {
      live = false;
    };
  }, [api, shopId, attempt]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (copy !== 'fallback') return;
    linkInput.current?.focus();
    linkInput.current?.select();
  }, [copy]);

  const key = load.status === 'ready' ? load.key : null;
  // A new key makes any earlier «Αντιγράφηκε» or shown link stale.
  useEffect(() => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    setCopy('idle');
  }, [key]);

  const copyLink = async (link: string) => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      setCopy('copied');
      copiedTimer.current = window.setTimeout(() => {
        copiedTimer.current = null;
        setCopy((c) => (c === 'copied' ? 'idle' : c));
      }, COPIED_MS);
    } catch {
      setCopy('fallback');
    }
  };

  const share = (link: string) => {
    try {
      // A cancelled or refused share is the person's choice, not an error.
      navigator.share({ title: shopName, url: link }).catch(() => {});
    } catch {
      /* ignored for the same reason */
    }
  };

  const confirmRotate = async () => {
    if (rotating.current) return;
    rotating.current = true;
    try {
      const r = await rotate.run(() => api.rotateJoinKey(shopId));
      if (r.ok) {
        setLoad({ status: 'ready', key: r.data });
        setConfirming(false);
        onRotated();
      }
    } finally {
      rotating.current = false;
    }
  };

  const closeSheet = () => {
    setConfirming(false);
    rotate.clear();
  };

  const link = key === null ? null : linkFor(key);
  return (
    <Card title="Είσοδος στο κατάστημα">
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <>
          <p className="form-error" role="alert">
            {load.message}
          </p>
          <button type="button" className="btn btn-text" onClick={() => setAttempt((a) => a + 1)}>
            Ξανά
          </button>
        </>
      )}
      {key !== null && link !== null && (
        <>
          <p className="notice-soft">Το προσωπικό σκανάρει το QR ή ανοίγει τον σύνδεσμο και μπαίνει με το όνομα και το PIN του.</p>
          <div className="qr-frame">
            <QrCode text={link} label={QR_LABEL} />
          </div>
          <p className="pair-code">{formatJoinKey(key)}</p>
          <div className="choices">
            <button type="button" className="choice" onClick={() => void copyLink(link)}>
              {copy === 'copied' ? 'Αντιγράφηκε' : 'Αντιγραφή συνδέσμου'}
            </button>
            {typeof navigator.share === 'function' && (
              <button type="button" className="choice" onClick={() => share(link)}>
                Κοινοποίηση
              </button>
            )}
            <button type="button" className="choice" onClick={() => window.print()}>
              Εκτύπωση
            </button>
          </div>
          {copy === 'fallback' && (
            <input
              ref={linkInput}
              className="field text wide"
              aria-label="Σύνδεσμος καταστήματος"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          <button type="button" className="btn btn-text" onClick={() => setConfirming(true)}>
            Νέος σύνδεσμος
          </button>
          {createPortal(
            // Printed alone (see `.print-only` in theme.css); a child of <body>, outside every glass container.
            <div className="print-only" aria-hidden="true">
              <h1>{shopName}</h1>
              <QrCode text={link} label={QR_LABEL} />
              <p className="print-code">{formatJoinKey(key)}</p>
              <p>Σκάναρε για να μπεις στο ταμείο. Μετά: όνομα και PIN.</p>
            </div>,
            document.body,
          )}
        </>
      )}
      {confirming && (
        <Sheet title="Νέος σύνδεσμος" onClose={closeSheet}>
          <p>
            Ο παλιός σύνδεσμος και το QR θα πάψουν να ισχύουν. Όλες οι συσκευές θα βγουν από το κατάστημα και το προσωπικό θα
            χρειαστεί τον νέο σύνδεσμο.
          </p>
          <ErrorText state={rotate.state} />
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={closeSheet}>
              Άκυρο
            </button>
            <button type="button" className="btn btn-primary" disabled={rotate.busy} onClick={() => void confirmRotate()}>
              Νέος σύνδεσμος
            </button>
          </div>
        </Sheet>
      )}
    </Card>
  );
}
