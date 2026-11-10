// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDraft } from '../../../src/data/local/drafts';
import { memoryStore, shopKey } from '../../../src/data/local/storage';
import { newDraft } from '../../../src/features/register/draft';
import { useDraftAutosave } from '../../../src/features/register/useDraftAutosave';
import { boxes } from './boxes';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDraftAutosave', () => {
  it('saves immediately when the tab is backgrounded, without waiting for the debounce timer', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const draft = newDraft('2026-09-28');
    const now = () => new Date(1_790_000_000_000);
    renderHook(() => useDraftAutosave(store, 'local', draft, now));

    // No timer advance: the 300ms debounce has not fired.
    expect(store.getItem(shopKey('local', 'draft'))).toBeNull();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(store.getItem(shopKey('local', 'draft'))).not.toBeNull();
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });

  it('flushes the pending debounced save on unmount', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const now = () => new Date(1_790_000_000_000);
    const first = newDraft('2026-09-28');
    const { rerender, unmount } = renderHook(({ draft }) => useDraftAutosave(store, 'local', draft, now), {
      initialProps: { draft: first },
    });
    vi.advanceTimersByTime(300);
    const edited = { ...first, entries: boxes({ '10000': '7' }) };
    rerender({ draft: edited });
    unmount();
    expect(loadDraft(store, 'local', '2026-09-28')).toEqual(edited);
  });
});
