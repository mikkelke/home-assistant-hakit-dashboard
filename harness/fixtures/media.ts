import { readFileSync } from 'node:fs';
import type { HouseBuilder } from './builder';
import { HaError, type Attributes } from './types';
import { iso } from './time';

const musicFixture = (name: string): unknown[] =>
  JSON.parse(readFileSync(new URL(`../../src/music/__tests__/fixtures/${name}.json`, import.meta.url), 'utf8')) as unknown[];

const SPEAKERS: Array<{ id: string; name: string; maPlayerId: string }> = [
  { id: 'living_room', name: 'Living Room', maPlayerId: 'RINCON_74CA6064C9BF01400' },
  { id: 'kitchen', name: 'Kitchen', maPlayerId: 'RINCON_F0F6C1A525A201400' },
  { id: 'dining_room', name: 'Dining room', maPlayerId: 'RINCON_C43875EC190201400' },
  { id: 'bedroom', name: 'Bedroom', maPlayerId: 'RINCON_F0F6C1A526E601400' },
  { id: 'bathroom', name: 'Bathroom', maPlayerId: 'RINCON_F0F6C1A5264A01400' },
  { id: 'guest_bathroom', name: 'Guest bathroom', maPlayerId: 'RINCON_804AF2CB366601400' },
  { id: 'claudias_room', name: 'Claudias room', maPlayerId: 'RINCON_804AF2CB397801400' },
  { id: 'kristines_room', name: 'Kristines room', maPlayerId: 'RINCON_804AF2CB391401400' },
  { id: 'rooftop', name: 'Rooftop', maPlayerId: 'RINCON_74CA6021706E01400' },
];

const SOURCES = ['Line-in', 'TV', 'Spotify', 'Podcasts'];

const PODCAST_EPISODE = 'example_podcasts://podcast_episode/https://podcasts.example/4/feed.xml https://podcasts.example/4/episodes/34';

const LONG_TITLE =
  'Concerto for Violin, Cello and Orchestra in A minor, Op. 102: II. Andante (Live at the Royal Danish Theatre, Copenhagen, 2019 Remastered Edition)';

interface Playing {
  state: string;
  title?: string;
  artist?: string;
  contentId?: string;
  volume: number;
  muted?: boolean;
  group?: string[];
  duration?: number;
  position?: number;
  source?: string;
}

const PLAYING: Record<string, Playing> = {
  living_room: {
    state: 'playing',
    title: 'Kanal 4 København (AAC)',
    contentId: 'library://radio/4',
    volume: 0.28,
    group: ['living_room', 'kitchen'],
    source: 'Spotify',
  },
  kitchen: {
    state: 'playing',
    title: 'Kanal 4 København (AAC)',
    contentId: 'library://radio/4',
    volume: 0.22,
    group: ['living_room', 'kitchen'],
  },
  dining_room: { state: 'idle', volume: 0.3 },
  bedroom: {
    state: 'paused',
    title: 'Efterårets første',
    artist: 'Fredagsbangers',
    contentId: PODCAST_EPISODE,
    volume: 0.15,
    duration: 7200,
    position: 1800,
  },
  bathroom: { state: 'idle', volume: 0.2 },
  guest_bathroom: { state: 'off', volume: 0 },
  claudias_room: { state: 'unavailable', volume: 0 },
  kristines_room: {
    state: 'playing',
    title: LONG_TITLE,
    artist: 'Copenhagen Philharmonic Orchestra and the Friends of the Conservatory Chamber Ensemble',
    contentId: 'spotify://track/example-long',
    volume: 0,
    muted: true,
    duration: 1280,
    position: 410,
  },
  rooftop: { state: 'idle', volume: 0.35 },
};

function player(id: string, name: string, spec: Playing, now: number): Attributes {
  const dead = spec.state === 'unavailable';
  return {
    friendly_name: name,
    volume_level: spec.volume,
    is_volume_muted: spec.muted ?? false,
    group_members: dead ? [] : (spec.group ?? [id]).map(member => `media_player.${member}`),
    source_list: SOURCES,
    ...(spec.source ? { source: spec.source } : {}),
    ...(spec.title ? { media_title: spec.title } : {}),
    ...(spec.artist ? { media_artist: spec.artist } : {}),
    ...(spec.contentId ? { media_content_id: spec.contentId } : {}),
    ...(spec.duration
      ? { media_duration: spec.duration, media_position: spec.position ?? 0, media_position_updated_at: iso(now - 20_000) }
      : {}),
    supported_features: 1180031,
  };
}

