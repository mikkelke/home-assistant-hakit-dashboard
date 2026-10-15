import {
  FINGERPRINTS_KEY,
  MAP_KEY,
  applyFingerprintOp,
  applyMapOp,
  emptyFingerprintDoc,
  parseFingerprintDoc,
  parseMapDoc,
  type FingerprintDoc,
  type FingerprintOp,
  type MapDoc,
  type MapOp,
  type SystemKey,
} from './mapDoc';

export type SaveState = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict';
export type DocKey = 'map' | 'fingerprints';

export interface QueueDocs {
  map: MapDoc;
  fingerprints: FingerprintDoc;
}

export type QueuedOp = { target: 'map'; op: MapOp } | { target: 'fingerprints'; op: FingerprintOp };

/** A document kept on this device because it was never acknowledged. `base` is the `write_id` it was edited from. */
export interface Draft {
  key: DocKey;
  base: string | null;
  savedAt: string;
  doc: QueueDocs[DocKey];
}

export interface QueueSnapshot {
  docs: QueueDocs;
  state: SaveState;
  error: string | null;
}

export interface QueueDeps {
  read: (key: SystemKey) => Promise<unknown>;
  /** Resolves when Home Assistant has acknowledged the write. */
  write: (key: SystemKey, value: unknown) => Promise<void>;
  drafts?: { save: (key: DocKey, base: string | null, doc: QueueDocs[DocKey]) => void; clear: (key: DocKey) => void };
  newId?: () => string;
}

export const QUIET_MS = 1000;
export const WRITE_TIMEOUT_MS = 10_000;
const MAX_FLUSH_ROUNDS = 5;

export const DOC_KEYS: readonly DocKey[] = ['map', 'fingerprints'];
const NAMES: Record<DocKey, SystemKey> = { map: MAP_KEY, fingerprints: FINGERPRINTS_KEY };

export const PARSE: { [K in DocKey]: (raw: unknown) => QueueDocs[K] } = {
  map: parseMapDoc,
  fingerprints: raw => (raw === null ? emptyFingerprintDoc(new Date().toISOString()) : parseFingerprintDoc(raw)),
};

