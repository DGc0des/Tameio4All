import { useEffect, useRef } from 'react';
import { saveDraft } from '../../data/local/drafts';
import type { KeyValueStore } from '../../data/local/storage';
import type { Draft } from './draft';

/**
 * Saves the draft 300 ms after the last change, and immediately when the page is hidden — either
 * unloaded (pagehide) or backgrounded/tab-switched away from (visibilitychange to 'hidden'; iOS
 * Safari does not reliably fire pagehide when the app is merely backgrounded).
 */
export function useDraftAutosave(store: KeyValueStore, shopId: string, draft: Draft, now: () => Date): void {
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
    const timer = setTimeout(() => saveDraft(store, shopId, draft, now().getTime()), 300);
    return () => clearTimeout(timer);
  }, [store, shopId, draft, now]);

  useEffect(() => {
    const saveNow = () => saveDraft(store, shopId, latest.current, now().getTime());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store, shopId, now]);
}
