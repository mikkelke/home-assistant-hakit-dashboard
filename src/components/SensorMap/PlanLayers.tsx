import { memo } from 'react';
import { doorPaths, glazingLine, polyPath } from '../../sensorMap/planPaths';
import type { Plan } from '../../sensorMap/mapDoc';
import { clipIdOf } from './types';

const WALL_EPS = 0.004;

/** Clip regions for radar footprints, one per zone and per open region. */
export const PlanDefs = memo(function PlanDefs({ plan }: { plan: Plan }) {
  const yTop = plan.bounds.y1;
  return (
    <defs>
      {plan.zones.map(zone => (
        <clipPath key={zone.zone_id} id={clipIdOf('z', zone.zone_id)}>
          <path d={polyPath(zone.poly, yTop)} />
        </clipPath>
      ))}
      {plan.clip_regions.map(region => (
        <clipPath key={region.clip_region_id} id={clipIdOf('c', region.clip_region_id)}>
          <path d={polyPath(region.poly, yTop)} />
        </clipPath>
      ))}
      <marker
        id='sm-arrowhead'
        viewBox='0 0 10 10'
        refX={9}
        refY={5}
        markerUnits='userSpaceOnUse'
        markerWidth={0.22}
        markerHeight={0.22}
        orient='auto'
      >
        <path d='M0 0L10 5L0 10z' className='sm-arrowhead' />
      </marker>
      <pattern id='sm-hatch' patternUnits='userSpaceOnUse' width={0.16} height={0.16} patternTransform='rotate(45)'>
        <line x1={0} y1={0} x2={0} y2={0.16} className='sm-hatch-line' strokeWidth={0.045} />
      </pattern>
    </defs>
  );
});

export const PlanGrid = memo(function PlanGrid({ plan }: { plan: Plan }) {
  const { bounds } = plan;
  const yTop = bounds.y1;
  const xs: number[] = [];
  for (let x = Math.ceil(bounds.x0); x <= Math.floor(bounds.x1); x += 1) xs.push(x);
  const ys: number[] = [];
  for (let y = Math.ceil(bounds.y0); y <= Math.floor(bounds.y1); y += 1) ys.push(y);
  return (
    <g className='sm-grid'>
      {xs.map(x => (
        <g key={`x${x}`}>
          <line x1={x} y1={yTop - bounds.y0} x2={x} y2={yTop - bounds.y1} className={x === 0 ? 'sm-axis' : undefined} />
          {x >= 0 && x <= bounds.x1 - 0.5 && (
            <text x={x} y={yTop - bounds.y0 - 0.08} className='sm-gridlab' textAnchor='middle'>
              {x} m
            </text>
          )}
        </g>
      ))}
      {ys.map(y => (
        <g key={`y${y}`}>
          <line x1={bounds.x0} y1={yTop - y} x2={bounds.x1} y2={yTop - y} className={y === 0 ? 'sm-axis' : undefined} />
          {y >= 0 && y <= bounds.y1 - 1 && (
            <text x={bounds.x1 - 0.7} y={yTop - y - 0.05} className='sm-gridlab'>
              {y} m
            </text>
          )}
        </g>
      ))}
    </g>
  );
});

function TextLines({
  at,
  lines,
  className,
  rot,
  yTop,
}: {
  at: [number, number];
  lines: string[];
  className: string;
  rot: number;
  yTop: number;
}) {
  const [x, y] = at;
  return (
    <text x={x} y={yTop - y} className={className} transform={rot ? `rotate(${rot} ${x} ${yTop - y})` : undefined}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : '1.15em'}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export const PlanLabels = memo(function PlanLabels({ plan }: { plan: Plan }) {
  const yTop = plan.bounds.y1;
  return (
    <g className='sm-labels'>
      {plan.zone_lines.map((line, index) => (
        <line key={index} x1={line.x} y1={yTop} x2={line.x} y2={yTop - line.y1} className='sm-zoneline' />
      ))}
      {plan.annotations.map(note => (
        <TextLines
          key={note.id}
          at={note.at}
          lines={note.lines}
          rot={note.rot}
          yTop={yTop}
          className={note.kind === 'zone_label' ? 'sm-zonelab' : `sm-room${note.small ? ' small' : ''}${note.outside ? ' outside' : ''}`}
        />
      ))}
    </g>
  );
});

/** Furniture as a quiet filled outline with its name, under the room labels and the walls. */
export const PlanFurniture = memo(function PlanFurniture({ plan }: { plan: Plan }) {
  const yTop = plan.bounds.y1;
  if (!plan.furniture?.length) return null;
  return (
    <g className='sm-furniture'>
      {plan.furniture.map(piece => {
        const [x0, y0, x1, y1] = piece.box;
        return (
          <g key={piece.id}>
            <rect x={x0} y={yTop - y1} width={x1 - x0} height={y1 - y0} className='sm-furniture-box' />
            <text x={(x0 + x1) / 2} y={yTop - (y0 + y1) / 2} dy='0.35em' className='sm-room small'>
              {piece.name}
            </text>
          </g>
        );
      })}
    </g>
  );
});

export const PlanWalls = memo(function PlanWalls({ plan }: { plan: Plan }) {
  const yTop = plan.bounds.y1;
  const { compass } = plan;
  return (
    <g className='sm-structure'>
      <g className='sm-walls'>
        {plan.walls.map((wall, index) => (
          <rect
            key={index}
            x={wall.x0 - WALL_EPS}
            y={yTop - wall.y1 - WALL_EPS}
            width={wall.x1 - wall.x0 + 2 * WALL_EPS}
            height={wall.y1 - wall.y0 + 2 * WALL_EPS}
          />
        ))}
      </g>
      <g className='sm-windows'>
        {plan.windows.map((glazing, index) => {
          const [x0, y0, x1, y1] = glazing.box;
          const line = glazingLine(glazing, yTop);
          return (
            <g key={index}>
              <title>{glazing.name}</title>
              <rect x={x0} y={yTop - y1} width={x1 - x0} height={y1 - y0} className='sm-win-bg' />
              <rect x={x0} y={yTop - y1} width={x1 - x0} height={y1 - y0} className='sm-win-frame' />
              {line && <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} className='sm-win-line' />}
            </g>
          );
        })}
      </g>
      <g className='sm-doors'>
        {plan.doors.map(door => {
          const { leaf, arc } = doorPaths(door, yTop);
          return (
            <g key={door.name}>
              <title>{door.name}</title>
              <path d={leaf} className='sm-door-leaf' />
              <path d={arc} className='sm-door-arc' />
            </g>
          );
        })}
      </g>
      <g className='sm-compass' transform={`translate(${compass.x} ${yTop - compass.y})`}>
        <circle r={0.42} />
        <g transform={`rotate(${compass.rot})`}>
          <path d='M0 -0.38L0.11 0.05L0 -0.04L-0.11 0.05Z' />
          <text x={0} y={-0.48}>
            N
          </text>
        </g>
        <text x={0} y={0.72} className='sm-compass-note'>
          approx.
        </text>
      </g>
    </g>
  );
});
