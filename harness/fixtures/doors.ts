import { readFileSync } from 'node:fs';
import type { HouseBuilder } from './builder';
import { DAY, MINUTE, iso, rng } from './time';

const SVG = (label: string, tone: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${tone}"/><rect x="190" y="70" width="260" height="340" fill="none" stroke="#a1a1aa" stroke-width="6"/><text x="320" y="450" fill="#d4d4d8" font-family="sans-serif" font-size="28" text-anchor="middle">${label}</text></svg>`;

const pad = (n: number) => String(n).padStart(2, '0');

function ringStamp(ms: number): string {
  const d = new Date(ms + 2 * 3_600_000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function doorbellIndex(now: number) {
  const noise = rng(11);
  const types = ['ring_auto_opened', 'ring_missed', 'ring_answered', 'ring_auto_opened', 'ring_auto_opened', 'ring'];
  const images = Array.from({ length: 18 }, (_, index) => {
    const at = now - (index * 0.45 + noise() * 0.3 + 0.05) * DAY;
    const ts = ringStamp(at);
    const clipOnly = index === 4 || index === 11;
    return {
      ts,
      datetime: iso(at),
      station: index % 5 === 3 ? 'outdoor_station_2_2' : 'outdoor_station_2_1',
      door: index % 5 === 3 ? 'back door' : 'front door',
      event_type: types[index % types.length],
      filename: clipOnly ? '' : `ring_${ts}.jpg`,
      url: clipOnly ? '' : `/media/local/doorbell/ring_${ts}.jpg`,
      clip_filename: index % 3 === 0 ? `ring_${ts}.mp4` : '',
      clip_url: index % 3 === 0 ? `/media/local/doorbell/ring_${ts}.mp4` : '',
    };
  });
  return { images };
}

function maps(now: number) {
  const index = JSON.parse(
    readFileSync(new URL('../../src/components/Vacuum/__tests__/fixtures/rober2-maps.json', import.meta.url), 'utf8')
  ) as {
    maps: Array<{ datetime?: string }>;
  };
  const newest = Math.max(...index.maps.map(entry => Date.parse(entry.datetime ?? '') || 0));
  const shift = Math.round((now - newest) / DAY - 1) * DAY;
  return {
    maps: index.maps.map(entry => ({
      ...entry,
      datetime: entry.datetime ? new Date(Date.parse(entry.datetime) + shift).toISOString().slice(0, 26) : undefined,
    })),
  };
}

export function addDoors(h: HouseBuilder): void {
  const { now } = h;

  h.put('binary_sensor.apartment_door_open', 'off', { friendly_name: 'Apartment door open', device_class: 'door' }, { ago: 38 });
  h.put('binary_sensor.yale_door', 'off', { friendly_name: 'Yale door', device_class: 'door' }, { ago: 38 });
  h.put('lock.yale_bt', 'locked', { friendly_name: 'Apartment lock', supported_features: 0 }, { ago: 37 });
  h.put('lock.yale', 'locked', { friendly_name: 'Apartment lock cloud' }, { ago: 37 });
  h.put('sensor.yale_operator', 'Auto-lock', { friendly_name: 'Yale operator' }, { ago: 37 });
  h.put(
    'binary_sensor.apartment_entry_secure',
    'on',
    { friendly_name: 'Apartment entry secure', device_class: 'lock', lock_state: 'locked', door_state: 'closed', cloud_agrees: true },
    { ago: 37 }
  );
  h.put('lock.intercomproxy_front_door', 'locked', { friendly_name: 'Building front door' }, { ago: 300 });
  h.put('lock.intercomproxy_back_door', 'locked', { friendly_name: 'Building back door' }, { ago: 300 });
  h.put('button.abb_welcome_gateway_outdoor_station_2_1', 'unknown', { friendly_name: 'Open front door' });
  h.put('input_boolean.auto_open_intercom', 'on', { friendly_name: 'Auto open intercom' }, { ago: 1500 });
  h.put('binary_sensor.intercomproxy_doorbell_front_door', 'off', { friendly_name: 'Front door doorbell' }, { ago: 410 });
  h.put('binary_sensor.intercomproxy_doorbell_back_door', 'off', { friendly_name: 'Back door doorbell' }, { ago: 3000 });

  const contacts: Array<[string, string, boolean]> = [
    ['rooftop_door_1_contact', 'Rooftop door 1', false],
    ['rooftop_door_2_contact', 'Rooftop door 2', false],
    ['dining_room_window_1_contact', 'Dining room window 1', false],
    ['dining_room_window_2_contact', 'Dining room window 2', false],
    ['dining_room_window_3_contact', 'Dining room window 3', false],
    ['bathroom_window_contact', 'Bathroom window', false],
    ['bedroom_window_contact', 'Bedroom window', true],
    ['kitchen_window_contact', 'Kitchen window', false],
    ['living_room_window_contact', 'Living room window', false],
    ['kristines_room_window_contact', 'Kristines room window', false],
  ];
  for (const [id, name, open] of contacts) {
    h.put(
      `binary_sensor.${id}`,
      open ? 'on' : 'off',
      { friendly_name: name, device_class: id.includes('door') ? 'door' : 'window' },
      { ago: open ? 75 : 600 }
    );
  }

  h.put(
    'sensor.fire_safety',
    'clear',
    {
      friendly_name: 'Fire safety',
      headline: 'All clear',
      detail: 'Kitchen alarm normal',
      since: iso(now - 40 * DAY),
      hushed_until: null,
      hush_count: 0,
      last_smoke: 'off',
      battery: 96,
      battery_low: 'false',
      last_test: iso(now - 11 * DAY),
      test_overdue: 'false',
      device_available: 'true',
      cooking_until: null,
      iaq: 1,
      iaq_band: 'fresh',
      eco2: 520,
      eco2_band: 'fresh',
      computed_at: iso(now - MINUTE),
      dry_run: 'false',
    },
    { ago: 4000 }
  );
  const smoke: Array<[string, string, number, Record<string, unknown>]> = [
    ['temperature', 'Temperature', 24.3, { unit_of_measurement: '°C', device_class: 'temperature' }],
    ['humidity', 'Humidity', 44.6, { unit_of_measurement: '%', device_class: 'humidity' }],
    ['eco2', 'eCO2', 520, { unit_of_measurement: 'ppm' }],
    ['aqi', 'AQI', 1, {}],
    ['illuminance', 'Illuminance', 62, { unit_of_measurement: 'lx', device_class: 'illuminance' }],
    ['battery', 'Battery', 96, { unit_of_measurement: '%', device_class: 'battery' }],
    ['linkquality', 'Link quality', 148, { unit_of_measurement: 'lqi' }],
  ];
  for (const [id, name, value, attributes] of smoke)
    h.put(`sensor.kitchen_smoke_alarm_${id}`, value, { friendly_name: `Kitchen smoke alarm ${name}`, ...attributes });
  h.put('sensor.kitchen_smoke_alarm_last_seen', iso(now - 2 * MINUTE), {
    friendly_name: 'Kitchen smoke alarm last seen',
    device_class: 'timestamp',
  });
  h.put('sensor.kitchen_smoke_alarm_siren_state', 'clear', { friendly_name: 'Kitchen smoke alarm siren state' });
  h.put('switch.kitchen_smoke_alarm_self_test', 'off', { friendly_name: 'Kitchen smoke alarm self test' });
  h.put('switch.kitchen_smoke_alarm_heartbeat', 'on', { friendly_name: 'Kitchen smoke alarm heartbeat' });
  h.put('switch.kitchen_smoke_alarm_pre_alarm', 'on', { friendly_name: 'Kitchen smoke alarm pre alarm' });
  h.put('select.kitchen_smoke_alarm_sensitivity', 'medium', {
    friendly_name: 'Kitchen smoke alarm sensitivity',
    options: ['low', 'medium', 'high'],
  });
  h.put('input_button.fire_safety_hush', 'unknown', { friendly_name: 'Fire safety hush' });
  h.put('input_button.fire_safety_clear', 'unknown', { friendly_name: 'Fire safety clear' });
  h.put('input_boolean.kitchen_cooking_mode', 'off', { friendly_name: 'Kitchen cooking mode' });

  h.ws['auth/sign_path'] = message => ({ path: `${String(message.path)}?authSig=harness` });
  h.services['shell_command.doorbell_archive_index'] = () => ({ stdout: JSON.stringify(doorbellIndex(now)), stderr: '', returncode: 0 });
  h.services['shell_command.rober2_maps_index'] = () => ({ stdout: JSON.stringify(maps(now)), stderr: '', returncode: 0 });
  const archive = doorbellIndex(now).images;
  h.rest.push({
    match: /\/media\/local\/doorbell\//,
    respond: path => ({
      contentType: 'image/svg+xml',
      body: SVG(archive.find(image => path.includes(image.ts))?.door ?? 'front door', '#27272a'),
    }),
  });
  h.rest.push({
    match: /\/media\/local\/rober2_maps\//,
    respond: () => ({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#18181b"/><path d="M60 60H340V340H60Z" fill="#27272a" stroke="#52525b" stroke-width="6"/><path d="M90 120C160 90 220 160 300 130S300 260 200 250 110 300 100 240" fill="none" stroke="#38bdf8" stroke-width="4"/></svg>',
    }),
  });
}
