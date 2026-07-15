import { useMemo } from 'react';
import { assembleForecast, priceLevel, useEnergyView, type EnergyBar } from '../../energy';
import { formatPrice } from '../../utils/format';
import { PriceForecast } from './PriceForecast';
import './PriceTab.css';
import './StatTiles.css'; // hero tile below reuses .stat-tiles/.stat-tile* directly (see render)

interface PriceTabProps {
  nowMs: number;
  todayStartMs: number;
}

const PRICE_LEVEL_WORD: Record<EnergyBar['level'], string> = {
  low: 'cheap',
  mid: 'normal',
  high: 'expensive',
  unknown: 'unknown',
};

/** Tab "Price": current rate, the next 48 hours in detail, and the week ahead — split out of Live
 * (which stays focused on real-time power draw) so the price picture gets its own uncluttered read.
 * Reuses the day view's own hook purely for `priceAttrs` (the live price entity's attributes); its
 * bars/totals go unused here, but the module cache means this rarely costs a second fetch when
 * Live or Usage are also viewing today. */
export function PriceTab({ nowMs, todayStartMs }: PriceTabProps) {
  const { priceAttrs } = useEnergyView('day', todayStartMs);

  const forecast = useMemo(
    () => assembleForecast(priceAttrs.rawTomorrow, priceAttrs.tomorrowValid, priceAttrs.carnotForecast, nowMs),
    [priceAttrs, nowMs]
  );

  const priceLvl = priceLevel(priceAttrs.currentPrice);

  return (
    <>
      <div className='stat-tiles'>
        <div className='stat-tile'>
          <span className='stat-tile-label'>Current price</span>
          <span className='stat-tile-value'>{priceAttrs.currentPrice != null ? formatPrice(priceAttrs.currentPrice) : '—'}</span>
          {priceAttrs.currentPrice != null && (
            <span className='stat-tile-sub price-tab-level'>
              <span className={`price-tab-dot price-tab-dot--${priceLvl}`} />
              {PRICE_LEVEL_WORD[priceLvl]}
            </span>
          )}
        </div>
      </div>

      {forecast ? (
        <PriceForecast forecast={forecast} nowMs={nowMs} />
      ) : (
        <p className='price-tab-empty'>Price forecast is not available right now.</p>
      )}
    </>
  );
}
