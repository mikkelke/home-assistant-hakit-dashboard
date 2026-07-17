import { useMemo } from 'react';
import { assembleBill, assembleBillPriceStats, type BillPriceStats, type EnergyBar, type EnergyView } from '../../energy';
import { formatClockHour, formatKr, formatPrice } from '../../utils/format';
import './BillCard.css';

interface BillCardProps {
  view: EnergyView;
  nowMs: number;
}

/** Tints a min/max price value the same way EnergyChart/PriceTab/PriceAdvisor color price
 * levels — see BillCard.css's own `.bill-card-price-stat-value--<level>` for the shared ramp. */
const PRICE_LEVEL_CLASS: Record<EnergyBar['level'], string> = {
  low: 'bill-card-price-stat-value--low',
  mid: 'bill-card-price-stat-value--mid',
  high: 'bill-card-price-stat-value--high',
  unknown: 'bill-card-price-stat-value--unknown',
};

/** WHEN a min/max bucket fell, phrased per `BillPriceStats.bucket`: "14:00" for an hour, "Mon
 * 14/7" for a day, "July" for a month — mirrors the app's other per-component local date-label
 * helpers (e.g. StatTiles.tsx's own `hourRangeLabel`) rather than a new shared formatter. */
function bucketWhenLabel(bucket: BillPriceStats['bucket'], ms: number): string {
  switch (bucket) {
    case 'hour':
      return formatClockHour(ms);
    case 'day':
      return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric' });
    case 'month':
      return new Date(ms).toLocaleDateString(undefined, { month: 'long' });
  }
}

/** Card "Bill": the visible period's bill — exact variable cost (HA's own cost stat) plus the
 * period's full share of the fixed subscription fees. The in-progress period additionally shows a
 * "Projected ≈" projection (see `assembleBill`); a past, fully-settled period shows only the
 * settled total, which is what reconciles with the actual Vindstød invoice. Renders the same way
 * for every view — day, week, month, year — against that view's own period totals. Below the
 * amounts, a price-spread row (see `assembleBillPriceStats`) shows the period's cheapest/priciest
 * bucket and the consumption-weighted average rate actually paid; omitted entirely when there's no
 * priced bar to derive it from. */
export function BillCard({ view, nowMs }: BillCardProps) {
  const bill = useMemo(() => assembleBill(view, nowMs), [view, nowMs]);
  const priceStats = useMemo(() => assembleBillPriceStats(view), [view]);

  return (
    <div className='bill-card'>
      <div className='bill-card-header'>
        <h2>Bill</h2>
      </div>

      <div className='bill-card-rows'>
        <div className='bill-card-row'>
          <span className='bill-card-row-label'>Consumption</span>
          <span className='bill-card-row-value'>{formatKr(bill.variableKr)}</span>
        </div>

        <div className='bill-card-row-group'>
          <div className='bill-card-row'>
            <span className='bill-card-row-label'>Subscription</span>
            <span className='bill-card-row-value'>{formatKr(bill.feesKr)}</span>
          </div>
          <p className='bill-card-note'>Radius net + Energinet TSO, incl. VAT</p>
        </div>

        <div className='bill-card-divider' />

        <div className='bill-card-row bill-card-row--total'>
          <span className='bill-card-row-label'>Total</span>
          <span className='bill-card-row-value'>{formatKr(bill.totalKr)}</span>
        </div>

        {bill.projectedTotalKr != null && (
          <div className='bill-card-row-group'>
            <div className='bill-card-row'>
              <span className='bill-card-row-label'>Projected</span>
              <span className='bill-card-row-value'>≈ {formatKr(bill.projectedTotalKr)}</span>
            </div>
            <p className='bill-card-note'>extrapolated from usage so far</p>
          </div>
        )}
      </div>

      {priceStats && (
        <div className='bill-card-price-stats'>
          <div className='bill-card-price-stat'>
            <span className='bill-card-price-stat-label'>Cheapest {priceStats.bucket}</span>
            <span className={`bill-card-price-stat-value ${PRICE_LEVEL_CLASS[priceStats.min.level]}`}>
              {formatPrice(priceStats.min.price)}
            </span>
            <span className='bill-card-price-stat-sub'>{bucketWhenLabel(priceStats.bucket, priceStats.min.startMs)}</span>
          </div>

          <div className='bill-card-price-stat'>
            <span className='bill-card-price-stat-label'>You paid on avg</span>
            <span className='bill-card-price-stat-value'>{formatPrice(priceStats.avgPaidKrPerKwh)}</span>
          </div>

          <div className='bill-card-price-stat'>
            <span className='bill-card-price-stat-label'>Priciest {priceStats.bucket}</span>
            <span className={`bill-card-price-stat-value ${PRICE_LEVEL_CLASS[priceStats.max.level]}`}>
              {formatPrice(priceStats.max.price)}
            </span>
            <span className='bill-card-price-stat-sub'>{bucketWhenLabel(priceStats.bucket, priceStats.max.startMs)}</span>
          </div>
        </div>
      )}

      <p className='bill-card-footnote'>Estimate — settled by the supplier (±4 %)</p>
    </div>
  );
}
