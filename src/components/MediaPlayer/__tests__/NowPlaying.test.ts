// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';

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

type Message = { type: string; command: string; args: Record<string, unknown> };

const KITCHEN = 'media_player.kitchen';
const DR_P3 = 'https://drliveradio2.akamaized.net/hls/live/2118698/p3/playlist-320000.m3u8';
const DR_P3_STREAM = `builtin://radio/${DR_P3}`;

/** The DR stations as the library lists them, with invented image ids. */
const drRadios = [
  [11, 'DR P1', 'p1'],
  [13, 'DR P3', 'p3'],
  [14, 'DR P4 København', 'p4kbh'],
].map(([id, name, channel]) => ({
  item_id: String(id),
  provider: 'library',
  name,
  uri: `library://radio/${id}`,
  media_type: 'radio',
  favorite: false,
  provider_mappings: [{ provider_domain: 'dr_podcasts', provider_instance: 'dr_podcasts', item_id: channel, available: true }],
  metadata: { images: [{ type: 'thumb', provider: 'dr_podcasts', proxy_id: `dr${id}proxy`, remotely_accessible: true }] },
}));

let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ connection: null });
  vi.restoreAllMocks();
});

/** A bridge answering the commands in `answers`; anything else rejects. `down` rejects everything. */
function connect(answers: Record<string, unknown>, down = false) {
  const sent: Message[] = [];
  store.setState({
    connection: {
      sendMessagePromise: async (message: Message) => {
        sent.push(message);
        if (down) throw new Error('bridge down');
        if (!(message.command in answers)) throw new Error(`no answer for ${message.command}`);
        return answers[message.command];
      },
    },
  });
  return { commands: () => sent.map(message => message.command) };
}

/** What Home Assistant reports for the kitchen speaker. */
const kitchen = (attributes: Record<string, unknown> = {}, state = 'idle'): HassEntities => ({
  [KITCHEN]: {
    entity_id: KITCHEN,
    state,
    attributes: {
      source_list: [],
      group_members: [KITCHEN],
      active_queue: 'RINCON_F0F6C1A525A201400',
      source: 'Music Assistant Queue',
      app_id: 'music_assistant',
      media_content_type: 'music',
      volume_level: 0.24,
      ...attributes,
    },
  },
});

const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

async function show(entities: HassEntities, embedded = true) {
  await act(async () => {
    root.render(createElement(SonosPlayer, { entityId: KITCHEN, entities, hassUrl: 'https://ha.example', callService: vi.fn(), embedded }));
  });
  await settle();
}

const pick = (selector: string) => document.querySelector(selector);
const text = (selector: string) => pick(selector)?.textContent ?? null;
const title = () => text('.sonos-track-title');
const sub = () => text('.sonos-track-sub');
const art = () => pick('.sonos-art img')?.getAttribute('src') ?? null;
const placeholder = () => pick('.sonos-art-placeholder [data-icon]')?.getAttribute('data-icon') ?? null;

describe('a DR stream played as a plain address', () => {
  it('shows the channel and its logo, as the library entry does', async () => {
    connect({ 'music/radios/library_items': drRadios });
    await show(kitchen({ media_content_id: DR_P3_STREAM, media_title: 'playlist-320000' }));
    expect(title()).toBe('DR P3');
    expect(sub()).toBeNull();
    expect(art()).toBe('https://ma.me2go.dk/imageproxy/dr13proxy?size=256');
    expect(pick('.sonos-ibtn--bare .sonos-mark-logo')?.getAttribute('src')).toBe('https://ma.me2go.dk/imageproxy/dr13proxy?size=256');
  });

  it('says the channel at once and adds the logo when the library has answered', async () => {
    let answer: (radios: unknown) => void = () => {};
    const pending = new Promise<unknown>(resolve => (answer = resolve));
    connect({ 'music/radios/library_items': pending });
    await show(kitchen({ media_content_id: DR_P3_STREAM, media_title: 'no desc' }, 'playing'));
    expect(title()).toBe('DR P3');
    expect(art()).toBeNull();
    await act(async () => answer(drRadios));
    await settle();
    expect(title()).toBe('DR P3');
    expect(art()).toBe('https://ma.me2go.dk/imageproxy/dr13proxy?size=256');
  });

  it('keeps the name while Music Assistant is out of reach', async () => {
    connect({}, true);
    await show(kitchen({ media_content_id: DR_P3_STREAM, media_title: 'playlist-320000' }));
    expect(title()).toBe('DR P3');
    expect(art()).toBeNull();
    expect(placeholder()).toBe('mdi:music');
  });

  it('marks the channel in the Source sheet as the one that plays', async () => {
    connect({
      'music/radios/library_items': drRadios,
      'music/podcasts/library_items': [],
      'music/in_progress_items': [],
      'music/playlists/library_items': [],
    });
    await show(kitchen({ media_content_id: DR_P3_STREAM, media_title: 'playlist-320000' }, 'playing'));
    await act(async () => (pick('[aria-label="Source"]') as HTMLElement).click());
    await settle();
    const tiles = [...document.querySelectorAll('.sonos-srcgrid .sonos-srctile > span')].map(node => node.textContent);
    expect(tiles).toEqual(['DR P1', 'DR P3 · now', 'DR P4 København']);
  });
});

