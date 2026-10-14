// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events-2026-10-13.json';
import { houseEpisodes, parseHouseEvents } from '../../../home/houseEvents';
import archive from '../../Vacuum/__tests__/fixtures/rober2-maps-2026-10-14.json';

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

const episodes = houseEpisodes(parseHouseEvents(feed.attributes.events));
const finishOf = (iso: string) => episodes.find(episode => episode.startMs === Date.parse(iso))!.id;
const LATEST = finishOf('2026-10-13T08:41:47.432+02:00');
const EARLIER = finishOf('2026-10-12T11:41:37.244+02:00');

let root: Root;
let openRoom: Mock<(areaId: string) => void>;
let fetchMock: Mock<(url: string) => Promise<Response>>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(Date.parse('2026-10-13T13:30:00Z'));
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/rober2_maps/index.json') ? new Response(JSON.stringify(archive), { status: 200 }) : new Response('', { status: 404 })
  );
  vi.stubGlobal('fetch', fetchMock);
  store.setState({
    entities: { 'sensor.house_events': { entity_id: 'sensor.house_events', state: 'x', attributes: { events: feed.attributes.events } } },
    areas: { kitchen: { area_id: 'kitchen', icon: 'mdi:chef-hat' }, hallway: { area_id: 'hallway', icon: 'mdi:door' } },
  });
  openRoom = vi.fn<(areaId: string) => void>();
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Opens the timeline and lets the map index fetch, and any lazy sheet, land. */
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

const chips = (id: string) => [...document.querySelectorAll<HTMLButtonElement>(`[data-row-id="${id}"] .now-room`)];
const sheet = () => document.querySelector('.vacuum-map-modal');
const title = () => sheet()?.querySelector('.room')?.textContent;
const step = (label: string) => sheet()!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

describe('room chips on a Rober2 finish row', () => {
  it('name each room the round cleaned, in cleaning order, with its area icon', async () => {
    await open();
    const latest = chips(LATEST);
    expect(latest.map(chip => chip.textContent)).toEqual([
      'Hallway',
      'Kitchen cook side',
      'Kitchen dining side',
      'Living room',
      'Dining room',
    ]);
    expect(latest.map(chip => chip.querySelector('i')?.dataset.icon)).toEqual([
      'mdi:door',
      'mdi:chef-hat',
      'mdi:chef-hat',
      'mdi:map-outline',
      'mdi:map-outline',
    ]);
    expect(chips(EARLIER)).toHaveLength(5);
    expect(document.querySelectorAll('.now-room')).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('open the tapped room map over the timeline, step through the round, and close on Back', async () => {
    await open();
    await act(async () => chips(LATEST)[1].click());
    await settle();
    expect(openRoom).not.toHaveBeenCalled();
    expect(title()).toBe('Kitchen cook side');
    expect(sheet()?.querySelector('.date')?.textContent).toBe('Today 08:01');
    expect(sheet()?.querySelector('img')?.getAttribute('src')).toMatch(/rober2_map_20261013_080153_kitchen\.png$/);
    expect(sheet()?.querySelector('.vacuum-map-step-count')?.textContent).toBe('2 / 5');
    expect(history.state).toEqual({ modal: 'rober-session-map' });

    await act(async () => step('Next room').click());
    expect(title()).toBe('Kitchen dining side');
    await act(async () => step('Previous room').click());
    await act(async () => step('Previous room').click());
    expect(title()).toBe('Hallway');
    expect(step('Previous room').disabled).toBe(true);

    await act(async () => void window.dispatchEvent(new CustomEvent('modalBackButton', { cancelable: true })));
    expect(sheet()).toBeNull();
    expect(document.querySelector('.now-view')).not.toBeNull();
  });

  it('leave the row itself opening the kitchen', async () => {
    await open();
    await act(async () => document.querySelector<HTMLElement>(`[data-row-id="${LATEST}"] .now-body`)!.click());
    expect(openRoom).toHaveBeenCalledWith('kitchen');
    expect(sheet()).toBeNull();
  });

  it('stay away when the index has no maps for the round or cannot be read', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ maps: archive.maps.slice(0, 5) }), { status: 200 }));
    await open();
    expect(document.querySelectorAll('.now-room')).toHaveLength(0);

    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    await open();
    expect(document.querySelectorAll('.now-room')).toHaveLength(0);
  });
});
