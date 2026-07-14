import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { assembleForecast, useEnergyDevices, useEnergyView, type DeviceUsage, type EnergyBar, type Period } from '../../energy';
import { labelFor, nextDisabled, rangeFor, startOfLocalDay, startOfPeriod, stepAnchor } from '../../energy/period';
import { PRICE_BAND_THRESHOLDS } from '../../config/energy';
import { useSwipeToClose } from '../../hooks';
import { formatKr, formatKWh, formatPrice } from '../../utils/format';
import { BillCard } from './BillCard';
import { DeviceBreakdown } from './DeviceBreakdown';
import { DeviceDialog } from './DeviceDialog';
import { EnergyChart } from './EnergyChart';
import { PeriodPicker } from './PeriodPicker';
import { PriceForecast } from './PriceForecast';
import { PriceStrip } from './PriceStrip';
import { StatTiles } from './StatTiles';
import { UnitToggle } from './UnitToggle';
import './EnergyPage.css';

interface EnergyPageProps {
  onClose: () => void;
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

export function EnergyPage({ onClose }: EnergyPageProps) {
  const [period, setPeriod] = useState<Period>('day');
  const [anchorStartMs, setAnchorStartMs] = useState(() => startOfLocalDay(Date.now()));
  // Clock-in-state (purity lint forbids Date.now()/new Date() in render): a 1-minute tick keeps
  // the period label and the next-arrow clamp correct across midnight.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [unit, setUnit] = useState<'kwh' | 'kr'>('kwh');
  const [selectedBar, setSelectedBar] = useState<EnergyBar | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DeviceUsage | null>(null);

  // Mobile swipe-to-close on the page root (mirrors RoomDetail's usage). The hook's own
  // interactive-target allowlist already ignores buttons/[role="button"] (PeriodPicker's segments
  // and arrows, tappable device rows) and anything marked data-interactive="true" (EnergyChart's
  // SVG, whose bar hit-rects are real tap targets, and the period label's long-press target); it's
  // a no-op on non-mobile viewports.
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(onClose);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayStartMs = useMemo(() => startOfLocalDay(nowMs), [nowMs]);

  const { data, loading, refreshing, error, reload, forceReload, priceAttrs } = useEnergyView(period, anchorStartMs);
  const devicesState = useEnergyDevices(period, anchorStartMs, data);
  const forecast = useMemo(
    () => assembleForecast(priceAttrs.rawTomorrow, priceAttrs.tomorrowValid, priceAttrs.carnotForecast, nowMs),
    [priceAttrs, nowMs]
  );

  const handlePeriodChange = (nextPeriod: Period) => {
    setPeriod(nextPeriod);
    setAnchorStartMs(startOfPeriod(nextPeriod, Date.now()));
    setSelectedBar(null);
    setSelectedDevice(null);
  };

  const handleStep = (delta: 1 | -1) => {
    setAnchorStartMs(current => (delta === 1 && nextDisabled(period, current, nowMs) ? current : stepAnchor(period, current, delta)));
    setSelectedBar(null);
    setSelectedDevice(null);
  };

  // Force-refresh (PeriodPicker long-press): busts both hooks' persisted cache for the current
  // period and reloads, bypassing their own reload-coalescing guard.
  const handleForceReload = () => {
    forceReload();
    devicesState.forceReload();
  };

  const nextStepDisabled = nextDisabled(period, anchorStartMs, nowMs);

  // The stored selection tracks an hour/day/month by ms; re-derive against the live bars array so
  // a background refresh (partial bar growing, hourly re-assemble) keeps the pill's numbers fresh.
  const liveSelectedBar = selectedBar && (data?.bars.find(bar => bar.startMs === selectedBar.startMs) ?? selectedBar);

  return (
    <div className='energy-page' onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className='energy-page-header'>
        <button className='close-button' onClick={onClose}>
          <Icon icon='mdi:close' />
        </button>
        <div className='energy-page-title'>
          <h1>Energy</h1>
          <span className='energy-page-subtitle'>{labelFor(period, anchorStartMs, todayStartMs)}</span>
        </div>
      </div>

      <div className='energy-page-content'>
        <div className='energy-page-inner'>
          <PeriodPicker
            period={period}
            anchorStartMs={anchorStartMs}
            todayStartMs={todayStartMs}
            onPeriodChange={handlePeriodChange}
            onStep={handleStep}
            nextStepDisabled={nextStepDisabled}
            onForceReload={handleForceReload}
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
                  <UnitToggle unit={unit} onChange={setUnit} />
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

          {period === 'day' && anchorStartMs === todayStartMs && forecast && <PriceForecast forecast={forecast} nowMs={nowMs} />}

          {data && <BillCard view={data} nowMs={nowMs} />}

          {data && (
            <DeviceBreakdown
              period={period}
              view={data}
              devices={devicesState.data}
              loading={devicesState.loading}
              refreshing={devicesState.refreshing}
              error={devicesState.error}
              onReload={devicesState.reload}
              onSelectDevice={setSelectedDevice}
            />
          )}
        </div>
      </div>

      {selectedDevice && (
        <DeviceDialog
          device={selectedDevice}
          period={period}
          anchorStartMs={anchorStartMs}
          rangeEndMs={rangeFor(period, anchorStartMs).endMs}
          onClose={() => setSelectedDevice(null)}
        />
      )}
    </div>
  );
}
