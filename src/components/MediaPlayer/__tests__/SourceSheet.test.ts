// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';
import episodes from '../../../music/__tests__/fixtures/episodes.json';
import inProgress from '../../../music/__tests__/fixtures/in-progress.json';
import playlistTracks from '../../../music/__tests__/fixtures/playlist-tracks.json';
import playlists from '../../../music/__tests__/fixtures/playlists.json';
import podcasts from '../../../music/__tests__/fixtures/podcasts.json';
import radios from '../../../music/__tests__/fixtures/radios.json';

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
type Answer = unknown | ((args: Record<string, unknown>) => unknown);

const KITCHEN_QUEUE = 'RINCON_F0F6C1A525A201400';
const EPISODE_34 = 'example_podcasts://podcast_episode/https://podcasts.example/4/feed.xml https://podcasts.example/4/episodes/34';
const EPISODE_33 = 'example_podcasts://podcast_episode/https://podcasts.example/4/feed.xml https://podcasts.example/4/episodes/33';

let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** A bridge answering from `answers`; a command it has no answer for rejects. `down` rejects everything. */
function connect(answers: Record<string, Answer>, down = false) {
  const sent: Message[] = [];
  const connection = {
    sendMessagePromise: async (message: Message) => {
      sent.push(message);
      if (down) throw new Error('bridge down');
      if (!(message.command in answers)) throw new Error(`no answer for ${message.command}`);
      const answer = answers[message.command];
      return typeof answer === 'function' ? answer(message.args) : answer;
    },
  };
  store.setState({ connection });
  return { sent, played: () => sent.filter(m => m.command === 'player_queues/play_media') };
}

/** The playlists played through Music Assistant, the most recently played first: the query for them says `played_only`. */
const playedPlaylists = [playlists[3], playlists[1]];

const library = (overrides: Record<string, Answer> = {}): Record<string, Answer> => ({
  'music/radios/library_items': radios,
  'music/podcasts/library_items': podcasts,
  'music/in_progress_items': inProgress,
  'music/playlists/library_items': (args: Record<string, unknown>) => (args.played_only ? playedPlaylists : playlists),
  'music/playlists/playlist_tracks': playlistTracks,
  'music/podcasts/podcast_episodes': episodes,
  'player_queues/play_media': null,
  ...overrides,
});

const speaker = (id: string, attributes: Record<string, unknown> = {}, state = 'idle') => ({
  entity_id: id,
  state,
  attributes: { source_list: [], group_members: [id], ...attributes },
});

const kitchenOnly = (attributes: Record<string, unknown> = {}, state = 'idle'): HassEntities => ({
  'media_player.kitchen': speaker('media_player.kitchen', { active_queue: KITCHEN_QUEUE, ...attributes }, state),
});

async function render(entities: HassEntities, entityId = 'media_player.kitchen') {
  await act(async () => {
    root.render(createElement(SonosPlayer, { entityId, entities, hassUrl: 'https://ha.example', callService: vi.fn(), embedded: true }));
  });
}

const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle();
};

const pick = (selector: string) => document.querySelector(selector);
const texts = (selector: string) => [...document.querySelectorAll(selector)].map(node => node.textContent);
const tiles = () => texts('.sonos-srcgrid .sonos-srctile > span');
const sheetOpen = () => pick('.sonos-sheet') !== null;
const rowTitles = () => texts('.sonos-rows .sonos-row-title');
const rowTitled = (title: string) =>
  [...document.querySelectorAll('.sonos-row')].find(row => row.querySelector('.sonos-row-title')?.textContent === title) ?? null;

async function openSources(entities: HassEntities = kitchenOnly(), entityId = 'media_player.kitchen') {
  await render(entities, entityId);
  await click(pick('[aria-label="Source"]'));
}

async function openSpotify() {
  await openSources();
  await click(pick('[aria-label="Spotify"]'));
}

async function openTracks(playlist = 'Morgenkaffe') {
  await openSpotify();
  await click(rowTitled(playlist));
}

