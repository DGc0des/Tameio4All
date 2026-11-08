import { useEffect, useRef } from 'react';
import { saveDraft } from '../../data/local/drafts';
import type { KeyValueStore } from '../../data/local/storage';
import type { Draft } from './draft';

/**
 * Saves the draft 300 ms after the last change, and immediately when the page is hidden — either
 * unloaded (pagehide) or backgrounded/tab-switched away from (visibilitychange to 'hidden'; iOS
 * Safari does not reliably fire pagehide when the app is merely backgrounded). A save still pending when
 * the register unmounts (sign-out, a gate reload) is written at once.
 */
export function useDraftAutosave(store: KeyValueStore, shopId: string, draft: Draft, now: () => Date): void {
  const latest = useRef(draft);
  const pending = useRef(false);
  useEffect(() => {
    latest.current = draft;
    pending.current = true;
    const timer = setTimeout(() => {
      pending.current = false;
      saveDraft(store, shopId, draft, now().getTime());
    }, 300);
    return () => clearTimeout(timer);
  }, [store, shopId, draft, now]);

  useEffect(() => {
    const saveNow = () => {
      pending.current = false;
      saveDraft(store, shopId, latest.current, now().getTime());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onVisibility);
      if (pending.current) saveNow();
    };
  }, [store, shopId, now]);
}
