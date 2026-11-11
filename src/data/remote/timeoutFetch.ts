/** Every request through the Supabase client gives up after this long. */
export const REQUEST_TIMEOUT_MS = 15000;

/**
 * The fixed text our own timeout rejects with. postgrest-js reports a thrown fetch error as
 * `{ message: 'Error: request_timeout' }`; both error mappers match it as `network`.
 */
export const TIMEOUT_MESSAGE = 'request_timeout';

/**
 * Wraps fetch so a request that has not answered after `ms` is aborted and rejects with
 * `Error(TIMEOUT_MESSAGE)`. Uses AbortController + setTimeout (AbortSignal.timeout/any are missing
 * on older iOS Safari). A caller-supplied `init.signal` is honoured: its abort is forwarded and its
 * original error is rethrown. Only the time until the response headers is covered; a body that
 * stalls afterwards is not.
 */
export function timeoutFetch(ms: number, base?: typeof fetch): typeof fetch {
  return (input, init) => {
    const doFetch = base ?? globalThis.fetch;
    const controller = new AbortController();
    const callerSignal = init?.signal ?? null;
    let timedOut = false;

    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    };

    return doFetch(input, { ...init, signal: controller.signal }).then(
      (res) => {
        cleanup();
        return res;
      },
      (err) => {
        cleanup();
        if (timedOut && !callerSignal?.aborted) throw new Error(TIMEOUT_MESSAGE);
        throw err;
      },
    );
  };
}
