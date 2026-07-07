// Room-to-light mapping used by LightCard
// Add or adjust entity ids as needed

export const ROOM_LIGHTS: Record<string, string[]> = {
  dining_room: ['light.dining_room_lights'],
  kitchen: ['light.island_lights', 'light.kitchen_counter_lights'],
  living_room: ['light.living_room_corner_light', 'light.living_room_window_light', 'light.living_room_wall_lights'],
  bedroom: ['light.bedroom_bed_lights', 'light.bedroom_ceiling_lights'],
  bathroom: ['light.bathroom_lights'],
  guest_bathroom: ['light.guest_bathroom_lights'],
  hallway: ['light.hallway_lights'],
  claudias_room: ['light.claudias_room_ceiling_lights', 'light.claudias_room_floor_light'],
  kristines_room: ['light.floor_lamp', 'light.small_lamp'],
};

// Lights to track in status bar (counts) – derived from ROOM_LIGHTS (unique)
export const TRACKED_LIGHTS = Array.from(new Set(Object.values(ROOM_LIGHTS).flat()));

// Global mechanism: per-room manual override toggle (input_boolean) — ON pauses that
// room's automatic lighting (the AppDaemon *_lights apps). The family zone has per-zone
// toggles (each area of the big room pauses only its own lights; island follows kitchen).
// Kristines room is manual-only (no auto lights) and rooftop has none, so neither appears.
// Must match `timeout_hours` in AppDaemon lights/manual_override_timeout.yaml — the
// dashboard countdown and the server-side auto-off both derive from the boolean's
// last_changed, so they stay in sync as long as this constant matches.
export const ROOM_LIGHT_MANUAL_OVERRIDE_TIMEOUT_HOURS = 12;

export const ROOM_LIGHT_MANUAL_OVERRIDE: Record<string, string> = {
  bathroom: 'input_boolean.bathroom_lights_manual',
  bedroom: 'input_boolean.bedroom_lights_manual',
  kitchen: 'input_boolean.kitchen_lights_manual',
  living_room: 'input_boolean.living_room_lights_manual',
  dining_room: 'input_boolean.dining_room_lights_manual',
  hallway: 'input_boolean.hallway_lights_manual',
  guest_bathroom: 'input_boolean.guest_bathroom_lights_manual',
  claudias_room: 'input_boolean.claudias_room_lights_manual',
};
