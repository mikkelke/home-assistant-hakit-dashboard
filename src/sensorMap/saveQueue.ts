import {
  FINGERPRINTS_KEY,
  MAP_KEY,
  applyFingerprintOp,
  applyMapOp,
  type FingerprintDoc,
  type FingerprintOp,
  type MapDoc,
  type MapOp,
  type SystemKey,
} from './mapDoc';

export type SaveState = 'saved' | 'pending' | 'saving' | 'failed';

export interface QueueDocs {
  map: MapDoc;
  fingerprints: FingerprintDoc;
}

export type QueuedOp = { target: 'map'; op: MapOp } | { target: 'fingerprints'; op: FingerprintOp };

export interface QueueSnapshot {
  docs: QueueDocs;
  state: SaveState;
  pending: number;
  error: string | null;
}

export interface QueueDeps {
  /** Resolves when Home Assistant has acknowledged the write. */
  write: (key: SystemKey, value: unknown) => Promise<void>;
}

export const QUIET_MS = 1000;
export const WRITE_TIMEOUT_MS = 10_000;
const MAX_FLUSH_ROUNDS = 5;

const KEYS: Record<QueuedOp['target'], SystemKey> = { map: MAP_KEY, fingerprints: FINGERPRINTS_KEY };

interface Pending {
  seq: number;
  item: QueuedOp;
}

interface Attempt {
  id: number;
  done: Promise<void>;
}

function applyTo(docs: QueueDocs, item: QueuedOp): QueueDocs {
  return item.target === 'map'
    ? { ...docs, map: applyMapOp(docs.map, item.op) }
    : { ...docs, fingerprints: applyFingerprintOp(docs.fingerprints, item.op) };
}

/**
 * Every edit becomes an operation that is applied to the in-memory documents at once and kept until Home
 * Assistant has acknowledged a write that contains it. A write goes out after a second of quiet, or when
 * asked to flush, and "saved" is only ever reported after the acknowledgement. A failed or timed out write
 * keeps the operations for a retry. After a reconnect the documents are read again and the kept operations are
 * applied on top of the fresh ones, which lands each edit once because the operations are safe to apply twice.
 */
export class SaveQueue {
  private docs: QueueDocs;
  private readonly deps: QueueDeps;
  private readonly quietMs: number;
  private readonly timeoutMs: number;
  private pending: Pending[] = [];
  private seq = 0;
  private attempt: Attempt | null = null;
  private attempts = 0;
  private failed: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: QueueSnapshot;

  constructor(deps: QueueDeps, docs: QueueDocs, options: { quietMs?: number; timeoutMs?: number } = {}) {
    this.deps = deps;
    this.docs = docs;
    this.quietMs = options.quietMs ?? QUIET_MS;
    this.timeoutMs = options.timeoutMs ?? WRITE_TIMEOUT_MS;
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): QueueSnapshot => this.snapshot;

  private build(): QueueSnapshot {
    const state: SaveState = this.failed !== null ? 'failed' : this.attempt ? 'saving' : this.pending.length > 0 ? 'pending' : 'saved';
    return { docs: this.docs, state, pending: this.pending.length, error: this.failed };
  }

  private publish() {
    this.snapshot = this.build();
    this.listeners.forEach(listener => listener());
  }

  apply(item: QueuedOp) {
    if (this.disposed) return;
    this.seq += 1;
    this.docs = applyTo(this.docs, item);
    this.pending.push({ seq: this.seq, item });
    this.scheduleQuiet();
    this.publish();
  }

  private cancelQuiet() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleQuiet() {
    this.cancelQuiet();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.attempt) this.start();
    }, this.quietMs);
  }

  private start(): Attempt {
    this.cancelQuiet();
    this.attempts += 1;
    const id = this.attempts;
    const upto = this.seq;
    const targets = new Set(this.pending.filter(entry => entry.seq <= upto).map(entry => entry.item.target));
    const snapshot = this.docs;
    this.failed = null;
    const done = this.run(id, upto, targets, snapshot);
    const attempt: Attempt = { id, done };
    this.attempt = attempt;
    this.publish();
    return attempt;
  }

  private async run(id: number, upto: number, targets: Set<QueuedOp['target']>, snapshot: QueueDocs): Promise<void> {
    let error: string | null = null;
    const results = await Promise.allSettled([...targets].map(target => this.writeWithTimeout(KEYS[target], snapshot[target])));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) error = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
    if (this.disposed || this.attempt?.id !== id) return;
    this.attempt = null;
    if (error === null) {
      this.pending = this.pending.filter(entry => entry.seq > upto);
    } else {
      this.failed = error;
    }
    if (this.pending.length > 0 && this.failed === null) this.scheduleQuiet();
    this.publish();
  }

  private writeWithTimeout(key: SystemKey, value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Home Assistant did not answer in time')), this.timeoutMs);
      this.deps.write(key, value).then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        error => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  /** Writes what is pending now. True when nothing is left to save afterwards. */
  async flush(): Promise<boolean> {
    this.cancelQuiet();
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
      if (this.disposed) return false;
      if (this.pending.length === 0 && !this.attempt) return this.failed === null;
      const attempt = this.attempt ?? (this.pending.length > 0 ? this.start() : null);
      if (attempt) await attempt.done;
      if (this.failed !== null) return false;
    }
    return this.pending.length === 0;
  }

  retry(): Promise<boolean> {
    this.failed = null;
    this.publish();
    return this.flush();
  }

  /**
   * The connection is back: `fresh` holds what Home Assistant has now. Anything an earlier write left in
   * doubt is settled by reading it, and the operations that were never acknowledged go on top.
   */
  reconnect(fresh: QueueDocs): Promise<boolean> {
    this.attempt = null;
    this.failed = null;
    this.docs = this.pending.reduce<QueueDocs>((docs, entry) => applyTo(docs, entry.item), fresh);
    this.publish();
    return this.flush();
  }

  dispose() {
    this.disposed = true;
    this.cancelQuiet();
    this.listeners.clear();
  }
}
