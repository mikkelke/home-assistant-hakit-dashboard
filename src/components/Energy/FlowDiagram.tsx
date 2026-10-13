import { Icon } from '@iconify/react';
import { flowDashSeconds, flowStrokeWidth, type FlowNode } from '../../energy/roomsView';

interface FlowDiagramProps {
  gridW: number | null;
  nodes: readonly FlowNode[];
}

const W = 352;
const HUB_X = 176;
const HUB_Y = 92;
const NODE_Y = 174;
const SKY = '#38bdf8';
const GREY = '#52525b';

const watts = (value: number) => Math.round(value).toLocaleString('da-DK');

/** Grid -> home -> rooms. Line width is a room's share of the draw, dash speed its watts, and a
 * ring marks a room with a running machine. Motion is stroke-dashoffset and transform only, and
 * stops under reduced motion (see EnergyViews.css). */
export function FlowDiagram({ gridW, nodes }: FlowDiagramProps) {
  const step = nodes.length > 1 ? (W - 48) / (nodes.length - 1) : 0;
  const xOf = (i: number) => (nodes.length > 1 ? 24 + i * step : HUB_X);
  const feedSeconds = gridW != null ? flowDashSeconds(gridW) : null;

  return (
    <svg
      viewBox={`0 0 ${W} 210`}
      className='plan-chart'
      role='img'
      aria-label={`Power flow: ${gridW != null ? `${watts(gridW)} W from the grid` : 'grid unknown'}, ${nodes.length} rooms`}
    >
      <line x1={HUB_X} y1={48} x2={HUB_X} y2={66} stroke={SKY} strokeWidth={7} strokeLinecap='round' opacity={0.25} />
      {feedSeconds != null && (
        <line
          className='ev-flowing'
          x1={HUB_X}
          y1={48}
          x2={HUB_X}
          y2={66}
          stroke={SKY}
          strokeWidth={flowStrokeWidth(0.45)}
          strokeLinecap='round'
          style={{ animationDuration: `${feedSeconds}s` }}
        />
      )}
      {nodes.map((node, i) => {
        const x = xOf(i);
        const d = `M${HUB_X} 118C${HUB_X} 156,${x} 122,${x} 155`;
        const color = node.untracked ? GREY : SKY;
        return (
          <g key={node.key}>
            <path d={d} fill='none' stroke={color} strokeWidth={node.strokeWidth * 1.8} strokeLinecap='round' opacity={0.25} />
            {node.dashSeconds != null && (
              <path
                className='ev-flowing'
                d={d}
                fill='none'
                stroke={color}
                strokeWidth={node.strokeWidth}
                strokeLinecap='round'
                style={{ animationDuration: `${node.dashSeconds}s` }}
              />
            )}
          </g>
        );
      })}

      <rect x={154} y={4} width={44} height={44} rx={12} fill='#1c1e24' stroke='#3f3f46' strokeWidth={1.5} />
      <Icon icon='mdi:transmission-tower' x={165} y={15} width={22} height={22} color='#e4e4e7' />
      <text x={206} y={20} className='plan-label plan-label--cap'>
        Grid
      </text>
      <text x={206} y={40} className='ev-tval'>
        {gridW != null ? `${watts(gridW)} W` : '—'}
      </text>

      <circle className='ev-hub-pulse' cx={HUB_X} cy={HUB_Y} r={36} fill={SKY} opacity={0.14} />
      <circle cx={HUB_X} cy={HUB_Y} r={26} fill={SKY} />
      <Icon icon='mdi:home' x={HUB_X - 12} y={HUB_Y - 12} width={24} height={24} color='#0d0f13' />

      {nodes.map((node, i) => {
        const x = xOf(i);
        const lit = !node.untracked && node.share >= 0.05;
        return (
          <g key={node.key}>
            <circle
              cx={x}
              cy={NODE_Y}
              r={17}
              fill='#16181d'
              stroke={lit ? SKY : node.untracked ? GREY : '#3f3f46'}
              strokeWidth={1.6}
              strokeDasharray={node.untracked ? '3 2' : undefined}
            />
            {node.running && (
              <circle className='ev-runring' cx={x} cy={NODE_Y} r={21} fill='none' stroke={SKY} strokeWidth={2} strokeLinecap='round' />
            )}
            <Icon icon={node.icon} x={x - 8} y={NODE_Y - 8} width={16} height={16} color={lit ? '#e4e4e7' : '#a1a1aa'} />
            <text x={x} y={206} textAnchor='middle' className={`plan-label plan-label--bold ${lit ? 'plan-label--strong' : ''}`}>
              {watts(node.watts)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
