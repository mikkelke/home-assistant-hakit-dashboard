import { describe, expect, it } from 'vitest';
import type { BrewRecord } from '../../coffee/model';
import {
  ARRIVAL_RESIDENTS,
  applianceRun,
  arrivalPath,
  brewForRow,
  detailSpec,
  detailWindow,
  earlierArrivals,
  plantOfRow,
  slug,
  type HistorySpec,
} from '../eventDetail';
import type { HistoryPoint } from '../eventHistory';
import type { HouseEvent } from '../houseEvents';

const claudia = ARRIVAL_RESIDENTS.find(r => r.name === 'Claudia')!;
const ms = (iso: string) => new Date(iso).getTime();
const series = (baseMs: number, rows: [number, string][]): HistoryPoint[] =>
  rows.map(([offset, state]) => ({ ts: baseMs + offset, state }));
const step = (path: ReturnType<typeof arrivalPath>, key: string) => path.steps.find(s => s.key === key)!;
const ev = (iso: string, icon: string, text: string, by?: string): HouseEvent => ({ tsMs: ms(iso), icon, text, by });

describe('arrivalPath', () => {
  it('16.11 12:38: landing 22 s before the door, unlock, inside, wifi', () => {
    const base = ms('2026-11-16T12:38:00+01:00');
    const history = {
      [claudia.areaSensor]: series(base, [
        [-600000, 'unknown'],
        [-25434, 'unknown'],
        [-24404, 'Landing'],
        [-19432, 'Hallway'],
        [-18431, 'Kitchen'],
        [570, 'Hallway'],
        [5574, 'Guest bathroom'],
      ]),
      [claudia.tracker]: series(base, [
        [-600000, 'not_home'],
        [3885, 'home'],
        [9461, 'home'],
      ]),
      'lock.yale_bt': series(base, [
        [-600000, 'locked'],
        [-429, 'unlocked'],
      ]),
      'binary_sensor.apartment_door_open': series(base, [
        [-600000, 'off'],
        [-2856, 'on'],
        [32270, 'off'],
      ]),
    };
    const path = arrivalPath(history, claudia, ms('2026-11-16T12:38:19.648+01:00'));
    expect(path.doorSeen).toBe(true);
    expect(path.anchorMs).toBe(base - 2856);
    expect(step(path, 'landing').offsetS).toBe(-22);
    expect(step(path, 'unlock').offsetS).toBe(2);
    expect(step(path, 'inside').offsetS).toBe(3);
    expect(step(path, 'wifi').offsetS).toBe(7);
  });

  it('19.11 18:20: auto-unlock, the door contact missed the opening, so the steps count from the unlock', () => {
    const base = ms('2026-11-19T18:20:24.383+01:00');
    const history = {
      [claudia.areaSensor]: series(base, [
        [-600000, 'unknown'],
        [-21593, 'Landing'],
        [406, 'Kitchen'],
      ]),
      [claudia.tracker]: series(base, [
        [-600000, 'not_home'],
        [5741, 'home'],
      ]),
      'lock.yale_bt': series(base, [
        [-600000, 'locked'],
        [-21402, 'unlocking'],
        [-19659, 'unlocked'],
        [21229, 'locked'],
      ]),
      'binary_sensor.apartment_door_open': series(base, [[-600000, 'off']]),
    };
    const path = arrivalPath(history, claudia, base);
    expect(path.doorSeen).toBe(false);
    expect(path.anchorMs).toBe(base - 19659);
    expect(step(path, 'door').label).toBe('Door opening not seen');
    expect(step(path, 'door').atMs).toBeNull();
    expect(step(path, 'landing').offsetS).toBe(-2);
    expect(step(path, 'unlock').offsetS).toBe(0);
    expect(step(path, 'inside').offsetS).toBe(20);
    expect(step(path, 'wifi').offsetS).toBe(25);
  });

  it('an empty history gives every step as not seen and anchors on the row', () => {
    const path = arrivalPath({}, claudia, 1_000_000);
    expect(path.anchorMs).toBe(1_000_000);
    expect(path.steps.every(s => s.atMs == null)).toBe(true);
  });
});