async function openPodcasts() {
  await openSources();
  await click(pick('[aria-label="Podcasts"]'));
}

async function openEpisodes() {
  await openPodcasts();
  await click([...document.querySelectorAll('.sonos-row')].find(row => row.textContent === 'Fredagsbangers') ?? null);
}

describe('the radio tiles', () => {
  it("are the library's stations, favorites first, without the codec tag", async () => {
    connect(library());
    await openSources();
    expect(tiles()).toEqual([
      'Spotify ›',
      'Kanal 3',
      'Kanal 4 København',
      'Kanal 1',
      'Kanal 2',
      'Kanal 6 BEAT',
      'Lokalradio',
      'Podcasts ›',
    ]);
  });

  it('wear the station logo from the image proxy, or a radio glyph without one', async () => {
    connect(library());
    await openSources();
    const buttons = [...document.querySelectorAll('.sonos-srcbtn--logo')];
    expect(buttons[0].querySelector('img')?.getAttribute('src')).toBe('https://ma.me2go.dk/imageproxy/radio5proxy?size=256');
    expect(buttons.at(-1)?.querySelector('img')).toBeNull();
    expect(buttons.at(-1)?.querySelector('[data-icon="mdi:radio"]')).not.toBeNull();
  });

  it('mark the station that plays, and the card then names it', async () => {
    connect(library());
    await openSources(kitchenOnly({ media_content_id: 'library://radio/5', media_title: 'playlist-320000' }, 'playing'));
    expect(tiles()).toContain('Kanal 3 · now');
    expect(pick('.sonos-track-title')?.textContent).toBe('Kanal 3');
  });

  it("start on the speaker's queue and close the sheet once Music Assistant has taken them", async () => {
    const { played } = connect(library());
    await openSources();
    await click(pick('button[aria-label="Kanal 3"]'));
    expect(played()).toEqual([
      {
        type: 'music_bridge/call',
        command: 'player_queues/play_media',
        args: { queue_id: KITCHEN_QUEUE, media: ['library://radio/5'], option: 'replace' },
      },
    ]);
    expect(sheetOpen()).toBe(false);
  });

  it('show a spinner on the tapped station while Music Assistant answers, and ignore other taps meanwhile', async () => {
    let finish: () => void = () => {};
    const { played } = connect(library({ 'player_queues/play_media': () => new Promise<null>(done => (finish = () => done(null))) }));
    await openSources();
    await click(pick('button[aria-label="Kanal 3"]'));
    expect(sheetOpen()).toBe(true);
    expect(pick('button[aria-label="Kanal 3"] [data-icon="mdi:loading"]')).not.toBeNull();
    await click(pick('button[aria-label="Kanal 1"]'));
    expect(played()).toHaveLength(1);
    await act(async () => finish());
    await settle();
    expect(sheetOpen()).toBe(false);
  });

  it('start on the queue of the coordinator when the speaker follows a group', async () => {
    const { played } = connect(library());
    const members = ['media_player.kitchen', 'media_player.dining_room'];
    await openSources(
      {
        'media_player.kitchen': speaker('media_player.kitchen', { active_queue: KITCHEN_QUEUE, group_members: members }),
        'media_player.dining_room': speaker('media_player.dining_room', { active_queue: KITCHEN_QUEUE, group_members: members }),
      },
      'media_player.dining_room'
    );
    await click(pick('button[aria-label="Kanal 4 København"]'));
    expect(played().map(m => m.args.queue_id)).toEqual([KITCHEN_QUEUE]);
  });

  it("start on the coordinator's own player when it reports no queue, not the follower's", async () => {
    const { played } = connect(library());
    const members = ['media_player.kitchen', 'media_player.dining_room'];
    await openSources(
      {
        'media_player.kitchen': speaker('media_player.kitchen', { active_queue: null, group_members: members }),
        'media_player.dining_room': speaker('media_player.dining_room', { active_queue: null, group_members: members }),
      },
      'media_player.dining_room'
    );
    await click(pick('button[aria-label="Kanal 1"]'));
    expect(played().map(m => m.args.queue_id)).toEqual([KITCHEN_QUEUE]);
  });

  it('leave the sheet open with the note when Music Assistant refuses', async () => {
    connect(
      library({
        'player_queues/play_media': () => {
          throw new Error('refused');
        },
      })
    );
    await openSources();
    await click(pick('button[aria-label="Kanal 3"]'));
    expect(sheetOpen()).toBe(true);
    expect(texts('.sonos-note')).toEqual(['Music Assistant unavailable']);
    expect(pick('button[aria-label="Kanal 3"] [data-icon="mdi:loading"]')).toBeNull();
  });
});

