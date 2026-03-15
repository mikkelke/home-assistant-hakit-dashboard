import type { Area, HassEntities } from '../../types';
import { ROOM_ORDER } from '../../config/dashboard';
import { ROOM_LIGHTS } from '../../config/lights';
import {
  FRONT_DOOR_LOCK_ENTITY,
  FRONT_DOOR_SENSOR_ENTITY,
  VACUUM_ENTITY,
  ROBOT_CLEAN_PREFIX,
  ROBOT_CLEAN_KITCHEN_1,
  ROBOT_CLEAN_KITCHEN_2,
} from '../../config/entities';
import { RoomCard } from './RoomCard';
import './RoomGrid.css';

interface RoomGridProps {
  areas: Area[];
  entities: HassEntities;
  selectedAreaId: string | null;
  onRoomClick: (area: Area) => void;
  hassUrl: string | null;
}

type IndicatorKey =
  | 'door'
  | 'window'
  | 'lock'
  | 'heating'
  | 'shower'
  | 'cleaning'
  | 'cleaning_cook'
  | 'cleaning_dining'
  | 'vacuum'
  | 'guest'
  | 'dishwasher'
  | 'washer'
  | 'dryer'
  | 'hotplate'
  | 'oven'
  | 'microwave'
  | 'media'
  | 'lights'
  | 'presence'
  | 'alarm';

type IndicatorCounts = Record<IndicatorKey, number>;

const indicatorKeys: IndicatorKey[] = [
  'door',
  'window',
  'lock',
  'heating',
  'shower',
  'cleaning',
  'cleaning_cook',
  'cleaning_dining',
  'vacuum',
  'guest',
  'dishwasher',
  'washer',
  'dryer',
  'hotplate',
  'oven',
  'microwave',
  'media',
  'lights',
  'presence',
  'alarm',
];

