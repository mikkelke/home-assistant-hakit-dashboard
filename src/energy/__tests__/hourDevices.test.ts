import { describe, expect, it } from 'vitest';
import { PLAN_APPLIANCES } from '../../config/plan';
import { homeWallTime } from '../homeTime';
import { SLOT_TOP_DEVICES, deviceIcon, slotDevices, slotEndMs } from '../hourDevices';
import type { DevicePref, StatisticsResponse, StatisticValue } from '../types';
import { HOUR_MS, MINUTE_MS, home } from './testUtils';

const prefs: DevicePref[] = [
  { statId: 'relay', name: 'Technical relay' },
  { statId: 'server', name: 'Server', parentStatId: 'relay' },
  { statId: 'oven', name: 'Oven' },
  { statId: 'fridge', name: 'Fridge' },
  { statId: 'washer', name: 'Washer' },
  { statId: 'dryer', name: 'Dryer' },
  { statId: 'tv', name: 'TV' },
  { statId: 'lamp', name: 'Lamp' },
  { statId: 'kettle', name: 'Kettle' },
];

/** Consecutive rows `stepMs` long from `startMs`. */
function rows(startMs: number, kWh: number[], stepMs = HOUR_MS): StatisticValue[] {
  return kWh.map((change, i) => ({ start: startMs + i * stepMs, end: startMs + (i + 1) * stepMs, change }));
}

/** One row per device in the hour starting at `startMs`. */
function hour(startMs: number, kWh: Record<string, number>): StatisticsResponse {
  return Object.fromEntries(Object.entries(kWh).map(([statId, change]) => [statId, rows(startMs, [change])]));
}

const names = (devices: { name: string }[]) => devices.map(device => device.name);

describe('slotDevices', () => {
  const day = home(2026, 10, 13);
  const at = (h: number) => day + h * HOUR_MS;

  it("takes each device's row for the tapped slot only", () => {
    const response = { oven: rows(day, [0, 1.2, 0.1]), fridge: rows(day, [0.03, 0.02, 0.04]) };
    const slot = slotDevices(prefs, response, 'day', at(1), 1.5)!;
    expect(slot.top.map(device => [device.name, device.kWh])).toEqual([
      ['Oven', 1.2],
      ['Fridge', 0.02],
    ]);
  });

  it("sums the in-progress hour's 5-minute rows into its slot", () => {
    const response = { oven: [...rows(day, [0.5, 0.6]), ...rows(at(2), [0.05, 0.05, 0.04], 5 * MINUTE_MS)] };
    expect(slotDevices(prefs, response, 'day', at(2), 0.2)!.top[0].kWh).toBeCloseTo(0.14);
    expect(slotDevices(prefs, response, 'day', at(1), 0.7)!.top[0].kWh).toBe(0.6);
  });

  it('takes the day row on the week and month views and the month row on the year view', () => {
    const days = { oven: rows(home(2026, 10, 1), [2, 3, 4], 24 * HOUR_MS) };
    expect(slotDevices(prefs, days, 'month', home(2026, 10, 2), 3.5)!.top.map(device => device.kWh)).toEqual([3]);
    const months = {
      oven: [
        { start: home(2026, 9, 1), end: home(2026, 10, 1), change: 50 },
        { start: home(2026, 10, 1), end: home(2026, 11, 1), change: 60 },
      ],
    };
    expect(slotDevices(prefs, months, 'year', home(2026, 10, 1), 70)!.top.map(device => device.kWh)).toEqual([60]);
  });

  it('lists only devices with use, biggest first', () => {
    const slot = slotDevices(prefs, hour(at(0), { fridge: 0.03, oven: 1.24, tv: 0, washer: 0.09 }), 'day', at(0), 1.4)!;
    expect(names(slot.top)).toEqual(['Oven', 'Washer', 'Fridge']);
    expect(slot.more).toEqual([]);
  });

  it('keeps the biggest five and folds the rest into more, biggest first', () => {
    const response = hour(at(0), { relay: 0.08, oven: 1.2, fridge: 0.03, washer: 0.5, dryer: 0.6, tv: 0.02, lamp: 0.01, kettle: 0.1 });
    const slot = slotDevices(prefs, response, 'day', at(0), 3)!;
    expect(SLOT_TOP_DEVICES).toBe(5);
    expect(names(slot.top)).toEqual(['Oven', 'Dryer', 'Washer', 'Kettle', 'Technical relay']);
    expect(names(slot.more)).toEqual(['Fridge', 'TV', 'Lamp']);
  });

  it('adds what no device accounts for once it is above 0,05 kWh, counting a child meter inside its parent', () => {
    const response = hour(at(0), { relay: 0.3, server: 0.2, oven: 1 });
    const slot = slotDevices(prefs, response, 'day', at(0), 1.5)!;
    expect(names(slot.top)).toEqual(['Oven', 'Technical relay']);
    expect(slot.unmeteredKWh).toBeCloseTo(0.2);
    expect(slotDevices(prefs, response, 'day', at(0), 1.36)!.unmeteredKWh).toBeCloseTo(0.06);
    expect(slotDevices(prefs, response, 'day', at(0), 1.34)!.unmeteredKWh).toBe(0);
  });

  it('clamps the remainder to 0 when the devices add up to more than the total', () => {
    const slot = slotDevices(prefs, hour(at(0), { oven: 1.1, fridge: 0.05 }), 'day', at(0), 1)!;
    expect(slot.unmeteredKWh).toBe(0);
    expect(names(slot.top)).toEqual(['Oven', 'Fridge']);
  });

  it('leaves out a device without rows rather than showing it at zero', () => {
    const slot = slotDevices(prefs, { oven: rows(at(0), [1]), fridge: [] }, 'day', at(0), 1.3)!;
    expect(names([...slot.top, ...slot.more])).toEqual(['Oven']);
    expect(slot.unmeteredKWh).toBeCloseTo(0.3);
  });

  it('is null when no device has a row in the slot', () => {
    expect(slotDevices(prefs, {}, 'day', at(0), 1)).toBeNull();
    expect(slotDevices(prefs, { oven: rows(at(0), [1]), fridge: [] }, 'day', at(1), 1)).toBeNull();
    expect(slotDevices(prefs, { unknown: rows(at(0), [1]) }, 'day', at(0), 1)).toBeNull();
  });
});