describe('a library station', () => {
  it('is named without the Source sheet having been opened, asking for the stations alone', async () => {
    const bridge = connect({ 'music/radios/library_items': drRadios });
    await show(kitchen({ media_content_id: 'library://radio/13', media_title: 'no desc' }, 'playing'));
    expect(title()).toBe('DR P3');
    expect(art()).toBe('https://ma.me2go.dk/imageproxy/dr13proxy?size=256');
    expect(bridge.commands()).toEqual(['music/radios/library_items']);
  });

  it('is not asked for by a card that plays no radio', async () => {
    const bridge = connect({ 'music/radios/library_items': drRadios });
    await show(
      kitchen({ media_content_id: 'spotify--a1B2c3D4://track/abc', media_title: 'Strong', media_artist: 'London Grammar' }, 'playing')
    );
    expect(bridge.commands()).toEqual([]);
  });

  it('is not asked for by a collapsed card, which shows none of it', async () => {
    const bridge = connect({ 'music/radios/library_items': drRadios });
    await show(kitchen({ media_content_id: DR_P3_STREAM, media_title: 'playlist-320000' }, 'playing'), false);
    expect(pick('.sonos-now')).toBeNull();
    expect(bridge.commands()).toEqual([]);
  });
});

describe('a player with nothing to say', () => {
  const unnamed = 'builtin://radio/https://streams.example/live.aac';

  it('names the speaker, with a speaker glyph, when the title is only the name of a stream file', async () => {
    connect({ 'music/radios/library_items': drRadios });
    await show(kitchen({ media_content_id: unnamed, media_title: 'live' }));
    expect(title()).toBe('Kitchen');
    expect(sub()).toBe('Quiet');
    expect(placeholder()).toBe('mdi:speaker');
  });

  it('says what the player does while it plays or is paused', async () => {
    connect({ 'music/radios/library_items': drRadios });
    await show(kitchen({ media_content_id: unnamed, media_title: 'live' }, 'playing'));
    expect(title()).toBe('Kitchen');
    expect(sub()).toBe('Radio');
    await show(kitchen({ media_content_id: unnamed, media_title: 'live' }, 'paused'));
    expect(sub()).toBe('Paused');
  });

  it('names the speaker for a placeholder title on a station the library does not hold', async () => {
    connect({ 'music/radios/library_items': [] });
    await show(kitchen({ media_content_id: 'library://radio/99', media_title: 'no desc' }));
    expect(title()).toBe('Kitchen');
    expect(sub()).toBe('Quiet');
  });

  it('names the speaker when it is idle with nothing queued', async () => {
    connect({});
    await show(kitchen());
    expect(title()).toBe('Kitchen');
    expect(sub()).toBe('Quiet');
    expect(placeholder()).toBe('mdi:speaker');
    await show(kitchen({}, 'off'));
    expect(title()).toBe('Kitchen');
  });

  it('leaves a player that plays without a title to its source', async () => {
    connect({});
    await show(kitchen({ source: 'TV' }, 'playing'));
    expect(title()).toBe('Not playing');
    expect(sub()).toBe('TV');
  });
});

describe('a player with real metadata', () => {
  it('shows Spotify as it did', async () => {
    connect({});
    await show(
      kitchen({ media_content_id: 'spotify--a1B2c3D4://track/abc', media_title: 'Strong', media_artist: 'London Grammar' }, 'playing')
    );
    expect(title()).toBe('Strong');
    expect(sub()).toBe('London Grammar · Spotify');
    expect(placeholder()).toBe('mdi:music');
  });

  it('shows a podcast episode as it did', async () => {
    connect({});
    await show(
      kitchen({
        media_content_id: 'dr_podcasts://podcast_episode/https://drpodcast.nu/x/feed.xml https://drpodcast.nu/x/1',
        media_title: 'En episode',
      })
    );
    expect(title()).toBe('En episode');
    expect(sub()).toBe('Podcast');
  });

  it('shows what an unnamed radio stream reports', async () => {
    connect({ 'music/radios/library_items': drRadios });
    await show(
      kitchen(
        { media_content_id: 'builtin://radio/https://streams.example/live.aac', media_title: 'Et nummer', media_artist: 'Nogen' },
        'playing'
      )
    );
    expect(title()).toBe('Et nummer');
    expect(sub()).toBe('Nogen · Radio');
  });

  it('keeps a picture Home Assistant serves for a title it could not name', async () => {
    connect({ 'music/radios/library_items': drRadios });
    await show(
      kitchen(
        {
          media_content_id: 'builtin://radio/https://streams.example/live.aac',
          media_title: 'live',
          entity_picture_local: '/api/media_player_proxy/x',
        },
        'playing'
      )
    );
    expect(title()).toBe('live');
    expect(art()).toBe('https://ha.example/api/media_player_proxy/x');
  });
});
