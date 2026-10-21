import { HOME_CALENDAR } from '../../src/energy/period';
import type { Period } from '../../src/energy/types';
import { HaError, type Fixture, type StatRow, type WsMessage } from '../fixtures/types';

const FIVE_MINUTES = 300_000;
const HOUR = 3_600_000;
const MAX_BUCKETS = 20_000;

type Bucket = 'day' | 'week' | 'month';

function buckets(period: string, startMs: number, endMs: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (period === '5minute' || period === 'hour') {
    const step = period === 'hour' ? HOUR : FIVE_MINUTES;
    for (let at = Math.floor(startMs / step) * step; at < endMs && out.length < MAX_BUCKETS; at += step) out.push([at, at + step]);
    return out;
  }
  const unit = period as Bucket;
  for (let at = HOME_CALENDAR.startOf(unit as Period, startMs); at < endMs && out.length < MAX_BUCKETS; ) {
    const next = HOME_CALENDAR.step(unit as Period, at, 1);
    out.push([at, next]);
    at = next;
  }
  return out;
}

const TYPES: ReadonlyArray<keyof StatRow> = ['mean', 'min', 'max', 'state', 'sum', 'change'];

/** `recorder/statistics_during_period`: each requested statistic's buckets, with only the requested value types. */
export function statisticsDuringPeriod(fixture: Fixture, message: WsMessage): Record<string, unknown[]> {
  const startMs = Date.parse(String(message.start_time));
  const endMs = message.end_time ? Date.parse(String(message.end_time)) : fixture.now + HOUR;
  const wanted = (Array.isArray(message.types) ? message.types : TYPES) as ReadonlyArray<keyof StatRow>;
  const response: Record<string, unknown[]> = {};
  for (const id of (message.statistic_ids as string[] | undefined) ?? []) {
    const source = fixture.statistics[id];
    if (!source) continue;
    const rows: unknown[] = [];
    for (const [start, end] of buckets(String(message.period), startMs, endMs)) {
      const fine = message.period === 'hour' || message.period === '5minute';
      if (fine ? end > fixture.now : start >= fixture.now) continue;
      const row = source(start, end);
      if (!row) continue;
      const picked: Record<string, number> = {};
      for (const type of wanted) if (row[type] !== undefined) picked[type] = row[type];
      rows.push({ start, end, ...picked });
    }
    response[id] = rows;
  }
  return response;
}

/** `recorder/list_statistic_ids`: the statistics the fixture has, by source. */
export function listStatisticIds(fixture: Fixture): unknown[] {
  return Object.keys(fixture.statistics).map(statistic_id => ({
    statistic_id,
    source: statistic_id.includes(':') ? statistic_id.split(':')[0] : 'recorder',
    has_sum: true,
    has_mean: false,
    name: null,
    unit_of_measurement: null,
    display_unit_of_measurement: null,
    statistics_unit_of_measurement: null,
    unit_class: null,
  }));
}

interface Recorded {
  state: string;
  attributes: Record<string, unknown>;
  at: number;
}

function recorded(fixture: Fixture, entityId: string, startMs: number, endMs: number): Recorded[] {
  const points = fixture.history[entityId];
  const seed = fixture.states.get(entityId);
  if (!points)
    return seed && seed.lastChanged <= endMs
      ? [{ state: seed.state, attributes: seed.attributes, at: Math.max(startMs, seed.lastChanged) }]
      : [];
  const out: Recorded[] = [];
  let before: Recorded | null = null;
  for (const point of points) {
    const entry = { state: point.state, attributes: point.attributes ?? seed?.attributes ?? {}, at: point.t };
    if (point.t < startMs) before = entry;
    else if (point.t <= endMs) out.push(entry);
  }
  if (before) out.unshift({ ...before, at: startMs });
  return out;
}

/** `history/history_during_period`, in the abbreviated shape Home Assistant sends with `minimal_response`. */
export function historyDuringPeriod(fixture: Fixture, message: WsMessage): Record<string, unknown[]> {
  const startMs = Date.parse(String(message.start_time));
  const endMs = message.end_time ? Date.parse(String(message.end_time)) : fixture.now;
  const full = message.no_attributes === false || message.minimal_response === false;
  const response: Record<string, unknown[]> = {};
  for (const id of (message.entity_ids as string[] | undefined) ?? []) {
    response[id] = recorded(fixture, id, startMs, endMs).map(entry =>
      full ? { s: entry.state, a: entry.attributes, lu: entry.at / 1000 } : { s: entry.state, lu: entry.at / 1000 }
    );
  }
  return response;
}

/** `/api/history/period/<start>`: one array per entity, as the REST API returns them. */
export function historyPeriod(fixture: Fixture, path: string, query: URLSearchParams): unknown[][] {
  const startMs = Date.parse(decodeURIComponent(path.split('/api/history/period/')[1] ?? ''));
  if (!Number.isFinite(startMs)) throw new HaError('invalid_format', 'Invalid start time');
  const endMs = query.get('end_time') ? Date.parse(String(query.get('end_time'))) : fixture.now;
  const ids = (query.get('filter_entity_id') ?? '').split(',').filter(Boolean);
  return ids
    .map(id =>
      recorded(fixture, id, startMs, endMs).map(entry => ({
        entity_id: id,
        state: entry.state,
        attributes: entry.attributes,
        last_changed: new Date(entry.at).toISOString(),
        last_updated: new Date(entry.at).toISOString(),
      }))
    )
    .filter(list => list.length > 0);
}
