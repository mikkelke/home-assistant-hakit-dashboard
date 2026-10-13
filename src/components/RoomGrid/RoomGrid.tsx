import type { Area, HassEntities } from '../../types';
import { ROOM_ORDER } from '../../config/dashboard';
import { RoomCard } from './RoomCard';
import './RoomGrid.css';

interface RoomGridProps {
  areas: Area[];
  entities: HassEntities;
  selectedAreaId: string | null;
  onRoomClick: (area: Area) => void;
  onRoomClimateClick?: (area: Area) => void;
  hassUrl: string | null;
}

const ALLOWED_AREAS = new Set(ROOM_ORDER);

export function RoomGrid({ areas, entities, selectedAreaId, onRoomClick, onRoomClimateClick, hassUrl }: RoomGridProps) {
  const sortedAreas = areas
    .filter(area => ALLOWED_AREAS.has(area.name.toLowerCase().replace(/\s+/g, '_')))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return (
    <div className='rooms-grid'>
      {sortedAreas.map(area => (
        <RoomCard
          key={area.area_id}
          area={area}
          entities={entities}
          onClick={() => onRoomClick(area)}
          onClimateClick={onRoomClimateClick ? () => onRoomClimateClick(area) : undefined}
          isSelected={selectedAreaId === area.area_id}
          hassUrl={hassUrl}
        />
      ))}
    </div>
  );
}
