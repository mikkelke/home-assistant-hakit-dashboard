// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';

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

const { useSky } = await import('../useSky');

const RAINING = 'binary_sensor.raining';
const RATE = 'sensor.gw2000a_rain_rate_piezo';
const PIEZO = 'binary_sensor.gw2000a_rain_state_piezo';

const entity = (entity_id: string, state: string) => ({ entity_id, state, attributes: {} });
const world = (...entities: ReturnType<typeof entity>[]): HassEntities => Object.fromEntries(entities.map(e => [e.entity_id, e]));

let root: Root;
let raining: boolean | null;

function Probe() {
  const { raining: now } = useSky();
  useEffect(() => {
    raining = now;
  });
  return null;
}

beforeEach(() => {
  raining = null;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ entities: {} });
});

async function sky(entities: HassEntities) {
  store.setState({ entities });
  await act(async () => {
    root.render(createElement(Probe));
  });
  return raining;
}

describe('useSky raining', () => {
  it('follows binary_sensor.raining, whatever the station rate says', async () => {
    expect(await sky(world(entity(RAINING, 'on'), entity(RATE, '0.0')))).toBe(true);
  });

  it('stays dry while the flag is off, however the station rate or piezo contact read', async () => {
    expect(await sky(world(entity(RAINING, 'off'), entity(RATE, '5.4'), entity(PIEZO, 'on')))).toBe(false);
  });

  it('is dry while the flag is missing or unreadable', async () => {
    expect(await sky(world(entity(RATE, '5.4'), entity(PIEZO, 'on')))).toBe(false);
    for (const state of ['unavailable', 'unknown']) {
      store.setState({ entities: world(entity(RAINING, state)) });
      await act(async () => {});
      expect(raining).toBe(false);
    }
  });

  it('changes as the flag changes', async () => {
    expect(await sky(world(entity(RAINING, 'off')))).toBe(false);
    store.setState({ entities: world(entity(RAINING, 'on')) });
    await act(async () => {});
    expect(raining).toBe(true);
    store.setState({ entities: world(entity(RAINING, 'off')) });
    await act(async () => {});
    expect(raining).toBe(false);
  });
});
