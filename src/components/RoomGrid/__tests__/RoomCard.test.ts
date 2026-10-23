// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHouseUpcoming } from '../../../home/houseUpcoming';
import type { Area, HassEntities, RoomCardProps } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; hassUrl: string; connection: object };
  let state: State = { entities: {}, hassUrl: '', connection: {} };
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
vi.mock('../../Timeline', async () => ({ LazyTimeline: (await import('../../Timeline/Timeline')).Timeline }));

const { RoomCard } = await import('../RoomCard');

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });

function world(...entities: ReturnType<typeof entity>[]): HassEntities {
  return Object.fromEntries(entities.map(e => [e.entity_id, e]));
}

/** The map Dashboard hands its cards, recording every entity read through it, as its tracker does. */
function tracked(entities: HassEntities, reads: Set<string>): HassEntities {
  return new Proxy(entities, {
    get(target, prop) {
      if (typeof prop === 'string') reads.add(prop);
      return Reflect.get(target, prop);
    },
  });
}

let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

function show(area: Area, entities: HassEntities, reads = new Set<string>(), extra: Partial<RoomCardProps> = {}) {
  store.setState({ entities });
  act(() => {
    root.render(
      createElement(RoomCard, { area, entities: tracked(entities, reads), onClick: () => {}, isSelected: false, hassUrl: null, ...extra })
    );
  });
  return reads;
}

const HALLWAY: Area = { area_id: 'hallway', name: 'Hallway' };
const KITCHEN: Area = { area_id: 'kitchen', name: 'Kitchen' };
const modalOpen = () => document.querySelector('.person-info-overlay') != null;

describe('room card exception icons', () => {
  it('keeps an open door history up when the door closes meanwhile', () => {
    show(HALLWAY, world(entity('binary_sensor.apartment_door_open', 'on', { friendly_name: 'Apartment door' })));
    const door = document.querySelector<HTMLElement>('.room-ex .indicator.door');
    expect(door).not.toBeNull();
    act(() => door!.click());
    expect(modalOpen()).toBe(true);

    show(HALLWAY, world(entity('binary_sensor.apartment_door_open', 'off', { friendly_name: 'Apartment door' })));
    expect(modalOpen()).toBe(true);
    expect(document.querySelector('.room-ex .indicator.door')?.closest('.is-hidden')).not.toBeNull();
  });

  it('shows semantic lock exceptions instead of a stuck BLE unlock', () => {
    const state = (value: string) =>
      world(
        entity('sensor.apartment_lock', value, { computed_at: new Date().toISOString() }),
        entity('lock.yale_bt', 'unlocked'),
        entity('lock.yale', 'locked')
      );
    show(HALLWAY, state('locked'));
    expect(document.querySelector('.room-ex .indicator.lock')?.closest('.is-hidden')).not.toBeNull();
    show(HALLWAY, state('unlocked'));
    expect(document.querySelector('.room-ex .indicator.lock')?.closest('.is-hidden') ?? null).toBeNull();
    show(HALLWAY, state('unknown'));
    expect(document.querySelector('.room-ex .indicator.lock')?.getAttribute('title')).toContain('unknown');
    expect(document.querySelector('.room-ex .indicator.lock i')?.getAttribute('data-icon')).toBe('mdi:lock-question');
  });

  it('opens the canonical lock chip as Yale operator visits, without heartbeat history', async () => {
    const fetchHistory = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        [
          { entity_id: 'sensor.yale_operator', state: 'Mikkel', last_changed: '2026-10-22T15:00:00+02:00' },
          { entity_id: 'sensor.yale_operator', state: 'Auto Lock', last_changed: '2026-10-22T15:03:00+02:00' },
        ],
      ],
    } as Response);
    try {
      show(
        HALLWAY,
        world(entity('sensor.apartment_lock', 'unlocked', { computed_at: new Date().toISOString() }), entity('lock.yale_bt', 'locked')),
        undefined,
        { hassUrl: 'https://ha.example' }
      );
      await act(async () => document.querySelector<HTMLElement>('.room-ex .indicator.lock')!.click());
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetchHistory.mock.calls[0][0])).searchParams.get('filter_entity_id')).toBe('sensor.yale_operator');
      expect(document.querySelectorAll('.timeline-event')).toHaveLength(1);
      expect(document.querySelector('.timeline-event')?.textContent).toContain('Mikkel');
      expect(document.querySelector('.timeline-yale-window')).not.toBeNull();
      expect(document.querySelector('[aria-label="Apartment lock timeline"]')).not.toBeNull();
    } finally {
      fetchHistory.mockRestore();
    }
  });

  it('keeps an open cooking history up when the power drops', () => {
    show(KITCHEN, world(entity('sensor.oven_plug_switch_0_power', '1500', { friendly_name: 'Oven' })));
    const oven = document.querySelector<HTMLElement>('.room-ex .indicator.power');
    expect(oven?.closest('.is-hidden') ?? null).toBeNull();
    act(() => oven!.click());
    expect(modalOpen()).toBe(true);

    show(KITCHEN, world(entity('sensor.oven_plug_switch_0_power', '3', { friendly_name: 'Oven' })));
    expect(modalOpen()).toBe(true);
  });

  it('never reads cooking power through the grid map', () => {
    const reads = new Set<string>();
    show(KITCHEN, world(entity('sensor.oven_plug_switch_0_power', '1500', { friendly_name: 'Oven' })), reads);
    show(KITCHEN, world(entity('sensor.oven_plug_switch_0_power', '3', { friendly_name: 'Oven' })), reads);
    expect([...reads].filter(id => id.includes('power'))).toEqual([]);
  });
});