describe('the source sheet while Music Assistant is out of reach', () => {
  it('shows the other sources and one note, with no stations and no Podcasts tile', async () => {
    connect({}, true);
    await openSources();
    expect(tiles()).toEqual(['Spotify ›']);
    expect(texts('.sonos-note')).toEqual(['Music Assistant unavailable']);
  });

  it('shows a loading note until the library has arrived', async () => {
    let arrive: () => void = () => {};
    const gate = new Promise<unknown>(done => (arrive = () => done(radios)));
    connect(library({ 'music/radios/library_items': () => gate }));
    await openSources();
    expect(pick('.sonos-note[aria-label="Loading"]')).not.toBeNull();
    expect(tiles()).toEqual(['Spotify ›']);
    await act(async () => arrive());
    await settle();
    expect(pick('.sonos-note')).toBeNull();
    expect(tiles()).toContain('Kanal 3');
  });

  it('asks again when the sheet is opened again', async () => {
    const { sent } = connect(library());
    await openSources();
    const asked = sent.filter(m => m.command === 'music/radios/library_items').length;
    await click(pick('[aria-label="Close"]'));
    await click(pick('[aria-label="Source"]'));
    expect(sent.filter(m => m.command === 'music/radios/library_items')).toHaveLength(asked + 1);
  });
});

