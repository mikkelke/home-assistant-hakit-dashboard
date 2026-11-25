import { memo, useMemo } from 'react';
import { ROOM_LIGHTS } from '../../config/lights';
import { MAP_DOOR_CONTACTS } from '../../config/mapDoors';
import { closedDoorNames, sensorOf } from '../../sensorMap/doorState';
import { LAMP_REACH_M, lampFields, outsidePanes, sunShafts } from '../../sensorMap/lightGeometry';
import type { Plan } from '../../sensorMap/mapDoc';
import { polyPath } from '../../sensorMap/planPaths';
import { clipIdOf } from './types';
import { statesById, useEntityStates } from './useEntityStates';

const SUN_ENTITY = 'sun.sun';

interface ZoneLamp {
  zoneId: string;
  ids: string[];
}

function lampsOf(plan: Plan): ZoneLamp[] {
  return plan.zones.flatMap(zone => {
    const ids = ROOM_LIGHTS[zone.zone_id];
    return ids?.length ? [{ zoneId: zone.zone_id, ids }] : [];
  });
}

/** How bright a room's lamps are, 0 when all are off: the brightest lamp on, as a share of full. */
function roomLevel(states: readonly ({ state: string; attributes?: Record<string, unknown> } | undefined)[]): number {
  let level = 0;
  for (const entity of states) {
    if (entity?.state !== 'on') continue;
    const brightness = Number(entity.attributes?.brightness);
    level = Math.max(level, Number.isFinite(brightness) && brightness > 0 ? brightness / 255 : 1);
  }
  return level;
}

const RoomGlow = memo(function RoomGlow({ plan, lamp, field }: { plan: Plan; lamp: ZoneLamp; field: string | null }) {
  const states = useEntityStates(lamp.ids);
  const level = roomLevel(states);
  if (level <= 0) return null;
  const yTop = plan.bounds.y1;
  const zone = plan.zones.find(candidate => candidate.zone_id === lamp.zoneId);
  if (!zone) return null;
  const gradient = `sm-lamp-${lamp.zoneId}`;
  const strength = 0.35 + 0.65 * level;
  return (
    <g className='sm-lamp' style={{ opacity: strength }}>
      <radialGradient id={gradient} gradientUnits='userSpaceOnUse' cx={zone.label[0]} cy={yTop - zone.label[1]} r={LAMP_REACH_M}>
        <stop offset='0' className='sm-lamp-stop' stopOpacity={0.55} />
        <stop offset='0.35' className='sm-lamp-stop' stopOpacity={0.28} />
        <stop offset='1' className='sm-lamp-stop' stopOpacity={0} />
      </radialGradient>
      <path d={polyPath(zone.poly, yTop)} className='sm-lamp-room' />
      {field && <path d={field} fill={`url(#${gradient})`} />}
    </g>
  );
});

const SunLayer = memo(function SunLayer({ plan }: { plan: Plan }) {
  const [sun] = useEntityStates([SUN_ENTITY]);
  const panes = useMemo(() => outsidePanes(plan), [plan]);
  const azimuth = Number(sun?.attributes?.azimuth);
  const elevation = Number(sun?.attributes?.elevation);
  const shafts = useMemo(
    () => (Number.isFinite(azimuth) && Number.isFinite(elevation) ? sunShafts(panes, azimuth, elevation, plan.compass.rot) : []),
    [panes, azimuth, elevation, plan.compass.rot]
  );
  if (shafts.length === 0) return null;
  const yTop = plan.bounds.y1;
  const low = elevation < 12;
  return (
    <g className={`sm-sun${low ? ' low' : ''}`}>
      {shafts.map(shaft => {
        const id = `sm-sun-${shaft.id}`;
        return (
          <g key={shaft.id} clipPath={`url(#${clipIdOf('z', shaft.zoneId)})`}>
            <linearGradient
              id={id}
              gradientUnits='userSpaceOnUse'
              x1={shaft.from[0]}
              y1={yTop - shaft.from[1]}
              x2={shaft.to[0]}
              y2={yTop - shaft.to[1]}
            >
              <stop offset='0' className='sm-sun-stop' stopOpacity={0.42} />
              <stop offset='0.35' className='sm-sun-stop' stopOpacity={0.2} />
              <stop offset='0.85' className='sm-sun-stop' stopOpacity={0} />
            </linearGradient>
            <path d={polyPath(shaft.quad, yTop)} fill={`url(#${id})`} />
          </g>
        );
      })}
    </g>
  );
});

const INDOORS_CLIP = 'sm-lamp-indoors';
const DOORWAY_PAD_M = 0.15;

/** The floor lamp light may fall on: every zone, and the box each door sweeps so light crosses the doorway. Walls
 * the plan leaves gaps in, along the outside, let no light out. */
function indoorPaths(plan: Plan): string[] {
  const yTop = plan.bounds.y1;
  const zones = plan.zones.map(zone => polyPath(zone.poly, yTop));
  const doors = plan.doors.map(door => {
    const xs = [door.hinge[0], door.closed[0], door.open[0]];
    const ys = [door.hinge[1], door.closed[1], door.open[1]];
    const x0 = Math.min(...xs) - DOORWAY_PAD_M;
    const x1 = Math.max(...xs) + DOORWAY_PAD_M;
    const y0 = Math.min(...ys) - DOORWAY_PAD_M;
    const y1 = Math.max(...ys) + DOORWAY_PAD_M;
    return polyPath(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      yTop
    );
  });
  return [...zones, ...doors];
}

/** Rooms whose lamps are on glow, the glow passing through open doorways and stopping at walls and closed doors, and
 * the sun falls through the outside panes while it is up. */
export const LampLayer = memo(function LampLayer({ plan }: { plan: Plan }) {
  const lamps = useMemo(() => lampsOf(plan), [plan]);
  const sensorIds = useMemo(() => plan.doors.flatMap(door => sensorOf(MAP_DOOR_CONTACTS[door.name]) ?? []), [plan.doors]);
  const sensorStates = useEntityStates(sensorIds);
  const closedKey = useMemo(() => {
    const byId = statesById(sensorIds, sensorStates);
    return closedDoorNames(plan.doors, MAP_DOOR_CONTACTS, id => byId[id]).join('\n');
  }, [plan.doors, sensorIds, sensorStates]);
  const fields = useMemo(() => {
    const yTop = plan.bounds.y1;
    const rings = lampFields(plan, closedKey ? closedKey.split('\n') : []);
    const out: Record<string, string | null> = {};
    for (const [zoneId, ring] of Object.entries(rings)) out[zoneId] = ring.length ? polyPath(ring, yTop) : null;
    return out;
  }, [plan, closedKey]);
  const indoors = useMemo(() => indoorPaths(plan), [plan]);
  return (
    <g className='sm-light-layer' aria-hidden='true'>
      <clipPath id={INDOORS_CLIP}>
        {indoors.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </clipPath>
      <SunLayer plan={plan} />
      <g clipPath={`url(#${INDOORS_CLIP})`}>
        {lamps.map(lamp => (
          <RoomGlow key={lamp.zoneId} plan={plan} lamp={lamp} field={fields[lamp.zoneId] ?? null} />
        ))}
      </g>
    </g>
  );
});
