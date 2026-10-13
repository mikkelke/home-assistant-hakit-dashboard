/** The people who live here: their HA person, sleep mode and room, and when the house counts as
 * night. Pure. */
import { homeWallTime } from '../energy/homeTime';

export interface HouseholdMember {
  key: 'mikkel' | 'kristine' | 'claudia';
  /** HA user display name. */
  name: string;
  personEntityId: string;
  sleepModeEntityId: string;
  /** HA area id of their room. Claudia's room is still the area `office`. */
  roomAreaId: string;
}

export const HOUSEHOLD: readonly HouseholdMember[] = [
  {
    key: 'mikkel',
    name: 'Mikkel',
    personEntityId: 'person.mikkel',
    sleepModeEntityId: 'input_boolean.mikkel_sleep_mode',
    roomAreaId: 'bedroom',
  },
  {
    key: 'kristine',
    name: 'Kristine',
    personEntityId: 'person.kristine',
    sleepModeEntityId: 'input_boolean.kristine_sleep_mode',
    roomAreaId: 'kristines_room',
  },
  {
    key: 'claudia',
    name: 'Claudia',
    personEntityId: 'person.claudia',
    sleepModeEntityId: 'input_boolean.claudia_sleep_mode',
    roomAreaId: 'office',
  },
];

/** An entity's state string, or undefined when it is missing. */
export type StateReader = (entityId: string) => string | undefined;

export function asleepMembers(readState: StateReader): HouseholdMember[] {
  return HOUSEHOLD.filter(member => readState(member.sleepModeEntityId) === 'on');
}

/** Home-time night: from 23:00 until 06:00. */
export const NIGHT_HOURS = { from: 23, until: 6 } as const;

export function isNightHour(nowMs: number): boolean {
  const { hour } = homeWallTime(nowMs);
  return hour >= NIGHT_HOURS.from || hour < NIGHT_HOURS.until;
}

/** Night hours, or anyone in sleep mode. */
export function isHouseNight(nowMs: number, readState: StateReader): boolean {
  return isNightHour(nowMs) || asleepMembers(readState).length > 0;
}
