// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { home } from '../../../energy/__tests__/testUtils';
import feed from '../../../home/__tests__/fixtures/house-events-2026-10-13.json';
import { NOW_RESOLVE_GIVE_UP_MS } from '../../../home/nowResolve';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Entities = Record<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>;

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
vi.mock('home-assistant-js-websocket', () => ({ getUser: async () => ({ is_admin: true, name: 'Mikkel' }) }));

const { NowView } = await import('../NowView');

const rows = feed.attributes.events;
/** The washer finish a push names, 13.10 10:55:30.468, and the feed as it was a little before it. */
const FINISHED = rows.findIndex(row => row.text.startsWith('Washer finished'));
const FINISHED_MS = Date.parse(rows[FINISHED].ts);
const before = rows.slice(FINISHED + 1);

function houseEvents(events: unknown[]): Entities {
  return { 'sensor.house_events': { entity_id: 'sensor.house_events', state: 'x', attributes: { events } } };
}

let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(FINISHED_MS + 60_000);
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  store.setState({ entities: houseEvents(before), connection: {} });
  root = createRoot(document.createElement('div'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 }))
  );
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function open() {
  await act(async () => {
    root.render(
      createElement(NowView, {
        focus: { kind: 'washer', epochS: Math.floor(FINISHED_MS / 1000) },
        arrival: 'cold',
        onBack: () => {},
        onOpenRoom: () => {},
      })
    );
  });
}

const focused = () => document.querySelector('[data-focus]')?.getAttribute('data-focus') ?? null;
const missing = () => document.querySelector('[data-now-missing]') != null;

describe('a #now link opened before its feed row arrives', () => {
  it('waits for the row that lands after the view opens instead of saying it is gone', async () => {
    await open();
    expect(missing()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(500);
      store.setState({ entities: houseEvents(rows.slice(FINISHED)) });
    });
    expect(focused()).toBe(String(FINISHED_MS));
    expect(missing()).toBe(false);
  });

  it('says the event is gone once the wait is over', async () => {
    await open();
    await act(async () => {
      vi.advanceTimersByTime(NOW_RESOLVE_GIVE_UP_MS - 1);
    });
    expect(missing()).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(missing()).toBe(true);

    await act(async () => {
      store.setState({ entities: houseEvents(rows.slice(FINISHED)) });
    });
    expect(missing()).toBe(true);
    expect(focused()).toBeNull();
  });
});

describe('sun and quiet hours on the timeline', () => {
  const helpers = (start: string, end: string): Entities => ({
    'sun.sun': {
      entity_id: 'sun.sun',
      state: 'below_horizon',
      attributes: { next_rising: '2026-10-14T05:37:12+00:00', next_setting: '2026-10-14T16:13:29+00:00', elevation: -20 },
    },
    'input_datetime.quiet_hours_start': { entity_id: 'input_datetime.quiet_hours_start', state: start, attributes: {} },
    'input_datetime.quiet_hours_end': { entity_id: 'input_datetime.quiet_hours_end', state: end, attributes: {} },
  });

  async function openAt(nowMs: number, entities: Entities) {
    vi.setSystemTime(nowMs);
    store.setState({ entities });
    await act(async () => {
      root.render(createElement(NowView, { focus: null, arrival: 'cold', onBack: () => {}, onOpenRoom: () => {} }));
    });
  }

  const quietTag = () => document.querySelector('[data-now-quiet]')?.textContent ?? null;
  const markers = () => [...document.querySelectorAll('.now-ev.is-marker')].map(row => row.textContent);
  const days = () => [...document.querySelectorAll('.now-day')].map(day => day.textContent);

  it('marks quiet hours, sunrise and sunset after the NOW line, with nothing to press', async () => {
    await openAt(home(2026, 10, 13, 21, 0), helpers('22:00:00', '07:00:00'));
    expect(quietTag()).toBeNull();
    expect(markers()).toEqual(['22:00Quietuntil 07:00', '07:37Sunrise', '18:13Sunset']);
    expect(days()).toEqual(['Tomorrow']);
    expect(document.querySelector('.now-ev.is-marker button, .now-ev.is-marker [role]')).toBeNull();
  });

  it('tags the NOW line while quiet hours are on, and places no start behind it', async () => {
    await openAt(home(2026, 10, 13, 23, 0), helpers('22:00:00', '07:00:00'));
    expect(quietTag()).toBe('Quiet until 07:00');
    expect(markers()).toEqual(['07:37Sunrise', '18:13Sunset']);
    expect(document.querySelector('[data-row-id="quiet"]')).toBeNull();
  });

  it("keeps SonosNotifier's 22:00-07:00 while the helpers are unavailable", async () => {
    await openAt(home(2026, 10, 14, 0, 30), helpers('unavailable', 'unavailable'));
    expect(quietTag()).toBe('Quiet until 07:00');
  });

  it('states the announce setting, and when the ETA falls in quiet hours', async () => {
    const washer = (eta: string): Entities => ({
      ...helpers('22:00:00', '07:00:00'),
      'sensor.washer_state': {
        entity_id: 'sensor.washer_state',
        state: 'Running',
        attributes: { estimated_end_time: eta, progress_pct: 40, cycle_start_time: '2026-10-13T18:00:00Z' },
      },
      'input_boolean.washer_announce': { entity_id: 'input_boolean.washer_announce', state: 'on', attributes: {} },
    });
    const status = () => document.querySelector('.now-statuses')?.textContent ?? null;
    await openAt(home(2026, 10, 13, 21, 30), washer('22:30'));
    expect(status()).toBe('Finish announcements onETA in quiet hours');
    await act(async () => {
      store.setState({ entities: washer('21:50') });
    });
    expect(status()).toBe('Finish announcements on');
  });
});