describe('the Spotify page', () => {
  it('lists the playlists played through Music Assistant first, then the rest in the order of the library, without its own generated ones', async () => {
    const { sent } = connect(library());
    await openSpotify();
    expect(pick('.sonos-sheet-top .sonos-title')?.textContent).toBe('Spotify');
    expect(rowTitles()).toEqual(['Morgenkaffe', 'Fredagsmix', 'Efterårsdage', 'Løbeture']);
    expect(sent.filter(m => m.command === 'music/playlists/library_items').map(m => m.args)).toEqual([
      { order_by: 'last_played_desc', played_only: true },
      { order_by: 'timestamp_added' },
    ]);
  });

  it('shows each playlist with its cover from the image proxy, or a playlist glyph without one', async () => {
    connect(library());
    await openSpotify();
    const rows = [...document.querySelectorAll('.sonos-rows .sonos-row')];
    expect(rows[0].querySelector('img')?.getAttribute('src')).toBe('https://ma.me2go.dk/imageproxy/playlist7proxy?size=256');
    expect(rows[3].querySelector('img')).toBeNull();
    expect(rows[3].querySelector('[data-icon="mdi:playlist-music"]')).not.toBeNull();
  });

  it('opens a playlist with a tap, and starts nothing', async () => {
    const { played } = connect(library());
    await openSpotify();
    await click(rowTitled('Morgenkaffe'));
    expect(pick('.sonos-sheet-top .sonos-title')?.textContent).toBe('Morgenkaffe');
    expect(played()).toEqual([]);
    expect(sheetOpen()).toBe(true);
  });

  it('goes back to the source grid with the back button', async () => {
    connect(library());
    await openSpotify();
    await click(pick('[aria-label="Back"]'));
    expect(pick('.sonos-rows')).toBeNull();
    expect(tiles()).toContain('Spotify ›');
    expect(tiles()).toContain('Kanal 3');
  });

  it('opens the Spotify app from a button in its header, and nowhere else', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    connect(library());
    await openSources();
    expect(pick('[aria-label="Open Spotify"]')).toBeNull();
    await click(pick('[aria-label="Spotify"]'));

    // The desktop route adds a hidden iframe on spotify:// and takes it away again; neither is wanted in the test page.
    const appended = vi.spyOn(document.body, 'appendChild').mockImplementation(node => node);
    const removed = vi.spyOn(document.body, 'removeChild').mockImplementation(node => node);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let attached: Node[] = [];
    let detached: Node[] = [];
    try {
      await act(async () => (pick('.sonos-sheet-top [aria-label="Open Spotify"]') as HTMLElement).click());
      await act(async () => vi.advanceTimersByTime(2000));
      attached = appended.mock.calls.map(([node]) => node);
      detached = removed.mock.calls.map(([node]) => node);
    } finally {
      vi.useRealTimers();
      appended.mockRestore();
      removed.mockRestore();
    }
    expect(attached.map(node => (node as HTMLElement).getAttribute('src'))).toEqual(['spotify://']);
    expect(attached[0]).toBeInstanceOf(HTMLIFrameElement);
    expect(detached).toEqual(attached);
    expect(open).not.toHaveBeenCalled();
    expect(sheetOpen()).toBe(true);
    expect(rowTitles()).toHaveLength(4);
    await click(pick('[aria-label="Back"]'));
    await click(pick('[aria-label="Podcasts"]'));
    expect(pick('[aria-label="Open Spotify"]')).toBeNull();
  });

  it('marks its tile when Spotify is what plays', async () => {
    connect(library());
    await openSources(kitchenOnly({ media_content_id: 'spotify--a1B2c3D4://track/abc', media_title: 'Et nummer' }, 'playing'));
    expect(tiles()).toContain('Spotify · now');
  });

  it('offers no tile to a viewer whose Music Assistant has no Spotify playlists', async () => {
    for (const answer of [[], [playlists[2]]]) {
      connect(library({ 'music/playlists/library_items': answer }));
      await openSources();
      expect(pick('[aria-label="Spotify"]')).toBeNull();
      expect(tiles()).not.toContain('Spotify ›');
      expect(tiles()).toContain('Kanal 3');
      await click(pick('[aria-label="Close"]'));
    }
  });

  it('keeps its tile when the playlists cannot be fetched, leaving the stations alone', async () => {
    connect(
      library({
        'music/playlists/library_items': () => {
          throw new Error('refused');
        },
      })
    );
    await openSources();
    expect(tiles()).toContain('Spotify ›');
    expect(tiles()).toContain('Kanal 3');
    expect(pick('.sonos-note')).toBeNull();
    await click(pick('[aria-label="Spotify"]'));
    expect(texts('.sonos-note')).toEqual(['Music Assistant unavailable']);
    expect(pick('.sonos-sheet-top [aria-label="Open Spotify"]')).not.toBeNull();
  });
});