describe('the to do badge', () => {
  const DINING: Area = { area_id: 'dining_room', name: 'Dining Room' };
  const NOW = Date.now();
  const due = (...rows: Record<string, string>[]) => parseHouseUpcoming({ expires: new Date(NOW + 600_000).toISOString(), rows }, NOW);
  const plant = { id: 'maint:plant:fig', kind: 'maint', title: 'Water the fig: 1 L', icon: 'mdi:watering-can-outline', audience: 'admin' };
  const badge = () => document.querySelector('.room-ex .indicator.todo');

  it('names what is due in the room with the icon of the row, in the corner the other states use', () => {
    show(DINING, world(), undefined, { todo: due(plant) });
    expect(badge()?.querySelector('i')?.getAttribute('data-icon')).toBe('mdi:watering-can-outline');
    expect(badge()?.getAttribute('aria-label')).toBe('Water the fig: 1 L');
    expect(badge()?.querySelector('.indicator-label')).toBeNull();
    expect(badge()?.closest('.is-hidden') ?? null).toBeNull();
    expect(document.querySelector<HTMLElement>('.room-card')?.style.getPropertyValue('--ex')).toBe('1');
  });

  it('is one badge with a count when several rows are due, in the icon of the first', () => {
    show(DINING, world(), undefined, {
      todo: due(plant, { ...plant, id: 'maint:plant:palm', title: 'Water the palm', icon: 'mdi:flower' }),
    });
    expect(document.querySelectorAll('.room-ex .indicator.todo')).toHaveLength(1);
    expect(badge()?.querySelector('i')?.getAttribute('data-icon')).toBe('mdi:watering-can-outline');
    expect(badge()?.querySelector('.indicator-label')?.textContent).toBe('2');
    expect(badge()?.getAttribute('aria-label')).toBe('2 things to do');
  });

  it('is not there when nothing is due, and the corner shows nothing', () => {
    show(DINING, world());
    expect(badge()).toBeNull();
    expect(document.querySelectorAll('.room-ex-item:not(.is-hidden)')).toHaveLength(0);
    expect(document.querySelector<HTMLElement>('.room-card')?.style.getPropertyValue('--ex')).toBe('0');
  });

  it('is part of the card: a tap on it opens the room', () => {
    const onClick = vi.fn();
    show(DINING, world(), undefined, { todo: due(plant), onClick });
    act(() => badge()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
