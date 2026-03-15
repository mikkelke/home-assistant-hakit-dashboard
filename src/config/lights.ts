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
  office: ['light.office_ceiling_lights', 'light.office_floor_light'],
  kristines_room: ['light.floor_lamp', 'light.small_lamp'],
};

// Lights to track in status bar (counts) – derived from ROOM_LIGHTS (unique)
export const TRACKED_LIGHTS = Array.from(new Set(Object.values(ROOM_LIGHTS).flat()));