describe("a playlist's tracks", () => {
  it('are asked for by the playlist, and the Spotify app stays one tap away in the header', async () => {
    const { sent } = connect(library());
    await openTracks();
    expect(sent.filter(m => m.command === 'music/playlists/playlist_tracks').map(m => m.args)).toEqual([
      { item_id: '7', provider_instance_id_or_domain: 'library' },
    ]);
    expect(pick('.sonos-sheet-top [aria-label="Open Spotify"]')).not.toBeNull();
  });

  it('follow a Play all button, in playlist order, with artist, length and cover', async () => {
    connect(library());
    await openTracks();
    expect(pick('.sonos-sheet-body')?.firstElementChild?.getAttribute('aria-label')).toBe('Play all');
    expect(rowTitles()).toEqual([
      'Lysets hastighed',
      'Duet i dur',
      'Uden omslag',
      'Fjernet fra Spotify',
      'Uden længde',
      'Lang liveoptagelse',
      'Uden kunstner',
    ]);
    expect(texts('.sonos-row-sub')).toEqual([
      'Eksempel Band',
      'Alma Eksempel, Bo Prøve',
      'Solo Eksempel',
      'Eksempel Band',
      'Eksempel Band',
      'Eksempel Band',
    ]);
    expect(texts('.sonos-row-time')).toEqual(['3:45', '4:02', '3:18', '3:07', '1:02:03', '2:20']);
    expect(rowTitled('Lysets hastighed')?.querySelector('img')?.getAttribute('src')).toBe(
      'https://ma.me2go.dk/imageproxy/track1cover?size=256'
    );
    expect(rowTitled('Uden omslag')?.querySelector('img')).toBeNull();
    expect(rowTitled('Uden omslag')?.querySelector('[data-icon="mdi:music-note"]')).not.toBeNull();
  });

  it("start the playlist at the tapped track on the speaker's queue and close the sheet once Music Assistant has taken it", async () => {
    const { played } = connect(library());
    await openTracks();
    await click(rowTitled('Duet i dur'));
    expect(played().map(m => m.args)).toEqual([
      { queue_id: KITCHEN_QUEUE, media: ['library://playlist/7'], option: 'replace', start_item: 'spotify--a1B2c3D4://track/example02' },
    ]);
    expect(sheetOpen()).toBe(false);
  });

  it('are played whole by Play all, which does not wait for them to arrive', async () => {
    let arrive: () => void = () => {};
    const gate = new Promise<unknown>(done => (arrive = () => done(playlistTracks)));
    const { played } = connect(library({ 'music/playlists/playlist_tracks': () => gate }));
    await openTracks();
    expect(pick('.sonos-note[aria-label="Loading"]')).not.toBeNull();
    await click(pick('[aria-label="Play all"]'));
    expect(played().map(m => m.args)).toEqual([{ queue_id: KITCHEN_QUEUE, media: ['library://playlist/7'], option: 'replace' }]);
    expect(sheetOpen()).toBe(false);
    await act(async () => arrive());
  });

  it('show a spinner on the tapped track while Music Assistant answers, and ignore other taps meanwhile', async () => {
    let finish: () => void = () => {};
    const { played } = connect(library({ 'player_queues/play_media': () => new Promise<null>(done => (finish = () => done(null))) }));
    await openTracks();
    await click(rowTitled('Duet i dur'));
    expect(sheetOpen()).toBe(true);
    expect(rowTitled('Duet i dur')?.querySelector('.sonos-row-badge [data-icon="mdi:loading"]')).not.toBeNull();
    expect(pick('[aria-label="Play all"] [data-icon="mdi:loading"]')).toBeNull();
    await click(rowTitled('Uden omslag'));
    await click(pick('[aria-label="Play all"]'));
    expect(played()).toHaveLength(1);
    await act(async () => finish());
    await settle();
    expect(sheetOpen()).toBe(false);
  });

  it('show the spinner on Play all, and not on a track, when that is what was tapped', async () => {
    let finish: () => void = () => {};
    connect(library({ 'player_queues/play_media': () => new Promise<null>(done => (finish = () => done(null))) }));
    await openTracks();
    await click(pick('[aria-label="Play all"]'));
    expect(pick('[aria-label="Play all"] [data-icon="mdi:loading"]')).not.toBeNull();
    expect(document.querySelectorAll('.sonos-row-badge')).toHaveLength(0);
    await act(async () => finish());
    await settle();
  });

  it('dims a track Music Assistant will skip and does not start it', async () => {
    const { played } = connect(library());
    await openTracks();
    const removed = rowTitled('Fjernet fra Spotify') as HTMLButtonElement;
    expect(removed.disabled).toBe(true);
    expect(removed.classList.contains('is-unavailable')).toBe(true);
    await click(removed);
    expect(played()).toEqual([]);
    expect((rowTitled('Duet i dur') as HTMLButtonElement).disabled).toBe(false);
  });

  it('stay open with the note when Music Assistant refuses, with Play all still on offer', async () => {
    connect(
      library({
        'player_queues/play_media': () => {
          throw new Error('refused');
        },
      })
    );
    await openTracks();
    await click(rowTitled('Duet i dur'));
    expect(sheetOpen()).toBe(true);
    expect(texts('.sonos-note')).toEqual(['Music Assistant unavailable']);
    expect(pick('.sonos-row-badge')).toBeNull();
    expect(pick('[aria-label="Play all"]')).not.toBeNull();
  });

  it('are shown thirty at a time', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      ...playlistTracks[0],
      uri: `spotify--a1B2c3D4://track/many-${i}`,
      name: `Nummer ${i}`,
    }));
    connect(library({ 'music/playlists/playlist_tracks': many }));
    await openTracks();
    expect(document.querySelectorAll('.sonos-rows .sonos-row')).toHaveLength(30);
    expect(rowTitles()[0]).toBe('Nummer 0');
    await click(pick('[aria-label="More tracks"]'));
    expect(document.querySelectorAll('.sonos-rows .sonos-row')).toHaveLength(35);
    expect(rowTitles().at(-1)).toBe('Nummer 34');
    expect(pick('[aria-label="More tracks"]')).toBeNull();
  });

  it('may hold the same track twice', async () => {
    connect(library({ 'music/playlists/playlist_tracks': [playlistTracks[0], playlistTracks[0]] }));
    await openTracks();
    expect(rowTitles()).toEqual(['Lysets hastighed', 'Lysets hastighed']);
  });

  it('say so when a playlist has none, and still offer Play all', async () => {
    connect(library({ 'music/playlists/playlist_tracks': [] }));
    await openTracks();
    expect(texts('.sonos-note')).toEqual(['No tracks found']);
    expect(pick('[aria-label="Play all"]')).not.toBeNull();
  });

  it('leave one note when they cannot be fetched, with Play all on offer and the playlists one step back', async () => {
    connect(
      library({
        'music/playlists/playlist_tracks': () => {
          throw new Error('refused');
        },
      })
    );
    await openTracks();
    expect(texts('.sonos-note')).toEqual(['Music Assistant unavailable']);
    expect(pick('[aria-label="Play all"]')).not.toBeNull();
    await click(pick('[aria-label="Back"]'));
    expect(rowTitles()).toContain('Morgenkaffe');
    expect(pick('.sonos-note')).toBeNull();
  });

  it('are fetched again for a playlist that is opened again', async () => {
    const { sent } = connect(library());
    await openTracks();
    await click(pick('[aria-label="Back"]'));
    await click(rowTitled('Morgenkaffe'));
    expect(sent.filter(m => m.command === 'music/playlists/playlist_tracks')).toHaveLength(2);
  });

  it('open for the playlist that was tapped', async () => {
    const { sent } = connect(library());
    await openTracks('Løbeture');
    expect(pick('.sonos-sheet-top .sonos-title')?.textContent).toBe('Løbeture');
    expect(sent.filter(m => m.command === 'music/playlists/playlist_tracks').map(m => m.args)).toEqual([
      { item_id: '21', provider_instance_id_or_domain: 'library' },
    ]);
  });

  it('open at the top and, on the way back, leave the playlists where they were scrolled to', async () => {
    connect(library());
    await openSpotify();
    const body = pick('.sonos-sheet-body') as HTMLElement;
    body.scrollTop = 240;
    await click(rowTitled('Morgenkaffe'));
    expect(body.scrollTop).toBe(0);
    await click(pick('[aria-label="Back"]'));
    expect(body.scrollTop).toBe(240);
    expect(rowTitles()).toContain('Morgenkaffe');
  });
});

