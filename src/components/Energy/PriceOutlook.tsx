import { priceLevel, type DayOutlook } from '../../energy';
import './PriceOutlook.css';

interface PriceOutlookProps {
  outlook: DayOutlook[];
}

/** Bare da-DK number, no unit suffix — the heading carries "kr/kWh" once instead of repeating it
 * on every row (mirrors EnergyChart.tsx's own local formatBarValue/PriceStrip's formatPriceLabel). */
function formatBarePrice(value: number): string {
  return value.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Extended outlook beyond the hourly "next 48 hours" chart — one row per day, Carnot-only. No
 * hourly detail this far out, so no scrub/callout here (a different granularity than a continuous
 * series): each row is a low–high range bar on a scale shared across every row, so the days compare
 * at a glance, the same shape as a week-ahead weather forecast's temperature bars. */
export function PriceOutlook({ outlook }: PriceOutlookProps) {
  if (outlook.length === 0) return null;

  const globalMin = Math.min(...outlook.map(day => day.minPrice));
  const globalMax = Math.max(...outlook.map(day => day.maxPrice));
  const globalRange = Math.max(0.01, globalMax - globalMin);

  return (
    <div className='price-outlook'>
      <div className='price-outlook-heading-row'>
        <h3 className='price-outlook-heading'>This week</h3>
        <span className='price-outlook-unit'>kr/kWh</span>
      </div>

      <div className='price-outlook-rows'>
        {outlook.map(day => {
          const leftPct = ((day.minPrice - globalMin) / globalRange) * 100;
          const widthPct = Math.max(4, ((day.maxPrice - day.minPrice) / globalRange) * 100);
          return (
            <div className='price-outlook-row' key={day.dayStartMs}>
              <span className='price-outlook-day'>{new Date(day.dayStartMs).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className='price-outlook-low'>{formatBarePrice(day.minPrice)}</span>
              <span className='price-outlook-track'>
                <span
                  className={`price-outlook-fill price-outlook-fill--${priceLevel(day.meanPrice)}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              </span>
              <span className='price-outlook-high'>{formatBarePrice(day.maxPrice)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
