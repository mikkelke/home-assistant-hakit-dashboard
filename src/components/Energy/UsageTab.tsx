import { useCallback, useMemo, useState } from 'react';
import { priceLevel, useEnergyView, type Period } from '../../energy';
import { slotsInRange } from '../../energy/period';
import { PRICE_BAND_THRESHOLDS } from '../../config/energy';
import { formatKr, formatKWh, formatPrice, hourRangeLabel } from '../../utils/format';
import { ChartCallout, type ChartCalloutModel } from './ChartCallout';
import { slotCenterPct, slotIndexFor, slotStartMsFor, snapToNearestSlot } from './chartGeometry';
import { EnergyChart } from './EnergyChart';
import { PeriodPicker } from './PeriodPicker';
import { PriceStrip } from './PriceStrip';
import { StatTiles } from './StatTiles';
import { UnitToggle } from './UnitToggle';
import { useChartScrub, type ScrubPhase } from './useChartScrub';
import './UsageTab.css';

interface UsageTabProps {
  period: Period;
  anchorStartMs: number;
  todayStartMs: number;
  nextStepDisabled: boolean;
  onPeriodChange: (period: Period) => void;
  onStep: (delta: 1 | -1) => void;
  unit: 'kwh' | 'kr';
  onUnitChange: (unit: 'kwh' | 'kr') => void;
}

/** Tab "Usage": period picker, day-view stat tiles, and the Consumption chart card with
 * Apple-Health-style scrubbing — tap or drag across the bars OR the price strip to inspect an
 * hour/day/month; a callout above the chart carries the numbers. Selection is slot-based
 * (`selectedSlotMs`), so today's future hours — which have a price but no bar yet — are
 * scrubbably real too. */
