import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPending, loadSnapshot } from '../../../data/local/openClosing';
import type { KeyValueStore } from '../../../data/local/storage';
import type { DeviceError } from '../../../data/remote/deviceApi';
import type { Draft } from '../draft';
import type { FieldKey } from './fields';
import {
  createSyncEngine, initialEngineState, toLiveState, visibleDraft,
  type EngineState, type LiveState, type SyncEngine, type Writer,
} from './syncEngine';

export interface LiveClosingOptions {
  /**
   * A write/load failed with an error the engine cannot handle (session_invalid, device_revoked,
   * not_a_device, unknown, …). Called once per mount; the queue is kept and nothing more is sent.
   */
  onFatal?(error: DeviceError): void;
}

export interface LiveClosing {
  state: LiveState;
  draft: Draft | null;
  /** Queues the edit (debounced 400 ms per key) and persists it at once. */
  edit(key: FieldKey, value: unknown): void;
  /** Sends a box (or all) without waiting for the debounce — call on blur. */
  flush(key?: FieldKey): void;
  /** Presence: the box this client is in. */
  focus(key: FieldKey | null): void;
  /** load() and replace the snapshot (the queue is kept). */
  resync(): Promise<void>;
  /** Flush and wait (at most `timeoutMs`) until the queue is sent; false if it was not (see SyncEngine.drain). */
  drain(timeoutMs: number): Promise<boolean>;
  /** The UI shows `state.notice` once, then clears it. */
  clearNotice(): void;
  /**
   * Disposes the engine (closing its channel) and starts a fresh one from what is persisted (queue +
   * cached snapshot): the way out of a halted engine after a fatal error the caller did not take over.
   */
  restart(): void;
}

const fresh = (store: KeyValueStore, shopId: string, author: string): EngineState =>
  initialEngineState(loadSnapshot(store, shopId), loadPending(store, shopId, author), author);

/**
 * React binding of the sync engine. One engine (and one live channel) per mount of (store, shopId,
 * me.name, me.id); the writer, clock and onFatal are read through refs, so a new object per render is fine.
 * `me.id` is the queue's author (the cashier's staff id, or OWNER_QUEUE_AUTHOR): only that person's
 * stored edits are shown and sent. `now` only stamps `updatedAt` of this client's acknowledged fields.
 */
export function useLiveClosing(
  writer: Writer,
  store: KeyValueStore,
  shopId: string,
  me: { name: string; id: string },
  now: () => Date,
  opts: LiveClosingOptions = {},
): LiveClosing {
  const writerRef = useRef(writer);
  const nowRef = useRef(now);
  const fatalRef = useRef(opts.onFatal);
  useEffect(() => {
    writerRef.current = writer;
    nowRef.current = now;
    fatalRef.current = opts.onFatal;
  });

  const [es, setEs] = useState<EngineState>(() => fresh(store, shopId, me.id));
  const engineRef = useRef<SyncEngine | null>(null);
  const name = me.name;
  const id = me.id;
  // Bumped by restart(): a new effect run disposes the old engine (cleanup first) and starts another.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const engine = createSyncEngine({
      writer: () => writerRef.current,
      now: () => nowRef.current(),
      store,
      shopId,
      me: { name },
      initial: fresh(store, shopId, id),
      onChange: setEs,
      onFatal: (e) => fatalRef.current?.(e),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [store, shopId, name, id, generation]);

  const edit = useCallback((key: FieldKey, value: unknown) => engineRef.current?.edit(key, value), []);
  const flush = useCallback((key?: FieldKey) => engineRef.current?.flush(key), []);
  const focus = useCallback((key: FieldKey | null) => engineRef.current?.focus(key), []);
  const resync = useCallback(() => engineRef.current?.resync() ?? Promise.resolve(), []);
  const drain = useCallback((ms: number) => engineRef.current?.drain(ms) ?? Promise.resolve(false), []);
  const clearNotice = useCallback(() => engineRef.current?.clearNotice(), []);
  const restart = useCallback(() => setGeneration((g) => g + 1), []);

  const state = useMemo(() => toLiveState(es), [es]);
  const { snapshot, pending } = es;
  const draft = useMemo(() => visibleDraft({ snapshot, pending }), [snapshot, pending]);

  return { state, draft, edit, flush, focus, resync, drain, clearNotice, restart };
}
