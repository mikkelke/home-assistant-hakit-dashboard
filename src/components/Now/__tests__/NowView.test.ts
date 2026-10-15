// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { home } from '../../../energy/__tests__/testUtils';
import feed from '../../../home/__tests__/fixtures/house-events.json';
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
vi.mock('@iconify/react', async () => {
  const { createElement } = await import('react');
  return { Icon: ({ icon, className }: { icon: string; className?: string }) => createElement('i', { 'data-icon': icon, className }) };
});
/** The HA user the viewer lookup returns; a new `connection` object makes the next view look it up again. */
const user = vi.hoisted(() => ({ current: { is_admin: true, name: 'Mikkel' } }));
vi.mock('home-assistant-js-websocket', () => ({ getUser: async () => user.current }));

const { NowView } = await import('../NowView');

const rows = feed.attributes.events;
/** The washer finish a push names, 13.10 13:37:44.605, and the feed as it was a little before it. */
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
  user.current = { is_admin: true, name: 'Mikkel' };
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

describe('the running appliance card', () => {
  const washer = (attributes: Record<string, unknown> = {}): Entities => ({
    'sensor.washer_state': {
      entity_id: 'sensor.washer_state',
      state: 'Running',
      attributes: { estimated_end_time: '21:50', progress_pct: 40, cycle_start_time: '2026-10-13T18:00:00Z', ...attributes },
    },
  });
  const subline = () => document.querySelector('.now-card.is-run small')?.textContent ?? null;

  async function openWith(entities: Entities) {
    vi.setSystemTime(home(2026, 10, 13, 21, 0));
    store.setState({ entities });
    await act(async () => {
      root.render(createElement(NowView, { focus: null, arrival: 'cold', onBack: () => {}, onOpenRoom: () => {} }));
    });
  }

  it('names who started it when the attribution is reliable', async () => {
    await openWith(washer({ started_by: 'claudia', started_by_method: 'sole_occupant' }));
    expect(subline()).toBe('since 20:00 · Claudia · 40 %');
  });

  it('names nobody without a reliable attribution, and the name follows the attributes', async () => {
    await openWith(washer());
    expect(subline()).toBe('since 20:00 · 40 %');
    await act(async () => {
      store.setState({ entities: washer({ started_by: 'claudia', started_by_method: 'unknown' }) });
    });
    expect(subline()).toBe('since 20:00 · 40 %');
    await act(async () => {
      store.setState({ entities: washer({ started_by: 'claudia', started_by_method: 'sole_occupant' }) });
    });
    expect(subline()).toBe('since 20:00 · Claudia · 40 %');
  });
});

