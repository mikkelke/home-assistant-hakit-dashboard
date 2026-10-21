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

/** The cards of a room are other tests' business: each stands in as nothing, the light card as a marker. */
vi.mock('../../MediaPlayer', () => ({ SonosPlayer: () => null, TVCard: () => null }));
vi.mock('../../AC', () => ({ TonightCard: () => null }));
vi.mock('../../Cover', () => ({ CoverCard: () => null }));
vi.mock('../../Vacuum', () => ({ VacuumCard: () => null, RoomCleaningToggle: () => null }));
vi.mock('../../Light', async () => {
  const { createElement } = await import('react');
  return { LightCard: () => createElement('div', { 'data-card': 'light' }) };
});
vi.mock('../../Alarm', () => ({ WakeupAlarm: () => null }));
vi.mock('../../Intercom', () => ({ IntercomCard: () => null }));
vi.mock('../../Washer', () => ({ WasherCard: () => null }));
vi.mock('../../Dishwasher', () => ({ DishwasherCard: () => null }));
vi.mock('../../Dryer', () => ({ DryerCard: () => null }));
vi.mock('../../Coffee/CoffeeCard', () => ({ CoffeeCard: () => null }));
vi.mock('../../../coffee/useCoffee', () => ({ useCoffeeState: () => null }));
vi.mock('../RoomClimateHeader', () => ({ RoomClimateHeader: () => null }));
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => ({}) }));

type User = { is_admin: boolean; name: string; id: string };
const lookups = vi.hoisted(() => new Map<object, Promise<User>>());
vi.mock('home-assistant-js-websocket', () => ({ getUser: (connection: object) => lookups.get(connection) }));

const { RoomDetail } = await import('../RoomDetail');

const KITCHEN: Area = { area_id: 'kitchen', name: 'Kitchen' };
const HYGIENE = {
  id: 'maint:dishwasher:hygiene',
  kind: 'maint',
  title: 'Dishwasher hygiene run',
  icon: 'mdi:dishwasher',
  area: 'kitchen',
  audience: 'admin',
};

let root: Root;

async function open(user: User) {
  const connection = {};
  lookups.set(connection, Promise.resolve(user));
  const entities = {
    'sensor.house_upcoming': {
      entity_id: 'sensor.house_upcoming',
      state: 'x',
      attributes: { expires: new Date(Date.now() + 600_000).toISOString(), rows: [HYGIENE] },
    },
  } as HassEntities;
  act(() => store.setState({ connection, entities }));
  await act(async () =>
    root.render(
      createElement(RoomDetail, { area: KITCHEN, entities: {}, hassUrl: null, callService: undefined, onClose: () => {}, isMobile: false })
    )
  );
}

beforeEach(() => {
  lookups.clear();
  store.setState({ connection: null, entities: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the room panel', () => {
  it('opens on a To do section with what is due in the room, above the cards of the room', async () => {
    await open({ is_admin: true, name: 'Mikkel', id: 'mikkel-id' });
    const content = document.querySelector('.room-detail-content');
    expect(content?.firstElementChild?.classList.contains('room-todo')).toBe(true);
    expect(content?.firstElementChild?.textContent).toContain('Dishwasher hygiene run');
    expect(content?.querySelector('[data-card="light"]')).not.toBeNull();
  });

  it('has no To do section for a housemate, who does not see the maintenance row', async () => {
    await open({ is_admin: false, name: 'Kristine', id: 'kristine-id' });
    expect(document.querySelector('.room-todo')).toBeNull();
    expect(document.querySelector('.room-detail-content [data-card="light"]')).not.toBeNull();
  });
});
