import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useRegistryData } from '@hakit/core';
import { useEnergyConfig, useEnergyDevices, type EnergyBar, type EnergyView, type Period } from '../../energy';
import { deviceIcon, slotDevices } from '../../energy/hourDevices';
import { labelFor } from '../../energy/period';
import { krValue } from '../../energy/planView';
import { PRICE_BAND_LABEL, type BandedPricePoint, type PriceBand } from '../../energy/priceBands';
import { PERIOD_UNIT, priceRank, rankLabel, sameHourYesterdayMs } from '../../energy/usageView';
import { useRoomResolver } from '../../energy/useRoomResolver';
import { formatClockHour, hourRangeLabel } from '../../utils/format';
import { ApplianceSheet } from '../Appliance';
import { slotIndexFor, slotStartMsFor } from './chartGeometry';
import { StatsState } from './StatsState';

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

/** A figure to two decimals, or "< 0,01" for what would round to nothing. */
function amount(value: number): string {
  return value > 0 && value < 0.005 ? `< ${krValue(0.01)}` : krValue(value, 2);
}

/** The devices that used power in the bar's slot, biggest first, then what no device accounts for. */
function SlotDeviceList({ period, view, bar, price }: { period: Period; view: EnergyView; bar: EnergyBar; price: number | null }) {
  const [all, setAll] = useState(false);
  const { config } = useEnergyConfig();
  const { rows, loading, refreshing, error, forceReload } = useEnergyDevices(period, view.startMs, view, true);
  const { areaOf, areas } = useRoomResolver();
  const registry = useRegistryData('entitiesRegistryDisplay');
  const slot = useMemo(
    () => (config && rows ? slotDevices(config.devices, rows, period, bar.startMs, bar.kWh, price) : null),
    [config, rows, period, bar, price]
  );

  if (!slot) {
    return error || !(loading || refreshing) ? (
      <StatsState error='Device data unavailable' onRetry={forceReload} />
    ) : (
      <div className='energy-chart-skeleton ev-slot-skeleton' aria-hidden='true' />
    );
  }

  const iconOf = (statId: string) =>
    registry[statId]?.icon || deviceIcon(config?.devices ?? [], statId) || areas[areaOf(statId) ?? '']?.icon || 'mdi:flash-outline';

  const body = (icon: string, name: string, kWh: number, costKr: number | null, barClassName = '') => (
    <>
      <span className='ev-ricon'>
        <Icon icon={icon} aria-hidden='true' />
      </span>
      <span className='ev-rmain'>
        <span className='ev-rname'>{name}</span>
        <span className='ev-rbar'>
          <i className={barClassName} style={{ width: `${Math.max(2, Math.min(100, (kWh / bar.kWh) * 100))}%` }} />
        </span>
      </span>
      <span className='ev-rnum'>
        <b>{amount(kWh)} kWh</b>
        {costKr != null && <small>{amount(costKr)} kr</small>}
      </span>
    </>
  );

  return (
    <div className='ev-list'>
      {(all ? [...slot.top, ...slot.more] : slot.top).map(device => (
        <div key={device.statId} className='ev-drow'>
          {body(iconOf(device.statId), device.name, device.kWh, device.costKr)}
        </div>
      ))}
      {!all && slot.more.length > 0 && (
        <button type='button' className='ev-drow' onClick={() => setAll(true)}>
          {body('mdi:chevron-down', `${slot.more.length} more`, slot.moreKWh, slot.moreCostKr)}
        </button>
      )}
      {slot.unmeteredKWh > 0 && (
        <div className='ev-drow'>
          {body('mdi:dots-horizontal', 'Unmetered', slot.unmeteredKWh, slot.unmeteredCostKr, 'ev-rbar--untracked')}
        </div>
      )}
    </div>
  );
}

/** One tapped hour (or day or month): its use and cost, its all-in price and where that price
 * ranks, the same slot one period earlier, and the devices that used it. */
export function HourSheet({ period, view, previous, slotMs, prices, todayStartMs, onClose }: HourSheetProps) {
  const isDay = period === 'day';
  const bar = view.bars.find(candidate => candidate.startMs === slotMs) ?? null;
  const point = isDay ? (prices.find(p => p.ms === slotMs) ?? null) : null;
  const price = point?.price ?? bar?.price ?? null;
  const band: PriceBand = point?.band ?? bar?.level ?? 'unknown';

  const ranked = isDay ? prices.map(p => p.price) : view.bars.flatMap(b => (b.price != null ? [b.price] : []));
  const rank = price != null && ranked.length > 1 ? rankLabel(priceRank(ranked, price), ranked.length, PERIOD_UNIT[period]) : '';
  const cheapest = isDay && prices.length > 1 ? prices.reduce((a, b) => (b.price < a.price ? b : a)) : null;

  const previousMs = isDay
    ? sameHourYesterdayMs(slotMs)
    : previous
      ? slotStartMsFor(period, previous.startMs, slotIndexFor(period, view.startMs, slotMs))
      : null;
  const previousBar = previous?.bars.find(b => b.startMs === previousMs) ?? null;

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
                {bar.kWh > previousBar.kWh ? '+' : ''}
                {Math.round(((bar.kWh - previousBar.kWh) / previousBar.kWh) * 100)} % kWh
              </span>
            )}
          </div>
        )}

        {bar && <SlotDeviceList period={period} view={view} bar={bar} price={price} />}
      </div>
    </ApplianceSheet>
  );
}
