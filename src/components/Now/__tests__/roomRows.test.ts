// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { home } from '../../../energy/__tests__/testUtils';
import feed from '../../../home/__tests__/fixtures/house-events.json';
import { archiveConnection } from '../../../utils/__tests__/archiveConnectionStub';
import type { MapEntry } from '../../Vacuum/maps';
import archive from '../../Vacuum/__tests__/fixtures/rober2-maps.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; areas: Record<string, unknown>; hassUrl: string; connection: object };
  let state: State = { entities: {}, areas: {}, hassUrl: '', connection: {} };
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
vi.mock('home-assistant-js-websocket', () => ({ getUser: async () => ({ is_admin: false, name: 'Claudia' }) }));

const { NowView } = await import('../NowView');

/** A Rober2 feed row as HouseEvents writes it, at a Copenhagen summer-time wall clock reading. */
const rober = (wall: string, cause: string, effect: string) => ({
  ts: `${wall}+02:00`,
  icon: 'mdi:robot-vacuum',
  text: `${cause} -> ${effect}`,
  cause,
  effect,
});
const start = (wall: string) => rober(wall, 'Nobody home', 'Vacuum starting its cleaning round');
const finish = (wall: string) => rober(wall, 'All queued rooms cleaned', 'Vacuum finished its round - heading to the dock');
const stop = (wall: string) => rober(wall, 'Someone came home', 'Vacuum stopped cleaning');

/** An index entry as the app writes it: wall clock time without an offset. */
const map = (room: string, wall: string): MapEntry => {
  const stamp = wall.slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
  return {
    filename: `rober2_map_${stamp}_${room}.png`,
    timestamp: stamp,
    datetime: wall,
    room,
    url: `/media/local/rober2_maps/x_${stamp}.png`,
  };
};

/** The fixture feed with the 14.10 round of the fixture index on top: 12.10, 13.10 and 14.10 each have a round. */
const FEED = [finish('2026-10-14T11:49:05.180'), start('2026-10-14T11:00:41.226'), ...feed.attributes.events];

let root: Root;
let openRoom: Mock<(areaId: string) => void>;
let ha: ReturnType<typeof archiveConnection>;

