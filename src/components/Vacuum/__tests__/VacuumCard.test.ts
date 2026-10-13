// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROBOT_ENABLED_BOOLEAN_ENTITY, VACUUM_ENTITY } from '../../../config/entities';
import type { HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; hassUrl: string; connection: object };
  let state: State = { entities: {}, hassUrl: 'https://ha.example', connection: {} };
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
vi.mock('../maps', () => ({ fetchMapsIndex: async () => [], formatMapDate: () => '' }));
vi.mock('../../RoomGrid/RobotCleaningNarrativeTimeline', async () => {
  const { createElement } = await import('react');
  return {
    RobotCleaningNarrativeTimeline: ({ enabled }: { enabled: boolean }) => createElement('div', { 'data-story': String(enabled) }),
  };
});

const { VacuumCard } = await import('../VacuumCard');

const entities = {
  [VACUUM_ENTITY]: { entity_id: VACUUM_ENTITY, state: 'docked', attributes: {} },
  [ROBOT_ENABLED_BOOLEAN_ENTITY]: { entity_id: ROBOT_ENABLED_BOOLEAN_ENTITY, state: 'on', attributes: {} },
} as unknown as HassEntities;

let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline')))
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Rober2 card', () => {
  it("opens the robot's story from a door on the card, and Back closes it", async () => {
    await act(async () => root.render(createElement(VacuumCard, { entities, callService: undefined })));
    const top = document.querySelector<HTMLElement>('.rober-top');
    if (top?.getAttribute('aria-expanded') === 'false') await act(async () => top.click());
    const door = document.querySelector<HTMLButtonElement>('.rober-doors button[aria-label="Story"]');
    expect(door).not.toBeNull();

    await act(async () => door!.click());
    expect(document.querySelector('[role="dialog"][aria-label="Rober2 story"] [data-story="true"]')).not.toBeNull();

    await act(async () => void window.dispatchEvent(new CustomEvent('modalBackButton', { cancelable: true })));
    expect(document.querySelector('[aria-label="Rober2 story"]')).toBeNull();
  });
});
