import type { HouseBuilder } from './builder';
import { HOME_CALENDAR } from '../../src/energy/period';
import { homeDayKey, homeWallTime, homeWallTimeToMs } from '../../src/energy/homeTime';
import { DAY, HOUR, rng } from './time';
import type { StatRow, StatSource } from './types';

const GRID = 'sensor.electricity_meter_energy';
const GRID_COST = 'sensor.electricity_meter_energy_cost';
const GRID_POWER = 'sensor.electricity_meter_power';
const PRICE = 'sensor.energi_data_service';

/** The grid statistics start with December 2025, like the bill history. */
const GRID_FROM = homeWallTimeToMs(2025, 12, 1);
const UTILITIES_FROM = homeWallTimeToMs(2024, 11, 1);

/** All-in price in kr/kWh for the hour starting at `ms`: a night trough, a morning shoulder and an evening peak, a different
 * level every day, and a free hour at midday on one day in eleven. */
export function priceAt(ms: number): number {
  const { hour } = homeWallTime(ms);
  const dayKey = homeDayKey(ms);
  const dayIndex = Math.floor(homeWallTimeToMs(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7)), Number(dayKey.slice(8, 10))) / DAY);
  const shape = [
    0.85, 0.82, 0.8, 0.8, 0.84, 0.95, 1.2, 1.55, 1.7, 1.45, 1.3, 1.25, 1.2, 1.2, 1.3, 1.5, 1.95, 2.55, 2.75, 2.5, 2.2, 1.7, 1.3, 1.05,
  ];
  const level = 0.72 + rng(dayIndex * 7919)() * 0.7;
  const free = dayIndex % 11 === 3 && hour >= 12 && hour <= 14;
  return free ? Math.round((-0.08 + hour * 0.0) * 1000) / 1000 : Math.round(shape[hour] * level * 1000) / 1000;
}

interface Device {
  /** Energy statistic id. */
  id: string;
  name: string;
  /** Live power entity. */
  power?: string;
  /** The device this one is counted inside. */
  parent?: string;
  area?: string;
  /** kWh in the hour starting at `ms`. */
  use: (ms: number, hour: number, weekday: number, noise: number) => number;
}

const evening = (hour: number, from: number, to: number, kwh: number) => (hour >= from && hour <= to ? kwh : 0);

const DEVICES: readonly Device[] = [
  { id: 'sensor.kitchen_circuit_energy', name: 'Kitchen circuit', area: 'kitchen', use: () => 0 },
  {
    id: 'sensor.oven_plug_switch_0_energy',
    name: 'Oven',
    power: 'sensor.oven_plug_switch_0_power',
    parent: 'sensor.kitchen_circuit_energy',
    area: 'kitchen',
    use: (_ms, hour, weekday, noise) =>
      weekday >= 5 ? evening(hour, 17, 18, 0.9) * noise : evening(hour, 18, 18, 0.5) * (noise > 0.6 ? 1 : 0),
  },
  {
    id: 'sensor.hotplate_power_monitor_total_active_energy',
    name: 'Hotplate',
    power: 'sensor.hotplate_power_monitor_total_active_power',
    parent: 'sensor.kitchen_circuit_energy',
    area: 'kitchen',
    use: (_ms, hour, _weekday, noise) => evening(hour, 7, 7, 0.12) * noise + evening(hour, 18, 19, 0.7) * noise,
  },
  {
    id: 'sensor.microwave_plug_energy',
    name: 'Microwave',
    power: 'sensor.microwave_plug_power',
    parent: 'sensor.kitchen_circuit_energy',
    area: 'kitchen',
    use: (_ms, hour, _weekday, noise) => (hour === 8 || hour === 13 || hour === 19 ? 0.05 * noise : 0),
  },
  {
    id: 'sensor.fridge_plug_energy',
    name: 'Fridge',
    power: 'sensor.kitchen_plug_power',
    area: 'kitchen',
    use: (_ms, _h, _w, noise) => 0.062 + noise * 0.02,
  },
  { id: 'sensor.wine_fridge_energy', name: 'Wine fridge', area: 'kitchen', use: (_ms, _h, _w, noise) => 0.041 + noise * 0.012 },
  {
    id: 'sensor.athom_smart_plug_v3_50ec44_energy',
    name: 'Dishwasher',
    power: 'sensor.athom_smart_plug_v3_50ec44_power',
    area: 'kitchen',
    use: (_ms, hour, _w, noise) => (hour === 20 || hour === 21 ? 0.34 * noise : hour === 22 ? 0.2 * noise : 0),
  },
  {
    id: 'sensor.kitchen_counter_socket_strip_with_kettle_toaster_and_blender_energy',
    name: 'Kitchen counter socket strip with the kettle, the toaster, the blender and the air fryer we borrowed',
    area: 'kitchen',
    use: (_ms, hour, _w, noise) => (hour === 7 || hour === 18 ? 0.18 * noise : 0.004),
  },
  {
    id: 'sensor.washer_plug_energy',
    name: 'Washer',
    power: 'sensor.washer_plug_power',
    area: 'guest_bathroom',
    use: (ms, hour, _w, noise) => (Math.floor(ms / DAY) % 2 === 0 && hour >= 15 && hour <= 17 ? 0.34 * noise : 0.0005),
  },
  {
    id: 'sensor.dryer_plug_energy',
    name: 'Dryer',
    power: 'sensor.dryer_plug_power',
    area: 'guest_bathroom',
    use: (ms, hour, _w, noise) => (Math.floor(ms / DAY) % 2 === 0 && hour >= 18 && hour <= 19 ? 0.9 * noise : 0),
  },
  {
    id: 'sensor.living_room_tv_relay_energy',
    name: 'Living room TV',
    power: 'sensor.living_room_tv_relay_power',
    area: 'living_room',
    use: (_ms, hour, _w, noise) => evening(hour, 19, 22, 0.19) * noise + 0.002,
  },
  {
    id: 'sensor.bedroom_tv_relay_energy',
    name: 'Bedroom TV',
    area: 'bedroom',
    use: (_ms, hour, _w, noise) => evening(hour, 22, 23, 0.08) * (noise > 0.8 ? 1 : 0) + 0.001,
  },
  {
    id: 'sensor.technical_relay_energy',
    name: 'Technical room',
    power: 'sensor.technical_relay_power',
    area: 'technical_room',
    use: (_ms, _h, _w, noise) => 0.165 + noise * 0.04,
  },
  { id: 'sensor.guest_room_standby_energy', name: 'Guest room standby', area: 'guest_bathroom', use: () => 0 },
];

