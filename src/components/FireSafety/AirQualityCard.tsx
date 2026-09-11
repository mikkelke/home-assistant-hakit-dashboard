import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { KITCHEN_TEMP_SENSOR, resolveKitchenHumiditySensorId } from '../../config/entities';
import { useLocalStorageBoolean } from '../../hooks';
import { airBandInfo, worstAirBand } from '../../utils/airQuality';
import { deriveFireSafety, isCooking } from '../../utils/fireSafety';
import { deriveRoomFeel } from '../../utils/roomFeel';
import './FireSafety.css';

interface AirQualityCardProps {
  entities: HassEntities;
}

function readNumber(entities: HassEntities, entityId: string | null): number | null {
  if (!entityId) return null;
  const value = Number(entities[entityId]?.state);
  return Number.isFinite(value) ? value : null;
}

/** Shared small numeric tile - also used by RoomFeelCard so every room's expanded panel matches. */
export function Stat({ label, value, unit, digits = 0 }: { label: string; value: number | null; unit?: string; digits?: number }) {
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

/** One calm line for the kitchen: a band word plus short advice. Numbers only once tapped open.
 * Also folds in the fused `sensor.kitchen_feel` reading (AppDaemon RoomFeel): it wins over the
 * raw temp/humidity sensors below when available, and adds dew point, source count and
 * staleness to the expanded panel - so the kitchen keeps one air card, not two competing ones. */
export function AirQualityCard({ entities }: AirQualityCardProps) {
  const fire = useMemo(() => deriveFireSafety(entities), [entities]);
  const feel = useMemo(() => deriveRoomFeel(entities, 'kitchen'), [entities]);
  const [expanded, setExpanded] = useLocalStorageBoolean('airqualitycard-expanded', false);
  if (!fire.present) return null;

  const band = worstAirBand(fire.iaqBand, fire.eco2Band);
  const info = airBandInfo(band);
  const cooking = isCooking(fire);
  const advice = cooking
    ? band === 'stuffy' || band === 'poor'
      ? 'Cooking — it will settle'
      : null
    : (info.advice ?? (feel.available && feel.airingHelps ? 'Airing would help' : null));
  const temperature = feel.available && feel.tempC != null ? feel.tempC : readNumber(entities, KITCHEN_TEMP_SENSOR);
  const humidity = feel.available && feel.rh != null ? feel.rh : readNumber(entities, resolveKitchenHumiditySensorId(entities));

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
        <>
          <div className='air-card-grid'>
            <Stat label='IAQ' value={fire.iaq} />
            <Stat label='eCO₂' value={fire.eco2} unit='ppm' />
            <Stat label='Temp' value={temperature} unit='°' digits={1} />
            <Stat label='Humidity' value={humidity} unit='%' />
            {feel.available && feel.dewPointC != null && <Stat label='Dew point' value={feel.dewPointC} unit='°' digits={1} />}
          </div>
          {feel.available && feel.sourceCount > 0 && (
            <p className='air-card-note'>
              {feel.sourceCount} source{feel.sourceCount === 1 ? '' : 's'}
            </p>
          )}
          {feel.available && feel.stale && <p className='air-card-note air-card-note-muted'>Reading is old</p>}
        </>
      )}
    </div>
  );
}
