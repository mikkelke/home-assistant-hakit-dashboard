/**
 * Entity IDs for vacuum, locks, doors, robot maps, and transit.
 * Set these to match your Home Assistant entity_ids so the vacuum card (Office) and room cleaning toggles appear.
 */

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

/** Front door lock (e.g. lock.front_door). */
export const FRONT_DOOR_LOCK_ENTITY = 'lock.front_door';

/** Front door contact sensor (e.g. binary_sensor.front_door). */
export const FRONT_DOOR_SENSOR_ENTITY = 'binary_sensor.front_door';

/** Input boolean: robot automation paused. */
export const ROBOT_PAUSED_BOOLEAN_ENTITY = 'input_boolean.rober2_automation_paused';

/** Input text: robot pause reason. */
export const ROBOT_PAUSE_REASON_ENTITY = 'input_text.rober2_pause_reason';

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