describe('detailSpec', () => {
  const exists = (id: string) => ['sensor.pothos_moisture', 'sensor.peace_lily_kitchen_soil_moisture'].includes(id);

  it('a watered plant opens its soil sensor, older or newer naming', () => {
    const pothos = detailSpec(ev('2026-11-19T20:06:42+01:00', 'mdi:watering-can-outline', 'Watered Pothos, soil 15% to 69%'), exists);
    expect(pothos).toMatchObject({ kind: 'plant', entity: 'sensor.pothos_moisture', low: 15, peak: 69 });
    const lily = detailSpec(
      ev('2026-11-19T20:06:42+01:00', 'mdi:watering-can-outline', 'Watered Peace lily kitchen, soil 18% to 41%'),
      exists
    );
    expect(lily).toMatchObject({ entity: 'sensor.peace_lily_kitchen_soil_moisture' });
    expect(detailSpec(ev('2026-11-19T20:06:42+01:00', 'mdi:watering-can-outline', 'Watered Fern, soil 1% to 2%'), exists)).toBeNull();
  });

  it('the plant window is a day either side of the watering, never past now', () => {
    const spec = detailSpec(
      ev('2026-11-19T20:00:00+01:00', 'mdi:watering-can-outline', 'Watered Pothos, soil 15% to 69%'),
      exists
    ) as HistorySpec;
    expect(detailWindow(spec, ms('2026-11-25T00:00:00+01:00'))).toEqual({
      startMs: ms('2026-11-18T20:00:00+01:00'),
      endMs: ms('2026-11-20T20:00:00+01:00'),
    });
    expect(detailWindow(spec, ms('2026-11-20T08:00:00+01:00')).endMs).toBe(ms('2026-11-20T08:00:00+01:00'));
  });

  it('a finished appliance opens its run with the kWh from the row; emptied rows open nothing', () => {
    const dish = detailSpec(ev('2026-11-20T06:33:06+01:00', 'mdi:dishwasher', 'Dishwasher finished - used 0.79 kWh', 'Claudia'), exists);
    expect(dish).toMatchObject({ kind: 'appliance', appliance: 'dish', kwh: 0.79, powerEntity: 'sensor.athom_smart_plug_v3_50ec44_power' });
    expect(detailSpec(ev('2026-11-20T07:00:00+01:00', 'mdi:basket-check', 'Dishwasher emptied', 'Claudia'), exists)).toBeNull();
  });

  it('arrivals: Came home and resident-named apartment unlocks; keypad users and Went out do not', () => {
    expect(detailSpec(ev('2026-11-19T18:57:00+01:00', 'mdi:door-open', 'Came home', 'Kristine'), exists)).toMatchObject({
      kind: 'arrival',
    });
    expect(
      detailSpec(ev('2026-11-19T18:20:24+01:00', 'mdi:lock-open-variant', 'Apartment door unlocked on arrival', 'Claudia'), exists)
    ).toMatchObject({
      kind: 'arrival',
      resident: { name: 'Claudia' },
    });
    expect(
      detailSpec(ev('2026-11-19T10:00:00+01:00', 'mdi:lock-open-variant', 'Apartment door unlocked', 'Liga Cleaning'), exists)
    ).toBeNull();
    expect(detailSpec(ev('2026-11-19T10:00:00+01:00', 'mdi:door-open', 'Went out', 'Mikkel'), exists)).toBeNull();
    expect(detailSpec(ev('2026-11-19T10:00:00+01:00', 'mdi:lock-open-variant', 'Apartment door unlocked'), exists)).toBeNull();
  });

  it('a Coffee ready row opens its brew; a music row opens nothing', () => {
    expect(detailSpec(ev('2026-11-19T12:26:23+01:00', 'mdi:coffee', 'Coffee ready', 'Claudia'), exists)).toEqual({
      kind: 'coffee',
      atMs: ms('2026-11-19T12:26:23+01:00'),
    });
    expect(detailSpec(ev('2026-11-19T12:26:23+01:00', 'mdi:music', 'Kristine started Spotify in Kitchen'), exists)).toBeNull();
  });
});

