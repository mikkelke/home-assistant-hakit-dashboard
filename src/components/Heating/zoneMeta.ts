import type { HassEntities } from '../../types';
import { comfortTone } from '../../utils/roomClimateStory';
import { deriveRoomFeel } from '../../utils/roomFeel';
import { BEDROOM_THERMOSTAT, heatNum, zoneSensorId, type HeatingZone } from '../../utils/heating';

export interface ZoneMeta {
  name: string;
  icon?: string;
  letter?: string;
  /** The area whose feel sensor gives the zone its comfort colour. */
  areaId: string;
}

export const ZONE_META: Record<HeatingZone, ZoneMeta> = {
  family: { name: 'Kitchen & dining', icon: 'mdi:silverware-fork-knife', areaId: 'kitchen' },
  living: { name: 'Living room', icon: 'mdi:sofa-outline', areaId: 'living_room' },
  kristines_room: { name: "Kristine's room", letter: 'K', areaId: 'kristines_room' },
  claudias_room: { name: "Claudia's room", letter: 'C', areaId: 'office' },
  bathroom: { name: 'Bathroom', icon: 'mdi:shower', areaId: 'bathroom' },
  guest_bathroom: { name: 'Guest bathroom', icon: 'mdi:toilet', areaId: 'guest_bathroom' },
};

/** The bedroom row's room, kept apart from ZONE_META because the controller has no zone for it. */
export const BEDROOM_META = { name: 'Bedroom', icon: 'mdi:bed-outline', areaId: 'bedroom' } satisfies ZoneMeta;
export const BEDROOM_FLOOR_ENTITY = 'sensor.bedroom_floor_thermometer_temperature';

/** The zone's air temperature (the controller's control air, else the thermostat's reading) and
 * the comfort tone the room's climate chip uses. */
export function zoneAir(entities: HassEntities, zone: HeatingZone) {
  const attrs = entities[zoneSensorId(zone)]?.attributes;
  const feel = deriveRoomFeel(entities, ZONE_META[zone].areaId);
  return {
    airC: heatNum(attrs?.control_air) ?? heatNum(attrs?.thermostat_temp),
    tone: feel.available && !feel.stale ? comfortTone(feel.comfortWord) : 'neutral',
  };
}

/** The bedroom's air temperature (its feel sensor, else its thermostat's reading) and the comfort tone of the feel. */
export function bedroomAir(entities: HassEntities) {
  const feel = deriveRoomFeel(entities, BEDROOM_META.areaId);
  return {
    airC: feel.tempC ?? heatNum(entities[BEDROOM_THERMOSTAT]?.attributes?.current_temperature),
    tone: feel.available && !feel.stale ? comfortTone(feel.comfortWord) : 'neutral',
  };
}
