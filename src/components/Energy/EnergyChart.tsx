import type { MouseEvent } from 'react';
import type { EnergyBar, Period } from '../../energy';
import { slotsInRange } from '../../energy/period';
import type { BandedPricePoint } from '../../energy/priceBands';
import { slotIndexFor, slotStartMsFor } from './chartGeometry';
import './EnergyChart.css';

interface EnergyChartProps {
  bars: EnergyBar[];
  rangeStartMs: number;
  rangeEndMs: number;
  period: Period;
  unit: 'kwh' | 'kr';
  nowMs: number;
  /** The day's priced hours: a band tick under every hour, future ones included. */
  prices?: readonly BandedPricePoint[];
  selectedMs: number | null;
  onSelect: (slotStartMs: number) => void;
  /** Unit of the bars' non-kr values. */
  amountUnit?: string;
  /** Text under the `nowMs` line; null leaves the line unlabelled and every axis label in place. */
  nowLabel?: string | null;
}

const W = 352;
const H = 158;
const TOP = 20;
const BASE = 116;
const STRIP_Y = 122;
const AXIS_Y = 150;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [1, 8, 15, 22, 29];

function axisLabel(period: Period, ms: number): string | null {
  const d = new Date(ms);
  switch (period) {
    case 'day':
      return d.getHours() % 6 === 0 ? String(d.getHours()).padStart(2, '0') : null;
    case 'week':
      return WEEKDAYS[d.getDay()];
    case 'month':
      return MONTH_DAYS.includes(d.getDate()) ? String(d.getDate()) : null;
    case 'year':
      return MONTHS[d.getMonth()];
  }
}

function value(bar: EnergyBar, unit: 'kwh' | 'kr'): number {
  return unit === 'kr' ? bar.costKr : bar.kWh;
}

/** Consumption bars tinted by relative price band, self-labelled: the biggest bar's value, a now
 * line, and on the day view a band tick under every priced hour. Tapping a slot selects it. */
export function EnergyChart({
  bars,
  rangeStartMs,
  rangeEndMs,
  period,
  unit,
  nowMs,
  prices,
  selectedMs,
  onSelect,
  amountUnit = 'kWh',
  nowLabel = 'now',
}: EnergyChartProps) {
  if (bars.length === 0 && !prices?.length) return <div className='energy-chart-empty'>No data for this period</div>;

  const slots = Math.max(1, slotsInRange(period, rangeStartMs, rangeEndMs));
  const slotW = W / slots;
  const barW = Math.min(28, slotW * 0.76);
  const slotOf = (ms: number) => slotIndexFor(period, rangeStartMs, ms);
  const max = Math.max(0, ...bars.map(bar => value(bar, unit)));
  const y = (v: number) => BASE - (max > 0 ? (v / max) * (BASE - TOP) : 0);
  const maxBar = max > 0 ? bars.find(bar => value(bar, unit) === max) : undefined;

  let nowX: number | null = null;
  if (nowMs >= rangeStartMs && nowMs < rangeEndMs) {
    const slot = slotOf(nowMs);
    const start = slotStartMsFor(period, rangeStartMs, slot);
    const end = slotStartMsFor(period, rangeStartMs, slot + 1);
    nowX = (slot + (nowMs - start) / Math.max(1, end - start)) * slotW;
  }

  const labels: Array<{ x: number; text: string; anchor: 'start' | 'middle' | 'end' }> = [];
  for (let slot = 0; slot < slots; slot++) {
    const text = axisLabel(period, slotStartMsFor(period, rangeStartMs, slot));
    if (text == null) continue;
    labels.push(
      period === 'day'
        ? { x: slot * slotW, text, anchor: slot === 0 ? 'start' : 'middle' }
        : { x: (slot + 0.5) * slotW, text, anchor: 'middle' }
    );
  }
  if (period === 'day') labels.push({ x: W, text: '24', anchor: 'end' });

  const selectedSlot = selectedMs != null ? slotOf(selectedMs) : null;
  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const slot = Math.min(slots - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * slots)));
    const ms = slotStartMsFor(period, rangeStartMs, slot);
    if (bars.some(bar => bar.startMs === ms) || prices?.some(point => point.ms === ms)) onSelect(ms);
  };

  const maxLabelX = maxBar ? (slotOf(maxBar.startMs) + 0.5) * slotW : 0;
  const decimals = unit === 'kr' || period === 'day' || max < 1 ? 2 : 1;

  return (
    <svg
      className='energy-chart-svg'
      data-interactive='true'
      viewBox={`0 0 ${W} ${H}`}
      role='img'
      aria-label={`${unit === 'kr' ? 'Kroner' : amountUnit} per ${period === 'day' ? 'hour' : period === 'year' ? 'month' : 'day'}${bars.some(bar => bar.level !== 'unknown') ? ', tinted by price band' : ''}. Tap a bar for details.`}
      onClick={handleClick}
    >
      <line x1={0} y1={BASE + 0.5} x2={W} y2={BASE + 0.5} className='energy-chart-baseline' />
      {prices?.map(point => {
        const slot = slotOf(point.ms);
        if (slot < 0 || slot >= slots) return null;
        return (
          <rect
            key={point.ms}
            x={slot * slotW + 1}
            y={STRIP_Y}
            width={Math.max(1, slotW - 2)}
            height={4}
            rx={1}
            className={`energy-chart-tick band--${point.band}`}
          />
        );
      })}
      {bars.map(bar => {
        const v = value(bar, unit);
        const top = y(v);
        const x = (slotOf(bar.startMs) + 0.5) * slotW - barW / 2;
        const cls = `energy-chart-bar band--${bar.level}${bar.partial ? ' energy-chart-bar--partial' : ''}`;
        return (
          <rect
            key={bar.startMs}
            x={x}
            y={Math.min(top, BASE - 2)}
            width={barW}
            height={Math.max(2, BASE - top)}
            rx={Math.min(3, barW / 3)}
            className={cls}
          />
        );
      })}
      {selectedSlot != null && selectedSlot >= 0 && selectedSlot < slots && (
        <rect
          x={selectedSlot * slotW + 0.75}
          y={TOP - 4}
          width={slotW - 1.5}
          height={STRIP_Y + 4 - TOP + 4}
          rx={4}
          className='energy-chart-selected'
        />
      )}
      {maxBar && (
        <text
          x={Math.min(W - 2, Math.max(2, maxLabelX))}
          y={TOP - 7}
          textAnchor={maxLabelX < 30 ? 'start' : maxLabelX > W - 30 ? 'end' : 'middle'}
          className='plan-label plan-label--bold plan-label--strong'
        >
          {max.toLocaleString('da-DK', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{' '}
          {unit === 'kr' ? 'kr' : amountUnit}
        </text>
      )}
      {nowX != null && (
        <>
          <line x1={nowX} y1={8} x2={nowX} y2={STRIP_Y + 6} className='plan-now-line' strokeDasharray='2 3' />
          <circle cx={nowX} cy={8} r={3.5} className='plan-now-dot' />
        </>
      )}
      {labels
        .filter(label => nowX == null || nowLabel == null || Math.abs(label.x - nowX) > 16)
        .map(label => (
          <text key={`${label.x}`} x={label.x} y={AXIS_Y} textAnchor={label.anchor} className='plan-label'>
            {label.text}
          </text>
        ))}
      {nowX != null && nowLabel != null && (
        <text
          x={Math.min(W - 12, Math.max(12, nowX))}
          y={AXIS_Y}
          textAnchor='middle'
          className='plan-label plan-label--bold plan-label--strong'
        >
          {nowLabel}
        </text>
      )}
    </svg>
  );
}
