import type { HouseBuilder } from './builder';
import { HOUR, MINUTE } from './time';

const QUEUE = [
  'hallway',
  'kitchen',
  'kitchen_2',
  'living_room',
  'dining_room',
  'claudias_room',
  'kristines_room',
  'bedroom',
  'bathroom',
  'guest_bathroom',
];

export function addVacuum(h: HouseBuilder): void {
  const { now } = h;
  h.put(
    'vacuum.rober2',
    'docked',
    { friendly_name: 'Rober2', battery_level: 100, fan_speed: 'Standard', status: 'Charging', supported_features: 12316 },
    { ago: 310 }
  );
  h.put('sensor.rober2_battery', 100, { friendly_name: 'Rober2 battery', unit_of_measurement: '%', device_class: 'battery' }, { ago: 310 });
  h.put('sensor.rober2_cleaning_progress', 0, { friendly_name: 'Rober2 cleaning progress', unit_of_measurement: '%' }, { ago: 310 });
  h.put('input_text.rober2_current_room', '', { friendly_name: 'Rober2 current room' }, { ago: 310 });
  h.put('sensor.rober2_current_room', 'unknown', { friendly_name: 'Rober2 current room sensor' }, { ago: 310 });
  h.put('input_text.rober2_cleaning_narrative', '', { friendly_name: 'Rober2 narrative' }, { ago: 310 });
  h.put('input_text.rober2_pause_reason', '', { friendly_name: 'Rober2 pause reason' }, { ago: 310 });
  h.put('input_boolean.rober2_enabled', 'on', { friendly_name: 'Rober2 enabled' }, { ago: 5000 });
  h.put('input_boolean.rober2_automation_paused', 'off', { friendly_name: 'Rober2 automation paused' }, { ago: 5000 });
  h.put('input_boolean.clean_while_home', 'on', { friendly_name: 'Clean while home' }, { ago: 5000 });
  h.put(
    'image.rober2_rooftop',
    'unknown',
    { friendly_name: 'Rober2 map', entity_picture: '/api/image_proxy/image.rober2_rooftop?token=harness' },
    { ago: 310 }
  );
  QUEUE.forEach((key, index) => {
    h.put(
      `input_boolean.rober2_clean_${key}`,
      key === 'dining_room' ? 'on' : 'off',
      { friendly_name: `Rober2 clean ${key}` },
      { ago: 300 + index }
    );
    const date = new Date(now - (index % 6) * 24 * HOUR - 8 * HOUR).toISOString().slice(0, 10);
    h.put(`input_text.${key}_last_clean`, date, { friendly_name: `${key} last clean` }, { ago: 400 });
  });
  const history = Array.from({ length: 40 }, (_, step) => ({
    t: now - (40 - step) * 18 * MINUTE,
    state: String(Math.min(100, 61 + step)),
  }));
  h.history['sensor.rober2_battery'] = history;
  h.history['vacuum.rober2'] = history.map(point => ({
    t: point.t,
    state: 'docked',
    attributes: {
      friendly_name: 'Rober2',
      battery_level: Number(point.state),
      fan_speed: 'Standard',
      status: 'Charging',
      supported_features: 12316,
    },
  }));
  h.rest.push({
    match: /\/api\/(image_proxy|camera_proxy)\//,
    respond: () => ({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#18181b"/><path d="M60 60H340V340H60Z" fill="#27272a" stroke="#52525b" stroke-width="6"/></svg>',
    }),
  });
}
