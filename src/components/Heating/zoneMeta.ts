import type { HassEntities } from '../../types';
import { comfortTone } from '../../utils/roomClimateStory';
import { deriveRoomFeel } from '../../utils/roomFeel';
import { BEDROOM_THERMOSTAT, heatNum, loopReturnSensorId, zoneSensorId, type HeatingZone } from '../../utils/heating';

export interface ZoneMeta {
  name: string;
  icon?: string;
  letter?: string;
  /** The area whose feel sensor gives the zone its comfort colour. */
  areaId: string;
  /** The floor loops the zone opens, with the icon its return probe shows under. */
  loops: { loop: number; icon: string }[];
}

const LOOP_ICON = 'mdi:thermometer-chevron-down';

export const ZONE_META: Record<HeatingZone, ZoneMeta> = {
  family: {
    name: 'Family',
    icon: 'mdi:sofa-outline',
    areaId: 'living_room',
    loops: [
      { loop: 1, icon: 'mdi:sofa-outline' },
      { loop: 4, icon: 'mdi:silverware-fork-knife' },
    ],
  },
  kristines_room: { name: "Kristine's room", letter: 'K', areaId: 'kristines_room', loops: [{ loop: 2, icon: LOOP_ICON }] },
  claudias_room: { name: "Claudia's room", letter: 'C', areaId: 'office', loops: [{ loop: 3, icon: LOOP_ICON }] },
  bathroom: { name: 'Bathroom', icon: 'mdi:shower', areaId: 'bathroom', loops: [{ loop: 7, icon: LOOP_ICON }] },
  guest_bathroom: { name: 'Guest bathroom', icon: 'mdi:toilet', areaId: 'guest_bathroom', loops: [{ loop: 6, icon: LOOP_ICON }] },
};

/** The bedroom row's room, kept apart from ZONE_META because the controller has no zone for it. */
export const BEDROOM_META = {
  name: 'Bedroom',
  icon: 'mdi:bed-outline',
  areaId: 'bedroom',
  loops: [{ loop: 5, icon: LOOP_ICON }],
} satisfies ZoneMeta;
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

/** The return temperature of each of the zone's floor loops that has a reading. */
export function loopReturns(entities: HassEntities, meta: ZoneMeta) {
  return meta.loops.flatMap(({ loop, icon }) => {
    const tempC = heatNum(entities[loopReturnSensorId(loop)]?.state);
    return tempC == null ? [] : [{ loop, icon, tempC }];
  });
}
