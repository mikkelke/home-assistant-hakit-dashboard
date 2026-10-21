import type { HouseBuilder } from './builder';

const BATTERIES: Array<[string, string, number]> = [
  ['hallway_motion', 'Hallway motion sensor', 9],
  ['living_room_window', 'Living room window contact', 88],
  ['bedroom_window', 'Bedroom window contact', 76],
  ['kitchen_window', 'Kitchen window contact', 100],
  ['dining_room_window_1', 'Dining room window 1 contact', 64],
  ['dining_room_window_2', 'Dining room window 2 contact', 0],
  ['bathroom_humidity', 'Bathroom humidity and temperature sensor with the extra long name from the first install', 41],
  ['guest_bathroom_flood', 'Guest bathroom flood sensor', 93],
  ['front_door_lock', 'Front door lock', 52],
  ['weather_station_wind', 'Weather station wind sensor', 71],
  ['thermostat_kristines_room', 'Kristines room thermostat', 33],
  ['thermostat_claudias_room', 'Claudias room thermostat', 27],
  ['remote_living_room', 'Living room remote', 18],
  ['doorbell_button', 'Doorbell button', 85],
];

export function addBatteries(h: HouseBuilder): void {
  for (const [key, name, level] of BATTERIES) {
    h.put(`sensor.${key}_battery`, level, {
      friendly_name: `${name} battery`,
      unit_of_measurement: '%',
      device_class: 'battery',
      state_class: 'measurement',
    });
  }
}
