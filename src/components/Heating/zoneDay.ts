import type { Connection } from 'home-assistant-js-websocket';
import {
  callPointsOf,
  callSegments,
  callSpans,
  localDay,
  type CallPoint,
  type CallSegment,
  type CallSpan,
  type LocalDay,
} from '../../utils/heatCalls';
import { KW_FIT, zoneKwh } from '../../utils/heatEnergy';
import { zoneCallSensorId, zoneSensorId, type HeatingZone } from '../../utils/heating';
import { normalizeHistory, type RawHistoryEntry, type TempPoint } from '../../utils/temperatureHistory';

/** How many days back the zone sheet lets you go. */
export const MAX_DAYS_BACK = 30;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The local day `count` calendar days after `day` (before it when negative), midnight to midnight. */
export function shiftDay(day: LocalDay, count: number): LocalDay {
  const start = new Date(day.startMs);
  return localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + count, 12).getTime());
}

/** Whole days from `day` to `today`: 0 for today, 1 for yesterday. */
export const daysBefore = (day: LocalDay, today: LocalDay): number => Math.round((today.startMs - day.startMs) / DAY_MS);

/** "Today", "Yesterday", else the weekday and date: "Mon 2 Nov". */
export function dayLabel(day: LocalDay, today: LocalDay): string {
  const back = daysBefore(day, today);
  if (back <= 0) return 'Today';
  if (back === 1) return 'Yesterday';
  const date = new Date(day.startMs);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export interface AirSource {
  entityId: string;
  /** The controller's weight for this room in the zone's control air. */
  weight: number;
}

/** The feel sensors a zone steers by (the controller's `control_air` and its weights). */
export const ZONE_AIR: Record<HeatingZone, readonly AirSource[]> = {
  family: [
    { entityId: 'sensor.living_room_feel', weight: 19 },
    { entityId: 'sensor.dining_room_feel', weight: 18.5 },
    { entityId: 'sensor.kitchen_feel', weight: 18.5 },
  ],
  kristines_room: [{ entityId: 'sensor.kristines_room_feel', weight: 1 }],
  claudias_room: [{ entityId: 'sensor.claudias_room_feel', weight: 1 }],
  bathroom: [{ entityId: 'sensor.bathroom_feel', weight: 1 }],
  guest_bathroom: [{ entityId: 'sensor.guest_bathroom_feel', weight: 1 }],
};

/** The floor thermometers of a zone; the controller judges the warmest one. */
export const ZONE_FLOORS: Record<HeatingZone, readonly string[]> = {
  family: ['sensor.living_room_floor_thermometer_temperature', 'sensor.dining_room_floor_thermometer_temperature'],
  kristines_room: ['sensor.kristines_room_floor_thermometer_temperature'],
  claudias_room: ['sensor.claudias_room_floor_thermometer_temperature'],
  bathroom: ['sensor.bathroom_floor_thermometer_temperature'],
  guest_bathroom: ['sensor.guest_bathroom_floor_thermometer_temperature'],
};

export interface Reading {
  value: number;
  weight: number;
}

export interface SeriesPart {
  points: readonly TempPoint[];
  weight: number;
}

/** The mean of the readings, each counted by its weight. */
export const weightedMean = (readings: readonly Reading[]): number => {
  const total = readings.reduce((sum, reading) => sum + reading.weight, 0);
  return readings.reduce((sum, reading) => sum + reading.value * reading.weight, 0) / total;
};

export const highest = (readings: readonly Reading[]): number => Math.max(...readings.map(reading => reading.value));

/** One series from several sensors that each hold their value until they change: at every moment any of them changes,
 * the latest readings of those that have started are combined. A sensor that has not read yet leaves the others to
 * carry the value, as the controller's own mean does. Points that repeat the previous value are dropped. */
export function mergeSeries(parts: readonly SeriesPart[], combine: (readings: readonly Reading[]) => number): TempPoint[] {
  const times = [...new Set(parts.flatMap(part => part.points.map(point => point.ts)))].sort((a, b) => a - b);
  const reached = parts.map(() => 0);
  const merged: TempPoint[] = [];
  for (const ts of times) {
    const readings: Reading[] = [];
    parts.forEach((part, index) => {
      while (reached[index] < part.points.length && part.points[reached[index]].ts <= ts) reached[index] += 1;
      if (reached[index] > 0) readings.push({ value: part.points[reached[index] - 1].value, weight: part.weight });
    });
    const value = combine(readings);
    if (merged.length === 0 || merged[merged.length - 1].value !== value) merged.push({ ts, value });
  }
  return merged;
}

const changesOnly = (points: readonly TempPoint[]): TempPoint[] =>
  points.filter((point, index) => index === 0 || point.value !== points[index - 1].value);

/** The series carried on at its last value to `endMs`. */
export function holdUntil(points: readonly TempPoint[], endMs: number): TempPoint[] {
  const last = points[points.length - 1];
  return last && last.ts < endMs ? [...points, { ts: endMs, value: last.value }] : [...points];
}

/** The value a held series has at `ts`: its latest point at or before it, null before its first. */
export function valueAt(points: readonly TempPoint[], ts: number): number | null {
  let low = 0;
  let high = points.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].ts <= ts) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found < 0 ? null : points[found].value;
}

export const callingAt = (segments: readonly CallSegment[], ts: number): boolean =>
  segments.some(segment => segment.startMs <= ts && ts < segment.endMs);

export interface DaySummary {
  /** Hours the zone called for heat; null when its call sensor has no history. */
  hours: number | null;
  /** Estimated district heat of those hours; null without hours and for a zone the meter cannot see. */
  kwh: number | null;
  airMinC: number | null;
  airMaxC: number | null;
}

