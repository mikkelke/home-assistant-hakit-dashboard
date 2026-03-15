// Dashboard configuration. Replace area names and entity IDs with your own.

// Areas to exclude from the dashboard
export const EXCLUDED_AREAS: string[] = [];

// Room display order (rooms not listed will appear at the end alphabetically).
// Use lowercase with underscores (area name normalized).
export const ROOM_ORDER = [
  'bathroom',
  'bedroom',
  'dining_room',
  'living_room',
  'kitchen',
  'hallway',
  'office',
  'kristines_room',
  'guest_bathroom',
  'rooftop',
];

// Room display settings
export const ROOM_GRID = {
  columns: {
    mobile: 2,
    tablet: 2,
    desktop: 3,
  },
};

// Exterior doors to track in status bar (on = open, off = closed). Replace with your entity_ids.
export const TRACKED_DOORS = ['binary_sensor.front_door', 'binary_sensor.door_2_contact', 'binary_sensor.door_3_contact'];

// Windows to track in status bar (exterior/important ones only). Replace with your entity_ids.
export const TRACKED_WINDOWS = [
  'binary_sensor.dining_room_window_1_contact',
  'binary_sensor.dining_room_window_2_contact',
  'binary_sensor.dining_room_window_3_contact',
];
