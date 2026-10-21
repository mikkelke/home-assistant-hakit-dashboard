import type { HouseBuilder } from './builder';
import { HOUR, iso } from './time';

const LIGHTS_OUT = [
  'island_lights',
  'kitchen_counter_lights',
  'living_room_corner_light',
  'living_room_wall_lights',
  'guest_bathroom_lights',
  'floor_lamp',
];

export function applyNight(h: HouseBuilder): void {
  const { now } = h;
  const sun = h.states.get('sun.sun');
  if (sun) {
    h.put('sun.sun', 'below_horizon', {
      ...sun.attributes,
      elevation: -31.4,
      azimuth: 345,
      next_rising: iso(now + 7.9 * HOUR),
      next_setting: iso(now + 18.1 * HOUR),
    });
  }
  h.put('weather.forecast_home', 'clear-night', {
    ...(h.states.get('weather.forecast_home')?.attributes ?? {}),
    cloud_coverage: 10,
    temperature: 9.1,
  });
  for (const light of LIGHTS_OUT) {
    const seed = h.states.get(`light.${light}`);
    if (seed && seed.state === 'on')
      h.put(`light.${light}`, 'off', { ...seed.attributes, brightness: null, color_mode: null }, { ago: 40 });
  }
  const hallway = h.states.get('light.hallway_lights');
  if (hallway) h.put('light.hallway_lights', 'on', { ...hallway.attributes, brightness: 26 }, { ago: 12 });
  h.put('input_boolean.kristine_sleep_mode', 'on', { friendly_name: 'Kristine sleep mode' }, { ago: 55 });
  h.put(
    'binary_sensor.kristines_room_active',
    'on',
    { friendly_name: 'Kristines Room active', device_class: 'occupancy', reason: 'bed:binary_sensor.kristines_room_presence_occupancy' },
    { ago: 55 }
  );
  for (const room of ['living_room', 'kitchen']) {
    h.put(
      `binary_sensor.${room}_active`,
      'off',
      { friendly_name: `${room} active`, device_class: 'occupancy', reason: 'all_clear' },
      { ago: 70 }
    );
    h.put(
      `media_player.${room}`,
      'idle',
      { ...(h.states.get(`media_player.${room}`)?.attributes ?? {}), group_members: [`media_player.${room}`] },
      { ago: 70 }
    );
  }
  h.put('media_player.kristines_room', 'off', { ...(h.states.get('media_player.kristines_room')?.attributes ?? {}) }, { ago: 90 });
}
