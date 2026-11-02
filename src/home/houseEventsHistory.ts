/** Rows of the `sensor.house_events` feed older than the 40 the live entity holds, read back from the HA recorder. The
 * recorder keeps the whole `events` attribute on every state change, so the rows of all the states in a window together
 * are every row of that window, and the state at its start carries the rows before it. Pure, apart from the
 * connection it is handed. */
import type { Connection } from 'home-assistant-js-websocket';
import { parseHouseEvents, type HouseEvent } from './houseEvents';

/** How far back one page reaches from its end, in ms. */
export const HISTORY_PAGE_MS = 3 * 24 * 3_600_000;

/** How far past its end a page reaches. A row's state is written a few ms after the row's own time, so a row just
 * before a page's end can sit in a state just after it. */
export const HISTORY_OVERLAP_MS = 60_000;

const eventKey = (event: HouseEvent) => `${event.tsMs}|${event.text}`;

const newestFirst = (a: HouseEvent, b: HouseEvent) => b.tsMs - a.tsMs;

/** `primary` plus the rows of `secondary` it lacks, newest first. A row is the same row when its time and text are,
 * and `primary`'s copy stays. `primary` itself when nothing is added. */
export function mergeHouseEvents(primary: HouseEvent[], secondary: readonly HouseEvent[]): HouseEvent[] {
  const seen = new Set(primary.map(eventKey));
  const added = secondary.filter(event => {
    const key = eventKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return added.length === 0 ? primary : [...primary, ...added].sort(newestFirst);
}

/** The attributes of one history row, which comes compressed (`a`) from the websocket and in full (`attributes`) from
 * the REST API. A row has none when a minimal response strips them. */
function rowAttributes(row: unknown): Record<string, unknown> | null {
  if (typeof row !== 'object' || row === null) return null;
  const { a, attributes } = row as { a?: unknown; attributes?: unknown };
  const value = a ?? attributes;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export interface HistoryEvents {
  /** How many states of the entity the response holds. */
  states: number;
  /** The rows of all of them, once each, newest first. */
  events: HouseEvent[];
}

/** The rows in a `history/history_during_period` result for `entityId`, whose states come oldest first. When a row sits
 * in several states the newest state's copy wins, as the backend adds fields such as `by` to a row after the fact. */
export function houseEventsFromHistory(result: unknown, entityId: string): HistoryEvents {
  const states = typeof result === 'object' && result !== null ? (result as Record<string, unknown>)[entityId] : undefined;
  if (!Array.isArray(states)) return { states: 0, events: [] };
  const events = states.reduceRight<HouseEvent[]>(
    (all, state) => mergeHouseEvents(all, parseHouseEvents(rowAttributes(state)?.events)),
    []
  );
  return { states: states.length, events };
}

export interface HouseEventsPage extends HistoryEvents {
  /** Where the next, older page ends. */
  nextCursorMs: number;
}

/** The page of history that ends at `cursorMs`. No states means the entity has none yet at that time, so nothing
 * older exists. The window starts with the entity's state at its start, so a window in which nothing changed still
 * returns the rows then. */
export async function fetchHouseEventsPage(
  connection: Pick<Connection, 'sendMessagePromise'>,
  entityId: string,
  cursorMs: number
): Promise<HouseEventsPage> {
  const startMs = cursorMs - HISTORY_PAGE_MS;
  const result = await connection.sendMessagePromise<unknown>({
    type: 'history/history_during_period',
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(cursorMs + HISTORY_OVERLAP_MS).toISOString(),
    entity_ids: [entityId],
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: false,
    no_attributes: false,
  });
  return { ...houseEventsFromHistory(result, entityId), nextCursorMs: startMs };
}
