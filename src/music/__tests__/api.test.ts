import { describe, expect, it } from 'vitest';
import {
  fetchEpisodes,
  fetchInProgress,
  fetchPodcasts,
  fetchRadios,
  fetchSpotifyPlaylists,
  maImageUrl,
  mediaKindOf,
  newestFirst,
  playMedia,
  type BridgeConnection,
  type Episode,
} from '../api';
import episodes from './fixtures/episodes.json';
import inProgress from './fixtures/in-progress.json';
import playlists from './fixtures/playlists.json';
import podcasts from './fixtures/podcasts.json';
import radios from './fixtures/radios.json';

type Sent = { type: string; command: string; args: Record<string, unknown> };

/** A bridge that answers each command from `answers` and rejects the ones it does not know. */
function bridge(answers: Record<string, unknown>) {
  const sent: Sent[] = [];
  const connection: BridgeConnection = {
    async sendMessagePromise<T>(message: { type: string; [key: string]: unknown }): Promise<T> {
      sent.push(message as Sent);
      const command = (message as Sent).command;
      if (!(command in answers)) throw new Error(`unknown command ${command}`);
      return answers[command] as T;
    },
  };
  return { connection, sent };
}

describe('the radio library', () => {
  it('is asked for as a music_bridge/call', async () => {
    const { connection, sent } = bridge({ 'music/radios/library_items': radios });
    await fetchRadios(connection);
    expect(sent).toEqual([{ type: 'music_bridge/call', command: 'music/radios/library_items', args: {} }]);
  });

  it('keeps Music Assistant order and reads uri, name, favorite and the image of metadata.images', async () => {
    const { connection } = bridge({ 'music/radios/library_items': radios });
    const stations = await fetchRadios(connection);
    expect(stations.map(s => s.uri)).toEqual([
      'library://radio/6',
      'library://radio/7',
      'library://radio/5',
      'library://radio/4',
      'library://radio/8',
      'library://radio/9',
    ]);
    expect(stations[2]).toEqual({ uri: 'library://radio/5', name: 'Kanal 3 (AAC)', favorite: true, imageId: 'radio5proxy' });
    expect(stations.filter(s => s.favorite).map(s => s.name)).toEqual(['Kanal 3 (AAC)', 'Kanal 4 København (AAC)']);
  });

  it('has no image for a station without one', async () => {
    const { connection } = bridge({ 'music/radios/library_items': radios });
    expect((await fetchRadios(connection)).at(-1)?.imageId).toBeNull();
  });

  it('skips entries that are not stations, and answers nothing for an answer that is not a list', async () => {
    const { connection } = bridge({ 'music/radios/library_items': [null, 7, 'x', {}, { uri: 'library://radio/1' }, radios[0]] });
    expect((await fetchRadios(connection)).map(s => s.uri)).toEqual(['library://radio/6']);
    expect(await fetchRadios(bridge({ 'music/radios/library_items': { items: radios } }).connection)).toEqual([]);
  });

  it('rejects when the bridge does', async () => {
    await expect(fetchRadios(bridge({}).connection)).rejects.toThrow('unknown command');
  });
});

describe('the podcast library', () => {
  it('is asked for as a music_bridge/call', async () => {
    const { connection, sent } = bridge({ 'music/podcasts/library_items': podcasts });
    await fetchPodcasts(connection);
    expect(sent).toEqual([{ type: 'music_bridge/call', command: 'music/podcasts/library_items', args: {} }]);
  });

  it('reads what the episodes are asked for by, and has no image for a show with an empty metadata', async () => {
    const { connection } = bridge({ 'music/podcasts/library_items': podcasts });
    const shows = await fetchPodcasts(connection);
    expect(shows[0]).toEqual({
      uri: 'library://podcast/4',
      itemId: '4',
      provider: 'library',
      name: 'Fredagsbangers',
      imageId: null,
    });
    expect(shows[1].imageId).toBe('podcast5proxy');
  });
});

