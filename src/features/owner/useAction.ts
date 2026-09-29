import { useCallback, useEffect, useRef, useState } from 'react';
import { mapError } from '../../data/remote/errors';
import type { Result } from '../../data/remote/ownerApi';
import { ownerErrorMessage } from './model/messages';

export type ActionState = { status: 'idle' } | { status: 'busy' } | { status: 'error'; message: string };

/** One async action's state. Every branch — success, error result, thrown — settles `busy`. */
export function useAction() {
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    setState({ status: 'busy' });
    let result: Result<T>;
    try {
      result = await fn();
    } catch (e) {
      result = { ok: false, error: mapError(e) };
    }
    if (mounted.current) {
      setState(result.ok ? { status: 'idle' } : { status: 'error', message: ownerErrorMessage(result.error) });
    }
    return result;
  }, []);
  const fail = useCallback((message: string) => setState({ status: 'error', message }), []);
  const clear = useCallback(() => setState({ status: 'idle' }), []);

  return { state, busy: state.status === 'busy', run, fail, clear };
}
