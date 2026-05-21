/**
 * Entity IDs for vacuum, locks, doors, robot maps, and transit.
 * Set these to match your Home Assistant entity_ids so the vacuum card (Office) and room cleaning toggles appear.
 */

import type { HassEntities } from '../types';

/** Vacuum robot entity (e.g. vacuum.rober2). */
export const VACUUM_ENTITY = 'vacuum.rober2';

/** Robot vacuum battery sensor. */
export const VACUUM_BATTERY_SENSOR = 'sensor.rober2_battery';

/** Robot cleaning progress sensor. */
export const VACUUM_CLEANING_PROGRESS_SENSOR = 'sensor.rober2_cleaning_progress';

/** Robot current room (input_text). */
export const VACUUM_CURRENT_ROOM_INPUT = 'input_text.rober2_current_room';

/** Robot current room (sensor). */
export const VACUUM_CURRENT_ROOM_SENSOR = 'sensor.rober2_current_room';

/** Robot map camera (live map image; in your HA this is image.rober2_rooftop). */
export const VACUUM_MAP_IMAGE_ENTITY = 'image.rober2_rooftop';

/** Path under HA /local/ for robot maps. Used in URLs like /local/rober2_maps/index.json. */
export const ROBOT_MAPS_PATH = 'rober2_maps';

/** Hallway / “main door” lock (HA: lock.yale; Intercom building front is lock.intercomproxy_front_door). */
export const FRONT_DOOR_LOCK_ENTITY = 'lock.yale';

/**
 * Template: any apartment entry door open (OR of physical contacts).
 * Prefer this everywhere the UI shows a single “apartment door” state.
 */
export const APARTMENT_DOOR_OPEN_ENTITY = 'binary_sensor.apartment_door_open';

/** Single contact fallback when the template entity is not in the registry. */
export const YALE_DOOR_CONTACT_ENTITY = 'binary_sensor.yale_door';

/**
 * Hallway room tile: combined template first, then legacy single Yale contact.
 */
export function resolveHallwayDoorSensorId(entities: HassEntities | undefined): string | null {
  if (!entities) return null;
  if (entities[APARTMENT_DOOR_OPEN_ENTITY]) return APARTMENT_DOOR_OPEN_ENTITY;
  if (entities[YALE_DOOR_CONTACT_ENTITY]) return YALE_DOOR_CONTACT_ENTITY;
  return null;
}

/**
 * Hallway lock indicator: primary {@link FRONT_DOOR_LOCK_ENTITY}, then BT lock, then legacy IDs.
 */
export function resolveHallwayLockEntityId(entities: HassEntities | undefined): string | null {
  if (!entities) return null;
  if (entities[FRONT_DOOR_LOCK_ENTITY]) return FRONT_DOOR_LOCK_ENTITY;
  if (entities['lock.yale_bt']) return 'lock.yale_bt';
  if (entities['lock.front_door']) return 'lock.front_door';
  return null;
}

/** Input boolean: robot automation paused. */
export const ROBOT_PAUSED_BOOLEAN_ENTITY = 'input_boolean.rober2_automation_paused';

/** Input text: robot pause reason. */
export const ROBOT_PAUSE_REASON_ENTITY = 'input_text.rober2_pause_reason';

/** Input text: milestone cleaning narrative (human-readable; updated by automation, not per-percent). */
export const ROBOT_CLEANING_NARRATIVE_ENTITY = 'input_text.rober2_cleaning_narrative';

/** Prefix for per-room cleaning toggles (e.g. input_boolean.rober2_clean_kitchen). Room toggle ID = prefix + area (e.g. rober2_clean_bathroom). */
export const ROBOT_CLEAN_PREFIX = 'input_boolean.rober2_clean_';

/** Kitchen cleaning toggle (cook area). */
export const ROBOT_CLEAN_KITCHEN_1 = 'input_boolean.rober2_clean_kitchen';

/** Kitchen cleaning toggle (dining area). */
export const ROBOT_CLEAN_KITCHEN_2 = 'input_boolean.rober2_clean_kitchen_2';

/** Transit refresh button entity. */
export const TRANSIT_REFRESH_BUTTON = 'input_button.transit_refresh';

/** Transit last updated sensor. */
export const TRANSIT_LAST_UPDATED_SENSOR = 'sensor.transit_last_updated';

/** Bedroom bedside occupancy sensors with display metadata for overview + timeline UI. */
export const BEDROOM_BED_OCCUPANCY_SENSORS = [
  {
    entityId: 'binary_sensor.left_bedside',
    side: 'Left side',
  },
  {
    entityId: 'binary_sensor.right_bedside',
    side: 'Right side',
  },
] as const;

// --- Dryer (guest bathroom; matches AppDaemon / backend entity_ids) ---

/** Dryer state sensor (Off, Running, Paused, Unemptied, Emptied). */
export const DRYER_STATE_ENTITY = 'sensor.dryer_state';

/** Programme selector on the panel. */
export const DRYER_PROGRAMME_SELECT = 'input_select.dryer_programme';

/** Dryness / result (when the programme supports it). */
export const DRYER_DRYNESS_SELECT = 'input_select.dryer_dryness';

/** Skåne + (when applicable). */
export const DRYER_SKANE_PLUS_BOOLEAN = 'input_boolean.dryer_skane_plus';

/** Duration for “Varm luft” only. */
export const DRYER_TIME_MINUTES_SELECT = 'input_select.dryer_time_minutes';

/** Announce when finished. */
export const DRYER_ANNOUNCE_BOOLEAN = 'input_boolean.dryer_announce';