function getIndicatorCounts(areas: Area[], entities: HassEntities): IndicatorCounts {
  const counts = indicatorKeys.reduce((acc, key) => ({ ...acc, [key]: 0 }), {} as IndicatorCounts);

  areas.forEach(area => {
    const areaName = area.name.toLowerCase();
    const areaNameNormalized = areaName.replace(/\s+/g, '_');
    const entityKeys = Object.keys(entities || {});
    const isRooftop = area.area_id === 'rooftop' || areaNameNormalized === 'rooftop';
    const isHallway = areaNameNormalized === 'hallway';
    const isOffice = areaNameNormalized === 'office';
    const isKitchen = areaNameNormalized === 'kitchen';
    const isGuestBathroom = areaNameNormalized === 'guest_bathroom';
    const isDiningRoom = area.area_id === 'dining_room';

    // Presence
    const presenceEntity = entities?.[`binary_sensor.${areaNameNormalized}_pir_presence`];
    if (presenceEntity) counts.presence++;

    // Climate/heating
    const climateEntity = entities?.[`climate.${areaNameNormalized}_thermostat`];
    if (climateEntity) counts.heating++;

    // Doors
    const frontDoor = entities?.[FRONT_DOOR_SENSOR_ENTITY];
    const doorContact = isHallway ? frontDoor : entities?.[`binary_sensor.${areaNameNormalized}_door_contact`];
    const hasHallwayDoor = isHallway && !!frontDoor;
    const hasRooftopDoors = isRooftop; // always count rooftop as having doors (we show the indicator regardless of entity list)
    const hasRoomDoor = !!doorContact || hasRooftopDoors;
    if (hasRoomDoor || hasHallwayDoor) counts.door++;

    // Windows
    const windowContact = entities?.[`binary_sensor.${areaNameNormalized}_window_contact`];
    const diningWindow1 = isDiningRoom ? entities?.['binary_sensor.dining_room_window_1_contact'] : null;
    const diningWindow2 = isDiningRoom ? entities?.['binary_sensor.dining_room_window_2_contact'] : null;
    const diningWindow3 = isDiningRoom ? entities?.['binary_sensor.dining_room_window_3_contact'] : null;
    const hasDiningWindows = isDiningRoom && (diningWindow1 || diningWindow2 || diningWindow3);
    const hasRoomWindow = !!windowContact || hasDiningWindows;
    if (hasRoomWindow) counts.window++;

    // Lock
    const frontLock = entities?.[FRONT_DOOR_LOCK_ENTITY];
    if (isHallway && frontLock) counts.lock++;

    // Shower
    const bathPresenceId = 'binary_sensor.bathroom_bath_presence_presence';
    if (areaNameNormalized === 'bathroom' && entities?.[bathPresenceId]) counts.shower++;

    // Cleaning toggle
    const cleaningToggleId = `${ROBOT_CLEAN_PREFIX}${areaNameNormalized}`;
    if (isKitchen) {
      if (entities?.[ROBOT_CLEAN_KITCHEN_1]) counts.cleaning_cook++;
      if (entities?.[ROBOT_CLEAN_KITCHEN_2]) counts.cleaning_dining++;
    } else if (entities?.[cleaningToggleId]) {
      counts.cleaning++;
    }

    // Vacuum
    const vacuum = entities?.[VACUUM_ENTITY];
    if (isOffice && vacuum) counts.vacuum++;

    // Guest
    if (isOffice && entities?.['input_boolean.overnight_guest']) counts.guest++;

    // Dishwasher
    const dishwasherState = isKitchen ? entities?.['sensor.dishwasher_state']?.state : null;
    if (isKitchen && dishwasherState !== null && dishwasherState !== undefined) counts.dishwasher++;

    // Hotplate
    const hotplatePowerRaw = isKitchen ? entities?.['sensor.hotplate_power_monitor_total_active_power']?.state : null;
    if (isKitchen && hotplatePowerRaw !== null && hotplatePowerRaw !== undefined) counts.hotplate++;

    // Oven
    const ovenPowerRaw = isKitchen ? entities?.['sensor.oven_plug_switch_0_power']?.state : null;
    if (isKitchen && ovenPowerRaw !== null && ovenPowerRaw !== undefined) counts.oven++;

    // Washer/Dryer
    const washerState = isGuestBathroom ? entities?.['sensor.washer_state']?.state : null;
    const dryerState = isGuestBathroom ? entities?.['sensor.dryer_state']?.state : null;
    if (isGuestBathroom && washerState !== null && washerState !== undefined) counts.washer++;
    if (isGuestBathroom && dryerState !== null && dryerState !== undefined) counts.dryer++;

    // Media
    const mediaPlayer = entities?.[`media_player.${areaNameNormalized}`];
    if (mediaPlayer) counts.media++;

    // Lights
    const mappedLights = ROOM_LIGHTS[areaNameNormalized] || [];
    const availableLights =
      mappedLights.length > 0
        ? mappedLights.filter(id => entities?.[id])
        : entityKeys.filter(key => {
            if (!key.startsWith('light.')) return false;
            const lightName = key.slice(6);
            return (
              lightName.startsWith(areaNameNormalized + '_') ||
              lightName === areaNameNormalized + '_lights' ||
              lightName === areaNameNormalized
            );
          });
    if (availableLights.length > 0) counts.lights++;
  });

  return counts;
}

export function RoomGrid({ areas, entities, selectedAreaId, onRoomClick, hassUrl }: RoomGridProps) {
  const allowedAreas = new Set(ROOM_ORDER);

  const filteredAreas = areas.filter(area => {
    const normalized = area.name.toLowerCase().replace(/\s+/g, '_');
    return allowedAreas.has(normalized);
  });

  // Sort areas alphabetically by name
  const sortedAreas = [...filteredAreas].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const indicatorCounts = getIndicatorCounts(sortedAreas, entities);

  return (
    <main className='rooms-container'>
      <div className='rooms-grid'>
        {sortedAreas.map(area => (
          <RoomCard
            key={area.area_id}
            area={area}
            entities={entities}
            onClick={() => onRoomClick(area)}
            isSelected={selectedAreaId === area.area_id}
            hassUrl={hassUrl}
            indicatorCounts={indicatorCounts}
          />
        ))}
      </div>
    </main>
  );
}
