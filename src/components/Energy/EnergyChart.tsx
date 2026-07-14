import type { EnergyBar, Period } from '../../energy';
import { addDays, addMonths, localDayIndex, localMonthIndex, slotsInRange } from '../../energy/period';
import './EnergyChart.css';

interface EnergyChartProps {
  bars: EnergyBar[];
  rangeStartMs: number;
  rangeEndMs: number;
  period: Period;
  unit: 'kwh' | 'kr';
  onSelectBar?: (bar: EnergyBar | null) => void;
  selectedStartMs?: number | null;
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 240;
const PAD = { top: 14, right: 10, bottom: 26, left: 38 };
/** Floor for the invisible tap-target rects — on a narrow phone the month view's ~31 slots can
 * render a natural slot width under 10px; below that a tap becomes unreliable, so the hit rect
 * expands beyond its own slot (centered) and accepts overlap with its neighbors. */
const MIN_HIT_RECT_WIDTH = 12;
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

/** Bare da-DK number for the on-chart value label — no unit suffix (1 decimal kWh / 2 decimals kr). */
function formatBarValue(value: number, unit: 'kwh' | 'kr'): string {
  const decimals = unit === 'kr' ? 2 : 1;
  return value.toLocaleString('da-DK', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function EnergyChart({ bars, rangeStartMs, rangeEndMs, period, unit, onSelectBar, selectedStartMs }: EnergyChartProps) {
  // No axes, no gridlines — just the message (HA-restart gaps, or a year view's months before
  // Dec 2025, an absent period rather than a genuine zero).
  if (bars.length === 0) {
    return <div className='energy-chart-empty'>Ingen data for denne periode</div>;
  }

  const slots = Math.max(1, slotsInRange(period, rangeStartMs, rangeEndMs));
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;
  const slotWidth = plotWidth / slots;
  const barWidth = Math.min(24, slotWidth - 2);
  const hitRectWidth = Math.max(slotWidth, MIN_HIT_RECT_WIDTH);

  const valueFor = (bar: EnergyBar) => (unit === 'kr' ? bar.costKr : bar.kWh);
  const maxValue = bars.reduce((max, bar) => Math.max(max, valueFor(bar)), 0);
  const { max: axisMax, ticks } = niceScale(maxValue);
  const yFor = (value: number) => plotBottom - (value / axisMax) * plotHeight;
  const slotXFor = (startMs: number) => PAD.left + slotIndexFor(period, rangeStartMs, startMs) * slotWidth;

  const maxBar = bars.reduce<EnergyBar | null>((best, bar) => (best === null || valueFor(bar) > valueFor(best) ? bar : best), null);

  return (
    // data-interactive: escape hatch useSwipeToClose already recognizes (see its
    // isInteractiveElement allowlist) — the bar hit-rects below are real tap targets, so a swipe
    // gesture starting on the chart must not be read as a swipe-to-close.
    <svg className='energy-chart-svg' data-interactive='true' viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
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
        const value = valueFor(bar);
        const barX = slotXFor(bar.startMs) + (slotWidth - barWidth) / 2;
        const barTopY = yFor(value);
        const barHeight = Math.max(0, plotBottom - barTopY);
        const isSelected = selectedStartMs === bar.startMs;
        const classNames = ['energy-chart-bar', `energy-chart-bar--${bar.level}`];
        if (bar.partial) classNames.push('energy-chart-bar--partial');
        if (isSelected) classNames.push('energy-chart-bar--selected');
        return <path key={bar.startMs} d={roundedTopRect(barX, barTopY, barWidth, barHeight, 4)} className={classNames.join(' ')} />;
      })}

      {maxBar && valueFor(maxBar) > 0 && selectedStartMs !== maxBar.startMs && (
        <text
          x={slotXFor(maxBar.startMs) + slotWidth / 2}
          y={yFor(valueFor(maxBar)) - 6}
          textAnchor='middle'
          className='energy-chart-value-label'
        >
          {formatBarValue(valueFor(maxBar), unit)}
        </text>
      )}

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

      {onSelectBar &&
        bars.map(bar => (
          <rect
            key={`hit-${bar.startMs}`}
            x={slotXFor(bar.startMs) + (slotWidth - hitRectWidth) / 2}
            y={PAD.top}
            width={hitRectWidth}
            height={plotHeight}
            className='energy-chart-hit-rect'
            onPointerDown={() => onSelectBar(selectedStartMs === bar.startMs ? null : bar)}
          />
        ))}
    </svg>
  );
}
