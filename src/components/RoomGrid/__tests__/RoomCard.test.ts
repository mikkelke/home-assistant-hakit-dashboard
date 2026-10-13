// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Area, HassEntities } from '../../../types';

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
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../../Timeline', () => ({ LazyTimeline: () => null }));

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

function show(area: Area, entities: HassEntities, reads = new Set<string>()) {
  store.setState({ entities });
  act(() => {
    root.render(createElement(RoomCard, { area, entities: tracked(entities, reads), onClick: () => {}, isSelected: false, hassUrl: null }));
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