const noiseAt = (id: string, ms: number) => rng(Math.floor(ms / HOUR) * 31 + id.length * 977)();

function deviceKwh(device: Device, ms: number): number {
  const { hour } = homeWallTime(ms);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  return device.use(ms, hour, weekday, noiseAt(device.id, ms));
}

const UNTRACKED_BASE = 0.09;

function gridKwh(ms: number): number {
  const top = DEVICES.filter(device => !device.parent && device.id !== 'sensor.kitchen_circuit_energy');
  const kitchen = DEVICES.filter(device => device.parent === 'sensor.kitchen_circuit_energy');
  const sum = [...top, ...kitchen].reduce((total, device) => total + deviceKwh(device, ms), 0);
  const { hour } = homeWallTime(ms);
  return sum + UNTRACKED_BASE + noiseAt('grid', ms) * 0.06 + (hour >= 17 && hour <= 22 ? 0.12 : 0);
}

/** Integrates an hourly kWh function over [startMs, endMs), counting only whole hours that have ended. */
function integrate(fn: (hourMs: number) => number, startMs: number, endMs: number, nowMs: number): number {
  let total = 0;
  const to = Math.min(endMs, nowMs);
  for (let at = Math.floor(startMs / HOUR) * HOUR; at < to; at += HOUR) {
    const overlap = Math.min(at + HOUR, to) - Math.max(at, startMs);
    if (overlap > 0) total += fn(at) * (overlap / HOUR);
  }
  return total;
}

function cumulative(fn: (hourMs: number) => number, from: number, nowMs: number) {
  const cache = new Map<number, number>();
  const end = Math.floor(nowMs / HOUR) * HOUR;
  let running = 0;
  for (let at = Math.floor(from / HOUR) * HOUR; at <= end; at += HOUR) {
    cache.set(at, running);
    running += fn(at);
  }
  return (ms: number) => cache.get(Math.min(Math.floor(ms / HOUR) * HOUR, end)) ?? running;
}

function rows(from: number, nowMs: number, fn: (hourMs: number) => number, scale = 1, offset = 0): StatSource {
  const meter = cumulative(fn, from, nowMs);
  return (start, end) => {
    if (end <= from) return null;
    const change = integrate(fn, Math.max(start, from), end, nowMs) * scale;
    return { change, state: offset + meter(end) * scale, sum: meter(end) * scale };
  };
}

const price = (ms: number) => priceAt(Math.floor(ms / HOUR) * HOUR);

function daily(from: number, perDay: number, amplitude: number, seed: number, nowMs: number, dataEnd: number): StatSource {
  const noise = rng(seed);
  const values = new Map<number, number>();
  const at = (ms: number) => {
    const key = homeWallTimeToMs(...(homeDayKey(ms).split('-').map(Number) as [number, number, number]));
    if (!values.has(key)) values.set(key, Math.max(0, perDay * (1 + (noise() - 0.5) * amplitude)));
    return values.get(key) ?? 0;
  };
  return (start, end) => {
    if (end <= from || start >= dataEnd) return null;
    let total = 0;
    for (
      let day = HOME_CALENDAR.startOf('day', Math.max(start, from));
      day < Math.min(end, dataEnd, nowMs);
      day = HOME_CALENDAR.step('day', day, 1)
    )
      total += at(day);
    return { change: total, sum: total };
  };
}

