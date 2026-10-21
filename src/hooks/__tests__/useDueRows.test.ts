// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseUpcomingRow } from '../../home/houseUpcoming';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { connection: object | null; entities: Record<string, { attributes: unknown }> };
  let state: State = { connection: null, entities: {} };
  const listeners = new Set<(state: State) => void>();
  return {
    getState: () => state,
    setState(patch: Partial<State>) {
      state = { ...state, ...patch };
      listeners.forEach(listener => listener(state));
    },
    subscribe(listener: (state: State) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return { useHass: Object.assign(useHass, store) };
});

type User = { is_admin: boolean; name: string; id: string };
const lookups = vi.hoisted(() => new Map<object, Promise<User>>());
vi.mock('home-assistant-js-websocket', () => ({ getUser: (connection: object) => lookups.get(connection) }));

const { useDueRows } = await import('../useDueRows');

const NOW = Date.parse('2026-10-21T12:00:00Z');
const rows = [
  {
    id: 'maint:plant:fig',
    kind: 'maint',
    title: 'Water the fig',
    icon: 'mdi:watering-can-outline',
    area: 'dining_room',
    audience: 'admin',
  },
  { id: 'rain:terrace', kind: 'rain', title: 'Rain', icon: 'mdi:weather-pouring', area: 'living_room' },
  {
    id: 'maint:battery:sensor.test_battery',
    kind: 'maint',
    title: 'A battery',
    area: 'hallway',
    audience: 'admin',
    at: '2026-12-26T08:00:00Z',
  },
  { id: 'maint:dryer:plinth', kind: 'maint', title: 'Plinth', area: 'guest_bathroom', audience: 'admin', next: 'skip' },
];
const publish = (expires: number, published: unknown[] = rows) =>
  store.setState({ entities: { 'sensor.house_upcoming': { attributes: { expires: new Date(expires).toISOString(), rows: published } } } });

let root: Root;
const seen: HouseUpcomingRow[][] = [];
const latest = () => seen.at(-1) ?? [];

function Probe() {
  seen.push(useDueRows());
  return null;
}

const viewAs = async (user: User | Promise<User>) => {
  const connection = {};
  lookups.set(connection, Promise.resolve(user));
  act(() => store.setState({ connection }));
  await act(async () => root.render(createElement(Probe)));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  seen.length = 0;
  lookups.clear();
  store.setState({ connection: null, entities: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the rows that are due', () => {
  it('are the untimed rows that name a room, all of them for an administrator', async () => {
    publish(NOW + 600_000);
    await viewAs({ is_admin: true, name: 'Admin', id: 'admin-id' });
    expect(latest().map(row => row.id)).toEqual(['maint:plant:fig', 'rain:terrace']);
  });

  it('are the rows for everyone only, for a housemate', async () => {
    publish(NOW + 600_000);
    await viewAs({ is_admin: false, name: 'Housemate', id: 'housemate-id' });
    expect(latest().map(row => row.id)).toEqual(['rain:terrace']);
  });

  it('are only those of everyone until the viewer is known', async () => {
    publish(NOW + 600_000);
    const connection = {};
    let resolve: (user: User) => void = () => {};
    lookups.set(connection, new Promise<User>(done => (resolve = done)));
    act(() => store.setState({ connection }));
    await act(async () => root.render(createElement(Probe)));
    expect(latest().map(row => row.id)).toEqual(['rain:terrace']);
    await act(async () => resolve({ is_admin: true, name: 'Admin', id: 'admin-id' }));
    expect(latest().map(row => row.id)).toEqual(['maint:plant:fig', 'rain:terrace']);
  });

  it('follow what is published, and none once the lease has run out', async () => {
    publish(NOW + 600_000);
    await viewAs({ is_admin: true, name: 'Admin', id: 'admin-id' });
    act(() => publish(NOW + 600_000, rows.slice(0, 1)));
    expect(latest().map(row => row.id)).toEqual(['maint:plant:fig']);
    act(() => publish(NOW - 1_000));
    expect(latest()).toEqual([]);
  });

  it('count a rain row whatever its hour, since it exists only while a door is open and rain is forecast', async () => {
    const rain = {
      id: 'rain:terrace',
      kind: 'rain',
      title: 'Rain',
      icon: 'mdi:weather-pouring',
      area: 'living_room',
      at: new Date(NOW + 170 * 60_000).toISOString(),
    };
    publish(NOW + 600_000, [rain]);
    await viewAs({ is_admin: false, name: 'Housemate', id: 'housemate-id' });
    expect(latest().map(row => row.id)).toEqual(['rain:terrace']);
  });

  it('are none without the sensor', async () => {
    await viewAs({ is_admin: true, name: 'Admin', id: 'admin-id' });
    expect(latest()).toEqual([]);
  });
});
