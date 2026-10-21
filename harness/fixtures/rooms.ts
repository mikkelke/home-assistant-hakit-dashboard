import type { HouseBuilder } from './builder';
import { DAY, HOUR, MINUTE, dailyWave } from './time';

export interface Room {
  /** HA area id. */
  id: string;
  name: string;
  icon: string;
  /** The display key entity ids are built from. */
  key: string;
  tempC: number;
  rh: number;
  /** Floor temperature, for the rooms with underfloor heating. */
  floorC?: number;
  occupied?: boolean;
  /** Heating zone thermostat, when the room has its own. */
  thermostat?: string;
  blind?: boolean;
}

export const ROOMS: readonly Room[] = [
  {
    id: 'bathroom',
    name: 'Bathroom',
    icon: 'mdi:shower',
    key: 'bathroom',
    tempC: 23.1,
    rh: 58,
    floorC: 25.4,
    thermostat: 'bathroom',
    blind: true,
  },
  { id: 'bedroom', name: 'Bedroom', icon: 'mdi:bed', key: 'bedroom', tempC: 19.6, rh: 50, thermostat: 'bedroom', blind: true },
  {
    id: 'dining_room',
    name: 'Dining Room',
    icon: 'mdi:silverware-fork-knife',
    key: 'dining_room',
    tempC: 21.4,
    rh: 47,
    floorC: 22.1,
    blind: true,
  },
  {
    id: 'living_room',
    name: 'Living Room',
    icon: 'mdi:sofa',
    key: 'living_room',
    tempC: 22.1,
    rh: 45,
    floorC: 22.8,
    occupied: true,
    blind: true,
  },
  { id: 'kitchen', name: 'Kitchen', icon: 'mdi:countertop', key: 'kitchen', tempC: 22.6, rh: 49, floorC: 23.0, occupied: true },
  { id: 'hallway', name: 'Hallway', icon: 'mdi:door', key: 'hallway', tempC: 20.9, rh: 44, floorC: 21.6 },
  {
    id: 'office',
    name: 'Claudias Room',
    icon: 'mdi:desk',
    key: 'claudias_room',
    tempC: 21.2,
    rh: 46,
    floorC: 21.9,
    thermostat: 'claudias_room',
  },
  {
    id: 'kristines_room',
    name: 'Kristines Room',
    icon: 'mdi:flower',
    key: 'kristines_room',
    tempC: 21.9,
    rh: 48,
    floorC: 22.5,
    thermostat: 'kristines_room',
  },
  {
    id: 'guest_bathroom',
    name: 'Guest Bathroom',
    icon: 'mdi:toilet',
    key: 'guest_bathroom',
    tempC: 22.4,
    rh: 57,
    floorC: 24.0,
    thermostat: 'guest_bathroom',
  },
  { id: 'rooftop', name: 'Rooftop', icon: 'mdi:terrace', key: 'rooftop', tempC: 11.4, rh: 82 },
];

const COMFORT = (tempC: number) => (tempC >= 24 ? 'warm' : tempC >= 20.5 ? 'comfortable' : tempC >= 18.5 ? 'cool' : 'cold');

export function addRooms(h: HouseBuilder): void {
  for (const room of ROOMS) {
    h.area(room.id, room.name, room.icon);
    if (room.id === 'rooftop') continue;

    const word = COMFORT(room.tempC);
    h.put(`sensor.${room.key}_temperature`, room.tempC, {
      friendly_name: `${room.name} temperature`,
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement',
    });
    const wave = dailyWave(room.tempC, 0.7, room.key.length * 13);
    h.history[`sensor.${room.key}_temperature`] = Array.from({ length: 24 * 6 + 1 }, (_, step) => {
      const t = h.now - 24 * HOUR + step * 10 * MINUTE;
      return { t, state: String(step === 24 * 6 ? room.tempC : wave(t)) };
    });
    h.statistics[`sensor.${room.key}_temperature`] = (start, end) => {
      if (end > h.now || start < h.now - 8 * DAY) return null;
      const mean = wave(start + 30 * MINUTE);
      return { mean, min: mean - 0.2, max: mean + 0.2 };
    };
    h.put(`sensor.${room.key}_humidity`, room.rh, {
      friendly_name: `${room.name} humidity`,
      unit_of_measurement: '%',
      device_class: 'humidity',
      state_class: 'measurement',
    });
    h.put(`sensor.${room.key}_feel`, room.tempC, {
      friendly_name: `${room.name} feel`,
      unit_of_measurement: '°C',
      device_class: 'temperature',
      rh: room.rh,
      dew_point_c: Math.round((room.tempC - (100 - room.rh) / 5) * 10) / 10,
      ...(room.floorC ? { floor_temp_c: room.floorC, floor_spread_c: 0.4 } : {}),
      air_band: 'unknown',
      window_open: false,
      open_labels: ['<none>'],
      mould_risk: room.rh > 56 ? 'watch' : 'low',
      airing_helps: false,
      sun_hit: false,
      stale: false,
      sources: [`sensor.${room.key}_temperature`, `sensor.${room.key}_humidity`],
      headline: `${room.tempC.toFixed(1)} °C · ${word}`,
      detail: `${room.name} reads ${room.tempC.toFixed(1)} °C at ${room.rh} % humidity.`,
      history_entity: `sensor.${room.key}_temperature`,
      history_attribute: null,
    });
    h.put(
      `binary_sensor.${room.key}_active`,
      room.occupied ? 'on' : 'off',
      {
        friendly_name: `${room.name} active`,
        device_class: 'occupancy',
        reason: room.occupied ? `room:binary_sensor.${room.key}_presence_occupancy` : 'all_clear',
      },
      { ago: room.occupied ? 14 : 95 }
    );
    h.put(`binary_sensor.${room.key}_presence_occupancy`, room.occupied ? 'on' : 'off', {
      friendly_name: `${room.name} presence Occupancy`,
      device_class: 'occupancy',
    });
    if (room.thermostat) {
      const idle = room.tempC >= 22;
      h.put(`climate.${room.thermostat}_thermostat`, 'heat', {
        friendly_name: `${room.name} thermostat`,
        hvac_modes: ['off', 'heat'],
        hvac_action: idle ? 'idle' : 'heating',
        current_temperature: room.tempC,
        temperature: room.thermostat === 'bedroom' ? 17 : 21.5,
        min_temp: 5,
        max_temp: 30,
        target_temp_step: 0.5,
        supported_features: 1,
      });
    }
    if (room.blind) {
      h.put(`cover.${room.key}_blind`, room.key === 'living_room' ? 'closed' : 'open', {
        friendly_name: `${room.name} blind`,
        device_class: 'blind',
        current_position: room.key === 'living_room' ? 100 : 0,
        supported_features: 15,
      });
    }
  }

  h.put('climate.family_room_thermostat', 'heat', {
    friendly_name: 'Family room thermostat',
    hvac_modes: ['off', 'heat'],
    hvac_action: 'heating',
    current_temperature: 22.1,
    temperature: 22.5,
    min_temp: 5,
    max_temp: 30,
    target_temp_step: 0.5,
    supported_features: 1,
  });
}
