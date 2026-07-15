import { useCallback, useMemo, useState } from 'react';
import { assembleForecast, priceLevel, useEnergyView, type EnergyBar } from '../../energy';
import { hoursInRange } from '../../energy/period';
import { formatPrice, hourRangeLabel } from '../../utils/format';
import { ChartCallout, type ChartCalloutModel } from './ChartCallout';
import { slotCenterPct, slotIndexFor, slotStartMsFor, snapToNearestSlot } from './chartGeometry';
import { PriceForecast } from './PriceForecast';
import { PriceStrip } from './PriceStrip';
import { useChartScrub, type ScrubPhase } from './useChartScrub';
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

  // Today's curve gets the same tap/drag-to-inspect interaction as the Usage tab's charts — its own
  // self-contained scrub state, since (unlike Usage) there's no sibling bar chart to share it with
  // (mirrors how PriceForecast owns its own scrub for the same reason).
  const [selectedMs, setSelectedMs] = useState<number | null>(null);
  const points = useMemo(() => data?.price?.points ?? [], [data]);
  const slots = data ? Math.max(1, hoursInRange(data.startMs, data.endMs)) : 24;

  const availableSlots = useMemo(() => {
    const set = new Set<number>();
    if (!data) return set;
    for (const point of points) {
      const slot = slotIndexFor('day', data.startMs, point.ms);
      if (slot >= 0 && slot < slots) set.add(slot);
    }
    return set;
  }, [data, points, slots]);

  const handleScrub = useCallback(
    (slot: number, phase: ScrubPhase) => {
      if (!data) return;
      const snapped = snapToNearestSlot(slot, availableSlots);
      if (snapped === null) return;
      const ms = slotStartMsFor('day', data.startMs, snapped);
      setSelectedMs(previous => (phase === 'tap' && previous === ms ? null : ms));
    },
    [data, availableSlots]
  );

  const scrubHandlers = useChartScrub({ slots, onScrub: handleScrub });

  const todayCallout = useMemo<ChartCalloutModel | null>(() => {
    if (!data || selectedMs == null) return null;
    const point = points.find(candidate => candidate.ms === selectedMs);
    if (!point) return null;
    return {
      leftPct: slotCenterPct(slotIndexFor('day', data.startMs, selectedMs), slots),
      title: hourRangeLabel(selectedMs),
      primary: formatPrice(point.price),
      dot: priceLevel(point.price),
    };
  }, [data, selectedMs, points, slots]);

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
          <>
            <div className='energy-callout-lane energy-callout-lane--compact'>{todayCallout && <ChartCallout {...todayCallout} />}</div>
            <PriceStrip
              series={data.price}
              rangeStartMs={data.startMs}
              rangeEndMs={data.endMs}
              selectedMs={selectedMs}
              scrubHandlers={scrubHandlers}
            />
          </>
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
