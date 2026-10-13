import { Icon } from '@iconify/react';
import type { EnergyBar, EnergyView, Period } from '../../energy';
import { labelFor } from '../../energy/period';
import { krValue } from '../../energy/planView';
import { PRICE_BAND_LABEL, type BandedPricePoint, type PriceBand } from '../../energy/priceBands';
import { PERIOD_UNIT, priceRank, rankLabel } from '../../energy/usageView';
import { formatClockHour, hourRangeLabel } from '../../utils/format';
import { ApplianceSheet } from '../Appliance';
import { slotIndexFor, slotStartMsFor } from './chartGeometry';

interface HourSheetProps {
  period: Period;
  view: EnergyView;
  previous: EnergyView | null;
  slotMs: number;
  /** The day's priced hours (day view only). */
  prices: readonly BandedPricePoint[];
  todayStartMs: number;
  onClose: () => void;
}

const SAME_SLOT: Record<Period, string> = {
  day: 'Same hour yesterday',
  week: 'Same day last week',
  month: 'Same day last month',
  year: 'Same month last year',
};

function slotTitle(period: Period, ms: number): string {
  const d = new Date(ms);
  if (period === 'day') return hourRangeLabel(ms);
  if (period === 'year') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${weekday} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function usage(bar: EnergyBar): string {
  return `${krValue(bar.kWh, 2)} kWh · ${krValue(bar.costKr)} kr`;
}

/** One tapped hour (or day or month): its use and cost, its all-in price and where that price
 * ranks, and the same slot one period earlier. */
export function HourSheet({ period, view, previous, slotMs, prices, todayStartMs, onClose }: HourSheetProps) {
  const isDay = period === 'day';
  const bar = view.bars.find(candidate => candidate.startMs === slotMs) ?? null;
  const point = isDay ? (prices.find(p => p.ms === slotMs) ?? null) : null;
  const price = point?.price ?? bar?.price ?? null;
  const band: PriceBand = point?.band ?? bar?.level ?? 'unknown';

  const ranked = isDay ? prices.map(p => p.price) : view.bars.flatMap(b => (b.price != null ? [b.price] : []));
  const rank = price != null && ranked.length > 1 ? rankLabel(priceRank(ranked, price), ranked.length, PERIOD_UNIT[period]) : '';
  const cheapest = isDay && prices.length > 1 ? prices.reduce((a, b) => (b.price < a.price ? b : a)) : null;

  const index = slotIndexFor(period, view.startMs, slotMs);
  const previousBar = previous?.bars.find(b => b.startMs === slotStartMsFor(period, previous.startMs, index)) ?? null;

  return (
    <ApplianceSheet
      accentClassName='appliance-accent-washer'
      glyphIcon={isDay ? 'mdi:clock-outline' : 'mdi:calendar-outline'}
      title={slotTitle(period, slotMs)}
      historyKey='energy-slot'
      onClose={onClose}
    >
      <div className='plan-sheet'>
        <div className='plan-hero-main'>
          <span className='plan-hero-label'>{labelFor(period, view.startMs, todayStartMs)}</span>
          <span className='plan-hero-num'>
            {bar ? krValue(bar.kWh, 2) : '—'}
            <small> kWh</small>
          </span>
          <span className='plan-chips'>
            {bar && <span className='plan-chip plan-chip--sky'>{krValue(bar.costKr)} kr</span>}
            {price != null && (
              <span className={`plan-chip plan-chip--band band--${band}`}>
                <i className='plan-dot' />
                {!isDay && '≈ '}
                {krValue(price)} kr/kWh{band !== 'unknown' ? ` · ${PRICE_BAND_LABEL[band]}` : ''}
              </span>
            )}
            {bar?.partial && <span className='plan-chip plan-chip--ghost'>so far</span>}
            {!bar && <span className='plan-chip plan-chip--ghost'>no use yet</span>}
          </span>
        </div>

        {(rank || cheapest) && (
          <div className='plan-chips'>
            {rank && (
              <span className='plan-chip plan-chip--ghost'>
                <Icon icon='mdi:podium' aria-hidden='true' />
                {rank}
              </span>
            )}
            {cheapest && cheapest.ms !== slotMs && (
              <span className='plan-chip band--cheap plan-chip--band'>
                <i className='plan-dot' />
                cheapest {formatClockHour(cheapest.ms)} · {krValue(cheapest.price)}
              </span>
            )}
          </div>
        )}

        <div className='plan-row-head plan-row-head--in'>
          <span>{SAME_SLOT[period]}</span>
          <span className='plan-chip plan-chip--ghost'>{previousBar ? usage(previousBar) : '—'}</span>
        </div>
        {previousBar?.price != null && (
          <div className='plan-chips'>
            <span className={`plan-chip plan-chip--band band--${previousBar.level}`}>
              <i className='plan-dot' />
              {!isDay && '≈ '}
              {krValue(previousBar.price)} kr/kWh
            </span>
            {bar && previousBar.kWh > 0 && (
              <span className='plan-chip plan-chip--ghost'>
                <Icon icon={bar.kWh <= previousBar.kWh ? 'mdi:trending-down' : 'mdi:trending-up'} aria-hidden='true' />
                {Math.round(((bar.kWh - previousBar.kWh) / previousBar.kWh) * 100)} % kWh
              </span>
            )}
          </div>
        )}
      </div>
    </ApplianceSheet>
  );
}
