// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CallServiceFunction, HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { connection: object | null };
  let state: State = { connection: null };
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
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }), loadIcons: () => {} };
});
vi.mock('home-assistant-js-websocket', () => ({ getUser: () => Promise.resolve({ is_admin: true, name: 'Mikkel' }) }));

const { SonosPlayer } = await import('../SonosPlayer');

const KITCHEN = 'media_player.kitchen';
const PHONE = 'media_player.mikkels_phone';
const TRACK = 'spotify://track/strong';
const NEXT_TRACK = 'spotify://track/snowfall';
const START = Date.parse('2026-10-16T10:00:00Z');

type Report = { state?: string; position?: number; anchorMs?: number; item?: string };

/** What Home Assistant reports for the kitchen speaker, with the position anchored at `anchorMs` (now unless given). */
const report = ({ state = 'playing', position = 100, anchorMs = Date.now(), item = TRACK }: Report = {}): HassEntities => ({
  [KITCHEN]: {
    entity_id: KITCHEN,
    state,
    attributes: {
      source_list: [],
      group_members: [KITCHEN],
      media_title: 'Strong',
      media_content_id: item,
      media_duration: 275,
      media_position: position,
      media_position_updated_at: new Date(anchorMs).toISOString(),
    },
  },
});

let root: Root;
let callService: Mock<CallServiceFunction>;

beforeEach(() => {
  vi.useFakeTimers({ now: START, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  callService = vi.fn<CallServiceFunction>();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ connection: null });
  vi.useRealTimers();
});

const show = (entities: HassEntities) =>
  act(() => {
    root.render(createElement(SonosPlayer, { entityId: KITCHEN, entities, hassUrl: 'https://ha.example', callService, embedded: true }));
  });

const later = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const seeker = () => document.querySelector<HTMLInputElement>('input[aria-label="Seek position"]') as HTMLInputElement;
const setThumb = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
  this: HTMLInputElement,
  value: string
) => void;

const drag = (seconds: number) =>
  act(() => {
    setThumb.call(seeker(), String(seconds));
    seeker().dispatchEvent(new Event('input', { bubbles: true }));
  });
const release = (type: 'mouseup' | 'touchend' = 'mouseup') => act(() => void seeker().dispatchEvent(new Event(type, { bubbles: true })));

const thumb = () => Number(seeker().value);
const label = () => document.querySelector('.sonos-seek-times span')?.textContent;
const playButton = () => document.querySelector('.sonos-tbtn--main')?.getAttribute('aria-label');
const seeks = () => callService.mock.calls.map(([call]) => call.serviceData?.seek_position);

/** A card that has been playing for ten seconds on an anchor `position` seconds into the track. */
function playingFor10s(position = 100) {
  show(report({ position, anchorMs: START }));
  later(10_000);
}

describe('a released seek', () => {
  it('stays where the viewer let go while Home Assistant has not reported it yet', () => {
    playingFor10s();
    expect(thumb()).toBe(110);
    drag(200);
    release();
    expect(seeks()).toEqual([200]);
    expect(thumb()).toBe(200);
    expect(label()).toBe('3:20');
    later(1000);
    expect(thumb()).toBe(200);
  });

  it('ignores a shifted position and the stop while Music Assistant builds the new stream', () => {
    playingFor10s(150);
    drag(30);
    release();

    later(300);
    show(report({ position: 30 }));
    expect(thumb()).toBe(30);

    later(130);
    show(report({ position: 42 }));
    expect(thumb()).toBe(30);
    expect(label()).toBe('0:30');

    later(870);
    show(report({ state: 'idle', position: 30 }));
    expect(thumb()).toBe(30);

    later(200);
    show(report({ position: 30, anchorMs: Date.now() - 200 }));
    expect(thumb()).toBe(30);
  });

  it('hands over to the player once the settle time has passed and it reports the position', () => {
    playingFor10s();
    drag(200);
    release();
    later(300);
    show(report({ position: 200 }));
    later(1000);
    show(report({ position: 200 }));
    later(1000);
    expect(thumb()).toBe(200);
    later(1000);
    expect(thumb()).toBeCloseTo(202, 5);
  });

  it('is held beyond the settle time while the player has not reported a new position', () => {
    playingFor10s();
    drag(200);
    release();
    later(5000);
    expect(thumb()).toBe(200);
  });

  it('is held while the player reports positions that are not the sought one', () => {
    playingFor10s();
    drag(55);
    release();
    later(500);
    drag(110);
    release();
    expect(seeks()).toEqual([55, 110]);

    later(300);
    show(report({ position: 234 }));
    later(1000);
    show(report({ position: 55 }));
    later(3000);
    expect(thumb()).toBe(110);

    show(report({ position: 110 }));
    later(1000);
    expect(thumb()).toBeCloseTo(111, 5);
  });

  it('is dropped after ten seconds when the player never reports it', () => {
    playingFor10s();
    drag(200);
    release();
    later(9000);
    expect(thumb()).toBe(200);
    later(1000);
    expect(thumb()).toBe(120);
  });

  it('is dropped when the player moves on to another track', () => {
    playingFor10s();
    drag(270);
    release();
    later(500);
    show(report({ item: NEXT_TRACK, position: 0 }));
    expect(thumb()).toBe(0);
  });

  it('is sent once for a touch release and the mouse release that follows it', () => {
    playingFor10s();
    drag(200);
    release('touchend');
    release('mouseup');
    expect(seeks()).toEqual([200]);
  });

  it('is not sent when the thumb was not moved', () => {
    playingFor10s();
    release('touchend');
    release('mouseup');
    expect(seeks()).toEqual([]);
    expect(thumb()).toBe(110);
  });

  it('keeps the pause button while the stream is rebuilt', () => {
    playingFor10s();
    drag(200);
    release();
    expect(playButton()).toBe('Pause');
    later(1500);
    show(report({ state: 'idle', position: 200 }));
    expect(playButton()).toBe('Pause');
    later(200);
    show(report({ position: 200 }));
    expect(playButton()).toBe('Pause');
  });

  it('does not make a stopped player look as if it were playing', () => {
    show(report({ state: 'idle', position: 100 }));
    expect(playButton()).toBe('Play');
    drag(200);
    release();
    expect(playButton()).toBe('Play');
  });

  it('keeps the move-to-phone button while the stream is rebuilt', async () => {
    store.setState({ connection: {} });
    const phone = { [PHONE]: { entity_id: PHONE, state: 'idle', attributes: {} } };
    show({ ...report({ position: 100, anchorMs: START }), ...phone });
    await act(async () => {});
    expect(document.querySelector('[aria-label="Move to this phone"]')).not.toBeNull();
    drag(200);
    release();
    later(1500);
    show({ ...report({ state: 'idle', position: 200 }), ...phone });
    expect(document.querySelector('[aria-label="Move to this phone"]')).not.toBeNull();
  });
});
