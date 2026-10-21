import type { HouseBuilder } from './builder';
import { MINUTE, iso } from './time';

interface Zone {
  id: string;
  target: number;
  air: number;
  thermostat: number;
  floor: number;
  mode: string;
  nudge?: number;
  live: boolean;
  heating: boolean;
  next?: [number, string];
}

const ZONES: readonly Zone[] = [
  { id: 'family', target: 22.5, air: 22.1, thermostat: 22.1, floor: 23.4, mode: 'hold', live: true, heating: true, next: [21, '22:30'] },
  {
    id: 'kristines_room',
    target: 21.5,
    air: 21.9,
    thermostat: 21.7,
    floor: 22.5,
    mode: 'hold',
    nudge: 0.5,
    live: true,
    heating: false,
    next: [19, '23:00'],
  },
  { id: 'claudias_room', target: 20.5, air: 21.2, thermostat: 20.9, floor: 21.9, mode: 'window', live: false, heating: false },
  {
    id: 'bathroom',
    target: 23,
    air: 23.1,
    thermostat: 23.0,
    floor: 25.4,
    mode: 'sun_cut',
    live: true,
    heating: false,
    next: [24, '06:00'],
  },
  { id: 'guest_bathroom', target: 22, air: 22.4, thermostat: 22.2, floor: 24, mode: 'hold', live: false, heating: false },
];

export function addHeating(h: HouseBuilder): void {
  const { now } = h;
  h.put('input_boolean.heating_season', 'on', { friendly_name: 'Heating season' }, { ago: 6000 });
  h.put(
    'sensor.heating_controller',
    'live',
    {
      friendly_name: 'Heating controller',
      would_writes_today: 7,
      alerts_active: ['<none>'],
      season_advice: 'none',
      season_advice_reason: 'heat_wanted',
      season_forecast_mean: 10.6,
      season_morning_means: {
        family: [22.4, 22.1, 22.6],
        kristines_room: [21.6, 21.2, 21.9],
        claudias_room: [20.4, 20.9, 20.1],
        bathroom: [23.1, 22.8, 23.3],
        guest_bathroom: [22.0, 21.7, 22.2],
      },
    },
    { ago: 5 }
  );
  h.put(
    'sensor.heating_room_floor_heating_supply',
    41.3,
    { friendly_name: 'Floor heating supply', unit_of_measurement: '°C', device_class: 'temperature' },
    { ago: 2 }
  );
  h.put(
    'sensor.heating_room_floor_heating_return',
    33.8,
    { friendly_name: 'Floor heating return', unit_of_measurement: '°C', device_class: 'temperature' },
    { ago: 2 }
  );

  for (const zone of ZONES) {
    const nudged = zone.nudge ?? 0;
    h.put(
      `sensor.heating_zone_${zone.id}`,
      zone.target.toFixed(1),
      {
        friendly_name: `Heating zone ${zone.id}`,
        live: zone.live ? 'true' : 'false',
        plan_mode: zone.mode,
        base_target: String(zone.target - nudged),
        control_air: zone.air,
        thermostat_temp: zone.thermostat,
        setpoint_now: zone.heating ? zone.target + 0.5 : zone.target - 1,
        floor_temp: zone.floor,
        lower_limit: 19,
        upper_limit: 24,
        nudge: nudged === 0 ? '0' : `+${nudged}`,
        nudge_min: '-1.0',
        nudge_max: '1.0',
        ...(zone.next ? { next_setpoint: zone.next[0], next_change_at: zone.next[1] } : {}),
        day_blocks: [
          { start: '00:00', end: '06:00', mode: 'hold', setpoint: zone.target - 1.5 },
          { start: '06:00', end: '08:30', mode: 'hold', setpoint: zone.target },
          { start: '08:30', end: '16:00', mode: 'sun_cut', setpoint: zone.target - 1 },
          { start: '16:00', end: '22:30', mode: 'hold', setpoint: zone.target },
          { start: '22:30', end: '24:00', mode: 'guard', setpoint: zone.target - 1.5 },
        ],
        reasons: zone.mode === 'window' ? ['Window open since 17:25, holding the setpoint down'] : ['Holding the plan'],
        stale_inputs: zone.live ? ['<none>'] : ['room air sensor'],
        last_signal: zone.nudge
          ? { who: 'Kristine', source: 'dashboard', direction: 'warmer', effect: 'nudge_up', at: iso(now - 130 * MINUTE) }
          : '<none>',
        yesterday: { call_hours: 4.2, h_pred: 4.6, in_band_pct: 91 },
        call_hours_today: 3.1,
        budget_today_h: 4.4,
        sun_credit_h: zone.id === 'bathroom' ? 0.8 : 0,
      },
      { ago: 5 }
    );
    h.put(`input_number.heating_target_${zone.id}`, (zone.target - nudged).toFixed(1), {
      friendly_name: `Heating target ${zone.id}`,
      min: 19,
      max: 24,
      step: 0.5,
      mode: 'box',
    });
    h.put(`input_button.heating_${zone.id}_warmer`, 'unknown', { friendly_name: `${zone.id} warmer` });
    h.put(`input_button.heating_${zone.id}_colder`, 'unknown', { friendly_name: `${zone.id} colder` });
    const thermostat = zone.id === 'family' ? 'climate.family_room_thermostat' : `climate.${zone.id}_thermostat`;
    h.put(thermostat, 'heat', {
      friendly_name: `${zone.id} thermostat`,
      hvac_modes: ['off', 'heat'],
      hvac_action: zone.heating ? 'heating' : 'idle',
      current_temperature: zone.thermostat,
      temperature: zone.target,
      min_temp: 5,
      max_temp: 30,
      target_temp_step: 0.5,
      supported_features: 1,
    });
  }
  h.put('climate.bedroom_thermostat', 'off', {
    friendly_name: 'Bedroom thermostat',
    hvac_modes: ['off', 'heat'],
    hvac_action: 'off',
    current_temperature: 19.6,
    temperature: 17,
    min_temp: 5,
    max_temp: 30,
    supported_features: 1,
  });
}
