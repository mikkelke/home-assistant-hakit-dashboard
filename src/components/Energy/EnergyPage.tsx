import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useEnergyConfig, useEnergyDevices, useEnergyView, type DeviceUsage, type EnergyBar, type Period } from '../../energy';
import { labelFor, nextDisabled, rangeFor, startOfLocalDay, startOfPeriod, stepAnchor } from '../../energy/period';
import { PRICE_BAND_THRESHOLDS } from '../../config/energy';
import { formatKr, formatKWh, formatPrice } from '../../utils/format';
import { DeviceBreakdown } from './DeviceBreakdown';
import { DeviceDialog } from './DeviceDialog';
import { EnergyChart } from './EnergyChart';
import { PeriodPicker } from './PeriodPicker';
import { PriceStrip } from './PriceStrip';
import { StatTiles } from './StatTiles';
import { UnitToggle } from './UnitToggle';
import './EnergyPage.css';

interface EnergyPageProps {
  onClose: () => void;
}

/** Local calendar date for the debug line — deliberately not `toISOString()`, which converts to
 * UTC and would print the wrong date for buckets near local midnight. */
function debugDateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      const dateLabel = new Date(bar.startMs).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' });
      const parts = [dateLabel, formatKWh(bar.kWh), formatKr(bar.costKr)];
      if (bar.price != null) parts.push(`≈${formatPrice(bar.price)}`);
      return parts.join(' · ');
    }
    case 'year': {
      const monthLabel = new Date(bar.startMs).toLocaleDateString('da-DK', { month: 'long' });
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

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayStartMs = useMemo(() => startOfLocalDay(nowMs), [nowMs]);

  const { config } = useEnergyConfig();
  const { data, loading, error, reload } = useEnergyView(period, anchorStartMs);
  const devicesState = useEnergyDevices(period, anchorStartMs, data);

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

  const nextStepDisabled = nextDisabled(period, anchorStartMs, nowMs);

  // The stored selection tracks an hour/day/month by ms; re-derive against the live bars array so
  // a background refresh (partial bar growing, hourly re-assemble) keeps the pill's numbers fresh.
  const liveSelectedBar = selectedBar && (data?.bars.find(bar => bar.startMs === selectedBar.startMs) ?? selectedBar);

  const debugLine =
    [
      `grid: ${config?.gridStatId ?? '—'}`,
      `cost: ${config?.costStatId ?? '—'}`,
      `rækker: ${data?.bars.length ?? 0}`,
      `pris-punkter: ${data?.price?.points.length ?? 0}`,
      `${period} ${data ? `${debugDateLabel(data.startMs)}→${debugDateLabel(data.endMs)}` : ''}`,
      `kr i alt: ${data ? formatKr(data.totals.costKr) : '—'}`,
      `enheder: ${devicesState.data?.devices.length ?? 0}`,
      `umålt: ${devicesState.data ? formatKWh(devicesState.data.untracked.kWh) : '—'}`,
    ].join(' · ') + (error ? ` · ${error}` : '');

  // Temporary spike-line diagnostics (Phase 1 only) — logs once per successful fetch.
  useEffect(() => {
    if (data && config) {
      console.debug('[energy]', config.gridStatId, data.bars.length);
    }
  }, [data, config]);

  return (
    <div className='energy-page'>
      <div className='energy-page-header'>
        <button className='close-button' onClick={onClose}>
          <Icon icon='mdi:close' />
        </button>
        <div className='energy-page-title'>
          <h1>Energi</h1>
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
          />

          {period === 'day' && data && <StatTiles view={data} />}

          <div className='energy-page-card'>
            <div className='energy-page-card-header'>
              <h2>Forbrug</h2>
              {data && (
                <div className='energy-page-card-header-right'>
                  <span className='energy-page-card-total'>
                    I alt {unit === 'kr' ? formatKr(data.totals.costKr) : formatKWh(data.totals.kWh)}
                  </span>
                  <UnitToggle unit={unit} onChange={setUnit} />
                </div>
              )}
            </div>

            {loading && <p className='energy-page-state'>Henter data …</p>}

            {!loading && error && (
              <div className='energy-page-state energy-page-state-error'>
                <p>{error}</p>
                <button type='button' onClick={reload}>
                  Prøv igen
                </button>
              </div>
            )}

            {!loading && !error && data && (
              <>
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
                  title={`billig < ${PRICE_BAND_THRESHOLDS.lowMaxKrPerKWh.toLocaleString('da-DK')} kr/kWh · normal ${PRICE_BAND_THRESHOLDS.lowMaxKrPerKWh.toLocaleString('da-DK')}–${PRICE_BAND_THRESHOLDS.midMaxKrPerKWh.toLocaleString('da-DK')} kr/kWh · dyr > ${PRICE_BAND_THRESHOLDS.midMaxKrPerKWh.toLocaleString('da-DK')} kr/kWh`}
                >
                  <span className='energy-chart-legend-item'>
                    <span className='energy-chart-legend-dot energy-chart-legend-dot--low' />
                    billig
                  </span>
                  <span className='energy-chart-legend-item'>
                    <span className='energy-chart-legend-dot energy-chart-legend-dot--mid' />
                    normal
                  </span>
                  <span className='energy-chart-legend-item'>
                    <span className='energy-chart-legend-dot energy-chart-legend-dot--high' />
                    dyr
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
              </>
            )}

            {/* Debug line — kept while cost/price wiring is still being cross-checked live. */}
            <p className='energy-page-debug'>{debugLine}</p>
          </div>

          {data && (
            <DeviceBreakdown
              period={period}
              view={data}
              devices={devicesState.data}
              loading={devicesState.loading}
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
