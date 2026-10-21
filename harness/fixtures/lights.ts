import type { HouseBuilder } from './builder';

interface LightSpec {
  id: string;
  name: string;
  /** 0 to 100, or null for off. */
  level: number | null;
  kelvin?: number;
  rgb?: [number, number, number];
  dead?: boolean;
}

const LIGHTS: readonly LightSpec[] = [
  { id: 'dining_room_lights', name: 'Dining room lights', level: null },
  { id: 'island_lights', name: 'Island lights', level: 80, kelvin: 2700 },
  { id: 'kitchen_counter_lights', name: 'Kitchen counter lights', level: 60, kelvin: 3000 },
  { id: 'living_room_corner_light', name: 'Living room corner light', level: 40, rgb: [255, 150, 70] },
  {
    id: 'living_room_window_light',
    name: 'Living room window light with the reading lamp and its replaced bulb',
    level: null,
    kelvin: 2700,
  },
  { id: 'living_room_wall_lights', name: 'Living room wall lights', level: 55, kelvin: 2700 },
  { id: 'bedroom_bed_lights', name: 'Bedroom bed lights', level: null, kelvin: 2400 },
  { id: 'bedroom_ceiling_lights', name: 'Bedroom ceiling lights', level: null, kelvin: 2700 },
  { id: 'bathroom_lights', name: 'Bathroom lights', level: null, kelvin: 3000 },
  { id: 'guest_bathroom_lights', name: 'Guest bathroom lights', level: 100, kelvin: 4000 },
  { id: 'hallway_lights', name: 'Hallway lights', level: 35, kelvin: 2700 },
  { id: 'claudias_room_ceiling_lights', name: 'Claudias room ceiling lights', level: null, kelvin: 3000 },
  { id: 'claudias_room_string_lights', name: 'Claudias room string lights', level: null, rgb: [255, 190, 120] },
  { id: 'floor_lamp', name: 'Floor lamp', level: 70, kelvin: 2700 },
  { id: 'small_lamp', name: 'Small lamp', level: 0, kelvin: 2700, dead: true },
];

const MANUAL = ['bathroom', 'bedroom', 'kitchen', 'living_room', 'dining_room', 'hallway', 'guest_bathroom', 'claudias_room'];

export function addLights(h: HouseBuilder): void {
  for (const light of LIGHTS) {
    const on = light.level !== null && light.level > 0;
    const modes = light.rgb ? ['color_temp', 'rgb'] : ['color_temp'];
    h.put(
      `light.${light.id}`,
      light.dead ? null : on ? 'on' : 'off',
      {
        friendly_name: light.name,
        supported_color_modes: modes,
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
        supported_features: 40,
        ...(on
          ? {
              brightness: Math.round(((light.level ?? 0) / 100) * 255),
              color_mode: light.rgb ? 'rgb' : 'color_temp',
              ...(light.rgb ? { rgb_color: light.rgb } : { color_temp_kelvin: light.kelvin ?? 2700 }),
            }
          : { brightness: null, color_mode: null }),
      },
      { ago: on ? 130 : 400 }
    );
  }
  for (const key of MANUAL) {
    const name = key.replace(/_/g, ' ');
    h.put(
      `input_boolean.${key}_lights_manual`,
      key === 'dining_room' ? 'on' : 'off',
      { friendly_name: `${name} lights manual` },
      { ago: key === 'dining_room' ? 190 : 900 }
    );
  }
}
