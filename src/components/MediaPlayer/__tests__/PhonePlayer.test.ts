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

const { PhonePlayer } = await import('../PhonePlayer');
type MoveTarget = import('../PhonePlayer').MoveTarget;

const PHONE = 'media_player.mikkels_phone';
const EPISODE = 'dr_podcasts://podcast_episode/https://podcasts.example/show/feed.xml https://podcasts.example/show/episodes/7';
const DR_P3 = 'builtin://radio/https://drliveradio2.akamaized.net/hls/live/2118698/p3/playlist-320000.m3u8';

const TARGETS: MoveTarget[] = [
  { entityId: 'media_player.bedroom', name: 'Bedroom', groupSize: 1 },
  { entityId: 'media_player.kitchen', name: 'Kitchen', groupSize: 3 },
];

let root: Root;
let callService: Mock<CallServiceFunction>;
let tapped: Array<[string, string | undefined]>;

beforeEach(() => {
  callService = vi.fn<CallServiceFunction>();
  tapped = [];
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ connection: null });
});

/** What Home Assistant reports for the phone's Music Assistant player: no volume, and an empty group. */
const phone = (attributes: Record<string, unknown> = {}, state = 'playing'): HassEntities => ({
  [PHONE]: {
    entity_id: PHONE,
    state,
    attributes: {
      group_members: [],
      media_content_type: 'music',
      app_id: 'music_assistant',
      source: 'Music Assistant Queue',
      icon: 'mdi:cellphone',
      friendly_name: 'Mikkels phone',
      ...attributes,
    },
  },
});

const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

async function show(entities: HassEntities, targets: readonly MoveTarget[] = TARGETS) {
  await act(async () => {
    root.render(
      createElement(PhonePlayer, {
        entityId: PHONE,
        entities,
        hassUrl: 'https://ha.example',
        callService,
        targets,
        onUiTap: (action: string, detail?: string) => tapped.push([action, detail]),
      })
    );
  });
  await settle();
}

const pick = (selector: string) => document.querySelector<HTMLElement>(selector);
const text = (selector: string) => pick(selector)?.textContent ?? null;
const click = (selector: string) => act(async () => pick(selector)?.click());
const calls = () => callService.mock.calls.map(([call]) => call);
const setThumb = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
  this: HTMLInputElement,
  value: string
) => void;

const episode = { media_content_id: EPISODE, media_title: 'Et afsnit', media_album_name: 'Et program' };

describe('what plays on the phone', () => {
  it('shows the title, with the artist or else the show beneath it', async () => {
    await show(phone(episode));
    expect(text('.sonos-track-title')).toBe('Et afsnit');
    expect(text('.sonos-track-sub')).toBe('Et program');
    await show(phone({ ...episode, media_artist: 'Nogen' }));
    expect(text('.sonos-track-sub')).toBe('Nogen');
  });

  it('shows the artwork Home Assistant serves, and none from elsewhere', async () => {
    await show(phone({ ...episode, entity_picture_local: '/api/media_player_proxy/media_player.mikkels_phone?token=t' }));
    expect(pick('.sonos-art img')?.getAttribute('src')).toBe(
      'https://ha.example/api/media_player_proxy/media_player.mikkels_phone?token=t'
    );
    await show(phone({ ...episode, entity_picture: 'https://tracker.example/pixel.png' }));
    expect(pick('.sonos-art img')).toBeNull();
    expect(pick('.sonos-art-placeholder [data-icon="mdi:music"]')).not.toBeNull();
  });

  it('names a DR stream and a library station by the channel, with the logo from the library', async () => {
    store.setState({
      connection: {
        sendMessagePromise: async () => [
          {
            uri: 'library://radio/13',
            name: 'DR P3',
            favorite: false,
            metadata: { images: [{ proxy_id: 'dr13proxy' }] },
          },
        ],
      },
    });
    await show(phone({ media_content_id: DR_P3, media_title: 'playlist-320000' }));
    expect(text('.sonos-track-title')).toBe('DR P3');
    expect(pick('.sonos-art img')?.getAttribute('src')).toBe('https://ma.me2go.dk/imageproxy/dr13proxy?size=256');
    await show(phone({ media_content_id: 'library://radio/13', media_title: 'no desc' }));
    expect(text('.sonos-track-title')).toBe('DR P3');
  });

  it('names the phone when it is idle with nothing queued', async () => {
    await show(phone({}, 'idle'));
    expect(text('.sonos-track-title')).toBe('My phone');
    expect(text('.sonos-track-sub')).toBe('Quiet');
    expect(pick('.sonos-art-placeholder [data-icon="mdi:cellphone"]')).not.toBeNull();
    expect(pick('.sonos-transport')).toBeNull();
  });

  it('shows no controls while the phone is not reachable', async () => {
    await show(phone({}, 'unavailable'));
    expect(text('.sonos-track-title')).toBe('My phone');
    expect(text('.sonos-track-sub')).toBe('Unavailable');
    expect(pick('.sonos-transport')).toBeNull();
    expect(pick('[aria-label="Move to speaker"]')).toBeNull();
  });
});

