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

function normalizeHistory(entries: RawHistoryEntry[] | undefined): TempPoint[] {
  if (!entries?.length) return [];
  const points: TempPoint[] = [];
  let lastTs = Date.now();
  for (const entry of entries) {
    const value = Number(entry.s ?? entry.state);
    const ts = entryTimestampMs(entry, lastTs);
    lastTs = ts;
    if (Number.isFinite(value)) points.push({ ts, value });
  }
  return points;
}

/** 24h path: HA's history endpoint on this instance only ever returns ~24h of data from
 * start_time no matter how far back it's asked to go (see memory: ha-history-api-24h-cap), so it
 * is only used for the range it's actually good for. */
async function fetchHistory24h(conn: Connection, entityId: string, nowMs: number): Promise<TempPoint[]> {
  const response = await conn.sendMessagePromise<Record<string, RawHistoryEntry[]>>({
    type: 'history/history_during_period',
    start_time: new Date(rangeStartMs('24h', nowMs)).toISOString(),
    end_time: new Date(nowMs).toISOString(),
    entity_ids: [entityId],
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  return normalizeHistory(response?.[entityId]);
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

/** Fetches one entity's temperature series for the given range, serving a 5-minute in-memory
 * cache (per entity+range) when fresh. A failed fetch is never cached, so the next sheet-open
 * retries instead of sticking with an error. */
export function fetchTemperatureSeries(conn: Connection, entityId: string, range: TemperatureRange): Promise<TempPoint[]> {
  const key = cacheKey(entityId, range);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = (range === '24h' ? fetchHistory24h(conn, entityId, now) : fetchStatistics7d(conn, entityId, now)).catch(err => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { fetchedAt: now, promise });
  return promise;
}
