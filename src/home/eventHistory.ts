/** A few entities' recorded states over a past window, for a timeline row's detail sheet. HA's history
 * endpoint on this instance returns about a day from `start_time` at most, so a longer window is read
 * in day-long pieces. Answers are kept five minutes. */
import type { Connection } from 'home-assistant-js-websocket';
import type { RawHistoryEntry } from '../utils/temperatureHistory';

export interface HistoryPoint {
  ts: number;
  state: string;
}

const PIECE_MS = 23 * 3_600_000;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; promise: Promise<Record<string, HistoryPoint[]>> }>();

function entryMs(entry: RawHistoryEntry): number | null {
  const raw = entry.lu ?? entry.lc ?? entry.last_updated ?? entry.last_changed;
  if (raw == null) return null;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The raw entries of one entity as points, oldest first. The first entry of a piece is the state in
 * force at its start, so it is kept at its own time. */
export function toPoints(entries: readonly RawHistoryEntry[] | undefined): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const entry of entries ?? []) {
    const ts = entryMs(entry);
    const state = entry.s ?? entry.state;
    if (ts != null && typeof state === 'string') out.push({ ts, state });
  }
  return out;
}

/** Pieces of the window, each at most PIECE_MS. */
export function pieces(startMs: number, endMs: number): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  for (let from = startMs; from < endMs; from += PIECE_MS) out.push({ startMs: from, endMs: Math.min(endMs, from + PIECE_MS) });
  return out;
}

async function fetchWindow(conn: Connection, entityIds: string[], startMs: number, endMs: number): Promise<Record<string, HistoryPoint[]>> {
  const parts = await Promise.all(
    pieces(startMs, endMs).map(piece =>
      conn.sendMessagePromise<Record<string, RawHistoryEntry[]>>({
        type: 'history/history_during_period',
        start_time: new Date(piece.startMs).toISOString(),
        end_time: new Date(piece.endMs).toISOString(),
        entity_ids: entityIds,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      })
    )
  );
  const out: Record<string, HistoryPoint[]> = {};
  for (const id of entityIds) {
    const merged = parts.flatMap(part => toPoints(part?.[id]));
    merged.sort((a, b) => a.ts - b.ts);
    out[id] = merged.filter((p, i) => i === 0 || p.ts !== merged[i - 1].ts || p.state !== merged[i - 1].state);
  }
  return out;
}

/** The entities' states over [startMs, endMs]. A failed read is not kept, so the next open tries again. */
export function fetchEventHistory(
  conn: Connection,
  entityIds: string[],
  startMs: number,
  endMs: number
): Promise<Record<string, HistoryPoint[]>> {
  const key = `${entityIds.join(',')}|${Math.round(startMs / 60_000)}|${Math.round(endMs / 60_000)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetchWindow(conn, entityIds, startMs, endMs).catch(error => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: now, promise });
  return promise;
}

/** One state with its attributes. */
export interface AttributePoint {
  ts: number;
  attributes: Record<string, unknown>;
}

const attributeCache = new Map<string, { at: number; promise: Promise<AttributePoint[]> }>();

/** The raw entries of one entity with their attributes, oldest first. The websocket's compact form carries them as `a`. */
export function toAttributePoints(entries: readonly (RawHistoryEntry & { a?: Record<string, unknown> })[] | undefined): AttributePoint[] {
  const out: AttributePoint[] = [];
  for (const entry of entries ?? []) {
    const ts = entryMs(entry);
    const attributes = entry.a ?? entry.attributes;
    if (ts != null && attributes && typeof attributes === 'object') out.push({ ts, attributes });
  }
  return out;
}

/** One entity's states with attributes over [startMs, endMs], at most a day; kept five minutes like the states. */
export function fetchAttributeHistory(conn: Connection, entityId: string, startMs: number, endMs: number): Promise<AttributePoint[]> {
  const key = `${entityId}|${Math.round(startMs / 60_000)}|${Math.round(endMs / 60_000)}`;
  const now = Date.now();
  const hit = attributeCache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = conn
    .sendMessagePromise<Record<string, RawHistoryEntry[]>>({
      type: 'history/history_during_period',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(Math.min(endMs, startMs + PIECE_MS)).toISOString(),
      entity_ids: [entityId],
      minimal_response: false,
      no_attributes: false,
      significant_changes_only: false,
    })
    .then(answer => toAttributePoints(answer?.[entityId]))
    .catch(error => {
      attributeCache.delete(key);
      throw error;
    });
  attributeCache.set(key, { at: now, promise });
  return promise;
}
