import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import type { HassEntities } from '../../types';
import { callSegments, callSpans, fetchCallPoints, type CallPoint, type CallSpan, type LocalDay } from '../../utils/heatCalls';
import { HEATING_ZONES, zoneSensorId, type HeatingZone } from '../../utils/heating';

/** The first day the heating controller published its zone sensors. */
export const HEAT_RECORD_START = new Date(2026, 9, 17).getTime();

const HOUR_MS = 3_600_000;

interface SnapshotRow {
  s?: unknown;
  state?: unknown;
  a?: unknown;
  attributes?: unknown;
}

/** Each zone sensor as it stood at `atMs`, attributes included, in one websocket call. */
export async function fetchZoneSnapshots(
  connection: Pick<Connection, 'sendMessagePromise'>,
  atMs: number
): Promise<Partial<Record<HeatingZone, { state: string; attributes: Record<string, unknown> }>>> {
  const response = await connection.sendMessagePromise<Record<string, unknown> | null>({
    type: 'history/history_during_period',
    start_time: new Date(atMs - 1000).toISOString(),
    end_time: new Date(atMs).toISOString(),
    entity_ids: HEATING_ZONES.map(zoneSensorId),
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: false,
    no_attributes: false,
  });
  const snapshots: Partial<Record<HeatingZone, { state: string; attributes: Record<string, unknown> }>> = {};
  for (const zone of HEATING_ZONES) {
    const rows = response?.[zoneSensorId(zone)];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const row = rows[rows.length - 1] as SnapshotRow;
    const attributes = row.a ?? row.attributes;
    snapshots[zone] = {
      state: String(row.s ?? row.state ?? ''),
      attributes: typeof attributes === 'object' && attributes !== null ? (attributes as Record<string, unknown>) : {},
    };
  }
  return snapshots;
}

/** A finished day as the heat card draws it: each zone sensor as it stood at the end of the day, with the hours it
 * called counted from its call sensor, and the call stretches as shares of the day. */
export interface DemandDay {
  entities: HassEntities;
  calls: Partial<Record<HeatingZone, CallSpan[]>>;
}

export function demandDay(
  day: LocalDay,
  snapshots: Awaited<ReturnType<typeof fetchZoneSnapshots>>,
  points: Partial<Record<HeatingZone, CallPoint[]>>
): DemandDay {
  const entities: HassEntities = {};
  const calls: Partial<Record<HeatingZone, CallSpan[]>> = {};
  for (const zone of HEATING_ZONES) {
    const snapshot = snapshots[zone];
    if (!snapshot) continue;
    const segments = callSegments(points[zone] ?? [], day.startMs, day.endMs);
    calls[zone] = callSpans(segments, day);
    const hours = segments.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0) / HOUR_MS;
    entities[zoneSensorId(zone)] = {
      entity_id: zoneSensorId(zone),
      state: snapshot.state,
      attributes: { ...snapshot.attributes, call_hours_today: points[zone] ? hours : snapshot.attributes.call_hours_today },
    } as HassEntities[string];
  }
  return { entities, calls };
}

const finished = new Map<number, Promise<DemandDay>>();

export const clearDemandDayCache = () => finished.clear();

/** A finished day, read once and remembered; a failed read is forgotten so the next look tries again. */
function loadDemandDay(connection: Pick<Connection, 'sendMessagePromise'>, day: LocalDay): Promise<DemandDay> {
  const cached = finished.get(day.startMs);
  if (cached) return cached;
  const request = Promise.all([fetchZoneSnapshots(connection, day.endMs - 1), fetchCallPoints(connection, day.startMs, day.endMs)]).then(
    ([snapshots, points]) => demandDay(day, snapshots, points)
  );
  request.catch(() => finished.delete(day.startMs));
  finished.set(day.startMs, request);
  return request;
}

export type DemandDayState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: DemandDay };

/** The heat card's data for a finished day; null for `day` = null (today, which the live state draws). */
export function useDemandDay(day: LocalDay | null): DemandDayState | null {
  const connection = useHass(state => state.connection);
  const startMs = day?.startMs ?? null;
  const endMs = day?.endMs ?? null;
  const [loaded, setLoaded] = useState<{ startMs: number; data: DemandDay | null } | null>(null);

  useEffect(() => {
    if (!connection || startMs == null || endMs == null) return;
    let cancelled = false;
    loadDemandDay(connection, { startMs, endMs }).then(
      data => {
        if (!cancelled) setLoaded({ startMs, data });
      },
      () => {
        if (!cancelled) setLoaded({ startMs, data: null });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, startMs, endMs]);

  if (startMs == null) return null;
  if (loaded?.startMs !== startMs) return { status: 'loading' };
  return loaded.data ? { status: 'ready', data: loaded.data } : { status: 'error' };
}
