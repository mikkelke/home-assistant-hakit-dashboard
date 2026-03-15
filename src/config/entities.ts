/**
 * Placeholder entity IDs for the dashboard. Replace these with your own Home Assistant entity IDs.
 * This file is the single place to configure vacuum, locks, doors, robot maps path, and transit.
 */

/** Vacuum robot entity (e.g. vacuum.robot or your vacuum entity_id). */
export const VACUUM_ENTITY = 'vacuum.robot';

/** Robot vacuum battery sensor. */
export const VACUUM_BATTERY_SENSOR = 'sensor.robot_battery';

/** Robot cleaning progress sensor. */
export const VACUUM_CLEANING_PROGRESS_SENSOR = 'sensor.robot_cleaning_progress';

/** Robot current room (input_text). */
export const VACUUM_CURRENT_ROOM_INPUT = 'input_text.robot_current_room';

/** Robot current room (sensor). */
export const VACUUM_CURRENT_ROOM_SENSOR = 'sensor.robot_current_room';

/** Robot map camera (e.g. image.robot_map). */
export const VACUUM_MAP_IMAGE_ENTITY = 'image.robot_map';

/** Path under HA /local/ for robot maps (e.g. robot_maps). Used in URLs like /local/robot_maps/index.json. */
export const ROBOT_MAPS_PATH = 'robot_maps';

/** Front door lock (e.g. lock.front_door). */
export const FRONT_DOOR_LOCK_ENTITY = 'lock.front_door';

/** Front door contact sensor (e.g. binary_sensor.front_door). */
export const FRONT_DOOR_SENSOR_ENTITY = 'binary_sensor.front_door';

/** Input boolean: robot automation paused. */
export const ROBOT_PAUSED_BOOLEAN_ENTITY = 'input_boolean.robot_automation_paused';

/** Input text: robot pause reason. */
export const ROBOT_PAUSE_REASON_ENTITY = 'input_text.robot_pause_reason';

/** Prefix for per-room cleaning toggles (e.g. input_boolean.robot_clean_kitchen). */
export const ROBOT_CLEAN_PREFIX = 'input_boolean.robot_clean_';

/** Kitchen cleaning toggle (cook area). */
export const ROBOT_CLEAN_KITCHEN_1 = 'input_boolean.robot_clean_kitchen';

/** Kitchen cleaning toggle (dining area). */
export const ROBOT_CLEAN_KITCHEN_2 = 'input_boolean.robot_clean_kitchen_2';

/** Transit refresh button entity. */
export const TRANSIT_REFRESH_BUTTON = 'input_button.transit_refresh';

/** Transit last updated sensor. */
export const TRANSIT_LAST_UPDATED_SENSOR = 'sensor.transit_last_updated';
