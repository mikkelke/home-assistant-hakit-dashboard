import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import { nextHomeDayStartMs } from '../../energy/homeTime';
import { dailyOutlook, krValue, weekdayShort } from '../../energy/planView';
import type { PricePointMs } from '../../energy/priceTimeline';

interface WeekAheadProps {
  timeline: readonly PricePointMs[];
  nowMs: number;
}

const W = 352;
const H = 110;
const TOP = 26;
const BOTTOM = 78;
const MAX_DAYS = 7;

/** Days from tomorrow on: each day's low-to-high price range with its mean, the cheapest day in the
 * cheap colour and the dearest in the expensive one. Dashed days lean on the forecast. */
export function WeekAhead({ timeline, nowMs }: WeekAheadProps) {
  const days = useMemo(() => dailyOutlook(timeline, nextHomeDayStartMs(nowMs), MAX_DAYS), [timeline, nowMs]);
  if (days.length < 2) return null;

  const lo = Math.min(...days.map(d => d.minPrice));
  const hi = Math.max(...days.map(d => d.maxPrice));
  const span = Math.max(0.01, hi - lo);
  const y = (price: number) => BOTTOM - ((price - lo) / span) * (BOTTOM - TOP);
  const colW = W / days.length;
  const cheapestIdx = days.reduce((best, d, i) => (d.meanPrice < days[best].meanPrice ? i : best), 0);
  const dearestIdx = days.reduce((best, d, i) => (d.meanPrice > days[best].meanPrice ? i : best), 0);
  const anyEstimated = days.some(d => d.estimated);

  return (
    <>
      <div className='plan-row-head'>
        <span>Week ahead</span>
        {anyEstimated && (
          <span className='plan-chip plan-chip--ghost'>
            <Icon icon='mdi:wave' aria-hidden='true' />
            forecast
          </span>
        )}
        <span className='plan-chip plan-chip--band band--cheap'>
          <i className='plan-dot' />
          {weekdayShort(days[cheapestIdx].dayStartMs)} cheapest
        </span>
      </div>
      <div className='plan-card plan-card--chart'>
        <svg viewBox={`0 0 ${W} ${H}`} className='plan-chart' role='img' aria-label='Price outlook by day: low, average and high'>
          {days.map((day, i) => {
            const cx = (i + 0.5) * colW;
            const tone = i === cheapestIdx ? 'band--cheap' : i === dearestIdx ? 'band--expensive' : 'plan-week--plain';
            return (
              <g key={day.dayStartMs} className={tone}>
                <line x1={cx} y1={y(day.minPrice)} x2={cx} y2={y(day.maxPrice)} className='plan-week-halo' />
                <line
                  x1={cx}
                  y1={y(day.minPrice)}
                  x2={cx}
                  y2={y(day.maxPrice)}
                  className={`plan-week-range ${day.estimated ? 'plan-week-range--est' : ''}`}
                />
                <circle cx={cx} cy={y(day.meanPrice)} r={4.5} className='plan-week-mean' />
                <text x={cx} y={y(day.maxPrice) - 7} textAnchor='middle' className='plan-label plan-label--bold plan-label--strong'>
                  {krValue(day.maxPrice, 1)}
                </text>
                <text x={cx} y={y(day.minPrice) + 16} textAnchor='middle' className='plan-label'>
                  {krValue(day.minPrice, 1)}
                </text>
                <text x={cx} y={H - 3} textAnchor='middle' className='plan-label plan-label--bold'>
                  {weekdayShort(day.dayStartMs)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