describe('the Spotify playlists', () => {
  it('are asked for as a music_bridge/call, most recently played first', async () => {
    const { connection, sent } = bridge({ 'music/playlists/library_items': playlists });
    await fetchSpotifyPlaylists(connection);
    expect(sent).toEqual([{ type: 'music_bridge/call', command: 'music/playlists/library_items', args: { order_by: 'last_played_desc' } }]);
  });

  it('keep Music Assistant order and read the library uri, name and the image of metadata.images', async () => {
    const { connection } = bridge({ 'music/playlists/library_items': playlists });
    const lists = await fetchSpotifyPlaylists(connection);
    expect(lists[0]).toEqual({ uri: 'library://playlist/12', name: 'Fredagsmix', imageId: 'playlist12proxy' });
    expect(lists.map(p => p.name)).toEqual(['Fredagsmix', 'Morgenkaffe', 'Løbeture', 'Efterårsdage']);
  });

  it('leave out the playlists Music Assistant makes up itself', async () => {
    const { connection } = bridge({ 'music/playlists/library_items': playlists });
    const lists = await fetchSpotifyPlaylists(connection);
    expect(lists.map(p => p.uri)).not.toContain('library://playlist/3');
  });

  it('have no image for a playlist without one', async () => {
    const { connection } = bridge({ 'music/playlists/library_items': playlists });
    expect((await fetchSpotifyPlaylists(connection)).find(p => p.name === 'Løbeture')?.imageId).toBeNull();
  });

  it('are none for a viewer whose Music Assistant has none', async () => {
    expect(await fetchSpotifyPlaylists(bridge({ 'music/playlists/library_items': [] }).connection)).toEqual([]);
  });

  it('skip entries that are not playlists, and answer nothing for an answer that is not a list', async () => {
    const { connection } = bridge({ 'music/playlists/library_items': [null, 7, 'x', {}, { uri: 'library://playlist/1' }, playlists[0]] });
    expect((await fetchSpotifyPlaylists(connection)).map(p => p.uri)).toEqual(['library://playlist/12']);
    expect(await fetchSpotifyPlaylists(bridge({ 'music/playlists/library_items': { items: playlists } }).connection)).toEqual([]);
  });

  it('reject when the bridge does', async () => {
    await expect(fetchSpotifyPlaylists(bridge({}).connection)).rejects.toThrow('unknown command');
  });
});

describe("a podcast's episodes", () => {
  const show = { itemId: '4', provider: 'library' };

  it('are asked for by item_id and provider_instance_id_or_domain', async () => {
    const { connection, sent } = bridge({ 'music/podcasts/podcast_episodes': episodes });
    await fetchEpisodes(connection, show);
    expect(sent).toEqual([
      {
        type: 'music_bridge/call',
        command: 'music/podcasts/podcast_episodes',
        args: { item_id: '4', provider_instance_id_or_domain: 'library' },
      },
    ]);
  });

  it('come newest first: by release date, then position, with an undated one last', async () => {
    const { connection } = bridge({ 'music/podcasts/podcast_episodes': episodes });
    expect((await fetchEpisodes(connection, show)).map(e => e.name)).toEqual([
      'Efterårets første',
      'Gæst i studiet',
      'Kort og godt',
      'Sæsonafslutning',
      'Første afsnit',
      'Bonusafsnit uden dato',
    ]);
  });

  it('carry the episode uri, not the podcast uri', async () => {
    const { connection } = bridge({ 'music/podcasts/podcast_episodes': episodes });
    const [newest] = await fetchEpisodes(connection, show);
    expect(newest.uri).toBe(
      'example_podcasts://podcast_episode/https://podcasts.example/4/feed.xml https://podcasts.example/4/episodes/34'
    );
  });

  it('read how far each one has been listened to', async () => {
    const { connection } = bridge({ 'music/podcasts/podcast_episodes': episodes });
    const byName = Object.fromEntries((await fetchEpisodes(connection, show)).map(e => [e.name, e]));
    expect(byName['Efterårets første']).toMatchObject({ durationS: 7200, resumeMs: 1_800_000, fullyPlayed: false, position: 34 });
    expect(byName['Efterårets første'].releasedAt).toBe('2026-10-02T16:00:00+00:00');
    expect(byName['Gæst i studiet']).toMatchObject({ durationS: 5400, resumeMs: 0, fullyPlayed: true });
    expect(byName['Første afsnit']).toMatchObject({ resumeMs: 0, fullyPlayed: false });
  });

  it('have no length when Music Assistant reports 0, and no release date when it reports none', async () => {
    const { connection } = bridge({ 'music/podcasts/podcast_episodes': episodes });
    const bonus = (await fetchEpisodes(connection, show)).at(-1);
    expect(bonus).toMatchObject({ name: 'Bonusafsnit uden dato', durationS: null, releasedAt: '' });
  });

  it('take their image from metadata.images', async () => {
    const { connection } = bridge({ 'music/podcasts/podcast_episodes': episodes });
    expect((await fetchEpisodes(connection, show)).every(e => e.imageId === 'podcast4cover')).toBe(true);
  });
});

