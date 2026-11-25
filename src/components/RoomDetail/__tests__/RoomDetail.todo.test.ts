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
const cooking = vi.hoisted(() => ({ cook: false, coffee: false }));
vi.mock('../../Coffee/CoffeeCard', () => ({ CoffeeCard: () => (cooking.coffee ? createElement('div', { 'data-card': 'coffee' }) : null) }));
vi.mock('../../Cook/CookCard', () => ({ CookCard: () => (cooking.cook ? createElement('div', { 'data-card': 'cook' }) : null) }));
vi.mock('../../../coffee/useCoffee', () => ({ useCoffeeState: () => (cooking.coffee ? { phase: 'brewing' } : null) }));
vi.mock('../RoomClimateHeader', () => ({ RoomClimateHeader: () => null }));
/** The week on the Rooftop is the Terrace section's own test: here it only has to be there or not. */
vi.mock('../TerraceChart', () => ({ TerraceChart: () => null }));
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
  cooking.cook = false;
  cooking.coffee = false;
  lookups.clear();
  store.setState({ connection: null, entities: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the room panel', () => {
  it('puts cooking directly under the to-dos and gives a brewing coffee the first card', async () => {
    cooking.cook = true;
    await open({ is_admin: true, name: 'Mikkel', id: 'mikkel-id' });
    expect(
      [...document.querySelector('.room-detail-content')!.children].map(element => element.getAttribute('data-card') ?? 'todo')
    ).toEqual(['todo', 'cook', 'light']);
    cooking.coffee = true;
    await open({ is_admin: true, name: 'Mikkel', id: 'mikkel-id' });
    expect(
      [...document.querySelector('.room-detail-content')!.children].map(element => element.getAttribute('data-card') ?? 'todo')
    ).toEqual(['todo', 'coffee', 'cook', 'light']);
  });

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

describe('the Rooftop panel', () => {
  const ROOFTOP: Area = { area_id: 'rooftop', name: 'Rooftop' };
  const reading = (entity_id: string, state: string) => ({
    entity_id,
    state,
    attributes: {},
    last_updated: new Date(Date.now() - 60_000).toISOString(),
  });
  const entities = Object.fromEntries(
    [reading('sensor.ice_bath_temperature', '6.0'), reading('sensor.gw2000a_outdoor_temperature', '4.2')].map(entity => [
      entity.entity_id,
      entity,
    ])
  ) as HassEntities;

  async function openRooftop(scrollToSection: 'terrace' | null, onScrollToSectionHandled = vi.fn()) {
    await act(async () =>
      root.render(
        createElement(RoomDetail, {
          area: ROOFTOP,
          entities,
          hassUrl: null,
          callService: undefined,
          onClose: () => {},
          isMobile: false,
          scrollToSection,
          onScrollToSectionHandled,
        })
      )
    );
    return onScrollToSectionHandled;
  }

  beforeEach(() => {
    const kept = new Map<string, string>([['terrace-collapsed', 'true']]);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        removeItem: (key: string) => void kept.delete(key),
      },
    });
    Element.prototype.scrollTo = vi.fn();
  });

  it('keeps the Terrace section folded as the device keeps it on an ordinary open', async () => {
    await openRooftop(null);
    expect(document.querySelector('.terrace-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.terrace-grid')).toBeNull();
  });

  it("opens the Terrace section for the weather sheet's request, scrolls to it, and leaves the device as it was", async () => {
    const handled = await openRooftop('terrace');
    expect(document.querySelector('.terrace-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.terrace-grid')).not.toBeNull();
    expect(Element.prototype.scrollTo).toHaveBeenCalledTimes(1);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('terrace-collapsed')).toBe('true');
    await openRooftop(null, handled);
    expect(document.querySelector('.terrace-grid')).not.toBeNull();
  });
});
