// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

type User = { is_admin: boolean; name: string; id: string };
const lookups = vi.hoisted(() => new Map<object, Promise<User>>());
vi.mock('home-assistant-js-websocket', () => ({ getUser: (connection: object) => lookups.get(connection) }));

const { RoomTodo } = await import('../RoomTodo');

const FIG = {
  id: 'maint:plant:fig',
  kind: 'maint',
  title: 'Water the fig: 1 L',
  detail: 'every 10 days, last 9 days ago',
  icon: 'mdi:watering-can-outline',
  area: 'dining_room',
  audience: 'admin',
  done: 'tap',
  info: ['Tall plant, big leaves', 'Below the family room thermostat'],
};
const PALM = { ...FIG, id: 'maint:plant:palm', title: 'Water the palm', done: undefined, info: undefined };
const PLUG = {
  id: 'maint:dishwasher:hygiene',
  kind: 'maint',
  title: 'Dishwasher hygiene run',
  icon: 'mdi:dishwasher',
  area: 'kitchen',
  audience: 'admin',
  steps: ['Pick the Intensive programme.'],
};
const RAIN = { id: 'rain:terrace', kind: 'rain', title: 'Rain forecast', icon: 'mdi:weather-pouring', area: 'dining_room' };

let root: Root;
let send: Mock<(message: unknown) => Promise<unknown>>;

const publish = (...rows: Record<string, unknown>[]) =>
  act(() =>
    store.setState({
      entities: {
        'sensor.house_upcoming': {
          entity_id: 'sensor.house_upcoming',
          state: 'x',
          attributes: {
            expires: new Date(Date.now() + 600_000).toISOString(),
            rows: rows.map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))),
          },
        },
      },
    })
  );

async function openAs(user: User, areaId = 'dining_room') {
  const connection = { sendMessagePromise: send };
  lookups.set(connection, Promise.resolve(user));
  act(() => store.setState({ connection }));
  await act(async () => root.render(createElement(RoomTodo, { areaId })));
}
const MIKKEL: User = { is_admin: true, name: 'Mikkel', id: 'mikkel-id' };
const KRISTINE: User = { is_admin: false, name: 'Kristine', id: 'kristine-id' };

const chips = () => [...document.querySelectorAll('.room-todo-chip')].map(chip => chip.textContent);
const chip = (title: string) => [...document.querySelectorAll<HTMLElement>('.room-todo-chip')].find(node => node.textContent === title)!;
const tap = (node: HTMLElement) => act(async () => node.click());
const dialog = () => document.body.querySelector('[role="dialog"]');
const sheetButtons = () => [...document.body.querySelectorAll('.maint-body button')].map(node => node.textContent);

beforeEach(() => {
  send = vi.fn(() => Promise.resolve(null));
  lookups.clear();
  store.setState({ connection: null, entities: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the To do section of a room panel', () => {
  it("lists what is due in this room as chips with the icon of the row, in publish order, and no other room's rows", async () => {
    publish(FIG, PLUG, PALM);
    await openAs(MIKKEL);
    expect(document.querySelector('.room-todo-label')?.textContent).toBe('To do');
    expect(chips()).toEqual(['Water the fig: 1 L', 'Water the palm']);
    expect(document.querySelector('.room-todo-chip i')?.getAttribute('data-icon')).toBe('mdi:watering-can-outline');
    await act(async () => root.render(createElement(RoomTodo, { areaId: 'kitchen' })));
    expect(chips()).toEqual(['Dishwasher hygiene run']);
  });

  it('is not there when nothing is due in the room', async () => {
    publish(PLUG, { ...FIG, at: '2026-12-26T08:00:00Z' });
    await openAs(MIKKEL);
    expect(document.querySelector('.room-todo')).toBeNull();
  });

  it('shows a housemate what everyone sees and nothing of the maintenance', async () => {
    publish(FIG, RAIN);
    await openAs(KRISTINE);
    expect(chips()).toEqual(['Rain forecast']);
    publish(FIG);
    expect(document.querySelector('.room-todo')).toBeNull();
  });
});

describe('a chip of the To do section', () => {
  it('opens the maintenance sheet of the row, with its detail and info lines', async () => {
    publish(FIG);
    await openAs(MIKKEL);
    expect(dialog()).toBeNull();
    await tap(chip('Water the fig: 1 L'));
    expect(dialog()?.getAttribute('aria-label')).toBe('Water the fig: 1 L');
    const text = document.body.querySelector('.maint-body')?.textContent ?? '';
    expect(text).toContain('every 10 days, last 9 days ago');
    expect(text).toContain('Below the family room thermostat');
    expect(sheetButtons()).toEqual(['Done']);
  });

  it('gives an administrator the Done button of a row that has one, which fires the event for the row', async () => {
    publish(FIG);
    await openAs(MIKKEL);
    await tap(chip('Water the fig: 1 L'));
    await act(async () =>
      [...document.body.querySelectorAll<HTMLElement>('.maint-body button')].find(b => b.textContent === 'Done')?.click()
    );
    await act(async () =>
      [...document.body.querySelectorAll<HTMLElement>('.maint-body button')].find(b => b.textContent === 'Yes, done')?.click()
    );
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'fire_event',
      event_type: 'house_upcoming_done',
      event_data: { row: 'maint:plant:fig' },
    });
  });

  it('opens a sheet for a row without a Done button too, which has no way into the room it is opened from', async () => {
    publish(PALM);
    await openAs(MIKKEL);
    await tap(chip('Water the palm'));
    expect(dialog()?.getAttribute('aria-label')).toBe('Water the palm');
    expect(sheetButtons()).toEqual([]);
  });

  it('closes with its row once HouseUpcoming has taken the Done and no longer publishes it', async () => {
    publish(FIG, PALM);
    await openAs(MIKKEL);
    await tap(chip('Water the fig: 1 L'));
    expect(dialog()).not.toBeNull();
    publish(PALM);
    expect(dialog()).toBeNull();
    expect(chips()).toEqual(['Water the palm']);
  });
});
