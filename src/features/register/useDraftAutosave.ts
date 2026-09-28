import { useEffect, useRef } from 'react';
import { saveDraft } from '../../data/local/drafts';
import type { KeyValueStore } from '../../data/local/storage';
import type { Draft } from './draft';

/** Saves the draft 300 ms after the last change, and immediately when the page is hidden. */
export function useDraftAutosave(store: KeyValueStore, shopId: string, draft: Draft, now: () => Date): void {
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
    const timer = setTimeout(() => saveDraft(store, shopId, draft, now().getTime()), 300);
    return () => clearTimeout(timer);
  }, [store, shopId, draft, now]);

  useEffect(() => {
    const onHide = () => saveDraft(store, shopId, latest.current, now().getTime());
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [store, shopId, now]);
}
