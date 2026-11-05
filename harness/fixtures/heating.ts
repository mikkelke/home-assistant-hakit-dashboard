import type { HouseBuilder } from './builder';
import { HOUR, MINUTE, iso } from './time';

interface Zone {
  id: string;
  /** The room the thermostat and the heating_active sensor are named after. */
  room: string;
  target: number;
  air: number;
  thermostat: number;
  floor: number;
  /** The floor limit the controller publishes; the bathrooms have none. */
  floorMax?: number;
  mode: string;
  nudge?: number;
  live: boolean;
  heating: boolean;
  next?: [number, string];
  /** Today's calls as hours since local midnight; an end of null is a call still on. */
  calls: readonly (readonly [number, number | null])[];
  budget?: number;
  dull?: number;
  /** Hours called yesterday. */
  yesterday: number;
}

const ZONES: readonly Zone[] = [
  {
    id: 'family',
    room: 'family_room',
    target: 22.5,
    air: 22.1,
    thermostat: 22.1,
    floor: 24.3,
    floorMax: 24.5,
    mode: 'hold',
    live: true,
    heating: true,
    next: [21, '22:30'],
    calls: [
      [5.2, 6.7],
      [7.4, 8.4],
      [16.6, 17.4],
      [18.2, null],
    ],
    budget: 5.2,
    dull: 7.4,
    yesterday: 4.1,
  },
  {
    id: 'kristines_room',
    room: 'kristines_room',
    target: 21.5,
    air: 21.9,
    thermostat: 21.7,
    floor: 22.5,
    floorMax: 24.5,
    mode: 'hold',
    nudge: 0.5,
    live: true,
    heating: false,
    next: [19, '23:00'],
    calls: [
      [5.8, 6.1],
      [17.2, 17.5],
    ],
    budget: 1.6,
    dull: 1.6,
    yesterday: 0.9,
  },
  {
    id: 'claudias_room',
    room: 'claudias_room',
    target: 20.5,
    air: 21.2,
    thermostat: 20.9,
    floor: 21.9,
    floorMax: 24.5,
    mode: 'window',
    live: false,
    heating: false,
    calls: [[6, 6.5]],
    budget: 3.2,
    dull: 6.9,
    yesterday: 1.2,
  },
  {
    id: 'bathroom',
    room: 'bathroom',
    target: 23,
    air: 23.1,
    thermostat: 23.0,
    floor: 25.4,
    mode: 'sun_cut',
    live: true,
    heating: false,
    next: [24, '06:00'],
    calls: [
      [2.5, 3.2],
      [6.2, 7],
    ],
    budget: 2.4,
    dull: 5.6,
    yesterday: 1.8,
  },
  {
    id: 'guest_bathroom',
    room: 'guest_bathroom',
    target: 22,
    air: 22.4,
    thermostat: 22.2,
    floor: 24,
    mode: 'hold',
    live: false,
    heating: false,
    calls: [],
    yesterday: 0.2,
  },
];

/** Midnight of the fixture's day in Copenhagen, which is UTC+2 on the fixture date. */
const localMidnight = (now: number) => Math.floor((now + 2 * HOUR) / (24 * HOUR)) * 24 * HOUR - 2 * HOUR;

/** The hours a zone has called by `nowHour`, counting an open call up to it. */
const calledHours = (zone: Zone, nowHour: number) => zone.calls.reduce((sum, [from, to]) => sum + (to ?? nowHour) - from, 0);

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

  const probes: [string, string, number][] = [
    ['primary_supply', 'Primary supply', 48.6],
    ['primary_return', 'Primary return', 33.9],
    ['zone_1_return', 'Zone 1 return', 32.4],
    ['zone_2_return', 'Zone 2 return', 31.1],
    ['zone_3_return', 'Zone 3 return', 30.2],
    ['zone_4_return', 'Zone 4 return', 34.7],
    ['zone_5_return', 'Zone 5 return', 22.1],
    ['zone_6_return', 'Zone 6 return', 33.0],
    ['zone_7_return', 'Zone 7 return', 36.8],
  ];
  for (const [id, name, tempC] of probes) {
    h.put(`sensor.heating_room_${id}`, tempC, { friendly_name: name, unit_of_measurement: '°C', device_class: 'temperature' }, { ago: 2 });
  }

  h.put(
    'sensor.floor_heating_relay_power',
    16.3,
    { friendly_name: 'Floor heating relay Power', unit_of_measurement: 'W', device_class: 'power' },
    { ago: 1 }
  );
  h.put(
    'sensor.ista_heat_price',
    1.031,
    { friendly_name: 'ista Heat price', unit_of_measurement: 'DKK/kWh', source: 'estimate' },
    { ago: 900 }
  );

  const midnight = localMidnight(now);
  const nowHour = (now - midnight) / HOUR;

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
        floor_max_c: zone.floorMax ?? null,
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
        yesterday: { call_hours: zone.yesterday, h_pred: zone.budget ?? null, in_band_pct: 91 },
        call_hours_today: calledHours(zone, nowHour).toFixed(1),
        budget_today_h: zone.budget?.toFixed(1) ?? null,
        budget_dull_h: zone.dull?.toFixed(1) ?? null,
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
    h.put(
      `binary_sensor.${zone.room}_heating_active`,
      zone.heating ? 'on' : 'off',
      { friendly_name: `${zone.id} heating active`, device_class: 'heat' },
      { ago: 22 }
    );
    h.history[`binary_sensor.${zone.room}_heating_active`] = [
      { t: midnight - HOUR, state: 'off' },
      ...zone.calls.flatMap(([from, to]) => [
        { t: midnight + from * HOUR, state: 'on' },
        ...(to === null ? [] : [{ t: midnight + to * HOUR, state: 'off' }]),
      ]),
    ];
    h.put(`climate.${zone.room}_thermostat`, 'heat', {
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