describe('the podcasts page', () => {
  it('lists the unfinished episodes with a resume badge first, then the shows by name', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    connect(library());
    await openPodcasts();
    expect(rowTitles()).toEqual([
      'Efterårets første',
      '68: Et afsnit fra en anden udbyder',
      'Fredagsbangers',
      'Zebra-podcasten',
      'Ærlig talt',
      'Østkysten rundt',
    ]);
    expect(document.querySelectorAll('.sonos-row-badge')).toHaveLength(2);
    expect(document.querySelectorAll('.sonos-rows-rule')).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a show without cover with a podcast glyph', async () => {
    connect(library());
    await openPodcasts();
    const row = [...document.querySelectorAll('.sonos-row')].find(r => r.textContent === 'Fredagsbangers');
    expect(row?.querySelector('img')).toBeNull();
    expect(row?.querySelector('[data-icon="mdi:podcast"]')).not.toBeNull();
    const withCover = [...document.querySelectorAll('.sonos-row')].find(r => r.textContent === 'Zebra-podcasten');
    expect(withCover?.querySelector('img')?.getAttribute('src')).toBe('https://ma.me2go.dk/imageproxy/podcast5proxy?size=256');
  });

  it('resumes an unfinished episode by its own uri', async () => {
    const { played } = connect(library());
    await openPodcasts();
    await click(pick('.sonos-rows .sonos-row'));
    expect(played().map(m => m.args)).toEqual([{ queue_id: KITCHEN_QUEUE, media: [EPISODE_34], option: 'replace' }]);
    expect(sheetOpen()).toBe(false);
  });

  it('is not offered when the viewer has no podcasts and nothing in progress', async () => {
    connect(library({ 'music/podcasts/library_items': [], 'music/in_progress_items': [] }));
    await openSources();
    expect(tiles()).not.toContain('Podcasts ›');
  });

  it('has just the shows, with no divider, when nothing is in progress', async () => {
    connect(library({ 'music/in_progress_items': [] }));
    await openPodcasts();
    expect(rowTitles()).toEqual(['Fredagsbangers', 'Zebra-podcasten', 'Ærlig talt', 'Østkysten rundt']);
    expect(document.querySelectorAll('.sonos-rows-rule')).toHaveLength(0);
  });

  it('says so when a podcast episode plays', async () => {
    connect(library());
    await openSources(kitchenOnly({ media_content_id: EPISODE_34, media_title: 'Efterårets første' }, 'playing'));
    expect(tiles()).toContain('Podcasts · now');
  });
});

