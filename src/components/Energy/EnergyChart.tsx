import type { EnergyBar, Period } from '../../energy';
import { slotsInRange } from '../../energy/period';
import { CHART_PAD_LEFT, CHART_PAD_RIGHT, CHART_VIEW_WIDTH, slotIndexFor, slotStartMsFor } from './chartGeometry';
import type { ScrubHandlers } from './useChartScrub';
import './EnergyChart.css';

interface EnergyChartProps {
  bars: EnergyBar[];
  rangeStartMs: number;
  rangeEndMs: number;
  period: Period;
  unit: 'kwh' | 'kr';
  scrubHandlers?: ScrubHandlers;
  selectedStartMs?: number | null;
  hasSelection?: boolean;
}

const VIEW_WIDTH = CHART_VIEW_WIDTH;
const VIEW_HEIGHT = 240;
const PAD = { top: 14, right: CHART_PAD_RIGHT, bottom: 26, left: CHART_PAD_LEFT };
const HOUR_LABELS = [0, 6, 12, 18];
const MONTH_LABEL_SLOTS = [0, 7, 14, 21, 28];
const WEEKDAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // index = Date#getDay(): 0 = Sunday
const MONTH_AXIS_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

export function EnergyChart({
  bars,
  rangeStartMs,
  rangeEndMs,
  period,
  unit,
  scrubHandlers,
  selectedStartMs,
  hasSelection,
}: EnergyChartProps) {
  // No axes, no gridlines — just the message (HA-restart gaps, or a year view's months before
  // Dec 2025, an absent period rather than a genuine zero).
  if (bars.length === 0) {
    return <div className='energy-chart-empty'>No data for this period</div>;
  }

  const slots = Math.max(1, slotsInRange(period, rangeStartMs, rangeEndMs));
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotBottom = VIEW_HEIGHT - PAD.bottom;
  const plotHeight = plotBottom - PAD.top;
  const slotWidth = plotWidth / slots;
  const barWidth = Math.min(24, slotWidth - 2);

  const valueFor = (bar: EnergyBar) => (unit === 'kr' ? bar.costKr : bar.kWh);
  const maxValue = bars.reduce((max, bar) => Math.max(max, valueFor(bar)), 0);
  const { max: axisMax, ticks } = niceScale(maxValue);
  const yFor = (value: number) => plotBottom - (value / axisMax) * plotHeight;
  const slotXFor = (startMs: number) => PAD.left + slotIndexFor(period, rangeStartMs, startMs) * slotWidth;

  const maxBar = bars.reduce<EnergyBar | null>((best, bar) => (best === null || valueFor(bar) > valueFor(best) ? bar : best), null);

  const selectedSlot = selectedStartMs != null ? slotIndexFor(period, rangeStartMs, selectedStartMs) : null;
  const guideX = selectedSlot != null && selectedSlot >= 0 && selectedSlot < slots ? PAD.left + (selectedSlot + 0.5) * slotWidth : null;
  const selectedBar = selectedStartMs != null ? (bars.find(bar => bar.startMs === selectedStartMs) ?? null) : null;

  return (
    // data-interactive: escape hatch useSwipeToClose already recognizes — scrubbing is a
    // horizontal gesture, so a swipe starting on the chart must not be read as swipe-to-close.
    <svg
      className={`energy-chart-svg ${hasSelection ? 'energy-chart-svg--has-selection' : ''}`}
      data-interactive='true'
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      {...scrubHandlers}
    >
      {ticks.map(tick => (
        <g key={tick}>
          <line x1={PAD.left} y1={yFor(tick)} x2={VIEW_WIDTH - PAD.right} y2={yFor(tick)} className='energy-chart-gridline' />
          <text x={PAD.left - 6} y={yFor(tick) + 3} textAnchor='end' className='energy-chart-tick-label'>
            {tick.toLocaleString('da-DK')}
          </text>
        </g>
      ))}

      <line x1={PAD.left} y1={plotBottom} x2={VIEW_WIDTH - PAD.right} y2={plotBottom} className='energy-chart-baseline' />

      {guideX != null && <line x1={guideX} y1={PAD.top} x2={guideX} y2={plotBottom} className='energy-chart-guide' />}

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

      {guideX != null && selectedBar && <circle cx={guideX} cy={yFor(valueFor(selectedBar))} r={3} className='energy-chart-guide-dot' />}

      {!hasSelection && maxBar && valueFor(maxBar) > 0 && (
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
    </svg>
  );
}
