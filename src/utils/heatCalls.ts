import type { Connection } from 'home-assistant-js-websocket';
import type { HassEntity } from '../types';
import { HEATING_ZONES, zoneCallSensorId, type HeatingZone } from './heating';

/** One change of a zone's `heating_active` sensor: from `ts` on, the zone does (or does not) call for heat. */
export interface CallPoint {
  ts: number;
  on: boolean;
}

/** A stretch of time in which a zone called for heat. */
export interface CallSegment {
  startMs: number;
  endMs: number;
}

/** A segment as a share of the day, in percent. */
export interface CallSpan {
  left: number;
  width: number;
}

/** Midnight to midnight on the viewer's clock, so a day with a clock change is as long as it really was. */
export interface LocalDay {
  startMs: number;
  endMs: number;
}

export function localDay(nowMs: number): LocalDay {
  const now = new Date(nowMs);
  const [year, month, date] = [now.getFullYear(), now.getMonth(), now.getDate()];
  return { startMs: new Date(year, month, date).getTime(), endMs: new Date(year, month, date + 1).getTime() };
}

/** A history row, in the compressed shape of the websocket (`s`, `lu`, `lc`) or the full one of the REST API. */
interface HistoryRow {
  s?: unknown;
  state?: unknown;
  lu?: unknown;
  lc?: unknown;
  last_updated?: unknown;
  last_changed?: unknown;
}

function rowMs(row: HistoryRow): number | null {
  const raw = row.lu ?? row.lc ?? row.last_updated ?? row.last_changed;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000; // `lu` and `lc` are unix seconds
  if (typeof raw === 'string') {
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** The changes in one entity's history rows, oldest first. Anything but `on` (off, unavailable, unknown) is not calling. */
export function callPointsOf(rows: unknown): CallPoint[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: HistoryRow) => {
    const ts = typeof row === 'object' && row !== null ? rowMs(row) : null;
    return ts == null ? [] : [{ ts, on: (row.s ?? row.state) === 'on' }];
  });
}

/** Today's `heating_active` history of every zone, in one websocket call. A zone without history has no entry. */
export async function fetchCallPoints(
  connection: Pick<Connection, 'sendMessagePromise'>,
  startMs: number,
  endMs: number
): Promise<Partial<Record<HeatingZone, CallPoint[]>>> {
  const response = await connection.sendMessagePromise<Record<string, unknown> | null>({
    type: 'history/history_during_period',
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    entity_ids: HEATING_ZONES.map(zoneCallSensorId),
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: true,
    no_attributes: true,
  });
  const points: Partial<Record<HeatingZone, CallPoint[]>> = {};
  for (const zone of HEATING_ZONES) {
    const zonePoints = callPointsOf(response?.[zoneCallSensorId(zone)]);
    if (zonePoints.length > 0) points[zone] = zonePoints;
  }
  return points;
}

/** The sensor's current state as a point, null when it is missing. */
export function liveCallPoint(sensor: HassEntity | undefined): CallPoint | null {
  if (!sensor) return null;
  const ts = sensor.last_changed ? new Date(sensor.last_changed).getTime() : NaN;
  return Number.isFinite(ts) ? { ts, on: sensor.state === 'on' } : null;
}

/** `history` brought up to the sensor's live state: a change after the last row is added, so a call that started or
 * ended since the history was read shows at once. */
export function withLiveCall(history: readonly CallPoint[], live: CallPoint | null): CallPoint[] {
  const last = history[history.length - 1];
  if (!live || last?.on === live.on) return [...history];
  return [...history, { ts: Math.max(live.ts, last?.ts ?? live.ts), on: live.on }];
}

/** The stretches called within [startMs, endMs]. A call still on at the end runs to `endMs`, which is how the live
 * state extends the last segment to now. */
export function callSegments(points: readonly CallPoint[], startMs: number, endMs: number): CallSegment[] {
  const segments: CallSegment[] = [];
  let from: number | null = null;
  for (const { ts, on } of points) {
    const at = Math.min(Math.max(ts, startMs), endMs);
    if (on && from == null) {
      from = at;
    } else if (!on && from != null) {
      if (at > from) segments.push({ startMs: from, endMs: at });
      from = null;
    }
  }
  if (from != null && endMs > from) segments.push({ startMs: from, endMs });
  return segments;
}

/** One zone's calls today: its history up to the live state of its sensor, ending at `nowMs`. */
export function zoneCallSegments(history: readonly CallPoint[] | undefined, sensor: HassEntity | undefined, day: LocalDay, nowMs: number) {
  return callSegments(withLiveCall(history ?? [], liveCallPoint(sensor)), day.startMs, nowMs);
}

/** Each segment as a left edge and a width, in percent of the day. */
export function callSpans(segments: readonly CallSegment[], day: LocalDay): CallSpan[] {
  const length = day.endMs - day.startMs;
  return segments.map(({ startMs, endMs }) => ({
    left: ((startMs - day.startMs) / length) * 100,
    width: ((endMs - startMs) / length) * 100,
  }));
}
