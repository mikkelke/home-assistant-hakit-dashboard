import type { HassEntities } from '../../types';
import { comfortTone } from '../../utils/roomClimateStory';
import { deriveRoomFeel } from '../../utils/roomFeel';
import { heatNum, zoneSensorId, type HeatingZone } from '../../utils/heating';

export interface ZoneMeta {
  name: string;
  icon?: string;
  letter?: string;
  /** The area whose feel sensor gives the zone its comfort colour. */
  areaId: string;
}

export const ZONE_META: Record<HeatingZone, ZoneMeta> = {
  family: { name: 'Family', icon: 'mdi:sofa-outline', areaId: 'living_room' },
  kristines_room: { name: "Kristine's room", letter: 'K', areaId: 'kristines_room' },
  claudias_room: { name: "Claudia's room", letter: 'C', areaId: 'office' },
  bathroom: { name: 'Bathroom', icon: 'mdi:shower', areaId: 'bathroom' },
  guest_bathroom: { name: 'Guest bathroom', icon: 'mdi:toilet', areaId: 'guest_bathroom' },
};

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
