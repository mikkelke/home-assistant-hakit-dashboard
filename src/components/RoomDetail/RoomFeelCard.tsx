import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { useLocalStorageBoolean } from '../../hooks';
import { deriveRoomFeel } from '../../utils/roomFeel';
import { Stat } from '../FireSafety/AirQualityCard';
import '../FireSafety/FireSafety.css';

interface RoomFeelCardProps {
  entities: HassEntities;
  areaId: string;
}

/**
 * Compact "how does this room feel" card for every non-kitchen room's detail panel - same visual
 * language as the kitchen's AirQualityCard (which merges this same fused sensor straight in
 * instead of using this component, so the kitchen never gets two competing cards). Headline and
 * advice are the backend's own words; numbers only show once tapped open. Hides itself entirely
 * when the area has no feel sensor or it isn't reading yet.
 */
export function RoomFeelCard({ entities, areaId }: RoomFeelCardProps) {
  const feel = useMemo(() => deriveRoomFeel(entities, areaId), [entities, areaId]);
  const [expanded, setExpanded] = useLocalStorageBoolean('roomfeelcard-expanded', false);
  if (!feel.present || !feel.available) return null;

  const advice = feel.airingHelps ? 'Airing would help' : feel.detail || null;
  const floorSpread =
    feel.floorTempC != null && feel.floorSpreadC != null
      ? feel.floorSpreadC > 0.05
        ? `Floor ${feel.floorSpreadC.toFixed(1)} °C cooler than the air`
        : feel.floorSpreadC < -0.05
          ? `Floor ${Math.abs(feel.floorSpreadC).toFixed(1)} °C warmer than the air`
          : 'Floor matches the air'
      : null;

  return (
    <div className='air-card'>
      <button type='button' className='air-card-header' onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        <span className='air-dot' aria-hidden='true' />
        <span className='air-card-text'>
          <span className='air-card-line'>{feel.headline || 'Feel'}</span>
          {advice && <span className='air-card-advice'>{advice}</span>}
        </span>
        <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className='air-card-chevron' aria-hidden='true' />
      </button>
      {expanded && (
        <>
          <div className='air-card-grid'>
            <Stat label='Humidity' value={feel.rh} unit='%' />
            <Stat label='Dew point' value={feel.dewPointC} unit='°' digits={1} />
          </div>
          {floorSpread && <p className='air-card-note'>{floorSpread}</p>}
          {feel.mouldRisk && <p className='air-card-note'>Mould risk: {feel.mouldRisk}</p>}
          {feel.sourceCount > 0 && (
            <p className='air-card-note'>
              {feel.sourceCount} source{feel.sourceCount === 1 ? '' : 's'}
            </p>
          )}
          {feel.stale && <p className='air-card-note air-card-note-muted'>Reading is old</p>}
        </>
      )}
    </div>
  );
}
