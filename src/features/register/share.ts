import { toBlob } from 'html-to-image';
import { closingLabel } from '../../app/closingLabel';
import { formatDateEl } from '../../app/dates';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';
export type ShareFn = (card: HTMLElement, photo: File | null) => Promise<ShareOutcome>;

/**
 * Renders the summary card to a PNG and shares it (plus the optional Z photo) through the phone's
 * share sheet. Falls back to downloading the image where Web Share with files is unsupported.
 * Nothing is stored.
 */
export const shareCard: ShareFn = async (card, photo) => {
  try {
    const blob = await toBlob(card, { pixelRatio: 2, backgroundColor: getComputedStyle(card).backgroundColor });
    if (!blob) return 'failed';
    const image = new File([blob], 'tameio.png', { type: 'image/png' });
    const files = photo ? [image, photo] : [image];
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
      await navigator.share({ files });
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tameio.png';
    // Safari on iOS ignores a click on an <a> that isn't in the document, and revoking the object
    // URL synchronously can race the download starting — so attach, click, detach, then revoke
    // after a delay long enough for the browser to have picked up the blob.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
};

/** The share card's date line; a shop with several closings a day also names which one this is. */
export function shareDateLine(businessDate: string, closingNo: number, closingsPlanned: number): string {
  return closingsPlanned > 1 ? `${formatDateEl(businessDate)} · ${closingLabel(closingNo)}` : formatDateEl(businessDate);
}
