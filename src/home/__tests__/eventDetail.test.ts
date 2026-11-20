import { describe, expect, it } from 'vitest';
import type { BrewRecord } from '../../coffee/model';
import {
  APARTMENT_DOOR,
  APARTMENT_LOCK,
  ARRIVAL_RESIDENTS,
  applianceRun,
  arrivalPath,
  bedtimesIn,
  brewForRow,
  detailSpec,
  detailWindow,
  doorLines,
  earlierArrivals,
  nightSummary,
  plantOfRow,
  roberRound,
  runFinishBefore,
  skippedRooms,
  slug,
  woltOrder,
  type HistorySpec,
} from '../eventDetail';
import type { MapEntry } from '../../components/Vacuum/maps';
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

  it('a finished appliance opens its run with the kWh from the row; an emptied row opens the run before it', () => {
    const dish = detailSpec(ev('2026-11-20T06:33:06+01:00', 'mdi:dishwasher', 'Dishwasher finished - used 0.79 kWh', 'Claudia'), exists);
    expect(dish).toMatchObject({
      kind: 'appliance',
      appliance: 'dish',
      kwh: 0.79,
      powerEntity: 'sensor.athom_smart_plug_v3_50ec44_power',
      emptied: false,
    });
    const emptied = detailSpec(ev('2026-11-18T14:20:43+01:00', 'mdi:basket-check', 'Dishwasher emptied', 'Claudia'), exists);
    expect(emptied).toMatchObject({ kind: 'appliance', appliance: 'dish', kwh: null, emptied: true });
    expect(detailWindow(emptied as HistorySpec, ms('2026-11-20T00:00:00+01:00'))).toEqual({
      startMs: ms('2026-11-17T08:20:43+01:00'),
      endMs: ms('2026-11-18T14:25:43+01:00'),
    });
    expect(detailSpec(ev('2026-11-15T11:11:42+01:00', 'mdi:basket-check', 'Washer emptied'), exists)).toMatchObject({
      appliance: 'washer',
    });
  });

  it('Rober2 round rows, Wolt deliveries and the night open their sheets; a no-start row does not', () => {
    const rober = (text: string, cause: string, effect: string) => ({
      ...ev('2026-11-17T18:54:03+01:00', 'mdi:robot-vacuum', text),
      cause,
      effect,
    });
    expect(detailSpec(rober('x', 'Nobody home', 'Vacuum starting its cleaning round'), exists)).toMatchObject({ kind: 'rober' });
    expect(detailSpec(rober('x', 'Someone came home', 'Vacuum stopped cleaning'), exists)).toMatchObject({ kind: 'rober' });
    expect(detailSpec(rober('x', 'Vacuum finished the open rooms', 'Vacuum skipped Bedroom - doors closed'), exists)).toMatchObject({
      kind: 'rober',
    });
    expect(
      detailSpec(rober('x', "Couldn't reach the Hallway after several tries", 'Room skipped and its cleaning flag cleared'), exists)
    ).toMatchObject({ kind: 'rober' });
    expect(detailSpec(rober('x', 'Nobody home', "Vacuum didn't start: Bedroom - doors closed"), exists)).toBeNull();
    expect(
      detailSpec(ev('2026-11-19T20:11:38+01:00', 'mdi:moped', 'Wolt order from WokXpress - Vesterbro delivered'), exists)
    ).toMatchObject({ kind: 'wolt', title: 'WokXpress - Vesterbro' });
    expect(detailSpec(ev('2026-11-19T22:36:41+01:00', 'mdi:weather-night', 'Night mode on'), exists)).toMatchObject({ kind: 'night' });
    expect(detailSpec(ev('2026-11-20T00:24:29+01:00', 'mdi:bed', 'Went to bed', 'Claudia'), exists)).toBeNull();
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

/* Recorder states from the box (CO2 thinned to every 150th reading). */
const REAL = {
  area17: [
    { ts: 1794853416817, state: '20028.4' },
    { ts: 1794938318756, state: '20032.7' },
    { ts: 1794938686018, state: '20040.6' },
    { ts: 1794939222970, state: '20051.3' },
    { ts: 1794939345749, state: '20054.6' },
  ],
  area18: [
    { ts: 1794989648846, state: '20069.7' },
    { ts: 1794993153851, state: '20074.0' },
    { ts: 1794993509673, state: '20082.0' },
    { ts: 1794994064059, state: '20092.9' },
    { ts: 1794995091985, state: '20108.1' },
    { ts: 1794995916309, state: '20120.2' },
    { ts: 1794996696249, state: '20124.9' },
    { ts: 1794997195887, state: '20132.0' },
    { ts: 1794997564395, state: '20136.8' },
    { ts: 1794997969926, state: '20143.7' },
    { ts: 1795003454437, state: '20148.1' },
    { ts: 1795003710039, state: '20150.0' },
  ],
  dish: [
    { ts: 1794842496986, state: 'Off' },
    { ts: 1794968185904, state: 'Running' },
    { ts: 1794983053863, state: 'Unemptied' },
    { ts: 1795008043660, state: 'Emptied' },
    { ts: 1795008471035, state: 'Off' },
  ],
  feel: [
    { ts: 1795121651743, state: '20.9' },
    { ts: 1795122552046, state: '21.0' },
    { ts: 1795123452598, state: '21.1' },
    { ts: 1795124353361, state: '21.2' },
    { ts: 1795125253952, state: '21.3' },
    { ts: 1795127956049, state: '21.4' },
    { ts: 1795131558963, state: '21.5' },
    { ts: 1795142366370, state: '21.6' },
    { ts: 1795159478785, state: '21.7' },
  ],
  co2: [
    { ts: 1795121993615, state: '817.0' },
    { ts: 1795122670664, state: '755.0' },
    { ts: 1795123354719, state: '759.0' },
    { ts: 1795124044779, state: '809.0' },
    { ts: 1795124757855, state: '795.0' },
    { ts: 1795125466911, state: '807.0' },
    { ts: 1795126182968, state: '815.0' },
    { ts: 1795126883068, state: '775.0' },
    { ts: 1795127530133, state: '789.0' },
    { ts: 1795128241199, state: '771.0' },
    { ts: 1795128925232, state: '754.0' },
    { ts: 1795129528276, state: '810.0' },
    { ts: 1795130274352, state: '758.0' },
    { ts: 1795131033412, state: '734.0' },
    { ts: 1795131793464, state: '734.0' },
    { ts: 1795132606551, state: '720.0' },
    { ts: 1795133324646, state: '722.0' },
    { ts: 1795134031660, state: '730.0' },
    { ts: 1795134767771, state: '718.0' },
    { ts: 1795135488777, state: '725.0' },
    { ts: 1795136224834, state: '691.0' },
    { ts: 1795137017923, state: '687.0' },
    { ts: 1795137843981, state: '675.0' },
    { ts: 1795138693072, state: '671.0' },
    { ts: 1795139524151, state: '707.0' },
    { ts: 1795140278172, state: '677.0' },
    { ts: 1795141057285, state: '687.0' },
    { ts: 1795141776288, state: '719.0' },
    { ts: 1795142553371, state: '669.0' },
    { ts: 1795143238434, state: '661.0' },
    { ts: 1795144035507, state: '685.0' },
    { ts: 1795144726587, state: '711.0' },
    { ts: 1795145461642, state: '703.0' },
    { ts: 1795146297735, state: '693.0' },
    { ts: 1795147050859, state: '683.0' },
    { ts: 1795147851865, state: '697.0' },
    { ts: 1795148617911, state: '715.0' },
    { ts: 1795149397977, state: '671.0' },
    { ts: 1795149847030, state: '768.0' },
    { ts: 1795150461142, state: '724.0' },
    { ts: 1795151140130, state: '712.0' },
    { ts: 1795152001200, state: '728.0' },
    { ts: 1795152871281, state: '750.0' },
    { ts: 1795153617311, state: '758.0' },
    { ts: 1795154359384, state: '730.0' },
    { ts: 1795155211476, state: '752.0' },
    { ts: 1795155943521, state: '774.0' },
    { ts: 1795156543570, state: '862.0' },
    { ts: 1795157295629, state: '838.0' },
    { ts: 1795158044740, state: '799.0' },
    { ts: 1795158766252, state: '760.0' },
    { ts: 1795159127323, state: '958.0' },
    { ts: 1795159755380, state: '860.0' },
    { ts: 1795160388574, state: '788.0' },
    { ts: 1795161056223, state: '720.0' },
  ],
  heat: [{ ts: 1795068364110, state: 'off' }],
  night: [
    { ts: 1795068345721, state: 'off' },
    { ts: 1795124201048, state: 'on' },
    { ts: 1795156384361, state: 'off' },
  ],
} as Record<string, HistoryPoint[]>;

const map = (datetime: string, room: string): MapEntry => ({
  filename: `${room}.png`,
  timestamp: '',
  datetime,
  room,
  url: `/media/local/rober2_maps/${room}.png`,
});
const roberRow = (iso: string, cause: string, effect: string): HouseEvent => ({
  tsMs: ms(iso),
  icon: 'mdi:robot-vacuum',
  text: `${cause} -> ${effect}`,
  cause,
  effect,
});

describe('roberRound', () => {
  const rows = [
    roberRow('2026-11-17T18:54:03+01:00', 'Nobody home', 'Vacuum starting its cleaning round'),
    roberRow('2026-11-17T19:15:42+01:00', 'Someone came home', 'Vacuum stopped cleaning'),
    roberRow('2026-11-17T19:39:50+01:00', 'Nobody home', 'Vacuum starting its cleaning round'),
    roberRow('2026-11-18T10:08:08+01:00', 'Clean-while-home is on (someone is home)', 'Vacuum starting its cleaning round'),
    roberRow('2026-11-18T12:59:40+01:00', 'Nobody home', 'Vacuum starting its cleaning round'),
    roberRow('2026-11-18T13:11:18+01:00', 'Vacuum error: Robot Trapped', "Cleaning stopped - automation paused until it's rescued"),
  ];
  const maps = [
    map('2026-11-17T18:58:37.777967', 'hallway'),
    map('2026-11-17T19:04:44.625371', 'kitchen'),
    map('2026-11-17T19:13:42.607884', 'kitchen_2'),
    map('2026-11-17T19:56:03.172793', 'living_room'),
    map('2026-11-18T10:12:33.199714', 'hallway'),
    map('2026-11-18T10:18:29.236070', 'kitchen'),
    map('2026-11-18T11:32:17.308301', 'bathroom'),
    map('2026-11-18T13:04:13.634414', 'hallway'),
  ];

  it('17.11: the start row and the stop row both open the same round: three rooms in 22 minutes, 26 m²', () => {
    const fromStart = roberRound(rows, maps, REAL.area17, ms('2026-11-17T18:54:03+01:00'));
    expect(fromStart).toMatchObject({
      startMs: ms('2026-11-17T18:54:03+01:00'),
      endMs: ms('2026-11-17T19:15:42+01:00'),
      endReason: 'Someone came home',
      areaM2: 26.2,
      skipped: [],
    });
    expect(fromStart.rooms.map(r => r.room)).toEqual(['hallway', 'kitchen', 'kitchen_2']);
    expect(roberRound(rows, maps, REAL.area17, ms('2026-11-17T19:15:42+01:00')).rooms).toHaveLength(3);
  });

  it('18.11 10:08 ended without a row before the next round started: its rooms stop at that start', () => {
    const round = roberRound(rows, maps, REAL.area18, ms('2026-11-18T10:08:08+01:00'));
    expect(round.endMs).toBeNull();
    expect(round.rooms.map(r => r.room)).toEqual(['hallway', 'kitchen', 'bathroom']);
    expect(round.lastRoomMs).toBe(ms('2026-11-18T11:32:17.308+01:00'));
  });

  it('18.11 13:11: an error row ends the 12:59 round', () => {
    const round = roberRound(rows, maps, [], ms('2026-11-18T13:11:18+01:00'));
    expect(round).toMatchObject({ startMs: ms('2026-11-18T12:59:40+01:00'), endReason: 'Vacuum error: Robot Trapped', areaM2: null });
    expect(round.rooms.map(r => r.room)).toEqual(['hallway']);
  });

  it('names the rooms a round left out', () => {
    const end = roberRow('2026-11-21T10:30:00+01:00', 'Vacuum finished the open rooms', 'Vacuum skipped Bedroom, Bathroom - doors closed');
    const start = roberRow('2026-11-21T10:00:00+01:00', 'Nobody home', 'Vacuum starting its cleaning round');
    const reach = roberRow(
      '2026-11-21T10:10:00+01:00',
      "Couldn't reach the Hallway after several tries",
      'Room skipped and its cleaning flag cleared'
    );
    expect(skippedRooms(end)).toEqual(['Bedroom', 'Bathroom']);
    expect(roberRound([start, reach, end], [], [], end.tsMs).skipped).toEqual(['Hallway', 'Bedroom', 'Bathroom']);
  });
});

describe('runFinishBefore', () => {
  it('18.11: Dishwasher emptied 14:20 belongs to the run that finished 07:24', () => {
    expect(runFinishBefore(REAL.dish, ms('2026-11-18T14:20:43+01:00'))).toBe(ms('2026-11-18T07:24:13.863+01:00'));
    expect(runFinishBefore(REAL.dish, ms('2026-11-18T05:00:00+01:00'))).toBeNull();
  });
});

describe('woltOrder', () => {
  const at = (hhmmss: string) => ms(`2026-11-19T${hhmmss}+01:00`);
  const snap = (hhmmss: string, stage: string, eta: string | null) => ({
    ts: at(hhmmss),
    deliveries: [{ source: 'wolt', title: 'WokXpress - Vesterbro', stage, eta: eta && `2026-11-19T${eta}+01:00` }],
  });
  // 19.11, thinned: Wolt flips between preparing and on the way while the courier waits at the restaurant.
  const snapshots = [
    snap('19:31:07', 'preparing', null),
    snap('19:32:06', 'preparing', '20:09:32'),
    snap('19:51:37', 'on_the_way', '20:10:37'),
    snap('19:54:07', 'preparing', '20:10:33'),
    snap('19:58:08', 'on_the_way', '20:11:31'),
    snap('19:59:08', 'preparing', '20:11:34'),
    snap('20:08:38', 'on_the_way', '20:12:06'),
    snap('20:09:08', 'arriving', '20:12:06'),
    snap('20:09:38', 'on_the_way', '20:13:12'),
    snap('20:10:38', 'arriving', '20:13:12'),
    { ts: at('20:11:38'), deliveries: [{ source: 'wolt', title: 'WokXpress - Vesterbro', stage: 'delivered', eta: null }] },
  ];

  it('picked up at the start of the last stretch on the way, first promised 20:09, delivered 20:11', () => {
    expect(woltOrder(snapshots, 'WokXpress - Vesterbro', at('20:11:38'))).toEqual({
      orderedMs: at('19:31:07'),
      pickedUpMs: at('20:08:38'),
      arrivingMs: at('20:09:08'),
      deliveredMs: at('20:11:38'),
      firstEtaMs: at('20:09:32'),
      lastEtaMs: at('20:13:12'),
    });
  });

  it('another order in the sensor is not mixed in, and a missing order gives no steps', () => {
    expect(woltOrder(snapshots, 'House of Sushi', at('20:11:38'))).toMatchObject({ orderedMs: null, pickedUpMs: null, firstEtaMs: null });
  });

  const ring = (iso: string, icon: string, effect: string): HouseEvent => ({
    tsMs: ms(iso),
    icon,
    text: `Someone rang the front door -> ${effect}`,
    cause: 'Someone rang the front door',
    effect,
  });
  // 19.11 WokXpress: the ring and its auto-open, then the apartment door opened from inside 10 s after the ring.
  const rows = [
    ring('2026-11-19T20:10:31.831+01:00', 'mdi:bell-ring', 'Announcing on the speakers and opening the door'),
    ring('2026-11-19T20:10:36.393+01:00', 'mdi:door-open', 'The door was opened for them'),
    ev('2026-11-19T20:11:00+01:00', 'mdi:music', 'Kristine started Spotify in Kitchen'),
    ring('2026-11-19T19:00:00+01:00', 'mdi:bell-ring', 'Announcing on the speakers and opening the door'),
  ];
  const doors = {
    [APARTMENT_DOOR]: series(at('20:00:00'), [
      [0, 'off'],
      [641_000, 'on'],
      [690_000, 'off'],
    ]),
    [APARTMENT_LOCK]: series(at('20:00:00'), [
      [0, 'locked'],
      [642_000, 'unlocked'],
      [878_000, 'locked'],
    ]),
  };

  it('19.11: one line for the ring with how fast the street door opened, then the apartment door', () => {
    expect(doorLines(rows, doors, at('20:07:08'), at('20:21:38'))).toEqual([
      { key: `ring-${at('20:10:31.831')}`, text: 'Rang the front door', detail: '20:10 · opened after 5 s' },
      { key: `apartment-${at('20:10:41')}`, text: 'Apartment door opened', detail: '20:10 (+9 s)' },
    ]);
  });

  it('without a door contact edge the unlock stands in, named from its row', () => {
    const named = [...rows, ev('2026-11-19T20:10:50+01:00', 'mdi:lock-open-variant', 'Apartment door unlocked', 'Claudia')];
    const lines = doorLines(named, { [APARTMENT_LOCK]: doors[APARTMENT_LOCK] }, at('20:07:08'), at('20:21:38'));
    expect(lines[1]).toEqual({ key: `apartment-${at('20:10:42')}`, text: 'Apartment door unlocked', detail: '20:10 (+10 s) · by Claudia' });
  });

  it('a ring nobody answered says so, and nothing outside the window shows', () => {
    const missed = [ring('2026-11-19T20:10:31+01:00', 'mdi:bell-off', 'Nobody answered - sent a snapshot to everyone home')];
    expect(doorLines(missed, {}, at('20:07:08'), at('20:21:38'))).toEqual([
      { key: `ring-${at('20:10:31')}`, text: 'Rang the front door', detail: '20:10 · nobody answered' },
    ]);
    expect(doorLines(rows, {}, at('20:12:00'), at('20:21:38'))).toEqual([]);
  });
});

describe('nightSummary', () => {
  const rowMs = ms('2026-11-19T22:36:41.048+01:00');
  const history = {
    'sensor.bedroom_feel': REAL.feel,
    'sensor.airdot_b49928_co2': REAL.co2,
    'binary_sensor.bedroom_heating_active': REAL.heat,
    'input_boolean.house_night_mode': REAL.night,
  };

  it('19-20.11: the night ends when the house night mode goes off, no heating, feel 21.1-21.7', () => {
    const night = nightSummary(history, rowMs, ms('2026-11-20T12:00:00+01:00'));
    expect(night.endMs).toBe(ms('2026-11-20T07:33:04.361+01:00'));
    expect(night.heat).toEqual([]);
    expect(night.heatMinutes).toBe(0);
    expect(night.feelLow).toBeGreaterThanOrEqual(20.9);
    expect(night.feelHigh).toBeLessThanOrEqual(21.7);
    expect(night.co2High).toBeGreaterThan(700);
  });

  it('heat stretches are clipped to the night and one still on runs to its end', () => {
    const heat = [
      { ts: rowMs - 3_600_000, state: 'on' },
      { ts: rowMs + 600_000, state: 'off' },
      { ts: rowMs + 3_600_000, state: 'on' },
    ];
    const night = nightSummary({ ...history, 'binary_sensor.bedroom_heating_active': heat }, rowMs, ms('2026-11-20T12:00:00+01:00'));
    expect(night.heat).toEqual([
      { startMs: rowMs, endMs: rowMs + 600_000 },
      { startMs: rowMs + 3_600_000, endMs: ms('2026-11-20T07:33:04.361+01:00') },
    ]);
  });

  it('a night still going reads to now', () => {
    const night = nightSummary({ 'input_boolean.house_night_mode': [{ ts: rowMs, state: 'on' }] }, rowMs, rowMs + 3_600_000);
    expect(night.endMs).toBeNull();
  });

  it('bedtimes are the Went to bed rows inside it', () => {
    const rows = [
      ev('2026-11-19T22:20:00+01:00', 'mdi:bed', 'Went to bed', 'Mikkel'),
      ev('2026-11-20T01:24:29+01:00', 'mdi:bed', 'Went to bed', 'Claudia'),
      ev('2026-11-20T21:00:00+01:00', 'mdi:bed', 'Went to bed', 'Kristine'),
    ];
    expect(bedtimesIn(rows, rowMs, ms('2026-11-20T07:33:04+01:00')).map(e => e.by)).toEqual(['Mikkel', 'Claudia']);
  });
});
