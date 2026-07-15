import { useMemo } from 'react';
import { assembleForecast, priceLevel, useEnergyView, type EnergyBar } from '../../energy';
import { formatPrice } from '../../utils/format';
import { PriceForecast } from './PriceForecast';
import { PriceStrip } from './PriceStrip';
import './PriceTab.css';

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

/** Tab "Price": today's full curve (headed by the current rate, right where it's relevant),
 * tomorrow's forecast, and the week ahead — split out of Live (which stays focused on real-time
 * power draw) so the price picture gets its own uncluttered read. `data.price` (today, via the day
 * view's own `assemblePriceSeries`) and `priceAttrs` (tomorrow/Carnot, via `assembleForecast`) come
 * from the SAME `useEnergyView('day', …)` call — its module cache means Live/Usage viewing today
 * rarely costs this a second fetch. */
export function PriceTab({ nowMs, todayStartMs }: PriceTabProps) {
  const { data, priceAttrs } = useEnergyView('day', todayStartMs);

  const forecast = useMemo(
    () => assembleForecast(priceAttrs.rawTomorrow, priceAttrs.tomorrowValid, priceAttrs.carnotForecast, nowMs),
    [priceAttrs, nowMs]
  );

  const priceLvl = priceLevel(priceAttrs.currentPrice);

  return (
    <>
      <div className='price-tab-today'>
        <div className='price-tab-today-header'>
          <h2>Today</h2>
          {priceAttrs.currentPrice != null && (
            <span className='price-tab-current'>
              <span className={`price-tab-dot price-tab-dot--${priceLvl}`} />
              {formatPrice(priceAttrs.currentPrice)} · {PRICE_LEVEL_WORD[priceLvl]}
            </span>
          )}
        </div>
        {data?.price ? (
          <PriceStrip series={data.price} rangeStartMs={data.startMs} rangeEndMs={data.endMs} />
        ) : (
          <p className='price-tab-empty'>Loading today's prices…</p>
        )}
      </div>

      {forecast ? (
        <PriceForecast forecast={forecast} nowMs={nowMs} />
      ) : (
        <p className='price-tab-empty'>Price forecast is not available right now.</p>
      )}
    </>
  );
}
