import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatDecimal } from '../../utils/format';
import { type TrendPoint } from '../../body/weighings';
import { PAD_B, PAD_L, PAD_R, PAD_T, xTicks, yScale } from '../../body/chartScale';

import { DAY_MS } from '../../body/weighings';
/** A trend segment across a longer gap than this is not drawn: nothing was measured in between. */
const GAP_MS = 60 * DAY_MS;

export interface ChartPoint {
  ts: number;
  value: number;
}

interface BodyChartProps {
  points: ChartPoint[];
  trend: TrendPoint[];
  domain: [number, number];
  width: number;
  height: number;
  tone: 'weight' | 'fat';
  dense: boolean;
  selected: number | null;
  onSelect: (ts: number | null) => void;
  label: string;
}

/** One measure over time: the readings as dots and the trend as a line, with the y labels on the right. Tapping or
 * dragging picks the nearest reading; tapping it again lets go. */
export function BodyChart({ points, trend, domain, width, height, tone, dense, selected, onSelect, label }: BodyChartProps) {
  const [from, to] = domain;
  const visible = points.filter(p => p.ts >= from && p.ts <= to);
  const firstIn = trend.findIndex(p => p.ts >= from);
  const trendIn = firstIn < 0 ? [] : trend.slice(Math.max(0, firstIn - 1)).filter(p => p.ts <= to);
  const { lo, hi, ticks } = yScale([...visible.map(p => p.value), ...trendIn.filter(p => p.ts >= from).map(p => p.value)]);

  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const x = (ts: number) => PAD_L + ((ts - from) / Math.max(1, to - from)) * plotW;
  const y = (v: number) => PAD_T + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * plotH;

  // The point before the range is drawn where the line crosses the range's left edge.
  const drawn = trendIn.map((p, i) => {
    const next = trendIn[i + 1];
    if (p.ts >= from || !next || next.ts - p.ts > GAP_MS) return { ...p, skip: p.ts < from };
    const f = (from - p.ts) / (next.ts - p.ts);
    return { ts: from, value: p.value + f * (next.value - p.value), skip: false };
  });
  let path = '';
  drawn.forEach((p, i) => {
    if (p.skip) return;
    const prev = drawn[i - 1];
    const move = !prev || prev.skip || p.ts - prev.ts > GAP_MS;
    path += `${move ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`;
  });

  const pick = (event: ReactPointerEvent<SVGSVGElement>, toggle: boolean) => {
    if (visible.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    let best = visible[0];
    for (const p of visible) if (Math.abs(x(p.ts) - vx) < Math.abs(x(best.ts) - vx)) best = p;
    onSelect(toggle && selected === best.ts ? null : best.ts);
  };

  const sel = selected == null ? null : (visible.find(p => p.ts === selected) ?? null);
  const last = visible[visible.length - 1];
  const r = dense ? 1.7 : 2.6;

  return (
    <svg
      className={`body-chart is-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      role='img'
      data-interactive='true'
      aria-label={label}
      onPointerDown={event => pick(event, true)}
      onPointerMove={event => event.buttons === 1 && pick(event, false)}
    >
      {ticks.map(t => (
        <g key={t}>
          <line className='body-chart-grid' x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} />
          <text className='body-chart-ylabel' x={width - PAD_R + 6} y={y(t) + 3.5}>
            {formatDecimal(t, t % 1 === 0 ? 0 : 1)}
          </text>
        </g>
      ))}
      {xTicks(domain).map(t => (
        <text key={t.ts} className='body-chart-xlabel' x={x(t.ts)} y={height - 6} textAnchor='middle'>
          {t.label}
        </text>
      ))}
      {sel && <line className='body-chart-guide' x1={x(sel.ts)} x2={x(sel.ts)} y1={PAD_T - 4} y2={height - PAD_B} />}
      {visible.map(p => (
        <circle key={p.ts} className='body-chart-dot' cx={x(p.ts)} cy={y(p.value)} r={r} />
      ))}
      <path className='body-chart-trend' d={path} />
      {last && !sel && <circle className='body-chart-mark' cx={x(last.ts)} cy={y(last.value)} r={4.5} />}
      {sel && <circle className='body-chart-mark' cx={x(sel.ts)} cy={y(sel.value)} r={5} />}
    </svg>
  );
}