describe('brewForRow', () => {
  const brew = (id: string, iso: string, outcome: BrewRecord['outcome'] = 'complete') => ({ id, atMs: ms(iso), outcome }) as BrewRecord;
  const row = ms('2026-11-19T12:26:23+01:00');

  it('takes the complete brew nearest the row within 20 minutes', () => {
    const brews = [
      brew('late', '2026-11-19T12:40:00+01:00'),
      brew('mine', '2026-11-19T12:22:00+01:00'),
      brew('early', '2026-11-19T11:50:00+01:00'),
    ];
    expect(brewForRow(brews, row)?.id).toBe('mine');
  });

  it('skips stopped brews and brews 20 minutes or more away', () => {
    expect(brewForRow([brew('stopped', '2026-11-19T12:22:00+01:00', 'stopped')], row)).toBeNull();
    expect(brewForRow([brew('far', '2026-11-19T12:06:23+01:00')], row)).toBeNull();
  });
});

describe('applianceRun', () => {
  it('starts at the last move into Running before the finish, and a pause does not restart it', () => {
    const finish = ms('2026-11-20T06:33:06+01:00');
    const state = series(finish, [
      [-4 * 3600_000, 'Off'],
      [-130 * 60_000, 'Running'],
      [-60 * 60_000, 'Paused'],
      [-55 * 60_000, 'Running'],
      [0, 'Unemptied'],
    ]);
    const power = series(finish, [
      [-130 * 60_000, '5'],
      [-100 * 60_000, '2010'],
      [-10 * 60_000, '40'],
      [0, '0'],
    ]);
    expect(applianceRun(state, power, finish)).toEqual({ startMs: finish - 130 * 60_000, minutes: 130, peakW: 2010 });
  });
});

describe('earlierArrivals and plants', () => {
  it('lists the same resident’s arrivals before the row, newest first', () => {
    const events = [
      ev('2026-11-19T18:20:24+01:00', 'mdi:lock-open-variant', 'Apartment door unlocked on arrival', 'Claudia'),
      ev('2026-11-19T09:55:00+01:00', 'mdi:door-open', 'Came home', 'Claudia'),
      ev('2026-11-18T12:50:00+01:00', 'mdi:door-open', 'Came home', 'Claudia'),
      ev('2026-11-18T20:06:00+01:00', 'mdi:door-open', 'Came home', 'Mikkel'),
    ];
    const earlier = earlierArrivals(events, claudia, ms('2026-11-19T18:20:24+01:00'));
    expect(earlier.map(e => e.tsMs)).toEqual([ms('2026-11-19T09:55:00+01:00'), ms('2026-11-18T12:50:00+01:00')]);
  });

  it('finds a plant row’s sensor and last watering by its slug', () => {
    expect(slug('Peace lily kitchen')).toBe('peace_lily_kitchen');
    const events = [
      ev('2026-11-17T08:00:00+01:00', 'mdi:watering-can-outline', 'Watered Pothos, soil 12% to 60%'),
      ev('2026-11-19T20:06:42+01:00', 'mdi:watering-can-outline', 'Watered Pothos, soil 15% to 69%'),
    ];
    expect(plantOfRow('maint:plant:pothos', events, id => id === 'sensor.pothos_moisture')).toEqual({
      entity: 'sensor.pothos_moisture',
      wateredMs: ms('2026-11-19T20:06:42+01:00'),
    });
    expect(plantOfRow('maint:dishwasher:filters', events, () => true)).toBeNull();
  });
});
