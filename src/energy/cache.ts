/** Three-layer cache for the Energy page's statistics fetches — pure module, no React, no clock
 * reads of its own (every function that needs "now" takes an explicit `nowMs` arg, mirroring
 * period.ts/assemble.ts's purity conventions).
 *
 * L1 — a module-scoped `Map`: fastest, cleared on a full page reload, holds every period
 * (current/previous included) so reopening the page repaints instantly from whatever was last
 * fetched (stale-while-revalidate).
 * L2 — in-flight promise dedupe plus a short "just resolved" guard: collapses concurrent or
 * rapid-repeat callers of the same fetch (e.g. the `ready` and `visibilitychange` listeners firing
 * within moments of each other) into a single network call.
 * L3 — `localStorage`, namespaced `energyv1:`, surviving a reload. The caller only ever persists
 * here for periods it has determined are immutable (see `isImmutablePeriod` in period.ts) — a
 * current or previous period is never written to L3. Every access is wrapped in try/catch: a full
 * or blocked store degrades silently to "no L3" rather than breaking the page. */

export interface CacheEntry<T> {
  key: string;
  storedAtMs: number;
  value: T;
}

// ---------------------------------------------------------------------------------------------
// L1 — in-memory, module-scoped.
// ---------------------------------------------------------------------------------------------

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): CacheEntry<T> | null {
  const entry = memoryCache.get(key);
  return entry ? (entry as CacheEntry<T>) : null;
}

export function setCached<T>(key: string, value: T, nowMs: number): void {
  memoryCache.set(key, { key, storedAtMs: nowMs, value });
}

/** Force-reload path: L1 has no TTL, so a force-refresh of an already-cached immutable period
 * must drop this too — clearing only L3 would leave the L1 hit still short-circuiting the fetch. */
export function clearCached(key: string): void {
  memoryCache.delete(key);
}

// ---------------------------------------------------------------------------------------------
// L2 — in-flight promise dedupe + a short "just resolved" guard.
// ---------------------------------------------------------------------------------------------

/** A caller landing within this window of a previous successful resolution gets that same value
 * instead of triggering a new fetch — specifically coalesces the `ready` and `visibilitychange`
 * listeners, which can both fire within a moment of each other after the app resumes. */
const RECENT_RESOLUTION_WINDOW_MS = 2000;

const inFlightFetches = new Map<string, Promise<unknown>>();
const recentResolutions = new Map<string, { value: unknown; resolvedAtMs: number }>();

/** Shares one promise per `key` while it's pending; once resolved, a call for the same key within
 * `RECENT_RESOLUTION_WINDOW_MS` (measured against the `nowMs` the caller passes in) gets that
 * resolved value straight back without invoking `fn` again. Failures clear the in-flight slot
 * immediately — there's no negative caching, so the very next call retries for real. */
export function dedupeFetch<T>(key: string, nowMs: number, fn: () => Promise<T>): Promise<T> {
  const inFlight = inFlightFetches.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const recent = recentResolutions.get(key);
  if (recent && nowMs - recent.resolvedAtMs < RECENT_RESOLUTION_WINDOW_MS) {
    return Promise.resolve(recent.value as T);
  }

  const promise = fn().then(
    value => {
      inFlightFetches.delete(key);
      recentResolutions.set(key, { value, resolvedAtMs: nowMs });
      return value;
    },
    (err: unknown) => {
      inFlightFetches.delete(key); // no negative caching — the next call retries immediately
      throw err;
    }
  );

  inFlightFetches.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------------------------
// L3 — localStorage, closed periods only (caller decides via isImmutablePeriod).
// ---------------------------------------------------------------------------------------------

const STORAGE_PREFIX = 'energyv1:';
const STORAGE_LRU_CAP = 40;

interface PersistedRecord<T> {
  storedAtMs: number;
  value: T;
}

/** Every localStorage touch — even the `window.localStorage` getter itself, which can throw in a
 * locked-down/private-mode WebView — goes through here so a full or blocked store silently
 * degrades to "no L3" instead of breaking the page. */
function withStorage<R>(fn: (storage: Storage) => R): R | undefined {
  try {
    return fn(window.localStorage);
  } catch {
    return undefined;
  }
}

function namespacedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  return keys;
}

/** Evicts the oldest `energyv1:` entry (by its own persisted `storedAtMs`) once a genuinely new
 * key would push the namespace past the LRU cap — overwriting an already-present key is never an
 * eviction. A corrupt entry (fails to parse) is evicted first, on the assumption it's worthless. */
function evictOldestIfAtCap(storage: Storage, incomingKey: string): void {
  const keys = namespacedKeys(storage);
  if (keys.includes(incomingKey) || keys.length < STORAGE_LRU_CAP) return;

  let oldestKey: string | null = null;
  let oldestAtMs = Infinity;
  for (const k of keys) {
    const raw = storage.getItem(k);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as PersistedRecord<unknown>;
      if (typeof parsed.storedAtMs === 'number' && parsed.storedAtMs < oldestAtMs) {
        oldestAtMs = parsed.storedAtMs;
        oldestKey = k;
      }
    } catch {
      oldestKey = k; // corrupt entry — evict it first rather than keep hunting for the true oldest
      break;
    }
  }
  if (oldestKey) storage.removeItem(oldestKey);
}

/** Persists `value` for a period the caller has already determined is immutable. */
export function persistClosed<T>(key: string, value: T, nowMs: number): void {
  withStorage(storage => {
    evictOldestIfAtCap(storage, key);
    const record: PersistedRecord<T> = { storedAtMs: nowMs, value };
    storage.setItem(key, JSON.stringify(record));
  });
}

export function readPersisted<T>(key: string): CacheEntry<T> | null {
  const entry = withStorage(storage => {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistedRecord<T>;
    if (typeof parsed.storedAtMs !== 'number') return undefined;
    return { key, storedAtMs: parsed.storedAtMs, value: parsed.value };
  });
  return entry ?? null;
}

/** Force-reload path: drop one persisted entry so the next fetch is guaranteed to hit the network. */
export function clearPersisted(key: string): void {
  withStorage(storage => storage.removeItem(key));
}

// ---------------------------------------------------------------------------------------------
// Cache keys.
// ---------------------------------------------------------------------------------------------

export function statsCacheKey(idsHash: string, period: string, startMs: number, kind: 'view' | 'dev'): string {
  return `${STORAGE_PREFIX}${kind}:${idsHash}:${period}:${startMs}`;
}

/** Short, stable djb2 hash (hex) of a joined id list — folds a config's statistic ids into the
 * cache key so an id-list change (a device added/removed, a stat id changed) invalidates stale
 * entries by construction, without an explicit cache-bust step. */
export function hashIds(ids: string[]): string {
  const joined = ids.join(',');
  let hash = 5381;
  for (let i = 0; i < joined.length; i++) {
    hash = (hash * 33 + joined.charCodeAt(i)) | 0; // djb2: hash*33 + c, wrapped to 32-bit each step
  }
  return (hash >>> 0).toString(16); // unsigned so the hex string is always positive
}