export function addMedia(h: HouseBuilder): void {
  for (const speaker of SPEAKERS) {
    const spec = PLAYING[speaker.id];
    h.put(`media_player.${speaker.id}`, spec.state, player(speaker.id, speaker.name, spec, h.now), {
      ago: spec.state === 'playing' ? 42 : 240,
    });
    h.put(`media_player.${speaker.id}_2`, spec.state, { friendly_name: `${speaker.name} (Sonos)` }, { ago: 240 });
  }
  h.put('media_player.mikkels_phone', 'unavailable', { friendly_name: 'Mikkels phone' });
  h.put('input_boolean.family_volume_sync_party', 'off', { friendly_name: 'Family volume sync party' });
  h.put('input_boolean.rooftop_keep_speaker_on', 'off', { friendly_name: 'Rooftop keep speaker on' });
  h.put('binary_sensor.rooftop_charging', 'on', { friendly_name: 'Rooftop charging', device_class: 'battery_charging' });

  h.put('media_player.living_room_tv', 'on', {
    friendly_name: 'Living room TV',
    volume_level: 0.18,
    is_volume_muted: false,
    source: 'HDMI 1',
    source_list: ['HDMI 1', 'HDMI 2', 'HDMI 3', 'HDMI4', 'TV'],
    app_name: 'Apple TV',
    supported_features: 152461,
  });
  h.put('media_player.living_room_apple_tv', 'playing', {
    friendly_name: 'Living room Apple TV',
    media_title: 'The Long Sunday: Season 2, Episode 6',
    app_name: 'Streaming',
    media_duration: 2760,
    media_position: 1210,
    media_position_updated_at: iso(h.now - 10_000),
  });
  h.put('remote.living_room_apple_tv', 'on', { friendly_name: 'Living room Apple TV remote' });
  h.put('media_player.living_room_cast', 'idle', { friendly_name: 'Living room Chromecast' });
  h.put('select.living_room_tv_lift_position', 'Living room', {
    friendly_name: 'TV lift position',
    options: ['Living room', 'Wall', 'Kitchen'],
  });
  h.put('media_player.bedroom_tv', 'off', { friendly_name: 'Bedroom TV', source_list: ['HDMI 1', 'HDMI 2'], supported_features: 152461 });
  h.put('media_player.bedroom_apple_tv', 'standby', { friendly_name: 'Bedroom Apple TV' });
  h.put('remote.bedroom_apple_tv', 'off', { friendly_name: 'Bedroom Apple TV remote' });

  const answers: Record<string, (args: Attributes) => unknown> = {
    'music/radios/library_items': () => musicFixture('radios'),
    'music/podcasts/library_items': () => musicFixture('podcasts'),
    'music/playlists/library_items': args =>
      args.played_only === true ? musicFixture('playlists').slice(0, 2) : musicFixture('playlists'),
    'music/playlists/playlist_tracks': () => {
      const tracks = musicFixture('playlist-tracks') as Array<Record<string, unknown>>;
      const extra = Array.from({ length: 64 }, (_, index) => ({
        ...tracks[index % tracks.length],
        item_id: `generated${index}`,
        uri: `spotify--a1B2c3D4://track/generated${index}`,
        name: `${tracks[index % tracks.length].name} ${index + 8}`,
        available: true,
      }));
      return [...tracks, ...extra];
    },
    'music/podcasts/podcast_episodes': () => musicFixture('episodes'),
    'music/in_progress_items': () => musicFixture('in-progress'),
    'player_queues/play_media': () => null,
  };
  h.ws['music_bridge/call'] = message => {
    const answer = answers[String(message.command)];
    if (!answer) throw new HaError('unknown_command', `Unknown bridge command: ${String(message.command)}`);
    return answer((message.args ?? {}) as Attributes);
  };
}
