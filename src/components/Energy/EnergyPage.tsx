import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useEnergyConfig, useEnergyView, type Period } from '../../energy';
import { labelFor, nextDisabled, startOfLocalDay, startOfPeriod, stepAnchor } from '../../energy/period';
import { formatKWh } from '../../utils/format';
import { EnergyChart } from './EnergyChart';
import { PeriodPicker } from './PeriodPicker';
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

export function EnergyPage({ onClose }: EnergyPageProps) {
  const [period, setPeriod] = useState<Period>('day');
  const [anchorStartMs, setAnchorStartMs] = useState(() => startOfLocalDay(Date.now()));
  // Clock-in-state (purity lint forbids Date.now()/new Date() in render): a 1-minute tick keeps
  // the period label and the next-arrow clamp correct across midnight.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayStartMs = useMemo(() => startOfLocalDay(nowMs), [nowMs]);

  const { config } = useEnergyConfig();
  const { data, loading, error, reload } = useEnergyView(period, anchorStartMs);

  const handlePeriodChange = (nextPeriod: Period) => {
    setPeriod(nextPeriod);
    setAnchorStartMs(startOfPeriod(nextPeriod, Date.now()));
  };

  const handleStep = (delta: 1 | -1) => {
    setAnchorStartMs(current => (delta === 1 && nextDisabled(period, current, nowMs) ? current : stepAnchor(period, current, delta)));
  };

  const nextStepDisabled = nextDisabled(period, anchorStartMs, nowMs);

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

          <div className='energy-page-card'>
            <div className='energy-page-card-header'>
              <h2>Forbrug</h2>
              {data && <span className='energy-page-card-total'>I alt {formatKWh(data.totals.kWh)}</span>}
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
              <EnergyChart bars={data.bars} rangeStartMs={data.startMs} rangeEndMs={data.endMs} period={period} />
            )}

            {/* Temporary spike line — removed in Phase 3 once price/cost wiring is trusted. */}
            <p className='energy-page-debug'>
              grid: {config?.gridStatId ?? '—'} · cost: {config?.costStatId ?? '—'} · rækker: {data?.bars.length ?? 0} · {period}{' '}
              {data ? `${debugDateLabel(data.startMs)}→${debugDateLabel(data.endMs)}` : ''}
              {error ? ` · ${error}` : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
