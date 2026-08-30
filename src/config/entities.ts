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

/** Path under HA /local/ for archived doorbell ring snapshots (AbbWelcomeBridge).
 * Used in URLs like /local/abb_doorbell/index.json. */
export const DOORBELL_ARCHIVE_PATH = 'abb_doorbell';

/**
 * Hallway / “main door” lock. lock.yale_bt (local Bluetooth) is authoritative — the cloud
 * twin lock.yale can miss re-lock pushes and stick "unlocked" (seen 2026-07-12, 1.5 h stale).
 * Intercom building front is split in two (trial): opening is commanded via the ABB Welcome
 * integration's button (button.abb_welcome_gateway_outdoor_station_2_1), while
 * lock.intercomproxy_front_door still reports the door's state — the ESP is the only side
 * that sees the door controller's bus acknowledgement, so state stays there no matter who
 * commanded the open. Building back door is unchanged: both command and state stay on
 * lock.intercomproxy_back_door.
 */
export const FRONT_DOOR_LOCK_ENTITY = 'lock.yale_bt';

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
 * Hallway lock indicator: primary {@link FRONT_DOOR_LOCK_ENTITY} (BLE), then cloud twin, then legacy IDs.
 */
export function resolveHallwayLockEntityId(entities: HassEntities | undefined): string | null {
  if (!entities) return null;
  if (entities[FRONT_DOOR_LOCK_ENTITY]) return FRONT_DOOR_LOCK_ENTITY;
  if (entities['lock.yale']) return 'lock.yale';
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

/**
 * Bedroom bedside occupancy sensors with display metadata for overview + timeline UI.
 * Each side's Withings sleep mat stays the canonical entity (selector rows + timelines);
 * `witnessEntityIds` are extra fast/local witnesses (ESPHome pressure strip, installed
 * 2026-08-12) OR'd into that side's occupancy display. Additive only — a witness may
 * assert presence, never absence: the mats alone decide "bed empty", matching the
 * backend's tandem rule for the same strip. The bed's sole occupant doesn't always
 * sleep left, so each side maps to its own strip zone (`_left` / `_right`) rather than
 * sharing one. The whole-bed aggregate (`_either`) used to stand in on the left side
 * for the then-unvalidated `_right` zone; dropped as redundant now that `_right` has
 * its own live validation (2026-08-30: raw pressure tracked right-side occupancy
 * cleanly while `_left` stayed near 0%, confirming `_right` is trustworthy on its own).
 */
export const BEDROOM_BED_OCCUPANCY_SENSORS: ReadonlyArray<{
  /** Withings sleep mat — the per-side entity shown in the selection modal and timeline. */
  entityId: string;
  side: string;
  /** Additional occupied-only witnesses OR'd into this side (may be empty). */
  witnessEntityIds: readonly string[];
}> = [
  {
    entityId: 'binary_sensor.left_bedside',
    side: 'Left side',
    witnessEntityIds: ['binary_sensor.bed_presence_6b9c94_bed_occupied_left'],
  },
  {
    entityId: 'binary_sensor.right_bedside',
    side: 'Right side',
    witnessEntityIds: ['binary_sensor.bed_presence_6b9c94_bed_occupied_right'],
  },
];

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

/** Live power draw in W. */

/** Window that must be OPEN while cooling, so the condenser (in the bathroom) can vent its heat. */
export const AC_VENT_WINDOW_SENSOR = 'binary_sensor.bathroom_window_contact';

/**
 * Bathroom room temperature — the room the condenser vents into. Shown on the card so you can
 * see if the bathroom is overheating. (Use this real room temp, NOT the AC's `outdoor_temperature`
 * attribute, which is the condenser unit's own sensor and reads hotter than the room.)
 */

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

/** Click right before physically removing the AC — seals the room for the night. Auto-resets. */
export const SMART_COOLING_AC_REMOVED = 'input_boolean.smart_cooling_ac_removed';

/** One tap holds the compressor off for ~30 min (the condenser stands in the bathroom, so a
 * planner start mid-shower means hot exhaust in the shower room). SmartCooling clears it
 * itself when the window ends; tap again to resume early. */
export const SMART_COOLING_SHOWER_PAUSE = 'input_boolean.smart_cooling_shower_pause';

/** Bedroom comfort middle layer (AppDaemon BedroomComfort): dew point, effective ceiling, vent advice. */
export const BEDROOM_COMFORT_SENSOR = 'sensor.bedroom_comfort';

/** AC deploy advisor (AppDaemon DeployAdvisor): projected sleeping-zone night peaks without cooling. */
export const BEDROOM_NIGHT_PROJECTION_SENSOR = 'sensor.bedroom_night_projection';

/** Warmest wake-up temperature (°C) the SmartCooling automation is allowed to settle for. The
 * Tonight card's only interactive control besides the master on/off (input_number, 20-26, 0.5 step). */
export const SMART_COOLING_NIGHT_CEILING = 'input_number.smart_cooling_night_ceiling';

/** Tonight's recommendation (state: windows/hybrid/ac/nothing) + wake projection/time + the
 * one-voice verdict (verdict_title/verdict_text) shared by the Tonight card, push notifications,
 * and the rescue flow - so they never say three different things about the same night. */
export const SLEEP_PLAN_SENSOR = 'sensor.sleep_plan';

/** Entry arbitration middle layer (AppDaemon EntryTruth): BLE-authoritative lock + door fused, cloud_agrees flag. */
export const APARTMENT_ENTRY_SECURE_ENTITY = 'binary_sensor.apartment_entry_secure';

// --- Bedroom solar shade (AppDaemon `BedroomSolarShade` app: blocks morning ENE sun, keeps daylight) ---

/** Opt-in toggle for automatic sun-shading of cover.bedroom_blind. */
export const BEDROOM_SOLAR_SHADE_ENABLE = 'input_boolean.bedroom_solar_shade';

/** Blind position (0 open … 100 closed) used while the morning sun is on the window. */
export const BEDROOM_SOLAR_SHADE_POSITION = 'input_number.bedroom_solar_shade_position';

/** Published status sensor (shading/open/inactive + reason). */
export const BEDROOM_SOLAR_SHADE_STATUS = 'sensor.bedroom_solar_shade_status';

// --- Home activity (AppDaemon `HouseEvents` app, apps/home_pulse/house_events.py): plain-English
// feed of what the house just did, for non-technical housemates. ---

/**
 * Feed sensor. state is the UTC ISO timestamp of the newest event (or the string "empty");
 * attributes.events is a newest-first array of `{ ts, icon, text }` (max 40 entries). Ephemeral —
 * the list resets across HA restarts (nothing is persisted), so gaps are expected, not a bug.
 */
export const HOUSE_EVENTS_ENTITY = 'sensor.house_events';
