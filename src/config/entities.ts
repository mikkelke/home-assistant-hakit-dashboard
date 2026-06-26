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

/** Input boolean: robot enabled/disabled. */
export const ROBOT_ENABLED_BOOLEAN_ENTITY = 'input_boolean.rober2_enabled';

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

// --- Portable air conditioner (Midea porta split; seasonal, lives in the bedroom) ---
// The device has no HA area assigned, so it is surfaced via these explicit ids rather than
// the area-derived `climate.{area}_thermostat` convention (that one is the bedroom's
// underfloor heating). When the unit is stored away / unplugged the climate entity reports
// `unavailable`, which is how the dashboard auto-hides the card and the bedroom cooling badge.

/** Main climate entity for the portable AC (mode, target temp, fan, swing). */
export const AC_THERMOSTAT_ENTITY = 'climate.air_conditioner_thermostat';

/** Rich device status; attributes expose outdoor_temperature (bathroom/condenser side) and pmv (comfort). */
export const AC_DEVICE_STATUS_ENTITY = 'binary_sensor.air_conditioner_device_status';

/** Live power draw in W. */
export const AC_POWER_SENSOR = 'sensor.air_conditioner_real_time_power';

/** Window that must be OPEN while cooling, so the condenser (in the bathroom) can vent its heat. */
export const AC_VENT_WINDOW_SENSOR = 'binary_sensor.bathroom_window_contact';

/**
 * Bathroom room temperature — the room the condenser vents into. Shown on the card so you can
 * see if the bathroom is overheating. (Use this real room temp, NOT the AC's `outdoor_temperature`
 * attribute, which is the condenser unit's own sensor and reads hotter than the room.)
 */
export const AC_VENT_ROOM_CLIMATE = 'climate.bathroom_thermostat';

/**
 * Room temperature shown on the card. The AC's own `current_temperature` is its intake-air
 * sensor (reads ~2° cold while cooling, so target can look like "heating"). Use a combined
 * bedroom reading instead — a min_max(median) helper over the 1.5m wall, floor and ceiling
 * sensors (median rejects the noisy ceiling/presence sensor). Falls back to the AC's own
 * reading if the combined sensor is ever unavailable.
 */
export const AC_ROOM_TEMP_SENSOR = 'sensor.bedroom_median_temperature';

/** Normalized area name that hosts the AC card (the indoor unit is in the bedroom). */
export const AC_HOST_AREA = 'bedroom';

/** True when the portable AC is physically deployed (plugged in / reachable), i.e. not stored away. */
export function isAcDeployed(entities: HassEntities | undefined): boolean {
  const ac = entities?.[AC_THERMOSTAT_ENTITY];
  if (!ac) return false;
  return ac.state !== 'unavailable' && ac.state !== 'unknown';
}

// --- Smart cooling (AppDaemon `SmartCooling` app: autonomous price-aware pre-cool + comfort) ---
// The app recomputes every 15 min and drives `climate.air_conditioner_thermostat`. These ids are
// the published status sensor + the control helpers it reads (all created via the HA MCP).

/** Published status sensor: state (waiting/cooling/comfort/off/…) + plan attributes for the card. */
export const SMART_COOLING_STATUS_SENSOR = 'sensor.smart_cooling_status';

/** Master enable — your morning toggle. Turning it OFF makes the app turn the AC off. */
export const SMART_COOLING_ENABLE = 'input_boolean.smart_cooling';

/** Comfort cooling: keep the room nice while power is cheap (independent of the sleep goal). */
export const SMART_COOLING_COMFORT_ENABLE = 'input_boolean.smart_cooling_comfort';

/** Sleep pre-cool target temperature to reach by bedtime. */
export const SMART_COOLING_TARGET_TEMP = 'input_number.smart_cooling_target_temp';

/** Bedtime — the time the room must hit the sleep target. */
export const SMART_COOLING_BEDTIME = 'input_datetime.smart_cooling_bedtime';

/** Comfort price ceiling (DKK/kWh): comfort cools only when the current price is at/below this. */
export const SMART_COOLING_COMFORT_PRICE = 'input_number.smart_cooling_free_price';

/** Comfort hold temperature. */
export const SMART_COOLING_COMFORT_TEMP = 'input_number.smart_cooling_day_maintain_temp';

/** Night ceiling: keep the bedroom <= this for the whole night (the primary cooling objective). */
export const SMART_COOLING_NIGHT_CEILING = 'input_number.smart_cooling_night_ceiling';

// --- Bedroom solar shade (AppDaemon `BedroomSolarShade` app: blocks morning ENE sun, keeps daylight) ---

/** Opt-in toggle for automatic sun-shading of cover.bedroom_blind. */
export const BEDROOM_SOLAR_SHADE_ENABLE = 'input_boolean.bedroom_solar_shade';

/** Blind position (0 open … 100 closed) used while the morning sun is on the window. */
export const BEDROOM_SOLAR_SHADE_POSITION = 'input_number.bedroom_solar_shade_position';

/** Published status sensor (shading/open/inactive + reason). */
export const BEDROOM_SOLAR_SHADE_STATUS = 'sensor.bedroom_solar_shade_status';
