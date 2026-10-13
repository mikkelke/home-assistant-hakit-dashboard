import type { MouseEvent } from 'react';
import type { EnergyBar } from '../../energy';
import { slotsInRange } from '../../energy/period';
import type { BandedPricePoint } from '../../energy/priceBands';

interface UsageClockProps {
  bars: EnergyBar[];
  prices: readonly BandedPricePoint[];
  rangeStartMs: number;
  rangeEndMs: number;
  nowMs: number;
  unit: 'kwh' | 'kr';
  centre: { primary: string; secondary: string; note: string | null };
  selectedMs: number | null;
  onSelect: (slotStartMs: number) => void;
}

const S = 320;
const C = S / 2;
const R_IN = 62;
const R_BAR = 120;
const RING_IN = 128;
const RING_OUT = 136;
const HOUR_MS = 3_600_000;
const TAU = Math.PI * 2;

function polar(r: number, a: number): string {
  return `${(C + r * Math.sin(a)).toFixed(1)} ${(C - r * Math.cos(a)).toFixed(1)}`;
}

function wedge(rIn: number, rOut: number, a0: number, a1: number): string {
  return `M${polar(rOut, a0)}A${rOut} ${rOut} 0 0 1 ${polar(rOut, a1)}L${polar(rIn, a1)}A${rIn} ${rIn} 0 0 0 ${polar(rIn, a0)}Z`;
}

/** The day as a 24-hour clock: wedge length is the hour's use, colour its price band, and an
 * outer ring shows every priced hour. Midnight at the top, a hand at now. */
export function UsageClock({ bars, prices, rangeStartMs, rangeEndMs, nowMs, unit, centre, selectedMs, onSelect }: UsageClockProps) {
  const slots = Math.max(1, slotsInRange('day', rangeStartMs, rangeEndMs));
  const step = TAU / slots;
  const gap = step * 0.08;
  const slotOf = (ms: number) => Math.round((ms - rangeStartMs) / HOUR_MS);
  const valueOf = (bar: EnergyBar) => (unit === 'kr' ? bar.costKr : bar.kWh);
  const max = Math.max(0, ...bars.map(valueOf));
  const nowAngle = nowMs >= rangeStartMs && nowMs < rangeEndMs ? ((nowMs - rangeStartMs) / HOUR_MS) * step : null;

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * S - C;
    const y = ((event.clientY - rect.top) / rect.height) * S - C;
    const r = Math.hypot(x, y);
    if (r < R_IN - 8 || r > RING_OUT + 12) return;
    const angle = (Math.atan2(x, -y) + TAU) % TAU;
    const ms = rangeStartMs + Math.floor(angle / step) * HOUR_MS;
    if (bars.some(bar => bar.startMs === ms) || prices.some(point => point.ms === ms)) onSelect(ms);
  };

  const selectedSlot = selectedMs != null ? slotOf(selectedMs) : null;

  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className='ev-clock'
      data-interactive='true'
      role='img'
      aria-label='24 hour clock: wedge length is use per hour, colour is price band. Tap an hour for details.'
      onClick={handleClick}
    >
      {prices.map(point => {
        const slot = slotOf(point.ms);
        if (slot < 0 || slot >= slots) return null;
        return (
          <path
            key={`p${point.ms}`}
            d={wedge(RING_IN, RING_OUT, slot * step + gap, (slot + 1) * step - gap)}
            className={`ev-clock-ring band--${point.band}`}
          />
        );
      })}
      {bars.map(bar => {
        const slot = slotOf(bar.startMs);
        const r = R_IN + Math.max(2, max > 0 ? (valueOf(bar) / max) * (R_BAR - R_IN) : 2);
        return (
          <path
            key={bar.startMs}
            d={wedge(R_IN, r, slot * step + gap, (slot + 1) * step - gap)}
            className={`energy-chart-bar band--${bar.level}${bar.partial ? ' energy-chart-bar--partial' : ''}`}
          />
        );
      })}
      {selectedSlot != null && selectedSlot >= 0 && selectedSlot < slots && (
        <path d={wedge(R_IN - 3, RING_OUT + 3, selectedSlot * step, (selectedSlot + 1) * step)} className='energy-chart-selected' />
      )}
      {nowAngle != null && (
        <>
          <line
            x1={C + (R_IN - 4) * Math.sin(nowAngle)}
            y1={C - (R_IN - 4) * Math.cos(nowAngle)}
            x2={C + (RING_OUT + 4) * Math.sin(nowAngle)}
            y2={C - (RING_OUT + 4) * Math.cos(nowAngle)}
            className='plan-now-line'
          />
          <circle
            cx={C + (RING_OUT + 4) * Math.sin(nowAngle)}
            cy={C - (RING_OUT + 4) * Math.cos(nowAngle)}
            r={3.5}
            className='plan-now-dot'
          />
        </>
      )}
      {Array.from({ length: slots }, (_, slot) => {
        const hour = new Date(rangeStartMs + slot * HOUR_MS).getHours();
        if (hour % 6 !== 0) return null;
        const a = slot * step;
        return (
          <text
            key={slot}
            x={C + 150 * Math.sin(a)}
            y={C - 150 * Math.cos(a) + 4}
            textAnchor='middle'
            className='plan-label plan-label--bold'
          >
            {String(hour).padStart(2, '0')}
          </text>
        );
      })}
      <text x={C} y={C - 2} textAnchor='middle' className='ev-ck1'>
        {centre.primary}
      </text>
      <text x={C} y={C + 18} textAnchor='middle' className='ev-ck2'>
        {centre.secondary}
      </text>
      {centre.note && (
        <text x={C} y={C + 35} textAnchor='middle' className='plan-label'>
          {centre.note}
        </text>
      )}
    </svg>
  );
}
