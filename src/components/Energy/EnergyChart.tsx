import type { EnergyBar } from '../../energy';
import { hoursInRange } from '../../energy/period';
import './EnergyChart.css';

interface EnergyChartProps {
  bars: EnergyBar[];
  rangeStartMs: number;
  rangeEndMs: number;
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 240;
const PAD = { top: 14, right: 10, bottom: 26, left: 38 };
const HOUR_LABELS = [0, 6, 12, 18];
const NICE_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50];

/** Rounded-top / square-baseline bar outline; clamps the radius so short bars never overshoot. */
function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, h, w / 2));
  if (radius <= 0) {
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

/** Clean axis ticks above zero (e.g. 0.25/0.5/0.75/1); zero itself is the baseline, drawn separately. */
function niceScale(maxValue: number): { max: number; ticks: number[] } {
  const safeMax = maxValue > 0 ? maxValue : 1;
  const step = NICE_STEPS.find(candidate => safeMax / candidate <= 4) ?? NICE_STEPS[NICE_STEPS.length - 1];
  const count = Math.max(1, Math.ceil(safeMax / step));
  const ticks = Array.from({ length: count }, (_, i) => Math.round((i + 1) * step * 100) / 100);
  return { max: ticks[ticks.length - 1], ticks };
}

export function EnergyChart({ bars, rangeStartMs, rangeEndMs }: EnergyChartProps) {
  const slots = Math.max(1, hoursInRange(rangeStartMs, rangeEndMs));
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;
  const slotWidth = plotWidth / slots;
  const barWidth = Math.min(24, slotWidth - 2);

  const maxKWh = bars.reduce((max, bar) => Math.max(max, bar.kWh), 0);
  const { max: axisMax, ticks } = niceScale(maxKWh);
  const yFor = (value: number) => plotBottom - (value / axisMax) * plotHeight;
  const slotXFor = (startMs: number) => PAD.left + Math.round((startMs - rangeStartMs) / 3_600_000) * slotWidth;

  return (
    <svg className='energy-chart-svg' viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
      {ticks.map(tick => (
        <g key={tick}>
          <line x1={PAD.left} y1={yFor(tick)} x2={VIEW_WIDTH - PAD.right} y2={yFor(tick)} className='energy-chart-gridline' />
          <text x={PAD.left - 6} y={yFor(tick) + 3} textAnchor='end' className='energy-chart-tick-label'>
            {tick.toLocaleString('da-DK')}
          </text>
        </g>
      ))}

      <line x1={PAD.left} y1={plotBottom} x2={VIEW_WIDTH - PAD.right} y2={plotBottom} className='energy-chart-baseline' />

      {bars.map(bar => {
        const barX = slotXFor(bar.startMs) + (slotWidth - barWidth) / 2;
        const barTopY = yFor(bar.kWh);
        const barHeight = Math.max(0, plotBottom - barTopY);
        return <path key={bar.startMs} d={roundedTopRect(barX, barTopY, barWidth, barHeight, 4)} className='energy-chart-bar' />;
      })}

      {Array.from({ length: slots }, (_, slot) => {
        // ms-arg Date is pure; slot walk keeps labels correct on 23/25-hour DST days.
        const slotStartMs = rangeStartMs + slot * 3_600_000;
        const hour = new Date(slotStartMs).getHours();
        if (!HOUR_LABELS.includes(hour)) return null;
        const labelX = PAD.left + slot * slotWidth + slotWidth / 2;
        return (
          <text key={slotStartMs} x={labelX} y={VIEW_HEIGHT - PAD.bottom + 16} textAnchor='middle' className='energy-chart-axis-label'>
            {String(hour).padStart(2, '0')}
          </text>
        );
      })}
    </svg>
  );
}