describe("a podcast's episodes", () => {
  it('are listed newest first with date and length, and a mark for what has been listened to', async () => {
    const { sent } = connect(library());
    await openEpisodes();
    expect(pick('.sonos-sheet-top .sonos-title')?.textContent).toBe('Fredagsbangers');
    expect(sent.filter(m => m.command === 'music/podcasts/podcast_episodes').map(m => m.args)).toEqual([
      { item_id: '4', provider_instance_id_or_domain: 'library' },
    ]);
    expect(rowTitles()).toEqual([
      'Efterårets første',
      'Gæst i studiet',
      'Kort og godt',
      'Sæsonafslutning',
      'Første afsnit',
      'Bonusafsnit uden dato',
    ]);
    expect(texts('.sonos-row-sub')).toEqual([
      '2 Oct 2026 · 2 h',
      '25 Sep 2026 · 1 h 30 min',
      '11 Sep 2026 · 45 min',
      '11 Sep 2026 · 2 h',
      '2 Jan 2026 · 2 h',
    ]);
    const [resuming, played, plain] = [...document.querySelectorAll('.sonos-rows .sonos-row')];
    expect(resuming.querySelector('.sonos-row-cover.is-resume')).not.toBeNull();
    expect(resuming.querySelector<HTMLElement>('.sonos-row-bar > span')?.style.width).toBe('25%');
    expect(played.classList.contains('is-played')).toBe(true);
    expect(played.querySelector('[data-icon="mdi:check-circle"]')).not.toBeNull();
    expect(plain.classList.contains('is-played')).toBe(false);
    expect(plain.querySelector('.sonos-row-bar')).toBeNull();
  });

  it('start with the episode uri, never the podcast uri', async () => {
    const { played } = connect(library());
    await openEpisodes();
    await click([...document.querySelectorAll('.sonos-row')].find(row => row.textContent?.startsWith('Gæst i studiet')) ?? null);
    expect(played().map(m => m.args)).toEqual([{ queue_id: KITCHEN_QUEUE, media: [EPISODE_33], option: 'replace' }]);
    expect(sheetOpen()).toBe(false);
  });

  it('are shown thirty at a time', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      ...episodes[0],
      uri: `example_podcasts://podcast_episode/ep-${i}`,
      name: `Afsnit ${i}`,
      metadata: { ...episodes[0].metadata, release_date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() },
    }));
    connect(library({ 'music/podcasts/podcast_episodes': many }));
    await openEpisodes();
    expect(document.querySelectorAll('.sonos-rows .sonos-row')).toHaveLength(30);
    expect(rowTitles()[0]).toBe('Afsnit 34');
    await click(pick('[aria-label="Older episodes"]'));
    expect(document.querySelectorAll('.sonos-rows .sonos-row')).toHaveLength(35);
    expect(rowTitles().at(-1)).toBe('Afsnit 0');
    expect(pick('[aria-label="Older episodes"]')).toBeNull();
  });

  it('say so when a show has none', async () => {
    connect(library({ 'music/podcasts/podcast_episodes': [] }));
    await openEpisodes();
    expect(texts('.sonos-note')).toEqual(['No episodes found']);
  });

  it('leave one note when they cannot be fetched, with the podcasts page one step back', async () => {
    connect(
      library({
        'music/podcasts/podcast_episodes': () => {
          throw new Error('refused');
        },
      })
    );
    await openEpisodes();
    expect(texts('.sonos-note')).toEqual(['Music Assistant unavailable']);
    await click(pick('[aria-label="Back"]'));
    expect(rowTitles()).toContain('Fredagsbangers');
    expect(pick('.sonos-note')).toBeNull();
  });

  it('are fetched again for a show that is opened again', async () => {
    const { sent } = connect(library());
    await openEpisodes();
    await click(pick('[aria-label="Back"]'));
    await click([...document.querySelectorAll('.sonos-row')].find(row => row.textContent === 'Fredagsbangers') ?? null);
    expect(sent.filter(m => m.command === 'music/podcasts/podcast_episodes')).toHaveLength(2);
  });
});

