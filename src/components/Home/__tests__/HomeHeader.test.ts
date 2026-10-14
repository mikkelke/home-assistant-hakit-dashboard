// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events.json';
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
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('home-assistant-js-websocket', () => ({ getUser: async () => ({ is_admin: false, name: 'Kristine' }) }));
vi.mock('../../Timeline', () => ({ LazyTimeline: () => null }));

const { HomeHeader } = await import('../HomeHeader');

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });
const person = (key: string, name: string, state: string) => entity(`person.${key}`, state, { friendly_name: name });
const sleepMode = (key: string, state: string) => entity(`input_boolean.${key}_sleep_mode`, state);
const events = (rows: unknown[]) => entity('sensor.house_events', 'x', { events: rows });

const PEOPLE = [person('mikkel', 'Mikkel', 'home'), person('kristine', 'Kristine', 'home'), person('claudia', 'Claudia', 'home')];

function world(...entities: ReturnType<typeof entity>[]): HassEntities {
  return Object.fromEntries(entities.map(e => [e.entity_id, e]));
}

/** The map Dashboard hands the header, recording every entity read through it, as its tracker does. */
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

async function show(entities: HassEntities, onOpenNow = vi.fn()) {
  const reads = new Set<string>();
  store.setState({ entities, connection: {} });
  await act(async () => {
    root.render(createElement(HomeHeader, { entities: tracked(entities, reads), hassUrl: null, onMenu: () => {}, onOpenNow }));
  });
  return reads;
}

const groundLine = () => [...document.querySelector('.sky .sky-ground-line')!.children].map(child => child.className);

describe('the sky ground line', () => {
  it('holds the people, a divider and the newest events, newest first', async () => {
    const reads = await show(world(events(feed.attributes.events), ...PEOPLE));
    expect(groundLine()).toEqual(['sky-people', 'ticker-divider', 'ticker']);
    expect([...document.querySelectorAll('.sky .ticker-chip')].map(chip => chip.getAttribute('aria-label'))).toEqual([
      'The door was opened for them, 14:51',
      'Washer emptied, 13:37',
      'Washer finished - used 0.82 kWh, 13:37',
    ]);
    expect(document.querySelectorAll('.ticker').length).toBe(1);
    expect(document.querySelector('.ticker-history, .sky-suntime')).toBeNull();
    expect([...reads]).not.toContain('sensor.house_events');
  });

  it('opens the timeline at a tapped event', async () => {
    const onOpenNow = vi.fn();
    await show(world(events(feed.attributes.events), ...PEOPLE), onOpenNow);
    act(() => document.querySelector<HTMLElement>('.sky .ticker-chip')!.click());
    const ringMs = Date.parse('2026-10-13T14:51:12.742031+02:00');
    expect(onOpenNow).toHaveBeenCalledExactlyOnceWith({ kind: 'evt', epochS: Math.floor(ringMs / 1000) }, String(ringMs));
  });

  it('leaves the ground to the people without events', async () => {
    await show(world(events([]), ...PEOPLE));
    expect(groundLine()).toEqual(['sky-people']);
  });
});

describe('avatar looks', () => {
  /** Each avatar's state classes in `scope`, by name. */
  function looks(scope: string): Record<string, string[]> {
    return Object.fromEntries(
      [...document.querySelectorAll(`${scope} .sky-av-slot`)].map(slot => [
        slot.getAttribute('aria-label')!.split(',')[0],
        [...slot.querySelector('.sky-av')!.classList].filter(name => name.startsWith('is-')),
      ])
    );
  }

  it('shows a sleeper asleep and never away, in the sky and the strip', async () => {
    await show(
      world(
        person('mikkel', 'Mikkel', 'home'),
        sleepMode('mikkel', 'on'),
        person('kristine', 'Kristine', 'not_home'),
        sleepMode('kristine', 'off'),
        person('claudia', 'Claudia', 'not_home'),
        sleepMode('claudia', 'on')
      )
    );
    for (const scope of ['.sky', '.sky-strip']) {
      expect(looks(scope)).toEqual({ Mikkel: ['is-asleep'], Kristine: ['is-away'], Claudia: ['is-asleep'] });
      expect(document.querySelectorAll(`${scope} .is-asleep .sky-av-zz`).length).toBe(2);
      expect(document.querySelector(`${scope} .is-away .sky-av-zz, ${scope} .is-away .sky-av-dot`)).toBeNull();
    }
  });
});
