import { formatHomeClock } from '../../energy/homeTime';

const W = 600;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

export interface EventChartProps {
  points: readonly { ts: number; value: number }[];
  startMs: number;
  endMs: number;
  /** The row's moment, drawn as a line; the time after it is lightly shaded. */
  eventMs: number;
  /** A second moment, such as where a run started. */
  markMs?: number | null;
  unit: string;
  /** A dashed level, such as the soil a plant should be watered at. */
  level?: number | null;
  /** Readings change only when they move, so the line is held to the window's end at its last value. */
  holdToEnd?: boolean;
  label: string;
}

function ticks(lo: number, hi: number): [number, number] {
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

/** One series around a timeline event, the event marked. */
export function EventChart({ points, startMs, endMs, eventMs, markMs, unit, level, holdToEnd = true, label }: EventChartProps) {
  const inside = points.filter(p => p.ts <= endMs);
  const before = [...inside].reverse().find(p => p.ts <= startMs);
  const series = [...(before ? [{ ts: startMs, value: before.value }] : []), ...inside.filter(p => p.ts > startMs)];
  if (holdToEnd && series.length > 0 && series[series.length - 1].ts < endMs)
    series.push({ ts: endMs, value: series[series.length - 1].value });
  if (series.length < 2) return <p className='evd-empty'>No readings recorded for this time.</p>;

  const values = series.map(p => p.value).concat(level != null ? [level] : []);
  const [lo, hi] = ticks(Math.min(...values), Math.max(...values));
  const x = (ts: number) => PAD.left + ((ts - startMs) / Math.max(1, endMs - startMs)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  // A step line: a reading holds until the next one.
  const path = series
    .map((p, i) => (i === 0 ? `M ${x(p.ts).toFixed(1)} ${y(p.value).toFixed(1)}` : `H ${x(p.ts).toFixed(1)} V ${y(p.value).toFixed(1)}`))
    .join(' ');
  const fmt = (v: number) => `${Math.round(v)}${unit}`;
  const ex = x(Math.min(Math.max(eventMs, startMs), endMs));

  return (
    <svg className='evd-chart' viewBox={`0 0 ${W} ${H}`} role='img' aria-label={label}>
      <rect className='evd-after' x={ex} y={PAD.top} width={Math.max(0, W - PAD.right - ex)} height={H - PAD.top - PAD.bottom} />
      <text className='evd-axis' x={PAD.left - 6} y={PAD.top + 4} textAnchor='end'>
        {fmt(hi)}
      </text>
      <text className='evd-axis' x={PAD.left - 6} y={H - PAD.bottom} textAnchor='end'>
        {fmt(lo)}
      </text>
      {level != null && <line className='evd-level' x1={PAD.left} x2={W - PAD.right} y1={y(level)} y2={y(level)} />}
      {markMs != null && markMs >= startMs && markMs <= endMs && (
        <line className='evd-mark' x1={x(markMs)} x2={x(markMs)} y1={PAD.top} y2={H - PAD.bottom} />
      )}
      <line className='evd-event' x1={ex} x2={ex} y1={PAD.top} y2={H - PAD.bottom} />
      <path className='evd-line' d={path} />
      {ex - PAD.left > 80 && (
        <text className='evd-axis' x={PAD.left} y={H - 6}>
          {formatHomeClock(startMs)}
        </text>
      )}
      <text className='evd-axis' x={ex} y={H - 6} textAnchor='middle'>
        {formatHomeClock(eventMs)}
      </text>
      {W - PAD.right - ex > 80 && (
        <text className='evd-axis' x={W - PAD.right} y={H - 6} textAnchor='end'>
          {formatHomeClock(endMs)}
        </text>
      )}
    </svg>
  );
}
