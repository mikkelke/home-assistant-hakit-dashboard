import { useState } from 'react';
import { useEnergyView, type EnergyBar, type Period } from '../../energy';
import { PRICE_BAND_THRESHOLDS } from '../../config/energy';
import { formatKr, formatKWh, formatPrice } from '../../utils/format';
import { EnergyChart } from './EnergyChart';
import { PeriodPicker } from './PeriodPicker';
import { PriceStrip } from './PriceStrip';
import { StatTiles } from './StatTiles';
import { UnitToggle } from './UnitToggle';
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

/** Period-appropriate one-line summary for the selection info pill. */
function describeBar(period: Period, bar: EnergyBar): string {
  switch (period) {
    case 'day': {
      const hour = new Date(bar.startMs).getHours();
      const parts = [`${hour}–${hour + 1}`, formatKWh(bar.kWh), formatKr(bar.costKr)];
      if (bar.price != null) parts.push(formatPrice(bar.price));
      return parts.join(' · ');
    }
    case 'week':
    case 'month': {
      const dateLabel = new Date(bar.startMs).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
      const parts = [dateLabel, formatKWh(bar.kWh), formatKr(bar.costKr)];
      if (bar.price != null) parts.push(`≈${formatPrice(bar.price)}`);
      return parts.join(' · ');
    }
    case 'year': {
      const monthLabel = new Date(bar.startMs).toLocaleDateString(undefined, { month: 'long' });
      return [monthLabel, formatKWh(bar.kWh), formatKr(bar.costKr)].join(' · ');
    }
  }
}

/** Tab "Usage": period picker, day-view stat tiles, and the Consumption chart card — the page's
 * original single-view content minus the price forecast (now on the Live tab) and the Bill/Devices
 * cards (their own tabs). Owns `selectedBar` locally — a tab-local selection, reset on every
 * period/step change and (by unmounting) on tab switch. */
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
  const [selectedBar, setSelectedBar] = useState<EnergyBar | null>(null);
  const { data, loading, refreshing, error, reload, forceReload } = useEnergyView(period, anchorStartMs);

  const handlePeriodChange = (nextPeriod: Period) => {
    onPeriodChange(nextPeriod);
    setSelectedBar(null);
  };

  const handleStep = (delta: 1 | -1) => {
    onStep(delta);
    setSelectedBar(null);
  };

  // The stored selection tracks an hour/day/month by ms; re-derive against the live bars array so
  // a background refresh (partial bar growing, hourly re-assemble) keeps the pill's numbers fresh.
  const liveSelectedBar = selectedBar && (data?.bars.find(bar => bar.startMs === selectedBar.startMs) ?? selectedBar);

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
            {liveSelectedBar && <div className='energy-selection-pill'>{describeBar(period, liveSelectedBar)}</div>}

            <EnergyChart
              bars={data.bars}
              rangeStartMs={data.startMs}
              rangeEndMs={data.endMs}
              period={period}
              unit={unit}
              onSelectBar={setSelectedBar}
              selectedStartMs={selectedBar?.startMs ?? null}
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
                selectedMs={selectedBar?.startMs ?? null}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
