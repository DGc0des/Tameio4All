// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_TIMEOUT_MS, TIMEOUT_MESSAGE, timeoutFetch } from '../../src/data/remote/timeoutFetch';

type Call = { input: unknown; init: RequestInit | undefined };

/** A base fetch that records its calls, rejects when init.signal aborts, and can be settled by hand. */
function fakeBase() {
  const calls: Call[] = [];
  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const base = ((input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
      const signal = init?.signal;
      const onAbort = () => rej(signal!.reason ?? new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort);
    });
  }) as unknown as typeof fetch;
  return { base, calls, resolve: (r: Response) => resolve(r), reject: (e: unknown) => reject(e) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('timeoutFetch', () => {
  it('rejects with request_timeout when the base fetch does not answer in time', async () => {
    const { base } = fakeBase();
    const p = timeoutFetch(15000, base)('https://x.test/rpc');
    const settled = expect(p).rejects.toThrow(TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(15000);
    await settled;
  });

  it('does not reject before the timeout', async () => {
    const { base } = fakeBase();
    const p = timeoutFetch(15000, base)('https://x.test/rpc');
    let state = 'pending';
    p.then(() => (state = 'resolved'), () => (state = 'rejected'));
    await vi.advanceTimersByTimeAsync(14999);
    expect(state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(state).toBe('rejected');
  });

  it('returns the response untouched and leaves no timer running', async () => {
    const { base, resolve } = fakeBase();
    const p = timeoutFetch(15000, base)('https://x.test/rpc');
    const res = new Response('ok');
    resolve(res);
    expect(await p).toBe(res);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer when the base fetch rejects (e.g. Failed to fetch)', async () => {
    const { base, reject } = fakeBase();
    const p = timeoutFetch(15000, base)('https://x.test/rpc');
    const err = new TypeError('Failed to fetch');
    reject(err);
    await expect(p).rejects.toBe(err);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the caller's own abort through, not as a timeout", async () => {
    const { base } = fakeBase();
    const c = new AbortController();
    const p = timeoutFetch(15000, base)('https://x.test/rpc', { signal: c.signal });
    c.abort();
    const err = await p.then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect((err as Error).message).not.toBe(TIMEOUT_MESSAGE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts at once when the caller signal is already aborted', async () => {
    const { base } = fakeBase();
    const c = new AbortController();
    c.abort();
    const p = timeoutFetch(15000, base)('https://x.test/rpc', { signal: c.signal });
    const err = await p.then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect((err as Error).message).not.toBe(TIMEOUT_MESSAGE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes input and the other init fields to the base fetch', async () => {
    const { base, calls, resolve } = fakeBase();
    const p = timeoutFetch(15000, base)('https://x.test/rpc', {
      method: 'POST',
      headers: { a: 'b' },
      body: 'payload',
    });
    resolve(new Response('ok'));
    await p;
    expect(calls[0]!.input).toBe('https://x.test/rpc');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers).toEqual({ a: 'b' });
    expect(calls[0]!.init?.body).toBe('payload');
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves globalThis.fetch at call time when no base is given', async () => {
    const f = timeoutFetch(15000);
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);
    try {
      await f('https://x.test/rpc');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('REQUEST_TIMEOUT_MS is 15000', () => expect(REQUEST_TIMEOUT_MS).toBe(15000));
});
