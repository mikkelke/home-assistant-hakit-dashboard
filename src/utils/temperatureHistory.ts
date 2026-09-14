import type { Connection } from 'home-assistant-js-websocket';

export type TemperatureRange = '24h' | '7d';

export interface TempPoint {
  ts: number; // epoch ms
  value: number; // °C
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const RANGE_WINDOW_MS: Record<TemperatureRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const cache = new Map<string, { fetchedAt: number; promise: Promise<TempPoint[]> }>();

function cacheKey(entityId: string, range: TemperatureRange): string {
  return `${entityId}|${range}`;
}

export function rangeStartMs(range: TemperatureRange, nowMs: number): number {
  return nowMs - RANGE_WINDOW_MS[range];
}

/** history/history_during_period entry - either its full shape or the abbreviated one HA sends
 * for every state after the first when `minimal_response` is set (state -> `s`, last_updated -> `lu`). */
interface RawHistoryEntry {
  state?: string;
  attributes?: Record<string, unknown>;
  last_updated?: string;
  last_changed?: string;
  s?: string;
  lu?: number;
  lc?: number;
}

function entryTimestampMs(entry: RawHistoryEntry, fallbackMs: number): number {
  const raw: string | number | undefined = entry.lu ?? entry.last_updated ?? entry.lc ?? entry.last_changed;
  if (raw == null) return fallbackMs;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000; // `lu`/`lc` are unix seconds
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function toFiniteNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** `attribute` set reads that attribute off each entry instead of its state - used for a fallback
 * entity whose state isn't the temperature (e.g. a climate.*'s hvac mode). */
function normalizeHistory(entries: RawHistoryEntry[] | undefined, attribute?: string | null): TempPoint[] {
  if (!entries?.length) return [];
  const points: TempPoint[] = [];
  let lastTs = Date.now();
  for (const entry of entries) {
    const value = toFiniteNumber(attribute ? entry.attributes?.[attribute] : (entry.s ?? entry.state));
    const ts = entryTimestampMs(entry, lastTs);
    lastTs = ts;
    if (value != null) points.push({ ts, value });
  }
  return points;
}

/** 24h path: HA's history endpoint on this instance only ever returns ~24h of data from
 * start_time no matter how far back it's asked to go, so it is only used for the range it's
 * actually good for. */
async function fetchHistory24h(conn: Connection, entityId: string, nowMs: number, attribute?: string | null): Promise<TempPoint[]> {
  const response = await conn.sendMessagePromise<Record<string, RawHistoryEntry[]>>({
    type: 'history/history_during_period',
    start_time: new Date(rangeStartMs('24h', nowMs)).toISOString(),
    end_time: new Date(nowMs).toISOString(),
    entity_ids: [entityId],
    minimal_response: !attribute,
    no_attributes: !attribute,
    significant_changes_only: false,
  });
  return normalizeHistory(response?.[entityId], attribute);
}

interface RawStatisticValue {
  start: number;
  mean?: number | null;
}

/** 7d path: hourly recorder statistics (mean) rather than raw history - the endpoint above can't
 * reach back a full week on this instance. */
async function fetchStatistics7d(conn: Connection, entityId: string, nowMs: number): Promise<TempPoint[]> {
  const response = await conn.sendMessagePromise<Record<string, RawStatisticValue[]>>({
    type: 'recorder/statistics_during_period',
    start_time: new Date(rangeStartMs('7d', nowMs)).toISOString(),
    end_time: new Date(nowMs).toISOString(),
    statistic_ids: [entityId],
    period: 'hour',
    types: ['mean'],
  });
  const entries = response?.[entityId] ?? [];
  const points: TempPoint[] = [];
  for (const entry of entries) {
    if (typeof entry.mean === 'number' && Number.isFinite(entry.mean)) {
      points.push({ ts: entry.start, value: entry.mean });
    }
  }
  return points;
}

function withCache(key: string, now: number, run: () => Promise<TempPoint[]>): Promise<TempPoint[]> {
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = run().catch(err => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { fetchedAt: now, promise });
  return promise;
}

/** Fetches one entity's temperature series for the given range, serving a 5-minute in-memory
 * cache (per entity+range) when fresh. A failed fetch is never cached, so the next sheet-open
 * retries instead of sticking with an error. */
export function fetchTemperatureSeries(conn: Connection, entityId: string, range: TemperatureRange): Promise<TempPoint[]> {
  const now = Date.now();
  return withCache(cacheKey(entityId, range), now, () =>
    range === '24h' ? fetchHistory24h(conn, entityId, now) : fetchStatistics7d(conn, entityId, now)
  );
}

/** Where to read a room's longer history when its own series is too sparse - the feel sensor's
 * `history_entity`/`history_attribute` attributes (see roomFeel.ts). `attribute` is set only when
 * the fallback entity's state isn't the temperature (a climate.*'s hvac mode). */
export interface HistoryFallback {
  entityId: string;
  attribute: string | null;
}

const FALLBACK_TRIGGER_POINTS = 8;

/** The fallback entity's own series. An `attribute` fallback (a climate.*) has no recorder
 * statistics and needs attributes kept in the response, so it always goes through the one
 * 24h-style, attribute-aware call regardless of range - the 7d chart just renders whatever that
 * returns, under its own label. A plain-sensor fallback uses statistics for 7d like any other
 * entity, dropping to that same 24h-style call only if those statistics come back empty. */
async function fetchFallbackSeries(
  conn: Connection,
  fallback: HistoryFallback,
  range: TemperatureRange,
  nowMs: number
): Promise<TempPoint[]> {
  if (fallback.attribute) {
    const key = `${fallback.entityId}|24h|${fallback.attribute}`;
    return withCache(key, nowMs, () => fetchHistory24h(conn, fallback.entityId, nowMs, fallback.attribute));
  }
  if (range === '24h') return fetchTemperatureSeries(conn, fallback.entityId, '24h');
  const stats = await fetchTemperatureSeries(conn, fallback.entityId, '7d');
  return stats.length > 0 ? stats : fetchTemperatureSeries(conn, fallback.entityId, '24h');
}

/** A room chart's primary series: the fused feel sensor, falling back to its longer-lived source
 * entity (fetchFallbackSeries above) when the feel sensor doesn't yet have enough recorder
 * history. Picks whichever of the two comes back richer rather than always preferring the
 * fallback, so a room keeps its own feel series once it has one. */
export async function fetchRoomTemperatureSeries(
  conn: Connection,
  entityId: string,
  fallback: HistoryFallback | null,
  range: TemperatureRange
): Promise<TempPoint[]> {
  const primary = await fetchTemperatureSeries(conn, entityId, range);
  if (!fallback || fallback.entityId === entityId || primary.length >= FALLBACK_TRIGGER_POINTS) return primary;
  const fallbackSeries = await fetchFallbackSeries(conn, fallback, range, Date.now());
  return fallbackSeries.length > primary.length ? fallbackSeries : primary;
}