/** Both documents as Home Assistant holds them; null while there is no map to edit. */
export async function loadDocs(read: QueueDeps['read']): Promise<QueueDocs | null> {
  const [map, fingerprints] = await Promise.all(DOC_KEYS.map(key => read(NAMES[key])));
  return map === null ? null : { map: PARSE.map(map), fingerprints: PARSE.fingerprints(fingerprints) };
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
const stampOf = (raw: unknown) => {
  const { write_id: id, writer } = (typeof raw === 'object' && raw !== null ? raw : {}) as { write_id?: unknown; writer?: unknown };
  return { id: typeof id === 'string' ? id : null, writer: typeof writer === 'string' ? writer : null };
};
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

class ChangedElsewhere extends Error {}

interface Entry {
  /** The `write_id` this queue last read from, or wrote to, Home Assistant. */
  base: string | null;
  acked: boolean;
  conflict: boolean;
}

/**
 * Holds the latest whole document of each key and whether Home Assistant has acknowledged it. An edit changes
 * the document at once and a write goes out after a second of quiet, or when asked to flush; "saved" is only
 * ever reported after the acknowledgement. A failed write leaves the latest document in place for a retry.
 *
 * Every write is stamped with a fresh `write_id` and this queue's `writer`, and is preceded by a read: if the
 * stored document carries a `write_id` this queue has not seen and a different writer, someone else changed it,
 * and nothing more is written. The caller then keeps the drafts and loads again, which offers them back.
 */
export class SaveQueue {
  private docs: QueueDocs;
  private readonly deps: QueueDeps;
  private readonly newId: () => string;
  private readonly writer: string;
  private readonly entries: Record<DocKey, Entry>;
  private attempt: Promise<void> | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: QueueSnapshot;

  constructor(deps: QueueDeps, docs: QueueDocs) {
    this.deps = deps;
    this.docs = docs;
    this.newId = deps.newId ?? randomId;
    this.writer = this.newId();
    const entry = (doc: unknown): Entry => ({ base: stampOf(doc).id, acked: true, conflict: false });
    this.entries = { map: entry(docs.map), fingerprints: entry(docs.fingerprints) };
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): QueueSnapshot => this.snapshot;

  private build(): QueueSnapshot {
    const entries = DOC_KEYS.map(key => this.entries[key]);
    let state: SaveState = 'saved';
    if (entries.some(entry => entry.conflict)) state = 'conflict';
    else if (this.error !== null) state = 'failed';
    else if (this.attempt) state = 'saving';
    else if (entries.some(entry => !entry.acked)) state = 'pending';
    return { docs: this.docs, state, error: this.error };
  }

  private publish() {
    this.snapshot = this.build();
    this.listeners.forEach(listener => listener());
  }

  private dirty(key: DocKey) {
    return !this.entries[key].acked && !this.entries[key].conflict;
  }

  apply(item: QueuedOp) {
    if (this.disposed) return;
    const key = item.target;
    const next = item.target === 'map' ? applyMapOp(this.docs.map, item.op) : applyFingerprintOp(this.docs.fingerprints, item.op);
    if (next === this.docs[key]) return;
    this.docs = { ...this.docs, [key]: next };
    this.entries[key].acked = false;
    this.scheduleQuiet();
    this.publish();
  }

  private cancelQuiet() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleQuiet() {
    this.cancelQuiet();
    this.timer = setTimeout(() => void this.flush(), QUIET_MS);
  }

  private start(): Promise<void> {
    this.error = null;
    const done = Promise.all(DOC_KEYS.filter(key => this.dirty(key)).map(key => this.save(key))).then(() => {
      this.attempt = null;
      if (!this.disposed) this.publish();
    });
    this.attempt = done;
    this.publish();
    return done;
  }

  /** Writes the document as it is now, unless another writer changed what is stored. Never rejects. */
  private async save(key: DocKey) {
    const entry = this.entries[key];
    const sent = this.docs[key];
    const id = this.newId();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Home Assistant did not answer in time')), WRITE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.guardedWrite(key, sent, id), late]);
      entry.base = id;
      entry.acked = this.docs[key] === sent;
      this.deps.drafts?.clear(key);
    } catch (error) {
      if (error instanceof ChangedElsewhere) entry.conflict = true;
      else this.error = messageOf(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async guardedWrite(key: DocKey, doc: QueueDocs[DocKey], id: string) {
    const stored = stampOf(await this.deps.read(NAMES[key]));
    if (stored.id !== this.entries[key].base && stored.writer !== this.writer) throw new ChangedElsewhere();
    await this.deps.write(NAMES[key], { ...doc, write_id: id, writer: this.writer });
  }

  /** Writes what is unsaved now. True when nothing is left to save afterwards. */
  async flush(): Promise<boolean> {
    this.cancelQuiet();
    for (let round = 0; round < MAX_FLUSH_ROUNDS && !this.disposed; round += 1) {
      if (this.attempt) await this.attempt;
      else if (DOC_KEYS.some(key => this.dirty(key))) await this.start();
      else break;
      if (this.error !== null || DOC_KEYS.some(key => this.entries[key].conflict)) break;
    }
    return !this.disposed && DOC_KEYS.every(key => this.entries[key].acked);
  }

  /** Makes kept drafts the local documents, to be saved like any edit. */
  restore(drafts: readonly Draft[]) {
    for (const draft of drafts) {
      this.docs = { ...this.docs, [draft.key]: draft.doc };
      this.entries[draft.key].acked = false;
    }
    this.scheduleQuiet();
    this.publish();
  }

  /** Keeps what Home Assistant has not acknowledged where the next visit can offer it back. */
  saveDrafts() {
    for (const key of DOC_KEYS) if (!this.entries[key].acked) this.deps.drafts?.save(key, this.entries[key].base, this.docs[key]);
  }

  dispose() {
    this.saveDrafts();
    this.disposed = true;
    this.cancelQuiet();
    this.listeners.clear();
  }
}