describe('slotDevices kr', () => {
  const day = home(2026, 10, 13);
  const at = (h: number) => day + h * HOUR_MS;
  const price = 2.5;
  // Eight top-level devices use 2,54 kWh; the grid says 3 kWh, so 0,46 kWh is unmetered.
  const response = hour(at(9), {
    relay: 0.08,
    server: 0.05,
    oven: 1.2,
    fridge: 0.03,
    washer: 0.5,
    dryer: 0.6,
    tv: 0.02,
    lamp: 0.01,
    kettle: 0.1,
  });
  const totalKWh = 3;
  const costs = (devices: { costKr: number | null }[]) => devices.map(device => device.costKr);

  it("prices each device at the hour's price", () => {
    const slot = slotDevices(prefs, response, 'day', at(9), totalKWh, price)!;
    expect(names(slot.top)).toEqual(['Oven', 'Dryer', 'Washer', 'Kettle', 'Technical relay']);
    costs(slot.top).forEach((cost, i) => expect(cost).toBeCloseTo(slot.top[i].kWh * price));
    expect(slot.top[0].costKr).toBeCloseTo(3);
    expect(slot.top.every(device => device.costExact)).toBe(true);
  });

  it('prices the more row and the unmetered row the same way', () => {
    const slot = slotDevices(prefs, response, 'day', at(9), totalKWh, price)!;
    expect(names(slot.more)).toEqual(['Fridge', 'TV', 'Lamp']);
    expect(slot.moreKWh).toBeCloseTo(0.06);
    expect(slot.moreCostKr).toBeCloseTo(0.15);
    expect(slot.unmeteredKWh).toBeCloseTo(0.46);
    expect(slot.unmeteredCostKr).toBeCloseTo(1.15);
    expect(costs(slot.more)).toEqual(slot.more.map(device => device.kWh * price));
  });

  it("adds up to the slot's kWh times the hour's price, the header's kr, a child meter counted once inside its parent", () => {
    const slot = slotDevices(prefs, response, 'day', at(9), totalKWh, price)!;
    const rowsKr = [...costs(slot.top), slot.moreCostKr, slot.unmeteredCostKr].reduce<number>((sum, kr) => sum + (kr ?? NaN), 0);
    expect(rowsKr).toBeCloseTo(totalKWh * price);
  });

  it("prices the in-progress hour's 5-minute rows at its price", () => {
    const partial = { oven: [...rows(at(1), [0.5]), ...rows(at(2), [0.05, 0.05, 0.04], 5 * MINUTE_MS)] };
    expect(slotDevices(prefs, partial, 'day', at(2), 0.14, 2)!.top[0].costKr).toBeCloseTo(0.28);
  });

  it('keeps a free hour at 0 kr rather than leaving kr out', () => {
    const slot = slotDevices(prefs, response, 'day', at(9), totalKWh, 0)!;
    expect(costs(slot.top)).toEqual([0, 0, 0, 0, 0]);
    expect([slot.moreCostKr, slot.unmeteredCostKr]).toEqual([0, 0]);
  });

  it('leaves kr out without a price', () => {
    for (const slot of [
      slotDevices(prefs, response, 'day', at(9), totalKWh)!,
      slotDevices(prefs, response, 'day', at(9), totalKWh, null)!,
    ]) {
      expect(costs([...slot.top, ...slot.more])).toEqual(Array(8).fill(null));
      expect([slot.moreCostKr, slot.unmeteredCostKr]).toEqual([null, null]);
      expect(slot.top.some(device => device.costExact)).toBe(false);
      expect(slot.unmeteredKWh).toBeCloseTo(0.46);
    }
  });

  it('leaves kr out of a day or month slot, which spans hours at different prices, even given a price', () => {
    const days = { oven: rows(home(2026, 10, 1), [2, 3, 4], 24 * HOUR_MS), fridge: rows(home(2026, 10, 1), [0.5, 0.6, 0.7], 24 * HOUR_MS) };
    const months = {
      oven: [{ start: home(2026, 10, 1), end: home(2026, 11, 1), change: 60 }],
      fridge: [{ start: home(2026, 10, 1), end: home(2026, 11, 1), change: 9 }],
    };
    const slots = [
      slotDevices(prefs, days, 'week', home(2026, 10, 2), 3.7, price)!,
      slotDevices(prefs, days, 'month', home(2026, 10, 2), 4, price)!,
      slotDevices(prefs, months, 'year', home(2026, 10, 1), 70, price)!,
    ];
    for (const slot of slots) {
      expect(slot.top).toHaveLength(2);
      expect(costs(slot.top)).toEqual([null, null]);
      expect(slot.top.some(device => device.costExact)).toBe(false);
      expect(slot.unmeteredKWh).toBeGreaterThan(0);
      expect([slot.moreCostKr, slot.unmeteredCostKr]).toEqual([null, null]);
    }
  });
});

