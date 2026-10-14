import { describe, expect, it } from 'vitest';
import { homeWallTime } from '../homeTime';
import { SLOT_TOP_DEVICES, slotDevices, slotEndMs } from '../hourDevices';
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