function priceRow(): StatSource {
  return start => {
    const value = price(start);
    return { mean: value, min: value, max: value, state: value };
  };
}

export function addEnergy(h: HouseBuilder): void {
  const { now } = h;
  h.area('technical_room', 'Technical Room', 'mdi:server-network');
  const priceNow = price(now);
  const day = HOME_CALENDAR.startOf('day', now);
  const hoursOf = (start: number) =>
    Array.from({ length: 24 }, (_, hour) => ({
      hour: new Date(homeWallTimeToMs(...ymd(start), hour)).toISOString(),
      price: priceAt(homeWallTimeToMs(...ymd(start), hour)),
    }));
  const next = HOME_CALENDAR.step('day', day, 1);

  h.put(
    PRICE,
    priceNow,
    {
      friendly_name: 'Energi Data Service',
      unit_of_measurement: 'kr/kWh',
      current_price: priceNow,
      raw_today: hoursOf(day),
      raw_tomorrow: hoursOf(next),
      tomorrow_valid: true,
      forecast: [],
    },
    { ago: 40 }
  );
  h.put(GRID_POWER, 1960, { friendly_name: 'Electricity meter power', unit_of_measurement: 'W', device_class: 'power' }, { ago: 0 });
  const powers: Record<string, number> = {
    'sensor.oven_plug_switch_0_power': 0,
    'sensor.hotplate_power_monitor_total_active_power': 0,
    'sensor.microwave_plug_power': 0,
    'sensor.kitchen_plug_power': 78,
    'sensor.living_room_tv_relay_power': 94,
    'sensor.technical_relay_power': 187,
  };
  for (const [id, watts] of Object.entries(powers))
    h.put(id, watts, { friendly_name: id.split('.')[1].replace(/_/g, ' '), unit_of_measurement: 'W', device_class: 'power' });

  h.ws['energy/get_prefs'] = () => ({
    energy_sources: [
      {
        type: 'grid',
        flow_from: [
          { stat_energy_from: GRID, stat_cost: null, entity_energy_price: PRICE, number_energy_price: null, stat_rate: GRID_POWER },
        ],
        flow_to: [],
        cost_adjustment_day: 0,
      },
    ],
    device_consumption: DEVICES.map(device => ({
      stat_consumption: device.id,
      name: device.name,
      ...(device.parent ? { included_in_stat: device.parent } : {}),
      ...(device.power ? { stat_rate: device.power } : {}),
    })),
  });
  h.ws['energy/info'] = () => ({ cost_sensors: { [GRID]: GRID_COST }, solar_forecast_domains: [] });

  h.statistics[GRID] = rows(GRID_FROM, now, gridKwh, 1, 1450);
  h.statistics[GRID_COST] = rows(GRID_FROM, now, hourMs => gridKwh(hourMs) * price(hourMs));
  h.statistics[PRICE] = priceRow();
  for (const device of DEVICES) {
    const self =
      device.id === 'sensor.kitchen_circuit_energy'
        ? (hourMs: number) => DEVICES.filter(d => d.parent === device.id).reduce((total, d) => total + deviceKwh(d, hourMs), 0)
        : (hourMs: number) => deviceKwh(device, hourMs);
    h.statistics[device.id] = rows(GRID_FROM, now, self);
    h.entityRegistry.push({ entity_id: device.id, platform: 'template', ...(device.area ? { area_id: device.area } : {}) });
  }

  const dataEnd = homeWallTimeToMs(2026, 10, 18);
  const meters: Array<[string, string, number, number, number, number]> = [
    ['cold_water', 'Cold water', 0.19, 0.5, 21, 14.6],
    ['hot_water', 'Hot water', 0.085, 0.6, 22, 73.4],
    ['heat', 'Heat', 22, 0.7, 23, 0.96],
  ];
  for (const [kind, name, perDay, amplitude, seed, krPerUnit] of meters) {
    const amount = daily(UTILITIES_FROM, perDay * (kind === 'heat' ? 1 : 1), amplitude, seed, now, dataEnd);
    const id = `ista_dk:0000001_${kind}`;
    h.statistics[id] = amount;
    h.statistics[`${id}_cost`] = (start, end) => {
      const row = amount(start, end);
      return row && row.change !== undefined ? ({ change: row.change * krPerUnit, sum: row.change * krPerUnit } satisfies StatRow) : null;
    };
    h.put(
      `sensor.ista_${kind}`,
      kind === 'heat' ? 8450.2 : 312.481,
      { friendly_name: `ista ${name}`, unit_of_measurement: kind === 'heat' ? 'kWh' : 'm³', reading_date: '2026-10-17' },
      { ago: 600 }
    );
    h.put(
      `sensor.ista_${kind}_price`,
      krPerUnit,
      { friendly_name: `ista ${name} price`, source: kind === 'heat' ? 'estimate' : 'settled' },
      { ago: 6000 }
    );
  }
}

function ymd(ms: number): [number, number, number] {
  const { year, month, day } = homeWallTime(ms);
  return [year, month, day];
}
