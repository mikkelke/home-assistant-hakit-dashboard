import { memo, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { VACUUM_CURRENT_ROOM_INPUT, VACUUM_ENTITY } from '../../config/entities';
import { HOME_TIME_ZONE } from '../../config/plan';
import type { Point, Zone } from '../../sensorMap/mapDoc';
import { latestRound, type RunRoom, type SegmentRow } from '../../sensorMap/rober2Run';
import { useEntityStates } from './useEntityStates';

const LOOKBACK_MS = 3 * 24 * 3_600_000;

interface HistoryRow {
  s?: unknown;
  state?: unknown;
  lu?: unknown;
  lc?: unknown;
  last_changed?: unknown;
}

function rowsOf(response: Record<string, unknown> | null): SegmentRow[] {
  const rows = response?.[VACUUM_CURRENT_ROOM_INPUT];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: HistoryRow) => {
    const seconds = Number(row.lc ?? row.lu);
    const atMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(row.last_changed ?? ''));
    return Number.isFinite(atMs) ? [{ state: String(row.s ?? row.state ?? ''), atMs }] : [];
  });
}

/** The latest round, refetched whenever the robot is sent to another segment. */
function useLatestRound(): RunRoom[] | null {
  const connection = useHass(state => state.connection);
  const [segment] = useEntityStates([VACUUM_CURRENT_ROOM_INPUT]);
  const changed = (segment as { last_changed?: string } | undefined)?.last_changed ?? '';
  const [round, setRound] = useState<{ key: string; rooms: RunRoom[] } | null>(null);
  useEffect(() => {
    if (!connection) return;
    let live = true;
    const now = Date.now();
    connection
      .sendMessagePromise<Record<string, unknown> | null>({
        type: 'history/history_during_period',
        start_time: new Date(now - LOOKBACK_MS).toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: [VACUUM_CURRENT_ROOM_INPUT],
        include_start_time_state: true,
        significant_changes_only: false,
        minimal_response: true,
        no_attributes: true,
      })
      .then(response => {
        if (live) setRound({ key: changed, rooms: latestRound(rowsOf(response)) });
      })
      .catch(() => {
        if (live) setRound({ key: changed, rooms: [] });
      });
    return () => {
      live = false;
    };
  }, [connection, changed]);
  return round?.rooms ?? null;
}

/** The area centroid of a polygon: the middle of the floor, wherever the room's label was put. */
function centroidOf(poly: readonly Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    area += cross;
    cx += (poly[j][0] + poly[i][0]) * cross;
    cy += (poly[j][1] + poly[i][1]) * cross;
  }
  if (Math.abs(area) < 1e-9) return poly[0];
  return [cx / (3 * area), cy / (3 * area)];
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: HOME_TIME_ZONE });

/** Rober2's latest round as numbered steps from room to room, the room it is cleaning now filled. The robot's own
 * position is too jittery to draw, so each step is a whole room. */
export const Rober2Layer = memo(function Rober2Layer({ zones, yTop }: { zones: readonly Zone[]; yTop: number }) {
  const rooms = useLatestRound();
  const [vacuum] = useEntityStates([VACUUM_ENTITY]);
  if (!rooms || rooms.length === 0) return null;
  const cleaning = vacuum?.state === 'cleaning';
  const steps = rooms.flatMap(room => {
    const zone = zones.find(candidate => candidate.ha_area_id === room.areaId);
    return zone ? [{ room, x: centroidOf(zone.poly)[0], y: yTop - centroidOf(zone.poly)[1] }] : [];
  });
  if (steps.length === 0) return null;
  const path = steps.map((step, index) => `${index === 0 ? 'M' : 'L'}${step.x.toFixed(3)} ${step.y.toFixed(3)}`).join('');
  const first = steps[0].room.startMs;
  return (
    <g className={`sm-rober${cleaning ? ' live' : ''}`} aria-label={`Rober2 round from ${clock(first)}`}>
      {steps.length > 1 && <path d={path} className='sm-rober-path' />}
      {steps.map((step, index) => {
        const now = cleaning && step.room.endMs === null;
        return (
          <g key={`${step.room.areaId}-${step.room.startMs}`} transform={`translate(${step.x} ${step.y})`}>
            <g className='sm-mk-hit-scale'>
              <circle r={9} className={`sm-rober-step${now ? ' now' : ''}`} />
              <text className='sm-rober-num' dy='0.35em'>
                {index + 1}
              </text>
              {index === 0 && (
                <text className='sm-rober-time' y={20}>
                  {clock(first)}
                </text>
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
});