describe('newest first', () => {
  const at = (releasedAt: string, position: number | null): Episode => ({
    uri: `u-${releasedAt}-${position}`,
    name: '',
    releasedAt,
    position,
    durationS: null,
    resumeMs: 0,
    fullyPlayed: false,
    imageId: null,
  });

  it('does not depend on the order Music Assistant answered in', () => {
    const a = at('2026-01-01T00:00:00+00:00', 1);
    const b = at('2026-02-01T00:00:00+00:00', 2);
    const c = at('2026-03-01T00:00:00+00:00', 3);
    expect(newestFirst([b, c, a])).toEqual([c, b, a]);
    expect(newestFirst([a, b, c])).toEqual([c, b, a]);
  });

  it('puts episodes of one moment in position order, and keeps the given order for equals', () => {
    const lowPosition = at('2026-01-01T00:00:00+00:00', 1);
    const highPosition = at('2026-01-01T00:00:00+00:00', 2);
    expect(newestFirst([lowPosition, highPosition])).toEqual([highPosition, lowPosition]);
    const first = at('2026-01-01T00:00:00+00:00', null);
    const second = { ...first, uri: 'second' };
    expect(newestFirst([first, second])).toEqual([first, second]);
  });

  it('leaves its input alone and puts unreadable dates last', () => {
    const dated = at('2026-01-01T00:00:00+00:00', 1);
    const broken = at('not a date', 9);
    const input = [broken, dated];
    expect(newestFirst(input)).toEqual([dated, broken]);
    expect(input).toEqual([broken, dated]);
  });
});

describe('episodes in progress', () => {
  it('are asked for as a music_bridge/call', async () => {
    const { connection, sent } = bridge({ 'music/in_progress_items': inProgress });
    await fetchInProgress(connection);
    expect(sent).toEqual([{ type: 'music_bridge/call', command: 'music/in_progress_items', args: {} }]);
  });

  it('are the podcast episodes only, in the order given, with the image of their single `image`', async () => {
    const { connection } = bridge({ 'music/in_progress_items': inProgress });
    const items = await fetchInProgress(connection);
    expect(items.map(i => i.name)).toEqual(['Efterårets første', '68: Et afsnit fra en anden udbyder']);
    expect(items.map(i => i.imageId)).toEqual(['podcast4cover', 'otherepisodeproxy']);
    expect(items[0].uri).toBe(
      'example_podcasts://podcast_episode/https://podcasts.example/4/feed.xml https://podcasts.example/4/episodes/34'
    );
  });
});

describe('starting something', () => {
  it('replaces the queue with the one uri', async () => {
    const { connection, sent } = bridge({ 'player_queues/play_media': null });
    await playMedia(connection, 'RINCON_QUEUE', 'library://radio/5');
    expect(sent).toEqual([
      {
        type: 'music_bridge/call',
        command: 'player_queues/play_media',
        args: { queue_id: 'RINCON_QUEUE', media: ['library://radio/5'], option: 'replace' },
      },
    ]);
  });

  it('rejects when the bridge does', async () => {
    await expect(playMedia(bridge({}).connection, 'q', 'library://radio/5')).rejects.toThrow('unknown command');
  });
});

describe('images', () => {
  it('come from the public image proxy at 256 pixels unless asked otherwise', () => {
    expect(maImageUrl('abc123')).toBe('https://ma.me2go.dk/imageproxy/abc123?size=256');
    expect(maImageUrl('abc123', 512)).toBe('https://ma.me2go.dk/imageproxy/abc123?size=512');
  });

  it('keep the proxy id one path segment', () => {
    expect(maImageUrl('a/b?c')).toBe('https://ma.me2go.dk/imageproxy/a%2Fb%3Fc?size=256');
  });
});

describe('the media type of a uri', () => {
  it('is the segment after the provider', () => {
    expect(mediaKindOf('library://radio/5')).toBe('radio');
    expect(mediaKindOf('builtin://radio/https://stream.example/live.m3u8')).toBe('radio');
    expect(
      mediaKindOf('example_podcasts://podcast_episode/https://podcasts.example/4/feed.xml https://podcasts.example/4/episodes/34')
    ).toBe('podcast_episode');
    expect(mediaKindOf('feeds--a1B2c3D4://podcast_episode/6f33c044')).toBe('podcast_episode');
    expect(mediaKindOf('library://track/86')).toBe('track');
  });

  it('is null for what is not a Music Assistant uri', () => {
    expect(mediaKindOf('')).toBeNull();
    expect(mediaKindOf('spotify')).toBeNull();
    expect(mediaKindOf('https://stream.example/live.m3u8')).toBeNull();
  });
});
