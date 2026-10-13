import { describe, expect, it } from 'vitest';
import { assembleDevices, assembleLivePower } from '../assemble';
import { flowDashSeconds, flowNodes, flowStrokeWidth, groupRooms, type RoomUsage } from '../roomsView';
import type { DevicePref, EnergyBar, StatisticsResponse } from '../types';

const prefs: DevicePref[] = [
  { statId: 'sensor.technical_relay_energy', name: 'Technical relay', powerEntityId: 'p.relay' },
  { statId: 'sensor.server_energy', name: 'Server', parentStatId: 'sensor.technical_relay_energy', powerEntityId: 'p.server' },
  { statId: 'sensor.network_energy', name: 'Network', parentStatId: 'sensor.technical_relay_energy', powerEntityId: 'p.net' },
  { statId: 'sensor.kitchen_fridge_energy', name: 'Fridge', powerEntityId: 'p.fridge' },
  { statId: 'sensor.dishwasher_energy', name: 'Dishwasher', powerEntityId: 'p.dish' },
  { statId: 'sensor.mystery_energy', name: 'Mystery' },
];

const AREA: Record<string, string> = {
  'sensor.technical_relay_energy': 'technical_room',
  // A child placed elsewhere still counts in its parent's room: its kWh is inside the parent's.
  'sensor.server_energy': 'office',
  'sensor.network_energy': 'technical_room',
  'sensor.kitchen_fridge_energy': 'kitchen',
  'sensor.dishwasher_energy': 'kitchen',
};
const areaOf = (id: string) => AREA[id] ?? null;
const areas = {
  technical_room: { name: 'Technical room', icon: 'mdi:server' },
  kitchen: { name: 'Kitchen', icon: 'mdi:chef-hat' },
  office: { name: 'Office' },
};

const row = (kWh: number) => [{ start: 0, end: 86_400_000, change: kWh }];
const rows: StatisticsResponse = {
  'sensor.technical_relay_energy': row(2.3),
  'sensor.server_energy': row(1.2),
  'sensor.network_energy': row(0.5),
  'sensor.kitchen_fridge_energy': row(0.9),
  'sensor.dishwasher_energy': row(1.1),
  'sensor.mystery_energy': row(0.2),
};
const bars: EnergyBar[] = [{ startMs: 0, endMs: 86_400_000, kWh: 7, costKr: 14, price: 2, level: 'normal' }];

describe('groupRooms', () => {
  const devices = assembleDevices(prefs, rows, bars, { kWh: 7, costKr: 14 });
  const live = assembleLivePower(
    prefs,
    {
      'sensor.technical_relay_energy': 211,
      'sensor.server_energy': 118,
      'sensor.network_energy': 40,
      'sensor.kitchen_fridge_energy': 72,
      'sensor.dishwasher_energy': 540,
    },
    1000
  );
  const view = groupRooms({ prefs, areaOf, areas, devices, live, runningAreas: new Set(['kitchen']) });
  const byKey = (key: string) => view.rooms.find(room => room.key === key)!;

  it('counts a parent meter once and nests its children in its room', () => {
    const tech = byKey('technical_room');
    expect(tech.kWh).toBeCloseTo(2.3);
    expect(tech.watts).toBe(211);
    expect(tech.devices.map(d => d.name)).toEqual(['Technical relay']);
    expect(tech.devices[0].children?.map(d => d.name)).toEqual(['Server', 'Network']);
    expect(view.rooms.some(room => room.key === 'office')).toBe(false);
  });

  it('names the biggest single draw, a child rather than the parent containing it', () => {
    expect(byKey('technical_room').top).toEqual({ name: 'Server', watts: 118 });
    expect(byKey('kitchen').top).toEqual({ name: 'Dishwasher', watts: 540 });
    expect(byKey('kitchen').running).toBe(true);
  });

  it('puts devices without an area in one room and adds up to the grid with Untracked', () => {
    expect(byKey('').name).toBe('No room');
    expect(byKey('').watts).toBeNull();
    const roomKWh = view.rooms.reduce((sum, room) => sum + room.kWh, 0);
    expect(roomKWh + view.untracked.kWh!).toBeCloseTo(7);
    expect(view.untracked.kWh).toBeCloseTo(7 - 2.3 - 0.9 - 1.1 - 0.2);
    const roomW = view.rooms.reduce((sum, room) => sum + (room.watts ?? 0), 0);
    expect(roomW + view.untracked.watts!).toBe(1000);
    const roomKr = view.rooms.reduce((sum, room) => sum + (room.costKr ?? 0), 0);
    expect(roomKr + view.untracked.costKr!).toBeCloseTo(14);
  });

  it('sorts rooms by kWh and has no costs before the period has loaded', () => {
    expect(view.rooms.map(room => room.key)).toEqual(['technical_room', 'kitchen', '']);
    const liveOnly = groupRooms({ prefs, areaOf, areas, devices: null, live, runningAreas: new Set() });
    expect(liveOnly.rooms.every(room => room.costKr == null && room.kWh === 0)).toBe(true);
    expect(liveOnly.untracked).toEqual({ watts: 1000 - 211 - 72 - 540, kWh: null, costKr: null });
  });
});

describe('flow diagram mapping', () => {
  const room = (key: string, watts: number | null, running = false): RoomUsage => ({
    key,
    name: key,
    icon: 'mdi:home',
    watts,
    kWh: 0,
    costKr: null,
    devices: [],
    top: null,
    running,
  });

  it('widens lines with share and speeds dashes with watts, within bounds', () => {
    expect(flowStrokeWidth(0)).toBe(1.2);
    expect(flowStrokeWidth(0.37)).toBeCloseTo(3.49);
    expect(flowStrokeWidth(1)).toBe(7);
    expect(flowDashSeconds(0)).toBeNull();
    expect(flowDashSeconds(0.5)).toBeNull();
    expect(flowDashSeconds(10)).toBe(2.4);
    expect(flowDashSeconds(46)).toBeCloseTo(1.3);
    expect(flowDashSeconds(612)).toBe(0.6);
  });

  it('keeps rooms drawing power, biggest first, then Untracked, shares of the grid', () => {
    const nodes = flowNodes([room('a', 100), room('b', 600, true), room('c', null), room('d', 0.4)], 300, 1000);
    expect(nodes.map(n => n.key)).toEqual(['b', 'a', 'untracked']);
    expect(nodes.map(n => n.share)).toEqual([0.6, 0.1, 0.3]);
    expect(nodes[0].running).toBe(true);
    expect(nodes[2].untracked).toBe(true);
  });

  it('folds the smallest rooms into one node past the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => room(`r${i}`, 100 - i, i === 9));
    const nodes = flowNodes(many, null, null, 8);
    expect(nodes).toHaveLength(8);
    expect(nodes[7]).toMatchObject({ key: 'other-rooms', watts: 93 + 92 + 91, running: true });
    expect(nodes.reduce((sum, n) => sum + n.share, 0)).toBeCloseTo(1);
  });
});
