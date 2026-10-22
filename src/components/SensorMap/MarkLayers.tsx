import { memo } from 'react';
import type { Fingerprint, Furniture, MapDevice, Point, VentKind } from '../../sensorMap/mapDoc';
import { polyPath } from '../../sensorMap/planPaths';
import { handlePoint } from '../../sensorMap/radarRange';
import { VENT_R, glyphOf, typeClass, ventGlyph } from './glyphs';
import { activateOnKey } from './activateOnKey';

/** Smaller than a marker's touch target: a ghost sits on top of the markers, and the device beside it must stay reachable. */
const GHOST_HIT_PX = 14;

export interface Ghost {
  id: string;
  /** The suggestion proposes this placement for a device already on the plan, which gives the arrow its start. */
  from: Point | null;
  at: Point;
  device: Pick<MapDevice, 'name' | 'type'>;
  /** Set for suggested furniture, which is drawn as this outline instead of a marker; `at` is its centre. */
  box?: Furniture['box'];
  /** Set for a suggested vent, which is drawn as the ring of a vent of this kind instead of a marker. */
  ventKind?: VentKind;
  /** Set for a suggested zone change, which is drawn as these outlines instead of a marker; `at` is their centre. */
  outlines?: Point[][];
  stale: boolean;
}

interface GhostMarkerProps {
  ghost: Ghost;
  yTop: number;
  selected: boolean;
  onActivate: (id: string) => void;
}

/** Suggested furniture: a dashed outline with its name. Only the edge takes a touch, so what lies inside stays reachable. */
function GhostOutline({ ghost, box, yTop, selected, onActivate }: GhostMarkerProps & { box: Furniture['box'] }) {
  const [x0, y0, x1, y1] = box;
  const frame = { x: x0, y: yTop - y1, width: x1 - x0, height: y1 - y0 };
  return (
    <g className={`sm-ghost sm-ghost-box${selected ? ' sel' : ''}${ghost.stale ? ' stale' : ''}`}>
      <rect {...frame} className='sm-ghost-rect' />
      <text x={(x0 + x1) / 2} y={yTop - (y0 + y1) / 2} dy='0.35em' className='sm-room small'>
        {ghost.device.name}
      </text>
      <g
        data-hit='ghost'
        data-id={ghost.id}
        tabIndex={0}
        role='button'
        aria-label={`Suggested furniture ${ghost.device.name}`}
        onKeyDown={activateOnKey(() => onActivate(ghost.id))}
      >
        <rect {...frame} className='sm-ghost-edge' />
      </g>
    </g>
  );
}

/** A suggested zone change: the new outline of each zone it redraws, dashed. Only the edge takes a touch, so what lies inside
 * stays reachable. */
function GhostZones({ ghost, outlines, yTop, selected, onActivate }: GhostMarkerProps & { outlines: Point[][] }) {
  return (
    <g className={`sm-ghost sm-ghost-zones${selected ? ' sel' : ''}${ghost.stale ? ' stale' : ''}`}>
      {outlines.map((poly, index) => (
        <path key={index} d={polyPath(poly, yTop)} className='sm-ghost-rect' />
      ))}
      <g
        data-hit='ghost'
        data-id={ghost.id}
        tabIndex={0}
        role='button'
        aria-label={`Suggested zone change ${ghost.device.name}`}
        onKeyDown={activateOnKey(() => onActivate(ghost.id))}
      >
        {outlines.map((poly, index) => (
          <path key={index} d={polyPath(poly, yTop)} className='sm-ghost-edge' />
        ))}
      </g>
    </g>
  );
}

/** A suggested vent: the ring of a vent, dashed. */
function GhostVent({ ghost, kind, yTop, selected, onActivate }: GhostMarkerProps & { kind: VentKind }) {
  const [x, y] = ghost.at;
  return (
    <g className={`sm-ghost sm-ghost-vent kind-${kind}${selected ? ' sel' : ''}${ghost.stale ? ' stale' : ''}`}>
      <g
        transform={`translate(${x} ${yTop - y})`}
        data-hit='ghost'
        data-id={ghost.id}
        tabIndex={0}
        role='button'
        aria-label={`Suggested vent ${ghost.device.name}`}
        onKeyDown={activateOnKey(() => onActivate(ghost.id))}
      >
        <g className='sm-mk-hit'>
          <circle r={GHOST_HIT_PX} />
        </g>
        <g className='sm-mk-body'>
          <circle r={VENT_R} className='sm-vent-bg' />
          <path d={ventGlyph(kind)} className='sm-vent-glyph' />
          {selected && (
            <text className='sm-mk-name' x={VENT_R + 5} y={4}>
              {ghost.device.name}
            </text>
          )}
        </g>
      </g>
    </g>
  );
}

/** A suggested placement: a dashed marker in the device's colour, with an arrow from where the device is now. */
export const GhostMarker = memo(function GhostMarker({ ghost, yTop, selected, onActivate }: GhostMarkerProps) {
  if (ghost.box) return <GhostOutline ghost={ghost} box={ghost.box} yTop={yTop} selected={selected} onActivate={onActivate} />;
  if (ghost.outlines) return <GhostZones ghost={ghost} outlines={ghost.outlines} yTop={yTop} selected={selected} onActivate={onActivate} />;
  if (ghost.ventKind) return <GhostVent ghost={ghost} kind={ghost.ventKind} yTop={yTop} selected={selected} onActivate={onActivate} />;
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