function setUp(events: unknown[], index: unknown) {
  ha = archiveConnection({ rober2_maps_index: index });
  store.setState({
    connection: ha.connection,
    entities: { 'sensor.house_events': { entity_id: 'sensor.house_events', state: 'x', attributes: { events } } },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(home(2026, 10, 14, 13, 0));
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  setUp(FEED, archive);
  openRoom = vi.fn<(areaId: string) => void>();
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Opens the timeline and lets the map index read, any lazy sheet and its signature land. */
async function open() {
  await act(async () => {
    root.render(createElement(NowView, { focus: null, itemId: null, arrival: 'cold', onBack: () => {}, onOpenRoom: openRoom }));
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      vi.advanceTimersByTime(0);
      await vi.dynamicImportSettled();
    });
  }
}

/** The past rows on the rail as `time text`, oldest first. */
const rail = () =>
  [...document.querySelectorAll<HTMLElement>('.now-ev.is-past')].map(row => {
    const room = row.classList.contains('is-room');
    return `${row.querySelector('.now-t')?.textContent} ${room ? row.querySelector('.now-chip-text')?.textContent : row.querySelector('.now-body')?.getAttribute('aria-label')}`;
  });
const roomRow = (name: string, nth = 0) =>
  [...document.querySelectorAll<HTMLElement>('.now-ev.is-room')].filter(
    row => row.querySelector('.now-chip-text')?.textContent === `${name} cleaned`
  )[nth];
const sheet = () => document.querySelector('.vacuum-map-modal');
const title = () => sheet()?.querySelector('.room')?.textContent;
const step = (label: string) => sheet()!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

describe('room rows of a Rober2 round', () => {
  it('stand between the start and finish rows of their round, one per room, at the Copenhagen time it was done', async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('Europe/Copenhagen');
    await open();
    const rows = rail();
    const from = rows.indexOf('10:06 Nobody home, Vacuum starting its cleaning round');
    expect(rows.slice(from, from + 7)).toEqual([
      '10:06 Nobody home, Vacuum starting its cleaning round',
      '10:11 Hallway cleaned',
      '10:18 Kitchen cook side cleaned',
      '10:27 Kitchen dining side cleaned',
      '10:43 Living room cleaned',
      '10:57 Dining room cleaned',
      '10:57 All queued rooms cleaned, Vacuum finished its round - heading to the dock',
    ]);
    expect(document.querySelectorAll('.now-ev.is-room')).toHaveLength(15);
    expect(document.querySelectorAll('.now-ev.in-round')).toHaveLength(3 * 7);
    expect(document.querySelector('.now-rooms, .now-room')).toBeNull();
    expect(ha.reads('rober2_maps_index')).toBe(1);
    expect(ha.signedPaths()).toEqual([]);
  });

  it('open their own map from the map button, step through that round only, and close on Back', async () => {
    await open();
    await act(async () => roomRow('Kitchen cook side', 1).querySelector<HTMLButtonElement>('.now-map')!.click());
    await settle();
    expect(openRoom).not.toHaveBeenCalled();
    expect(title()).toBe('Kitchen cook side');
    expect(sheet()?.querySelector('.date')?.textContent).toBe('Yesterday 10:18');
    expect(sheet()?.querySelector('img')?.getAttribute('src')).toBe(
      '/media/local/rober2_maps/rober2_map_20261013_101847_kitchen.png?authSig=1'
    );
    expect(sheet()?.querySelector('.vacuum-map-step-count')?.textContent).toBe('2 / 5');
    expect(history.state).toEqual({ modal: 'rober-session-map' });

    await act(async () => step('Next room').click());
    expect(title()).toBe('Kitchen dining side');
    expect(ha.signedPaths()).toEqual([
      '/media/local/rober2_maps/rober2_map_20261013_101847_kitchen.png',
      '/media/local/rober2_maps/rober2_map_20261013_102731_kitchen_2.png',
    ]);
    await act(async () => step('Previous room').click());
    await act(async () => step('Previous room').click());
    expect(title()).toBe('Hallway');
    expect(step('Previous room').disabled).toBe(true);

    await act(async () => void window.dispatchEvent(new CustomEvent('modalBackButton', { cancelable: true })));
    expect(sheet()).toBeNull();
    expect(document.querySelector('.now-view')).not.toBeNull();
  });

  it('open the room they lie in from the row itself', async () => {
    await open();
    await act(async () => roomRow('Kitchen dining side').querySelector<HTMLElement>('.now-body')!.click());
    expect(openRoom).toHaveBeenCalledWith('kitchen');
    expect(sheet()).toBeNull();
  });

  it('come with a round someone came home to, and give a room cleaned twice a row each time', async () => {
    setUp([stop('2026-10-14T12:10:00'), start('2026-10-14T11:20:00'), ...feed.attributes.events], {
      maps: [map('kitchen', '2026-10-14T11:55:00'), map('hallway', '2026-10-14T11:40:00'), map('kitchen', '2026-10-14T11:30:00')],
    });
    await open();
    expect(rail().slice(-5)).toEqual([
      '11:20 Nobody home, Vacuum starting its cleaning round',
      '11:30 Kitchen cook side cleaned',
      '11:40 Hallway cleaned',
      '11:55 Kitchen cook side cleaned',
      '12:10 Someone came home, Vacuum stopped cleaning',
    ]);
    await act(async () => roomRow('Kitchen cook side', 1).querySelector<HTMLButtonElement>('.now-map')!.click());
    await settle();
    expect(sheet()?.querySelector('.vacuum-map-step-count')?.textContent).toBe('3 / 3');
    expect(sheet()?.querySelector('.date')?.textContent).toBe('Today 11:55');
  });

  it('come while a round still runs, and leave stuck-robot snapshots out', async () => {
    setUp([start('2026-10-14T12:20:00'), ...feed.attributes.events], {
      maps: [map('stuck_in_the_hallway', '2026-10-14T12:41:00'), map('hallway', '2026-10-14T12:33:00')],
    });
    await open();
    expect(rail().slice(-2)).toEqual(['12:20 Nobody home, Vacuum starting its cleaning round', '12:33 Hallway cleaned']);
    expect(document.querySelectorAll('.now-ev.is-room')).toHaveLength(1);
  });

  it('stay away when the index has no maps after the oldest row or cannot be read', async () => {
    setUp(feed.attributes.events, { maps: archive.maps.filter(entry => entry.datetime < '2026-10-10') });
    await open();
    expect(document.querySelectorAll('.now-ev.is-room')).toHaveLength(0);
    expect(rail()).toContain('10:57 All queued rooms cleaned, Vacuum finished its round - heading to the dock');

    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    setUp(FEED, new Error('cat: Permission denied'));
    await open();
    expect(document.querySelectorAll('.now-ev.is-room')).toHaveLength(0);
  });
});
