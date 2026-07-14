import type { EnergyBar, Period } from '../../energy';
import { addDays, addMonths, localDayIndex, localMonthIndex, slotsInRange } from '../../energy/period';
import './EnergyChart.css';

interface EnergyChartProps {
  bars: EnergyBar[];
  rangeStartMs: number;
  rangeEndMs: number;
  period: Period;
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 240;
const PAD = { top: 14, right: 10, bottom: 26, left: 38 };
const HOUR_LABELS = [0, 6, 12, 18];
const MONTH_LABEL_SLOTS = [0, 7, 14, 21, 28];
const WEEKDAY_LETTERS = ['sø', 'ma', 'ti', 'on', 'to', 'fr', 'lø']; // index = Date#getDay(): 0 = Sunday
const MONTH_AXIS_LABELS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const NICE_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

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

/** Bucket index for a bar's startMs along the visible slots. Day uses hour-quantized ms math
 * (every hour bucket is exactly 3.6M ms, DST or not); week/month/year use the component-based
 * helpers from period.ts so a DST transition or absent bucket never misplaces a bar. */
function slotIndexFor(period: Period, rangeStartMs: number, ms: number): number {
  switch (period) {
    case 'day':
      return Math.round((ms - rangeStartMs) / 3_600_000);
    case 'week':
    case 'month':
      return localDayIndex(rangeStartMs, ms);
    case 'year':
      return localMonthIndex(rangeStartMs, ms);
  }
}

/** Wall-clock start of hypothetical slot `slot` — used only to place x-axis tick labels, so
 * absent bars (DST gaps, months before Dec 2025) never affect where a label falls. */
function slotStartMsFor(period: Period, rangeStartMs: number, slot: number): number {
  switch (period) {
    case 'day':
      return rangeStartMs + slot * 3_600_000;
    case 'week':
    case 'month':
      return addDays(rangeStartMs, slot);
    case 'year':
      return addMonths(rangeStartMs, slot);
  }
}

/** Tick label for a given slot, or null to leave it unlabeled (selective labeling per period). */
function axisLabelFor(period: Period, slotStartMs: number, slot: number): string | null {
  switch (period) {
    case 'day': {
      const hour = new Date(slotStartMs).getHours();
      return HOUR_LABELS.includes(hour) ? String(hour).padStart(2, '0') : null;
    }
    case 'week':
      return WEEKDAY_LETTERS[new Date(slotStartMs).getDay()];
    case 'month':
      return MONTH_LABEL_SLOTS.includes(slot) ? String(new Date(slotStartMs).getDate()) : null;
    case 'year':
      return slot % 3 === 0 ? MONTH_AXIS_LABELS[new Date(slotStartMs).getMonth()] : null;
  }
}

export function EnergyChart({ bars, rangeStartMs, rangeEndMs, period }: EnergyChartProps) {
  const slots = Math.max(1, slotsInRange(period, rangeStartMs, rangeEndMs));
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;
  const slotWidth = plotWidth / slots;
  const barWidth = Math.min(24, slotWidth - 2);

  const maxKWh = bars.reduce((max, bar) => Math.max(max, bar.kWh), 0);
  const { max: axisMax, ticks } = niceScale(maxKWh);
  const yFor = (value: number) => plotBottom - (value / axisMax) * plotHeight;
  const slotXFor = (startMs: number) => PAD.left + slotIndexFor(period, rangeStartMs, startMs) * slotWidth;

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
        const slotStartMs = slotStartMsFor(period, rangeStartMs, slot);
        const label = axisLabelFor(period, slotStartMs, slot);
        if (label === null) return null;
        const labelX = PAD.left + slot * slotWidth + slotWidth / 2;
        return (
          <text key={slot} x={labelX} y={VIEW_HEIGHT - PAD.bottom + 16} textAnchor='middle' className='energy-chart-axis-label'>
            {label}
          </text>
        );
      })}
    </svg>
  );
}
