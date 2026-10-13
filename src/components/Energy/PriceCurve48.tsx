import { useId } from 'react';
import { homeDayStartMs, homeWallTime, nextHomeDayStartMs } from '../../energy/homeTime';
import { krValue, peakWindows } from '../../energy/planView';
import type { BandedPricePoint } from '../../energy/priceBands';
import type { PriceBlock } from '../../energy/startPlan';

interface PriceCurve48Props {
  banded: readonly BandedPricePoint[];
  nowMs: number;
  cheapest: PriceBlock | null;
  peakHours: readonly number[] | null;
}

const HOUR_MS = 3_600_000;
const W = 352;
const H = 132;
const TOP = 32;
const BOTTOM = 106;
const AXIS_Y = 126;
const LABEL_GAP = 22;

interface AxisLabel {
  x: number;
  text: string;
  peak: boolean;
}

/** Today's and tomorrow's hourly prices as bars in their relative bands, self-labelled: each day's
 * cheapest and dearest hour, the cheapest block, the peak-tariff window, a now line. Hatched bars
 * are forecast hours; elapsed hours are dimmed. */
export function PriceCurve48({ banded, nowMs, cheapest, peakHours }: PriceCurve48Props) {
  const hatchId = useId();
  const todayStart = homeDayStartMs(nowMs);
  const tomorrowStart = nextHomeDayStartMs(todayStart);
  const dayAfterStart = nextHomeDayStartMs(tomorrowStart);
  const hasTomorrow = banded.some(p => p.ms >= tomorrowStart && p.ms < dayAfterStart);
  const rangeEnd = hasTomorrow ? dayAfterStart : tomorrowStart;
  const points = banded.filter(p => p.ms >= todayStart && p.ms < rangeEnd);
  if (points.length === 0) return null;

  const slots = Math.round((rangeEnd - todayStart) / HOUR_MS);
  const slotW = W / slots;
  const barW = Math.max(1, slotW * 0.8);
  const x = (ms: number) => ((ms - todayStart) / HOUR_MS) * slotW;

  const maxPrice = Math.max(0, ...points.map(p => p.price));
  const minPrice = Math.min(0, ...points.map(p => p.price));
  const span = Math.max(0.01, maxPrice - minPrice);
  const y = (price: number) => BOTTOM - ((price - minPrice) / span) * (BOTTOM - TOP);
  const zeroY = y(0);
  const barTop = (price: number) => (price >= 0 ? Math.min(y(price), zeroY - 2) : zeroY);

  const days = [todayStart, ...(hasTomorrow ? [tomorrowStart] : [])].map(start => {
    const end = nextHomeDayStartMs(start);
    const dayPoints = points.filter(p => p.ms >= start && p.ms < end);
    if (dayPoints.length === 0) return { start, min: null, max: null };
    const min = dayPoints.reduce((a, b) => (b.price < a.price ? b : a));
    const max = dayPoints.reduce((a, b) => (b.price > a.price ? b : a));
    return { start, min, max };
  });

  const block = cheapest && cheapest.startMs < rangeEnd ? cheapest : null;
  const blockPoints = block ? points.filter(p => p.ms >= block.startMs && p.ms < block.endMs) : [];
  const blockTop = blockPoints.length > 0 ? Math.min(...blockPoints.map(p => barTop(p.price))) - 4 : 0;
  const blockLabelX = block ? (x(block.startMs) + x(Math.min(block.endMs, rangeEnd))) / 2 : null;

  const peaks = peakWindows(todayStart, rangeEnd, peakHours);
  const peakEdges = new Set<number>();
  for (const w of peaks) {
    peakEdges.add(w.startMs);
    peakEdges.add(w.endMs);
  }

  const axisLabels: AxisLabel[] = [];
  const seenHours = new Set<string>();
  for (let ms = todayStart; ms < rangeEnd; ms += HOUR_MS) {
    const { day, hour } = homeWallTime(ms);
    const key = `${day}:${hour}`;
    if (seenHours.has(key)) continue;
    seenHours.add(key);
    const peak = peakEdges.has(ms);
    const plain = hour % 6 === 0 && !(peaks.length > 0 && hour === 18);
    if (!peak && !plain) continue;
    const lx = ms === todayStart ? 0 : x(ms);
    const previous = axisLabels[axisLabels.length - 1];
    if (previous && lx - previous.x < LABEL_GAP) {
      if (!peak || previous.peak) continue;
      axisLabels.pop();
    }
    axisLabels.push({ x: lx, text: String(hour).padStart(2, '0'), peak });
  }

  const nowX = x(nowMs);
  const currentHourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='plan-chart' role='img' aria-label='Electricity price today and tomorrow, kr per kWh'>
      <defs>
        <pattern id={hatchId} width='4' height='4' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
          <rect width='1.6' height='4' fill='rgba(13, 15, 19, 0.6)' />
        </pattern>
      </defs>

      {peaks.map(w => (
        <rect
          key={w.startMs}
          x={x(w.startMs)}
          y={TOP - 8}
          width={x(w.endMs) - x(w.startMs)}
          height={BOTTOM - TOP + 8}
          className='plan-peak'
        />
      ))}

      {hasTomorrow && <line x1={x(tomorrowStart)} y1={4} x2={x(tomorrowStart)} y2={BOTTOM + 2} className='plan-divider' />}

      {points.map(p => {
        const top = barTop(p.price);
        const height = Math.max(2, Math.abs(y(p.price) - zeroY));
        const bx = x(p.ms) + (slotW - barW) / 2;
        return (
          <g key={p.ms} className={`band--${p.band} ${p.ms < currentHourMs ? 'plan-bar--past' : ''}`}>
            <rect x={bx} y={top} width={barW} height={height} rx={Math.min(2, barW / 3)} className='plan-bar' />
            {p.estimated && <rect x={bx} y={top} width={barW} height={height} fill={`url(#${hatchId})`} />}
          </g>
        );
      })}

      {block && blockPoints.length > 0 && blockLabelX != null && (
        <g className='band--cheap'>
          <rect
            x={x(block.startMs) - 1}
            y={blockTop}
            width={x(Math.min(block.endMs, rangeEnd)) - x(block.startMs) + 2}
            height={BOTTOM - blockTop + 3}
            rx={4}
            className='plan-block'
          />
          <text x={blockLabelX} y={blockTop - 5} textAnchor='middle' className='plan-label plan-label--bold plan-label--band'>
            {krValue(block.avgPrice)}
          </text>
        </g>
      )}

      {days.flatMap(({ start, min, max }) =>
        [min, max].map((point, i) => {
          if (!point) return null;
          const cx = x(point.ms) + slotW / 2;
          if (i === 0 && blockLabelX != null && Math.abs(cx - blockLabelX) < 30) return null;
          const anchor = cx < 14 ? 'start' : cx > W - 14 ? 'end' : 'middle';
          return (
            <text
              key={`${start}-${i}`}
              x={anchor === 'start' ? 0 : anchor === 'end' ? W : cx}
              y={barTop(point.price) - 5}
              textAnchor={anchor}
              className={`plan-label plan-label--bold plan-label--band band--${point.band}`}
            >
              {krValue(point.price)}
            </text>
          );
        })
      )}

      <line x1={nowX} y1={20} x2={nowX} y2={BOTTOM + 2} className='plan-now-line' />
      <circle cx={nowX} cy={20} r={3.5} className='plan-now-dot' />

      <text x={2} y={11} className='plan-label plan-label--cap'>
        Today
      </text>
      {hasTomorrow && (
        <text x={x(tomorrowStart) + 4} y={11} className='plan-label plan-label--cap'>
          Tomorrow
        </text>
      )}

      {axisLabels.map(label => (
        <text
          key={label.x}
          x={label.x}
          y={AXIS_Y}
          textAnchor={label.x === 0 ? 'start' : 'middle'}
          className={`plan-label ${label.peak ? 'plan-label--bold plan-label--band band--expensive' : ''}`}
        >
          {label.text}
        </text>
      ))}
    </svg>
  );
}