export function UsageTab({
  period,
  anchorStartMs,
  todayStartMs,
  nextStepDisabled,
  onPeriodChange,
  onStep,
  unit,
  onUnitChange,
}: UsageTabProps) {
  const [selectedSlotMs, setSelectedSlotMs] = useState<number | null>(null);
  const { data, loading, refreshing, error, reload, forceReload } = useEnergyView(period, anchorStartMs);

  const handlePeriodChange = (nextPeriod: Period) => {
    onPeriodChange(nextPeriod);
    setSelectedSlotMs(null);
  };

  const handleStep = (delta: 1 | -1) => {
    onStep(delta);
    setSelectedSlotMs(null);
  };

  const slots = data ? Math.max(1, slotsInRange(period, data.startMs, data.endMs)) : 1;

  // Slots that carry data — bars always; on the day view, price points too (future hours of
  // today have a known price but no consumption yet).
  const availableSlots = useMemo(() => {
    const set = new Set<number>();
    if (!data) return set;
    for (const bar of data.bars) {
      const slot = slotIndexFor(period, data.startMs, bar.startMs);
      if (slot >= 0 && slot < slots) set.add(slot);
    }
    if (period === 'day' && data.price) {
      for (const point of data.price.points) {
        const slot = slotIndexFor(period, data.startMs, point.ms);
        if (slot >= 0 && slot < slots) set.add(slot);
      }
    }
    return set;
  }, [data, period, slots]);

  const handleScrub = useCallback(
    (slot: number, phase: ScrubPhase) => {
      if (!data) return;
      const snapped = snapToNearestSlot(slot, availableSlots);
      if (snapped === null) return;
      const ms = slotStartMsFor(period, data.startMs, snapped);
      setSelectedSlotMs(previous => (phase === 'tap' && previous === ms ? null : ms));
    },
    [data, availableSlots, period]
  );

  const scrubHandlers = useChartScrub({ slots, onScrub: handleScrub });

  const callout = useMemo<ChartCalloutModel | null>(() => {
    if (!data || selectedSlotMs == null) return null;
    const slot = slotIndexFor(period, data.startMs, selectedSlotMs);
    if (slot < 0 || slot >= slots) return null;

    const bar = data.bars.find(candidate => candidate.startMs === selectedSlotMs) ?? null;
    const pricePoint = period === 'day' ? (data.price?.points.find(point => point.ms === selectedSlotMs) ?? null) : null;
    if (!bar && !pricePoint) return null;

    const title =
      period === 'day'
        ? hourRangeLabel(selectedSlotMs)
        : period === 'year'
          ? new Date(selectedSlotMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
          : new Date(selectedSlotMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

    if (bar) {
      const secondaryParts = [unit === 'kr' ? formatKWh(bar.kWh) : formatKr(bar.costKr)];
      if (bar.price != null) secondaryParts.push(`${period !== 'day' ? '≈' : ''}${formatPrice(bar.price)}`);
      return {
        leftPct: slotCenterPct(slot, slots),
        title,
        primary: unit === 'kr' ? formatKr(bar.costKr) : formatKWh(bar.kWh),
        secondary: secondaryParts.join(' · '),
        dot: bar.price != null ? bar.level : null,
        note: bar.partial ? 'in progress' : null,
      };
    }

    return {
      leftPct: slotCenterPct(slot, slots),
      title,
      primary: formatPrice(pricePoint!.price),
      secondary: null,
      dot: priceLevel(pricePoint!.price),
      note: 'no usage yet',
    };
  }, [data, selectedSlotMs, period, slots, unit]);

  return (
    <>
      <PeriodPicker
        period={period}
        anchorStartMs={anchorStartMs}
        todayStartMs={todayStartMs}
        onPeriodChange={handlePeriodChange}
        onStep={handleStep}
        nextStepDisabled={nextStepDisabled}
        onForceReload={forceReload}
      />

      {period === 'day' && data && <StatTiles view={data} />}

      <div className='energy-page-card'>
        <div className='energy-page-card-header'>
          <div className='energy-page-card-header-left'>
            <h2>Consumption</h2>
            {refreshing && (
              <span className='energy-page-refreshing'>
                <span className='energy-page-refreshing-dot' />
                updating…
              </span>
            )}
          </div>
          {data && (
            <div className='energy-page-card-header-right'>
              <span className='energy-page-card-total'>
                Total {unit === 'kr' ? formatKr(data.totals.costKr) : formatKWh(data.totals.kWh)}
              </span>
              <UnitToggle unit={unit} onChange={onUnitChange} />
            </div>
          )}
        </div>

        {loading && <div className='energy-chart-skeleton' aria-hidden='true' />}

        {!loading && error && (
          <div className='energy-page-state-error'>
            <p>{error}</p>
            <button type='button' onClick={reload}>
              Try again
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <div className={`energy-page-card-body ${refreshing ? 'energy-page-card-body--refreshing' : ''}`}>
            <div className='energy-callout-lane'>{callout && <ChartCallout {...callout} />}</div>

            <EnergyChart
              bars={data.bars}
              rangeStartMs={data.startMs}
              rangeEndMs={data.endMs}
              period={period}
              unit={unit}
              scrubHandlers={scrubHandlers}
              selectedStartMs={selectedSlotMs}
              hasSelection={selectedSlotMs != null}
            />

            <div
              className='energy-chart-legend'
              title={`cheap < ${PRICE_BAND_THRESHOLDS.lowMaxKrPerKWh.toLocaleString('da-DK')} kr/kWh · normal ${PRICE_BAND_THRESHOLDS.lowMaxKrPerKWh.toLocaleString('da-DK')}–${PRICE_BAND_THRESHOLDS.midMaxKrPerKWh.toLocaleString('da-DK')} kr/kWh · expensive > ${PRICE_BAND_THRESHOLDS.midMaxKrPerKWh.toLocaleString('da-DK')} kr/kWh`}
            >
              <span className='energy-chart-legend-item'>
                <span className='energy-chart-legend-dot energy-chart-legend-dot--low' />
                cheap
              </span>
              <span className='energy-chart-legend-item'>
                <span className='energy-chart-legend-dot energy-chart-legend-dot--mid' />
                normal
              </span>
              <span className='energy-chart-legend-item'>
                <span className='energy-chart-legend-dot energy-chart-legend-dot--high' />
                expensive
              </span>
            </div>

            {period === 'day' && data.price && (
              <PriceStrip
                series={data.price}
                rangeStartMs={data.startMs}
                rangeEndMs={data.endMs}
                selectedMs={selectedSlotMs}
                scrubHandlers={scrubHandlers}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