describe('a maintenance row with a sheet', () => {
  const NOW = home(2026, 10, 14, 7, 0);
  const iso = (ms: number) => new Date(ms).toISOString();
  const TAPPED = {
    id: 'maint:dishwasher:filters',
    kind: 'maint',
    at: iso(home(2026, 12, 27, 9, 0)),
    icon: 'mdi:dishwasher',
    title: 'Dishwasher filters + spray arms',
    detail: 'rinse filter + arms, 30 runs left, ~27.12',
    area: 'kitchen',
    audience: 'admin',
    done: 'tap',
    info: ['Every 30 runs (~2 months)', 'Counting from 14.10'],
    steps: ['Switch the dishwasher off.', 'Rinse the filters under running water.'],
    warn: 'Never run the dishwasher without the filters.',
  };
  const GUIDE_ONLY = {
    id: 'maint:washer:drum',
    kind: 'maint',
    icon: 'mdi:washing-machine',
    title: 'Washer drum + drawer clean',
    detail: 'Bomuld 90, empty + a little powder, due, last unknown',
    area: 'guest_bathroom',
    audience: 'admin',
    steps: ['Pull the plug.', 'Start Bomuld 90 C with an empty drum.'],
  };
  const BATTERY = {
    id: 'maint:battery:sensor.ecowitt_battery_8351',
    kind: 'maint',
    icon: 'mdi:battery-alert-variant-outline',
    title: 'Roof weather station',
    detail: 'replace, 2x AA',
    area: 'rooftop',
    audience: 'admin',
  };
  const upcoming = (...rows: unknown[]): Entities => ({
    'sensor.house_upcoming': {
      entity_id: 'sensor.house_upcoming',
      state: iso(NOW),
      attributes: { expires: iso(NOW + 10 * 60_000), rows },
    },
    'sun.sun': {
      entity_id: 'sun.sun',
      state: 'above_horizon',
      attributes: { next_rising: '2026-10-15T05:39:15+00:00', next_setting: '2026-10-14T16:13:29+00:00' },
    },
  });

  async function openAs(isAdmin: boolean, ...rows: unknown[]) {
    user.current = { is_admin: isAdmin, name: isAdmin ? 'Mikkel' : 'Kristine' };
    vi.setSystemTime(NOW);
    const opened: string[] = [];
    const send = vi.fn(() => Promise.resolve(null));
    store.setState({ entities: upcoming(...rows), connection: { sendMessagePromise: send } });
    await act(async () => {
      root.render(
        createElement(NowView, {
          key: `${isAdmin}`,
          focus: null,
          arrival: 'cold',
          onBack: () => {},
          onOpenRoom: areaId => opened.push(areaId),
        })
      );
    });
    return { opened, send };
  }

  const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-row-id="${id}"] button`);
  const sheet = () => document.querySelector('.maint-sheet');
  const sheetText = () => document.querySelector('.maint-body')?.textContent ?? '';

  it('opens the sheet of a tapped row instead of its room', async () => {
    const { opened } = await openAs(true, TAPPED, BATTERY);
    expect(sheet()).toBeNull();
    await act(async () => row(TAPPED.id)?.click());
    expect(sheet()).not.toBeNull();
    expect(opened).toEqual([]);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Dishwasher filters + spray arms');
    expect(sheetText()).toContain('rinse filter + arms, 30 runs left, ~27.12');
    expect(sheetText()).toContain('Done');
  });

  it('still opens the room of a maintenance row that has no sheet', async () => {
    const { opened } = await openAs(true, TAPPED, BATTERY);
    await act(async () => row(BATTERY.id)?.click());
    expect(opened).toEqual(['rooftop']);
    expect(sheet()).toBeNull();
  });

  it('opens a guide without a Done button for a row that is closed some other way, and it opens the room from there', async () => {
    const { opened } = await openAs(true, GUIDE_ONLY);
    await act(async () => row(GUIDE_ONLY.id)?.click());
    expect(sheet()).not.toBeNull();
    expect([...document.querySelectorAll('.maint-body button')].map(button => button.textContent)).toEqual(['How to', 'Open room']);
    await act(async () => document.querySelector<HTMLButtonElement>('.maint-body .maint-btn')?.click());
    expect(opened).toEqual(['guest_bathroom']);
  });

  it('fires the Done event for the row it was opened on', async () => {
    const { send } = await openAs(true, TAPPED);
    await act(async () => row(TAPPED.id)?.click());
    const press = async (label: string) =>
      act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('.maint-body button')]
          .find(button => button.textContent?.includes(label))
          ?.click();
      });
    await press('Done');
    await press('Yes, done');
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'fire_event',
      event_type: 'house_upcoming_done',
      event_data: { row: 'maint:dishwasher:filters' },
    });
  });

  it('follows the row when it changes and closes with it when it is gone', async () => {
    await openAs(true, TAPPED);
    await act(async () => row(TAPPED.id)?.click());
    await act(async () => {
      store.setState({
        entities: upcoming({ ...TAPPED, detail: 'rinse filter + arms, 30 runs left, ~14.12', info: ['Done 14.10, no runs since'] }),
      });
    });
    expect(sheetText()).toContain('~14.12');
    expect(sheetText()).toContain('Done 14.10, no runs since');
    await act(async () => {
      store.setState({ entities: upcoming(BATTERY) });
    });
    expect(sheet()).toBeNull();
  });

  it('is never reached by a housemate, who does not see the row', async () => {
    await openAs(false, TAPPED, GUIDE_ONLY);
    expect(row(TAPPED.id)).toBeNull();
    expect(row(GUIDE_ONLY.id)).toBeNull();
    expect(sheet()).toBeNull();
  });
});

describe('rows from sensor.house_upcoming', () => {
  const NOW = home(2026, 10, 14, 7, 0);
  const iso = (ms: number) => new Date(ms).toISOString();
  const upcoming = (expiresMs: number): Entities => ({
    'sensor.house_upcoming': {
      entity_id: 'sensor.house_upcoming',
      state: iso(NOW),
      attributes: {
        expires: iso(expiresMs),
        rows: [
          {
            id: 'train:kristine',
            kind: 'train',
            at: iso(home(2026, 10, 14, 7, 46)),
            icon: 'mdi:train',
            title: 'Train to Odense',
            detail: '07:46, 08:02 +5',
            chip: 'S-tog delayed',
            audience_users: ['Kristine'],
          },
          {
            id: 'rain:terrace',
            kind: 'rain',
            at: iso(home(2026, 10, 14, 9, 0)),
            icon: 'mdi:weather-pouring',
            title: 'Rain forecast',
            detail: 'living-room terrace door open',
            area: 'living_room',
          },
          {
            id: 'maint:battery:sensor.ecowitt_battery_8351',
            kind: 'maint',
            icon: 'mdi:battery-alert-variant-outline',
            title: 'Roof weather station',
            detail: 'replace, 2x AA',
            area: 'rooftop',
            audience: 'admin',
          },
        ],
      },
    },
    'sun.sun': {
      entity_id: 'sun.sun',
      state: 'above_horizon',
      attributes: { next_rising: '2026-10-15T05:39:15+00:00', next_setting: '2026-10-14T16:13:29+00:00' },
    },
  });

  async function openAs(name: string, isAdmin: boolean, props: { itemId?: string } = {}, expiresMs = NOW + 10 * 60_000) {
    user.current = { is_admin: isAdmin, name };
    vi.setSystemTime(NOW);
    const opened: string[] = [];
    store.setState({ entities: upcoming(expiresMs), connection: {} });
    await act(async () => {
      root.render(
        createElement(NowView, {
          key: `${name}:${props.itemId ?? ''}`,
          focus: null,
          itemId: props.itemId ?? null,
          arrival: 'cold',
          onBack: () => {},
          onOpenRoom: areaId => opened.push(areaId),
        })
      );
    });
    return opened;
  }

  const cards = () =>
    [...document.querySelectorAll('.now-ev:not(.is-marker):not(.is-past) .now-card')].map(card => ({
      label: card.getAttribute('aria-label'),
      restricted: card.querySelector('.now-adm') != null,
    }));

  it('shows Mikkel every card, the restricted ones marked', async () => {
    await openAs('Mikkel', true);
    expect(cards()).toEqual([
      { label: 'Train to Odense, 07:46, 08:02 +5, S-tog delayed', restricted: true },
      { label: 'Rain forecast, living-room terrace door open', restricted: false },
      { label: 'Roof weather station, replace, 2x AA', restricted: true },
    ]);
  });

  it('shows Kristine her train and the rain, and Claudia only the rain', async () => {
    await openAs('Kristine', false);
    expect(cards().map(card => card.label?.split(',')[0])).toEqual(['Train to Odense', 'Rain forecast']);
    await openAs('Claudia', false);
    expect(cards().map(card => card.label?.split(',')[0])).toEqual(['Rain forecast']);
  });

  it('opens the room of a tapped card and leaves cards without a room untappable', async () => {
    const opened = await openAs('Mikkel', true);
    const rain = document.querySelector<HTMLButtonElement>('[data-row-id="rain:terrace"] button');
    await act(async () => rain?.click());
    expect(opened).toEqual(['living_room']);
    expect(document.querySelector('[data-row-id="train:kristine"] button')).toBeNull();
  });

  it('drops every card once the lease has run out', async () => {
    await openAs('Mikkel', true, {}, NOW + 60_000);
    expect(cards()).toHaveLength(3);
    await act(async () => {
      vi.setSystemTime(NOW + 90_000);
      vi.advanceTimersByTime(30_000);
    });
    expect(cards()).toEqual([]);
  });

  it('opens on the exact row the next chip names, a marker included', async () => {
    await openAs('Kristine', false, { itemId: 'train:kristine' });
    expect(focused()).toBe('train:kristine');
    await openAs('Claudia', false, { itemId: 'sun:set' });
    expect(focused()).toBe('sun:set');
    expect(missing()).toBe(false);
  });

  it('says the row is gone when the one the chip named has vanished', async () => {
    await openAs('Claudia', false, { itemId: 'train:kristine' });
    expect(focused()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(NOW_RESOLVE_GIVE_UP_MS);
    });
    expect(missing()).toBe(true);
  });
});
