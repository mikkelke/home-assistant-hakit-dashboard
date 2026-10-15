import { memo, type KeyboardEvent } from 'react';
import type { Fingerprint, MapDevice, Point } from '../../sensorMap/mapDoc';
import { handlePoint } from '../../sensorMap/radarRange';
import { glyphOf, typeClass } from './glyphs';

/** Smaller than a marker's touch target: a ghost sits on top of the markers, and the device beside it must stay reachable. */
const GHOST_HIT_PX = 14;

export interface Ghost {
  id: string;
  /** The suggestion proposes this placement for a device already on the plan, which gives the arrow its start. */
  from: Point | null;
  at: Point;
  device: Pick<MapDevice, 'name' | 'type'>;
  stale: boolean;
}

/** Enter or Space on a focused mark, for a keyboard user. */
function activateOnKey(activate: () => void) {
  return (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      activate();
    }
  };
}

interface GhostMarkerProps {
  ghost: Ghost;
  yTop: number;
  selected: boolean;
  onActivate: (id: string) => void;
}

/** A suggested placement: a dashed marker in the device's colour, with an arrow from where the device is now. */
export const GhostMarker = memo(function GhostMarker({ ghost, yTop, selected, onActivate }: GhostMarkerProps) {
  const [x, y] = ghost.at;
  return (
    <g className={`sm-ghost ${typeClass(ghost.device.type)}${selected ? ' sel' : ''}${ghost.stale ? ' stale' : ''}`}>
      {ghost.from && (
        <line className='sm-ghost-arrow' x1={ghost.from[0]} y1={yTop - ghost.from[1]} x2={x} y2={yTop - y} markerEnd='url(#sm-arrowhead)' />
      )}
      <g
        transform={`translate(${x} ${yTop - y})`}
        data-hit='ghost'
        data-id={ghost.id}
        tabIndex={0}
        role='button'
        aria-label={`Suggested place for ${ghost.device.name}`}
        onKeyDown={activateOnKey(() => onActivate(ghost.id))}
      >
        <title>{`Suggested: ${ghost.device.name}`}</title>
        <g className='sm-mk-hit'>
          <circle r={GHOST_HIT_PX} />
        </g>
        <g className='sm-mk-body'>
          <circle r={10} className='sm-mk-bg' />
          <g transform='translate(-6 -6) scale(0.5)'>
            <path d={glyphOf(ghost.device.type)} className='sm-mk-glyph' />
          </g>
          {selected && (
            <text className='sm-mk-name' x={15} y={4}>
              {ghost.device.name}
            </text>
          )}
        </g>
      </g>
    </g>
  );
});

export const FingerprintMarks = memo(function FingerprintMarks({
  items,
  yTop,
  selectedId,
  onActivate,
}: {
  items: readonly Fingerprint[];
  yTop: number;
  selectedId: string | null;
  onActivate: (id: string) => void;
}) {
  return (
    <g className='sm-prints'>
      {items.map(item => (
        <g
          key={item.id}
          className={`sm-print${item.weak ? ' weak' : ''}${selectedId === item.id ? ' sel' : ''}`}
          transform={`translate(${item.pos.x} ${yTop - item.pos.y})`}
          data-hit='fingerprint'
          data-id={item.id}
          tabIndex={0}
          role='button'
          aria-label={`Fingerprint ${item.at.slice(0, 16).replace('T', ' ')}${item.weak ? ', weak' : ''}`}
          onKeyDown={activateOnKey(() => onActivate(item.id))}
        >
          <g className='sm-mk-hit'>
            <circle r={16} />
          </g>
          <g className='sm-mk-body'>
            <path d='M-6 -6L6 6M6 -6L-6 6' />
          </g>
        </g>
      ))}
    </g>
  );
});

interface FacingHandleProps {
  /** The radar's position and facing; the handle sits 1.2 m out on the axis. */
  radar: { x: number; y: number };
  facing: Parameters<typeof handlePoint>[1];
  deviceId: string;
  yTop: number;
}

export const FacingHandle = memo(function FacingHandle({ radar, facing, deviceId, yTop }: FacingHandleProps) {
  const [hx, hy] = handlePoint({ x: radar.x, y: radar.y, h: null }, facing);
  return (
    <g className='sm-handle'>
      <line className='sm-handle-axis' x1={radar.x} y1={yTop - radar.y} x2={hx} y2={yTop - hy} />
      <g transform={`translate(${hx} ${yTop - hy})`} data-hit='handle' data-id={deviceId}>
        <g className='sm-mk-hit'>
          <circle r={22} />
        </g>
        <g className='sm-mk-body'>
          <circle r={7} className='sm-handle-knob' />
          <path d='M-3 3L3 -3M3 -3H-1M3 -3V1' className='sm-handle-arrow' />
        </g>
      </g>
    </g>
  );
});

export function Crosshair({ at, yTop }: { at: Point; yTop: number }) {
  return (
    <g className='sm-cross' transform={`translate(${at[0]} ${yTop - at[1]})`}>
      <g className='sm-mk-hit-scale'>
        <line x1={-12} y1={0} x2={12} y2={0} />
        <line x1={0} y1={-12} x2={0} y2={12} />
        <circle r={5} />
      </g>
    </g>
  );
}