describe('deviceIcon', () => {
  const device = (statId: string, powerEntityId?: string): DevicePref => ({ statId, name: statId, powerEntityId });
  const devices: DevicePref[] = [
    device('sensor.oven_plug_switch_0_energy', 'sensor.oven_plug_switch_0_power'),
    device('sensor.hotplate_power_monitor_total_active_energy', 'sensor.hotplate_power_monitor_total_active_power'),
    device('sensor.microwave_plug_energy', 'sensor.microwave_plug_power'),
    device('sensor.fridge_plug_energy', 'sensor.fridge_plug_power'),
    device('sensor.wine_fridge_energy', 'sensor.wine_fridge_power'),
    device('sensor.living_room_tv_relay_energy', 'sensor.living_room_tv_relay_power'),
    device('sensor.bedroom_tv_relay_energy', 'sensor.bedroom_tv_relay_power'),
    device('sensor.technical_relay_energy', 'sensor.technical_relay_power'),
    device('sensor.washer_plug_energy', 'sensor.washer_plug_power'),
    device('sensor.athom_smart_plug_v3_50ec44_energy', 'sensor.athom_smart_plug_v3_50ec44_power'),
    device('sensor.dryer_plug_energy', 'sensor.dryer_plug_power'),
    device('sensor.small_lamp_device_energy', 'sensor.small_lamp_device_power'),
    device('sensor.claudias_room_string_lights_energy'),
  ];
  const icon = (statId: string) => deviceIcon(devices, statId);

  it('gives the clear cases their own icon', () => {
    expect(icon('sensor.oven_plug_switch_0_energy')).toBe('mdi:toaster-oven');
    expect(icon('sensor.hotplate_power_monitor_total_active_energy')).toBe('mdi:stove');
    expect(icon('sensor.microwave_plug_energy')).toBe('mdi:microwave');
    expect(icon('sensor.fridge_plug_energy')).toBe('mdi:fridge');
    expect(icon('sensor.wine_fridge_energy')).toBe('mdi:fridge');
    expect(icon('sensor.living_room_tv_relay_energy')).toBe('mdi:television');
    expect(icon('sensor.bedroom_tv_relay_energy')).toBe('mdi:television');
    expect(icon('sensor.technical_relay_energy')).toBe('mdi:server-network');
  });

  it('takes the washer, dishwasher and dryer icons from the plan config', () => {
    const appliances = {
      washer: 'sensor.washer_plug_energy',
      dishwasher: 'sensor.athom_smart_plug_v3_50ec44_energy',
      dryer: 'sensor.dryer_plug_energy',
    };
    for (const [key, statId] of Object.entries(appliances)) {
      const planIcon = PLAN_APPLIANCES.find(appliance => appliance.key === key)?.icon;
      expect(planIcon).toBeTruthy();
      expect(icon(statId)).toBe(planIcon);
    }
  });

  it('leaves the rest to their room icon', () => {
    expect(icon('sensor.small_lamp_device_energy')).toBeUndefined();
    expect(icon('sensor.claudias_room_string_lights_energy')).toBeUndefined();
    expect(icon('sensor.not_a_device_energy')).toBeUndefined();
  });
});

