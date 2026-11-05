import type { HassEntities } from '../../types';
import { comfortTone } from '../../utils/roomClimateStory';
import { deriveRoomFeel } from '../../utils/roomFeel';
import {
  BEDROOM_THERMOSTAT,
  HEATING_SUPPLY_TEMP_SENSOR,
  heatNum,
  isHeating,
  loopPowerW,
  loopReturnSensorId,
  zoneSensorId,
  zoneThermostatId,
  type HeatingZone,
} from '../../utils/heating';

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

/** The bedroom row's room, kept apart from ZONE_META because the controller has no zone for it. */
export const BEDROOM_META = {
  name: 'Bedroom',
  icon: 'mdi:bed-outline',
  areaId: 'bedroom',
} satisfies ZoneMeta;
export const BEDROOM_FLOOR_ENTITY = 'sensor.bedroom_floor_thermometer_temperature';

export interface LoopMeta {
  /** The loop's number on the manifold: its wiring-centre zone, actuator cap 1-x. */
  loop: number;
  /** The zone whose thermostat opens the loop; the bedroom has none and is read from its own thermostat. */
  zone: HeatingZone | 'bedroom';
  name: string;
  icon?: string;
  letter?: string;
  /** Flow through the loop in L/min as its manifold flow meter reads at the current valve setting. A fixed number: no
   * sensor reports it, so it changes only when the valve does. */
  flowLpm: number;
}

/** The seven floor loops in manifold order. The family zone opens two of them. */
export const LOOPS: readonly LoopMeta[] = [
  { loop: 1, zone: 'family', name: 'Living room', icon: 'mdi:sofa-outline', flowLpm: 1.2 },
  { loop: 2, zone: 'kristines_room', name: "Kristine's room", letter: 'K', flowLpm: 1.0 },
  { loop: 3, zone: 'claudias_room', name: "Claudia's room", letter: 'C', flowLpm: 0.8 },
  { loop: 4, zone: 'family', name: 'Dining room and kitchen', icon: 'mdi:silverware-fork-knife', flowLpm: 1.7 },
  { loop: 5, zone: 'bedroom', name: 'Bedroom', icon: 'mdi:bed-outline', flowLpm: 1.1 },
  { loop: 6, zone: 'guest_bathroom', name: 'Guest bathroom', icon: 'mdi:toilet', flowLpm: 0.3 },
  { loop: 7, zone: 'bathroom', name: 'Bathroom', icon: 'mdi:shower', flowLpm: 1.2 },
];

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

export interface LoopRow extends LoopMeta {
  /** Return pipe temperature of the loop; null while its probe has no reading or does not exist. */
  returnC: number | null;
  /** Floor supply minus the loop's return: how much the water cooled in the loop. */
  dropC: number | null;
  /** The loop's zone calls for heat now. */
  calling: boolean;
  /** Heat the loop hands over, only while its zone calls: an idle loop's return just reads the manifold. */
  watts: number | null;
}

/** One row per floor loop with its return, its drop and, while the zone calls, its power. */
export function loopRows(entities: HassEntities): LoopRow[] {
  const supplyC = heatNum(entities[HEATING_SUPPLY_TEMP_SENSOR]?.state);
  return LOOPS.map(meta => {
    const returnC = heatNum(entities[loopReturnSensorId(meta.loop)]?.state);
    const dropC = supplyC == null || returnC == null ? null : supplyC - returnC;
    const calling = isHeating(entities[meta.zone === 'bedroom' ? BEDROOM_THERMOSTAT : zoneThermostatId(meta.zone)]);
    return { ...meta, returnC, dropC, calling, watts: calling ? loopPowerW(meta.flowLpm, dropC) : null };
  });
}
