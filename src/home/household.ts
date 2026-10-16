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
  /** The Music Assistant player their phone registers as; it exists only while the MA app runs. */
  phonePlayerEntityId?: string;
}

export const HOUSEHOLD: readonly HouseholdMember[] = [
  {
    key: 'mikkel',
    name: 'Mikkel',
    personEntityId: 'person.mikkel',
    sleepModeEntityId: 'input_boolean.mikkel_sleep_mode',
    roomAreaId: 'bedroom',
    phonePlayerEntityId: 'media_player.mikkels_phone',
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

/** The phone player of the member whose HA user display name is `userName`, ignoring case. */
export function phonePlayerOf(userName: string | null | undefined): string | undefined {
  const name = userName?.trim().toLowerCase();
  return name ? HOUSEHOLD.find(member => member.name.toLowerCase() === name)?.phonePlayerEntityId : undefined;
}

/** An entity's state string, or undefined when it is missing. */
export type StateReader = (entityId: string) => string | undefined;

/** The viewer's own phone player while its entity exists and is not unavailable, which is only while the Music Assistant app
 * runs. Never another member's: a viewer without a phone player of their own gets none. */
export function availablePhonePlayer(userName: string | null | undefined, readState: StateReader): string | undefined {
  const entityId = phonePlayerOf(userName);
  const state = entityId ? readState(entityId) : undefined;
  return entityId && state !== undefined && state !== 'unavailable' ? entityId : undefined;
}

/** Whether an entity is some member's phone player. */
export function isPhonePlayer(entityId: string): boolean {
  return HOUSEHOLD.some(member => member.phonePlayerEntityId === entityId);
}

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
