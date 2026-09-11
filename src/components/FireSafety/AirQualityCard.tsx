import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { KITCHEN_TEMP_SENSOR, resolveKitchenHumiditySensorId } from '../../config/entities';
import { useLocalStorageBoolean } from '../../hooks';
import { airBandInfo, worstAirBand } from '../../utils/airQuality';
import { deriveFireSafety, isCooking } from '../../utils/fireSafety';
import './FireSafety.css';

interface AirQualityCardProps {
  entities: HassEntities;
}

function readNumber(entities: HassEntities, entityId: string | null): number | null {
  if (!entityId) return null;
  const value = Number(entities[entityId]?.state);
  return Number.isFinite(value) ? value : null;
}

function Stat({ label, value, unit, digits = 0 }: { label: string; value: number | null; unit?: string; digits?: number }) {
  return (
    <div className='air-stat'>
      <span className='air-stat-value'>
        {value == null ? '—' : value.toFixed(digits)}
        {value != null && unit && <span className='air-stat-unit'>{unit}</span>}
      </span>
      <span className='air-stat-label'>{label}</span>
    </div>
  );
}

/** One calm line for the kitchen: a band word plus short advice. Numbers only once tapped open. */
export function AirQualityCard({ entities }: AirQualityCardProps) {
  const fire = useMemo(() => deriveFireSafety(entities), [entities]);
  const [expanded, setExpanded] = useLocalStorageBoolean('airqualitycard-expanded', false);
  if (!fire.present) return null;

  const band = worstAirBand(fire.iaqBand, fire.eco2Band);
  const info = airBandInfo(band);
  const cooking = isCooking(fire);
  const advice = cooking ? (band === 'stuffy' || band === 'poor' ? 'Cooking — it will settle' : null) : info.advice;
  const temperature = readNumber(entities, KITCHEN_TEMP_SENSOR);
  const humidity = readNumber(entities, resolveKitchenHumiditySensorId(entities));

  return (
    <div className='air-card' style={{ '--air-color': `var(${info.cssVar})` } as React.CSSProperties}>
      <button type='button' className='air-card-header' onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        <span className='air-dot' aria-hidden='true' />
        <span className='air-card-text'>
          <span className='air-card-line'>
            Air <span className='air-band'>{info.label.toLowerCase()}</span>
          </span>
          <span className='air-card-advice'>{advice ?? (band === 'unknown' ? 'The sensor is settling in' : 'Nothing to do')}</span>
        </span>
        <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className='air-card-chevron' aria-hidden='true' />
      </button>
      {expanded && (
        <div className='air-card-grid'>
          <Stat label='IAQ' value={fire.iaq} />
          <Stat label='eCO₂' value={fire.eco2} unit='ppm' />
          <Stat label='Temp' value={temperature} unit='°' digits={1} />
          <Stat label='Humidity' value={humidity} unit='%' />
        </div>
      )}
    </div>
  );
}