describe('slots on DST days', () => {
  const day = home(2026, 10, 25);
  const next = home(2026, 10, 26);
  // The hour before the day, its 25 hours worth 1..25 kWh, and the hour after it.
  const response = { oven: rows(day - HOUR_MS, [1000, ...Array.from({ length: 25 }, (_, i) => i + 1), 1000]) };

  it('ends the 2026-10-25 day slot 25 hours after it starts, in home time', () => {
    expect(next - day).toBe(25 * HOUR_MS);
    expect(slotEndMs('week', day)).toBe(next);
    expect(slotEndMs('month', day)).toBe(next);
    expect(slotEndMs('year', home(2026, 10, 1))).toBe(home(2026, 11, 1));
  });

  it('ends the 2026-03-29 day slot after 23 hours', () => {
    expect(slotEndMs('week', home(2026, 3, 29)) - home(2026, 3, 29)).toBe(23 * HOUR_MS);
  });

  it('gives each of the two 02:00 hours its own row', () => {
    expect(homeWallTime(day + 2 * HOUR_MS).hour).toBe(2);
    expect(homeWallTime(day + 3 * HOUR_MS).hour).toBe(2);
    expect(slotDevices(prefs, response, 'day', day + 2 * HOUR_MS, 3)!.top[0].kWh).toBe(3);
    expect(slotDevices(prefs, response, 'day', day + 3 * HOUR_MS, 4)!.top[0].kWh).toBe(4);
    expect(slotDevices(prefs, response, 'day', day + 24 * HOUR_MS, 25)!.top[0].kWh).toBe(25);
  });

  it('puts all 25 hourly rows in the day slot and none of the neighbours', () => {
    expect(slotDevices(prefs, response, 'week', day, 325)!.top[0].kWh).toBe(325);
    expect(slotDevices(prefs, response, 'month', next, 1000)!.top[0].kWh).toBe(1000);
  });
});