describe('the source mark of the card', () => {
  const sourceTitle = () => pick('[aria-label="Source"]')?.getAttribute('title');
  const sourceIcon = () => pick('[aria-label="Source"] [data-icon]')?.getAttribute('data-icon');

  it('is a podcast for a podcast episode', async () => {
    connect(library());
    await render(kitchenOnly({ media_content_id: EPISODE_34, media_title: 'Efterårets første' }, 'playing'));
    expect(sourceTitle()).toBe('Podcast');
    expect(sourceIcon()).toBe('mdi:podcast');
  });

  it('is a radio for a station the library does not know', async () => {
    connect(library());
    await render(kitchenOnly({ media_content_id: 'builtin://radio/https://stream.example/live.m3u8', media_title: 'live' }, 'playing'));
    expect(sourceTitle()).toBe('Radio');
    expect(sourceIcon()).toBe('mdi:radio');
  });

  it('is neither for a track, and not a podcast while the source is the TV', async () => {
    connect(library());
    await render(kitchenOnly({ media_content_id: 'library://track/86', media_title: 'All Good' }, 'playing'));
    expect(sourceIcon()).toBe('mdi:music');
    await render(kitchenOnly({ media_content_id: EPISODE_34, media_title: 'Efterårets første', source: 'TV' }, 'playing'));
    expect(sourceTitle()).toBe('TV');
  });

  it('shows no seek bar for a radio even when it reports a length', async () => {
    connect(library());
    await render(kitchenOnly({ media_content_id: 'library://radio/5', media_duration: 3600, media_position: 10 }, 'playing'));
    expect(pick('.sonos-seek')).toBeNull();
    await render(kitchenOnly({ media_content_id: EPISODE_34, media_duration: 3600, media_position: 10 }, 'playing'));
    expect(pick('.sonos-seek')).not.toBeNull();
  });
});
