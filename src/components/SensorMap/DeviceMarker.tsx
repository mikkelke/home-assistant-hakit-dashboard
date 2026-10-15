import { memo, useMemo, type KeyboardEvent } from 'react';
import { liveOf } from '../../sensorMap/live';
import type { MapDevice } from '../../sensorMap/mapDoc';
import { glyphOf, typeClass } from './glyphs';
import { statesById, useEntityStates } from './useEntityStates';

/** Radius of a marker's touch target in screen pixels; the body is drawn inside it. */
export const HIT_RADIUS_PX = 22;

interface DeviceMarkerProps {
  id: string;
  device: MapDevice;
  x: number;
  y: number;
  yTop: number;
  selected: boolean;
  names: boolean;
  /** Bluetooth no longer reports this device as a scanner. */
  scannerGone: boolean;
  onActivate: (id: string) => void;
}

const BODY_R = 10;

/** One device on the plan at a constant pixel size. It reads only its own bound entities: a change to any other
 * device leaves it untouched. */
export const DeviceMarker = memo(function DeviceMarker({
  id,
  device,
  x,
  y,
  yTop,
  selected,
  names,
  scannerGone,
  onActivate,
}: DeviceMarkerProps) {
  const bound = useMemo(() => Object.values(device.ha.bindings), [device.ha.bindings]);
  const states = useEntityStates(bound);
  const live = liveOf(device.ha.bindings, statesById(bound, states));
  const role = device.roles.find(candidate => candidate !== device.type);
  const { cert } = device.placement;
  const classes = [
    'sm-mk',
    typeClass(device.type),
    `c-${cert}`,
    selected ? 'sel' : '',
    live.lit ? 'lit' : '',
    live.alert ? 'alert' : '',
    live.unavailable ? 'unavailable' : '',
    scannerGone ? 'no-scanner' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onActivate(id);
    }
  };
  const showName = names || selected;
  return (
    <g
      className={classes}
      transform={`translate(${x} ${yTop - y})`}
      data-hit='marker'
      data-id={id}
      tabIndex={0}
      role='button'
      aria-label={device.name}
      aria-pressed={selected}
      onKeyDown={onKeyDown}
    >
      <title>{device.name}</title>
      <g className='sm-mk-hit'>
        <circle r={HIT_RADIUS_PX} />
      </g>
      <g className='sm-mk-body'>
        <circle r={BODY_R + 5} className='sm-mk-halo' />
        <circle r={BODY_R} className='sm-mk-bg' />
        <g transform='translate(-6 -6) scale(0.5)'>
          <path d={glyphOf(device.type)} className='sm-mk-glyph' />
        </g>
        {role && (
          <g className={`sm-mk-role ${typeClass(role)}`} transform='translate(9 -9)'>
            <circle r={5.6} />
            <g transform='translate(-3.9 -3.9) scale(0.325)'>
              <path d={glyphOf(role)} />
            </g>
          </g>
        )}
        {live.pir && <circle className='sm-mk-pir' cx={-8} cy={8} r={2.6} />}
        {live.lit && <circle className='sm-mk-live' cx={8} cy={8} r={3.4} />}
        {live.open && <path className='sm-mk-open' d='M4 7.5l5-2.5v6l-5 2.5z' />}
        {showName && (
          <text className='sm-mk-name' x={15} y={4}>
            {device.name}
          </text>
        )}
        {names && live.temperature && (
          <text className='sm-mk-temp' x={0} y={-15} textAnchor='middle'>
            {live.temperature}
          </text>
        )}
      </g>
    </g>
  );
});
