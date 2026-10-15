import { memo, useMemo } from 'react';
import { liveOf } from '../../sensorMap/live';
import type { Facing, MapDevice } from '../../sensorMap/mapDoc';
import { footprintKind, footprintPath, targetArcPath } from '../../sensorMap/radarRange';
import { clipIdOf } from './types';
import { statesById, useEntityStates } from './useEntityStates';

interface RadarFootprintProps {
  id: string;
  device: MapDevice;
  x: number;
  y: number;
  h: number | null;
  /** The facing while its handle is being dragged, in place of the stored one. */
  facing: Facing;
  yTop: number;
  selected: boolean;
}

/** The floor a radar covers, drawn from its configured range: lit while it sees someone, with a radial arc at the
 * distance of its target. Only the radar's own bound entities are read, so a presence flip redraws this footprint
 * and nothing else. */
export const RadarFootprint = memo(function RadarFootprint({ id, device, x, y, h, facing, yTop, selected }: RadarFootprintProps) {
  const bound = useMemo(() => Object.values(device.ha.bindings), [device.ha.bindings]);
  const states = useEntityStates(bound);
  const live = liveOf(device.ha.bindings, statesById(bound, states));
  const fov = device.placement.fov_deg;
  const kind = footprintKind(facing, fov);
  const pos = { x, y, h };
  const range = live.range;
  if (!range) return null;
  const d = footprintPath(pos, facing, fov, range, yTop);
  const arc = live.targetDistance !== null && kind !== 'unknown' ? targetArcPath(pos, facing, fov, live.targetDistance, yTop) : null;
  const clip = device.clip_region_id ? clipIdOf('c', device.clip_region_id) : device.zone_id ? clipIdOf('z', device.zone_id) : null;
  const classes = ['sm-fp', `kind-${kind}`, live.lit ? 'lit' : '', selected ? 'sel' : ''].filter(Boolean).join(' ');
  return (
    <g className={classes} data-radar={id}>
      <g clipPath={clip ? `url(#${clip})` : undefined}>
        {kind !== 'unknown' && <path d={d} className='sm-fp-fill' fillRule='evenodd' />}
        <path d={d} className='sm-fp-line' fillRule='evenodd' />
        {arc && <path d={arc} className='sm-fp-arc' />}
      </g>
      {kind === 'unknown' && (
        <text x={x} y={yTop - y - 0.4} className='sm-fp-label' textAnchor='middle'>
          facing unknown
        </text>
      )}
    </g>
  );
});
