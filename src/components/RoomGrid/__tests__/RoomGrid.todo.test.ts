// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Area, HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; hassUrl: string; connection: object | null };
  let state: State = { entities: {}, hassUrl: '', connection: null };
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
vi.mock('@iconify/react', async () => {
  const { createElement } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) };
});
vi.mock('../../Timeline', () => ({ LazyTimeline: () => null }));

type User = { is_admin: boolean; name: string; id: string };
const lookups = vi.hoisted(() => new Map<object, Promise<User>>());
vi.mock('home-assistant-js-websocket', () => ({ getUser: (connection: object) => lookups.get(connection) }));

const { RoomGrid } = await import('../RoomGrid');

const AREAS: Area[] = [
  { area_id: 'kitchen', name: 'Kitchen' },
  { area_id: 'dining_room', name: 'Dining Room' },
  { area_id: 'hallway', name: 'Hallway' },
  { area_id: 'guest_bathroom', name: 'Guest Bathroom' },
  { area_id: 'living_room', name: 'Living Room' },
  { area_id: 'rooftop', name: 'Rooftop' },
];

/** What the publisher sends: a plant and a hygiene run that are due, a battery that is not yet, and a log row. */
const ROWS = [
  {
    id: 'maint:plant:fig',
    kind: 'maint',
    title: 'Water the fig',
    icon: 'mdi:watering-can-outline',
    area: 'dining_room',
    audience: 'admin',
  },
  {
    id: 'maint:dishwasher:hygiene',
    kind: 'maint',
    title: 'Dishwasher hygiene run',
    icon: 'mdi:dishwasher',
    area: 'kitchen',
    audience: 'admin',
  },
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

/** Rain with a terrace door open: one row whose hour is 20 minutes away, one that is two hours away. */
const rain = (id: string, area: string, minutesAhead: number) => ({
  id,
  kind: 'rain',
  title: 'Rain forecast',
  icon: 'mdi:weather-pouring',
  area,
  at: new Date(Date.now() + minutesAhead * 60_000).toISOString(),
});

let root: Root;

async function openAs(user: User) {
  const connection = {};
  lookups.set(connection, Promise.resolve(user));
  const entities: HassEntities = {
    'sensor.house_upcoming': {
      entity_id: 'sensor.house_upcoming',
      state: 'x',
      attributes: {
        expires: new Date(Date.now() + 600_000).toISOString(),
        rows: [...ROWS, rain('rain:living', 'living_room', 20), rain('rain:later', 'rooftop', 120)],
      },
    },
  };
  act(() => store.setState({ connection, entities }));
  await act(async () => {
    root.render(createElement(RoomGrid, { areas: AREAS, entities, selectedAreaId: null, onRoomClick: () => {}, hassUrl: null }));
  });
}

/** The room name on each card that carries the badge, with the icon the badge shows. */
const badges = () =>
  [...document.querySelectorAll('.room-card')]
    .filter(card => card.querySelector('.indicator.todo'))
    .map(card => [card.querySelector('.room-name')?.textContent, card.querySelector('.indicator.todo i')?.getAttribute('data-icon')]);

beforeEach(() => {
  lookups.clear();
  store.setState({ connection: null, entities: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the to do badge on the room overview', () => {
  it("is on the card of each room that has a row due, for an administrator, in the row's own icon", async () => {
    await openAs({ is_admin: true, name: 'Mikkel', id: 'mikkel-id' });
    expect(document.querySelectorAll('.room-card')).toHaveLength(6);
    expect(badges()).toEqual([
      ['Dining Room', 'mdi:watering-can-outline'],
      ['Kitchen', 'mdi:dishwasher'],
      ['Living Room', 'mdi:weather-pouring'],
    ]);
  });

  it('is on no card for a housemate but the one with rain close, which everyone sees, and not for rain two hours off', async () => {
    await openAs({ is_admin: false, name: 'Kristine', id: 'kristine-id' });
    expect(document.querySelectorAll('.room-card')).toHaveLength(6);
    expect(badges()).toEqual([['Living Room', 'mdi:weather-pouring']]);
  });
});
