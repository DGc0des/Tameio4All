// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('html-to-image', () => ({
  toBlob: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
}));

import { shareCard } from '../../../src/features/register/share';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// jsdom tries to actually navigate on a real click of an <a href>, logging a "not implemented"
// error that is irrelevant to what's under test — every created anchor gets its default click
// prevented up front, and the test's own click listener runs first to observe the DOM state.
function stubAnchorClicks(onClick: (el: HTMLAnchorElement) => void) {
  const realCreateElement = document.createElement.bind(document);
  return vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreateElement(tag);
    if (tag === 'a') {
      el.addEventListener('click', (e) => {
        onClick(el as HTMLAnchorElement);
        e.preventDefault();
      });
    }
    return el;
  });
}

// jsdom has no Web Share API, so shareCard always falls back to the download link here.
describe('shareCard download fallback', () => {
  it('attaches the link to the document before clicking it (Safari ignores clicks on detached anchors)', async () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    let wasInDomOnClick = false;
    stubAnchorClicks((el) => { wasInDomOnClick = document.body.contains(el); });

    const outcome = await shareCard(card, null);

    expect(outcome).toBe('downloaded');
    expect(wasInDomOnClick).toBe(true);
    // The link is removed again once clicked; it must not linger in the DOM.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('defers revoking the object URL instead of racing the click/download', async () => {
    vi.useFakeTimers();
    const card = document.createElement('div');
    document.body.appendChild(card);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    stubAnchorClicks(() => {});

    await shareCard(card, null);

    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