describe('the phone card', () => {
  it('has no speaker group and no source sheet', async () => {
    await show(phone(episode));
    expect(pick('[aria-label="Speakers"]')).toBeNull();
    expect(pick('[aria-label="Source"]')).toBeNull();
    expect(pick('[aria-label="Move to this phone"]')).toBeNull();
  });

  it('pauses what plays, resumes what is paused, and skips either way', async () => {
    await show(phone(episode, 'playing'));
    await click('[aria-label="Pause"]');
    await show(phone(episode, 'paused'));
    await click('[aria-label="Play"]');
    await click('[aria-label="Previous track"]');
    await click('[aria-label="Next track"]');
    expect(calls()).toEqual([
      { domain: 'media_player', service: 'media_pause', target: { entity_id: PHONE } },
      { domain: 'media_player', service: 'media_play', target: { entity_id: PHONE } },
      { domain: 'media_player', service: 'media_previous_track', target: { entity_id: PHONE } },
      { domain: 'media_player', service: 'media_next_track', target: { entity_id: PHONE } },
    ]);
    expect(tapped).toEqual([
      ['play_pause', PHONE],
      ['play_pause', PHONE],
      ['skip', 'prev'],
      ['skip', 'next'],
    ]);
  });

  it('has no volume while Music Assistant reports none for the phone', async () => {
    await show(phone(episode));
    expect(pick('.sonos-volume')).toBeNull();
    expect(pick('input[aria-label="Volume"]')).toBeNull();
  });

  it('sets the volume when Music Assistant reports one', async () => {
    await show(phone({ ...episode, volume_level: 0.4 }));
    const strip = pick('input[aria-label="Volume"]') as HTMLInputElement;
    expect(strip.value).toBe('40');
    await act(async () => {
      setThumb.call(strip, '60');
      strip.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(calls()).toEqual([
      { domain: 'media_player', service: 'volume_set', target: { entity_id: PHONE }, serviceData: { volume_level: 0.6 } },
    ]);
    expect(pick('[aria-label="Mute"]')).toBeNull();
  });
});

describe('moving the queue to a speaker', () => {
  it('offers the door while the phone has something queued and there is a speaker to move it to', async () => {
    await show(phone(episode, 'playing'));
    expect(pick('[aria-label="Move to speaker"]')).not.toBeNull();
    await show(phone(episode, 'paused'));
    expect(pick('[aria-label="Move to speaker"]')).not.toBeNull();
    await show(phone(episode, 'idle'));
    expect(pick('[aria-label="Move to speaker"]')).not.toBeNull();
    await show(phone({}, 'idle'));
    expect(pick('[aria-label="Move to speaker"]')).toBeNull();
    await show(phone(episode, 'playing'), []);
    expect(pick('[aria-label="Move to speaker"]')).toBeNull();
  });

  it('lists the speakers behind a tap, and a group by its size', async () => {
    await show(phone(episode));
    expect(pick('.sonos-move')).toBeNull();
    await click('[aria-label="Move to speaker"]');
    expect([...document.querySelectorAll('.sonos-move .sonos-row-title')].map(node => node.textContent)).toEqual(['Bedroom', 'Kitchen']);
    expect([...document.querySelectorAll('.sonos-move .sonos-row-sub')].map(node => node.textContent)).toEqual(['3 speakers']);
    await click('[aria-label="Move to speaker"]');
    expect(pick('.sonos-move')).toBeNull();
  });

  it("moves the phone's queue to the chosen speaker, playing it there, and closes the list", async () => {
    await show(phone(episode));
    await click('[aria-label="Move to speaker"]');
    const kitchen = [...document.querySelectorAll<HTMLElement>('.sonos-move .sonos-row')].find(row =>
      row.textContent?.startsWith('Kitchen')
    );
    await act(async () => kitchen?.click());
    expect(calls()).toEqual([
      {
        domain: 'music_assistant',
        service: 'transfer_queue',
        target: { entity_id: 'media_player.kitchen' },
        serviceData: { source_player: PHONE, auto_play: true },
      },
    ]);
    expect(tapped).toEqual([['move_to_speaker', 'media_player.kitchen']]);
    expect(pick('.sonos-move')).toBeNull();
  });
});
