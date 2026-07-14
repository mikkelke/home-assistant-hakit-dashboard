import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { useEnergyConfig, useEnergyView } from '../../energy';
import { dayTitle, startOfLocalDay } from '../../energy/period';
import { formatKWh } from '../../utils/format';
import { EnergyChart } from './EnergyChart';
import './EnergyPage.css';

interface EnergyPageProps {
  onClose: () => void;
}

export function EnergyPage({ onClose }: EnergyPageProps) {
  const [anchorStartMs] = useState(() => startOfLocalDay(Date.now()));
  const { config } = useEnergyConfig();
  const { data, loading, error, reload } = useEnergyView('day', anchorStartMs);

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
          <span className='energy-page-subtitle'>{dayTitle(anchorStartMs, anchorStartMs)}</span>
        </div>
      </div>

      <div className='energy-page-content'>
        <div className='energy-page-inner'>
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

            {!loading && !error && data && <EnergyChart bars={data.bars} rangeStartMs={data.startMs} rangeEndMs={data.endMs} />}

            {/* Temporary spike line — removed in Phase 2 once the config resolver is trusted. */}
            <p className='energy-page-debug'>
              grid: {config?.gridStatId ?? '—'} · cost: {config?.costStatId ?? '—'} · rækker: {data?.bars.length ?? 0}
              {error ? ` · ${error}` : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
