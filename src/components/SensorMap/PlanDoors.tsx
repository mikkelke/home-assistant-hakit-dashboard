import { memo } from 'react';
import { MAP_DOOR_CONTACTS } from '../../config/mapDoors';
import { doorState } from '../../sensorMap/doorState';
import type { Door } from '../../sensorMap/mapDoc';
import { doorClosedLeaf, doorPaths } from '../../sensorMap/planPaths';
import { useEntityStates } from './useEntityStates';

const NO_IDS: readonly string[] = [];

const PlanDoor = memo(function PlanDoor({ door, yTop }: { door: Door; yTop: number }) {
  const sensorId = MAP_DOOR_CONTACTS[door.name];
  const [entity] = useEntityStates(sensorId ? [sensorId] : NO_IDS);
  const state = doorState(sensorId, entity);
  if (state === 'closed') {
    return (
      <g className='sm-door closed' aria-label={`${door.name}, closed`}>
        <path d={doorClosedLeaf(door, yTop)} className='sm-door-leaf' />
      </g>
    );
  }
  const { leaf, arc } = doorPaths(door, yTop);
  const mid = [(door.hinge[0] + door.open[0]) / 2, (door.hinge[1] + door.open[1]) / 2];
  const label = state === 'none' ? 'no sensor' : state === 'unknown' ? 'sensor not reporting' : 'open';
  return (
    <g className={`sm-door ${state}`} aria-label={`${door.name}, ${label}`}>
      <path d={leaf} className='sm-door-leaf' />
      <path d={arc} className='sm-door-arc' />
      {state === 'none' && (
        <g transform={`translate(${mid[0]} ${yTop - mid[1]})`}>
          <g className='sm-mk-hit-scale'>
            <circle r={7} className='sm-door-nosensor' />
            <text className='sm-door-nosensor-mark' dy='0.35em'>
              ?
            </text>
          </g>
        </g>
      )}
    </g>
  );
});

/** Each door as its sensor reports it: shut in the wall when closed, swung open otherwise, and marked with a question
 * mark when it has no sensor, so the light layer can only guess that it is open. */
export const PlanDoors = memo(function PlanDoors({ doors, yTop }: { doors: readonly Door[]; yTop: number }) {
  return (
    <g className='sm-doors'>
      {doors.map(door => (
        <PlanDoor key={door.name} door={door} yTop={yTop} />
      ))}
    </g>
  );
});