export function daySummary(zone: HeatingZone, segments: readonly CallSegment[] | null, air: readonly TempPoint[]): DaySummary {
  const hours = segments ? segments.reduce((sum, segment) => sum + (segment.endMs - segment.startMs), 0) / HOUR_MS : null;
  const values = air.map(point => point.value);
  return {
    hours,
    kwh: hours != null && KW_FIT[zone] > 0 ? zoneKwh(zone, hours) : null,
    airMinC: values.length > 0 ? Math.min(...values) : null,
    airMaxC: values.length > 0 ? Math.max(...values) : null,
  };
}

/** Low, middle and high gridline of a chart that must hold [minC, maxC] with a little headroom; whole degrees, evenly
 * spaced. */
export function temperatureTicks(minC: number, maxC: number): [number, number, number] {
  let low = minC;
  let high = maxC;
  if (low === high) {
    low -= 1;
    high += 1;
  }
  const pad = Math.max(0.5, (high - low) * 0.18);
  low = Math.floor(low - pad);
  high = Math.ceil(high + pad);
  if ((high - low) % 2 !== 0) high += 1;
  return [low, (low + high) / 2, high];
}

export interface PlotPoint {
  x: number;
  y: number;
}

const at = (point: PlotPoint) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;

export const linePath = (points: readonly PlotPoint[]): string => points.map((point, i) => `${i === 0 ? 'M' : 'L'}${at(point)}`).join(' ');

/** A step line: level to each new x at the old height, then straight to the new one, and on to `endX`. */
export function stepPath(points: readonly PlotPoint[], endX: number): string {
  if (points.length === 0) return '';
  const steps = points.map((point, i) => (i === 0 ? `M${at(point)}` : `H${point.x.toFixed(1)} V${point.y.toFixed(1)}`));
  return `${steps.join(' ')} H${endX.toFixed(1)}`;
}

/** What one day of one zone leaves in the recorder. */
export interface ZoneDayData {
  calls: CallPoint[];
  /** The zone's control air: the weighted mean of its feel sensors. */
  air: TempPoint[];
  target: TempPoint[];
  /** The warmest of the zone's floor thermometers. */
  floor: TempPoint[];
}

export const zoneDayEntities = (zone: HeatingZone): string[] => [
  zoneCallSensorId(zone),
  zoneSensorId(zone),
  ...ZONE_AIR[zone].map(source => source.entityId),
  ...ZONE_FLOORS[zone],
];

/** A zone's call sensor, target, air and floor between the start of `day` and `endMs`, in one websocket call. */
export async function fetchZoneDay(
  connection: Pick<Connection, 'sendMessagePromise'>,
  zone: HeatingZone,
  day: LocalDay,
  endMs: number
): Promise<ZoneDayData> {
  const response = await connection.sendMessagePromise<Record<string, RawHistoryEntry[]> | null>({
    type: 'history/history_during_period',
    start_time: new Date(day.startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    entity_ids: zoneDayEntities(zone),
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: true,
    no_attributes: true,
  });
  const series = (entityId: string) => normalizeHistory(response?.[entityId]);
  return {
    calls: callPointsOf(response?.[zoneCallSensorId(zone)]),
    air: mergeSeries(
      ZONE_AIR[zone].map(source => ({ points: series(source.entityId), weight: source.weight })),
      weightedMean
    ),
    target: changesOnly(series(zoneSensorId(zone))),
    floor: mergeSeries(
      ZONE_FLOORS[zone].map(entityId => ({ points: series(entityId), weight: 1 })),
      highest
    ),
  };
}

const MAX_CACHED_DAYS = 64;
const finishedDays = new Map<string, Promise<ZoneDayData>>();

export const clearZoneDayCache = () => finishedDays.clear();

const isBlank = (data: ZoneDayData) => !data.calls.length && !data.air.length && !data.target.length && !data.floor.length;

/** `fetchZoneDay` for a day that is over, remembered because it cannot change; a failed or empty read is not. A day
 * still running is read up to `nowMs` every time. */
export function loadZoneDay(
  connection: Pick<Connection, 'sendMessagePromise'>,
  zone: HeatingZone,
  day: LocalDay,
  nowMs: number
): Promise<ZoneDayData> {
  if (day.endMs > nowMs) return fetchZoneDay(connection, zone, day, nowMs);
  const key = `${zone}|${day.startMs}`;
  const cached = finishedDays.get(key);
  if (cached) return cached;
  const request = fetchZoneDay(connection, zone, day, day.endMs).then(
    data => {
      if (isBlank(data)) finishedDays.delete(key);
      return data;
    },
    (error: unknown) => {
      finishedDays.delete(key);
      throw error;
    }
  );
  finishedDays.set(key, request);
  if (finishedDays.size > MAX_CACHED_DAYS) {
    const oldest = finishedDays.keys().next().value;
    if (oldest !== undefined) finishedDays.delete(oldest);
  }
  return request;
}

export interface ZoneDayView {
  air: TempPoint[];
  target: TempPoint[];
  floor: TempPoint[];
  segments: CallSegment[];
  spans: CallSpan[];
  summary: DaySummary;
}

/** The day ready to draw: every series carried on to `untilMs` (now for today, else the end of the day), the call
 * stretches as shares of the day, and the summary figures. */
export function zoneDayView(zone: HeatingZone, data: ZoneDayData, day: LocalDay, untilMs: number): ZoneDayView {
  const end = Math.min(untilMs, day.endMs);
  const air = holdUntil(data.air, end);
  const segments = callSegments(data.calls, day.startMs, end);
  return {
    air,
    target: holdUntil(data.target, end),
    floor: holdUntil(data.floor, end),
    segments,
    spans: callSpans(segments, day),
    summary: daySummary(zone, data.calls.length > 0 ? segments : null, air),
  };
}
