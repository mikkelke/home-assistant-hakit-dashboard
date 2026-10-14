// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events.json';
import { houseEpisodes, parseHouseEvents } from '../../../home/houseEvents';
import { archiveConnection } from '../../../utils/__tests__/archiveConnectionStub';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const { NowView } = await import('../NowView');

const rows = feed.attributes.events;
const rings = houseEpisodes(parseHouseEvents(rows)).filter(episode => episode.kind === 'ring');
/** The bridge's entry for the newest ring of the fixture, 13.10 14:51:12; the fixture's other rings have none here. */
const ARCHIVE = {
  images: [
    {
      ts: 1791895872,
      datetime: '2026-10-13T14:51:12+02:00',
      station: '100000002',
      door: 'front door',
      event_type: 'ring_auto_opened',
      filename: '',
      url: '',
      clip_filename: 'clip.mp4',
      clip_url: '/media/local/abb_doorbell/clip.mp4',
    },
  ],
};

let root: Root;
let openRoom: Mock<(areaId: string) => void>;
let ha: ReturnType<typeof archiveConnection>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(Date.parse('2026-10-13T13:30:00Z'));
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  ha = archiveConnection({ doorbell_archive_index: ARCHIVE });
  store.setState({
    entities: { 'sensor.house_events': { entity_id: 'sensor.house_events', state: 'x', attributes: { events: rows } } },
    connection: ha.connection,
  });
  openRoom = vi.fn<(areaId: string) => void>();
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function open(props: { arrival: 'cold' | 'warm'; itemId?: string }) {
  const first = rings[0];
  await act(async () => {
    root.render(
      createElement(NowView, {
        focus: props.itemId ? { kind: 'evt', epochS: Math.floor(first.startMs / 1000) } : null,
        itemId: props.itemId ?? null,
        arrival: props.arrival,
        onBack: () => {},
        onOpenRoom: openRoom,
      })
    );
  });
  await settle();
}

/** Lets the lazy sheet load, and its index read and signatures land. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
}

const sheet = () => document.querySelector('.doorbell-photo');
const ringRow = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"] .now-body`);

describe('a ring row on the timeline', () => {
  it('opens who rang instead of the hallway, with the clip waiting for a tap', async () => {
    await open({ arrival: 'cold' });
    expect(sheet()).toBeNull();
    const row = ringRow(rings[0].id);
    expect(row?.classList.contains('is-ring')).toBe(true);

    await act(async () => row!.click());
    await settle();
    expect(openRoom).not.toHaveBeenCalled();
    const video = sheet()?.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/media/local/abb_doorbell/clip.mp4?authSig=1#t=0.1');
    expect(video?.hasAttribute('autoplay')).toBe(false);
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(sheet()?.querySelector('.doorbell-tag')?.textContent).toBe('Opened');
  });

  it('says there is no photo for a ring the archive has no entry for', async () => {
    await open({ arrival: 'cold' });
    await act(async () => ringRow(rings[1].id)!.click());
    await settle();
    expect(sheet()?.querySelector('video')).toBeNull();
    expect(sheet()?.textContent).toContain('No photo for this ring');
  });

  it('leaves other rows opening their room', async () => {
    await open({ arrival: 'cold' });
    const washer = [...document.querySelectorAll<HTMLElement>('.now-body.is-link')].find(body => !body.classList.contains('is-ring'));
    await act(async () => washer!.click());
    expect(openRoom).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
  });

  it('opens with the sheet up when the app taps a ring on the way in, and not when Back returns to it', async () => {
    await open({ arrival: 'warm', itemId: rings[0].id });
    expect(sheet()?.querySelector('video')).not.toBeNull();
    act(() => root.unmount());
    document.body.innerHTML = '';
    root = createRoot(document.createElement('div'));
    await open({ arrival: 'cold', itemId: rings[0].id });
    expect(sheet()).toBeNull();
  });
});
