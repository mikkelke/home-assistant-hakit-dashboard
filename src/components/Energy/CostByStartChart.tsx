import { useId } from 'react';
import { homeWallTime } from '../../energy/homeTime';
import { krValue } from '../../energy/planView';
import { rankBands } from '../../energy/priceBands';
import type { CostCurve, PlanChoice } from '../../energy/startPlan';

interface CostByStartChartProps {
  curve: CostCurve;
  plan: PlanChoice | null;
  /** Label of the curve's first start: "now", or the clock time the machine frees up. */
  startLabel: string;
  /** Done-by clock label, when one is set. */
  doneByLabel: string | null;
}

const HOUR_MS = 3_600_000;
const W = 300;
const H = 122;
const TOP = 26;
const BOTTOM = 92;
const KNOB_Y = 100;
const AXIS_Y = 118;

/** What one run costs by the minute it starts, over the next 24 hours, in bands relative to this
 * curve. Dots under the bars are the starts the delay knob reaches when pressed now; the plan's
 * start is ringed. Hatched starts lean on forecast prices; starts that would miss done-by are
 * shaded. */
export function CostByStartChart({ curve, plan, startLabel, doneByLabel }: CostByStartChartProps) {
  const hatchId = useId();
  const { points, knobs } = curve;
  const priced = points.filter(p => p.costKr != null);
  if (points.length === 0 || priced.length === 0) return null;

  const fromMs = points[0].startMs;
  const spanMs = Math.max(HOUR_MS, points[points.length - 1].startMs - fromMs + (points[1] ? points[1].startMs - points[0].startMs : 0));
  const x = (ms: number) => ((ms - fromMs) / spanMs) * W;
  const slotW = W / points.length;
  const max = Math.max(...priced.map(p => p.costKr as number));
  const min = Math.min(0, ...priced.map(p => p.costKr as number));
  const range = Math.max(0.01, max - min);
  const y = (kr: number) => BOTTOM - ((kr - min) / range) * (BOTTOM - TOP);
  const bands = rankBands(points.map(p => p.costKr));

  // Neighbouring starts with the same band and source share one step-shaped path, so the area has
  // no hairline seams between bars.
  const runs: Array<{ from: number; band: string; estimated: boolean; d: string }> = [];
  let i = 0;
  while (i < points.length) {
    const p = points[i];
    if (p.costKr == null) {
      i++;
      continue;
    }
    const from = i;
    const base = y(0);
    let d = `M ${i * slotW} ${base}`;
    while (i < points.length && points[i].costKr != null && bands[i] === bands[from] && points[i].estimated === p.estimated) {
      const top = Math.min(y(points[i].costKr as number), base - 2);
      d += ` V ${top} H ${(i + 1) * slotW}`;
      i++;
    }
    runs.push({ from, band: bands[from], estimated: p.estimated, d: `${d} V ${base} Z` });
  }

  const firstLate = points.find(p => p.tooLate);
  const lateX = firstLate ? x(firstLate.startMs) : null;
  const planX = plan ? x(plan.startMs) : null;
  const planY = plan ? y(plan.costKr) : null;

  const axis: Array<{ x: number; text: string }> = [{ x: 0, text: startLabel }];
  for (let ms = Math.ceil(fromMs / HOUR_MS) * HOUR_MS; ms < fromMs + spanMs; ms += HOUR_MS) {
    const hour = homeWallTime(ms).hour;
    if (hour % 4 !== 2) continue;
    const lx = x(ms);
    if (lx - axis[axis.length - 1].x < (axis.length === 1 ? 26 + startLabel.length * 4 : 30) || lx > W - 8) continue;
    axis.push({ x: lx, text: String(hour).padStart(2, '0') });
  }

  const first = points[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='plan-chart' role='img' aria-label='Cost of one run by start time'>
      <defs>
        <pattern id={hatchId} width='4' height='4' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
          <rect width='1.6' height='4' fill='rgba(13, 15, 19, 0.6)' />
        </pattern>
      </defs>

      {runs.map(run => (
        <g key={run.from} className={`band--${run.band}`}>
          <path d={run.d} className='plan-cost-bar' />
          {run.estimated && <path d={run.d} fill={`url(#${hatchId})`} />}
        </g>
      ))}

      {lateX != null && (
        <g>
          <rect x={lateX} y={TOP - 18} width={W - lateX} height={BOTTOM - TOP + 18} className='plan-late' />
          <line x1={lateX} y1={TOP - 18} x2={lateX} y2={BOTTOM} className='plan-late-line' />
          {doneByLabel && W - lateX > 70 && (
            <text x={lateX + 5} y={TOP - 6} className='plan-label'>
              late for {doneByLabel}
            </text>
          )}
        </g>
      )}

      {knobs.map(k =>
        k.costKr == null || k.tooLate ? null : <circle key={k.knobMin} cx={x(k.startMs)} cy={KNOB_Y} r={1.8} className='plan-knob' />
      )}

      {first.costKr != null && (
        <text x={0} y={Math.max(14, y(first.costKr) - 6)} className='plan-label plan-label--bold plan-label--strong plan-label--halo'>
          {krValue(first.costKr)}
        </text>
      )}

      {plan && planX != null && planY != null && planX > 34 && (
        <g className='band--cheap'>
          <line x1={planX} y1={planY} x2={planX} y2={KNOB_Y} className='plan-plan-line' />
          <circle cx={planX} cy={KNOB_Y} r={4} className='plan-plan-dot' />
          <text
            x={Math.min(W - 16, Math.max(16, planX))}
            y={Math.max(14, planY - 6)}
            textAnchor='middle'
            className='plan-label plan-label--bold plan-label--band plan-label--halo'
          >
            {krValue(plan.costKr)}
          </text>
        </g>
      )}

      {axis.map((label, i) => (
        <text
          key={label.x}
          x={label.x}
          y={AXIS_Y}
          textAnchor={i === 0 ? 'start' : 'middle'}
          className={`plan-label ${i === 0 ? 'plan-label--bold plan-label--strong' : ''}`}
        >
          {label.text}
        </text>
      ))}
    </svg>
  );
}
