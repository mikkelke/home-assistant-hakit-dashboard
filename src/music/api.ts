/** Music Assistant through the `music_bridge/call` websocket command. The bridge runs each command as the Home Assistant
 * user looking at the dashboard, so answers are that user's own library, provider filter and resume positions. */

export interface BridgeConnection {
  sendMessagePromise<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
}

const MA_IMAGE_PROXY = 'https://ma.me2go.dk/imageproxy';

/** A Music Assistant image by its `proxy_id`, at `size` pixels. */
export function maImageUrl(proxyId: string, size = 256): string {
  return `${MA_IMAGE_PROXY}/${encodeURIComponent(proxyId)}?size=${size}`;
}

export interface Radio {
  uri: string;
  name: string;
  favorite: boolean;
  imageId: string | null;
}

export interface Podcast {
  uri: string;
  /** With `provider`, what `music/podcasts/podcast_episodes` asks for. */
  itemId: string;
  provider: string;
  name: string;
  imageId: string | null;
}

export interface Playlist {
  uri: string;
  name: string;
  imageId: string | null;
}

export interface Episode {
  /** The episode's own uri. Playing a podcast uri instead starts at its oldest unplayed episode. */
  uri: string;
  name: string;
  /** ISO timestamp; empty when Music Assistant has none. */
  releasedAt: string;
  position: number | null;
  durationS: number | null;
  /** 0 when never started. */
  resumeMs: number;
  fullyPlayed: boolean;
  imageId: string | null;
}

/** A started, unfinished episode from `music/in_progress_items`; that command reports no position or duration. */
export interface ResumeItem {
  uri: string;
  name: string;
  imageId: string | null;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Library items carry their images in `metadata.images`; the short `ItemMapping` objects of `in_progress_items` in `image`. */
function imageIdOf(item: Json): string | null {
  const image = record(list(record(item.metadata)?.images)[0]) ?? record(item.image);
  return text(image?.proxy_id) || null;
}

function callBridge<T>(connection: BridgeConnection, command: string, args: Json = {}): Promise<T> {
  return connection.sendMessagePromise<T>({ type: 'music_bridge/call', command, args });
}

function toRadio(raw: unknown): Radio | null {
  const item = record(raw);
  const uri = text(item?.uri);
  const name = text(item?.name);
  return item && uri && name ? { uri, name, favorite: item.favorite === true, imageId: imageIdOf(item) } : null;
}

function toPodcast(raw: unknown): Podcast | null {
  const item = record(raw);
  const uri = text(item?.uri);
  const itemId = text(item?.item_id);
  const provider = text(item?.provider);
  const name = text(item?.name);
  return item && uri && itemId && provider && name ? { uri, itemId, provider, name, imageId: imageIdOf(item) } : null;
}

/** Only playlists that live on Spotify; the ones Music Assistant generates itself have no Spotify mapping. */
function toSpotifyPlaylist(raw: unknown): Playlist | null {
  const item = record(raw);
  const uri = text(item?.uri);
  const name = text(item?.name);
  const onSpotify = list(item?.provider_mappings).some(mapping => record(mapping)?.provider_domain === 'spotify');
  return item && uri && name && onSpotify ? { uri, name, imageId: imageIdOf(item) } : null;
}

function toEpisode(raw: unknown): Episode | null {
  const item = record(raw);
  const uri = text(item?.uri);
  const name = text(item?.name);
  if (!item || !uri || !name) return null;
  const durationS = amount(item.duration);
  return {
    uri,
    name,
    releasedAt: text(record(item.metadata)?.release_date),
    position: amount(item.position),
    durationS: durationS !== null && durationS > 0 ? durationS : null,
    resumeMs: Math.max(0, amount(item.resume_position_ms) ?? 0),
    fullyPlayed: item.fully_played === true,
    imageId: imageIdOf(item),
  };
}

function toResumeItem(raw: unknown): ResumeItem | null {
  const item = record(raw);
  const uri = text(item?.uri);
  const name = text(item?.name);
  return item && item.media_type === 'podcast_episode' && uri && name ? { uri, name, imageId: imageIdOf(item) } : null;
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

/** The library's radio stations in the order Music Assistant sorts them. */
export async function fetchRadios(connection: BridgeConnection): Promise<Radio[]> {
  return list(await callBridge(connection, 'music/radios/library_items'))
    .map(toRadio)
    .filter(present);
}

export async function fetchPodcasts(connection: BridgeConnection): Promise<Podcast[]> {
  return list(await callBridge(connection, 'music/podcasts/library_items'))
    .map(toPodcast)
    .filter(present);
}

/** The viewer's Spotify playlists, the most recently played one first. */
export async function fetchSpotifyPlaylists(connection: BridgeConnection): Promise<Playlist[]> {
  return list(await callBridge(connection, 'music/playlists/library_items', { order_by: 'last_played_desc' }))
    .map(toSpotifyPlaylist)
    .filter(present);
}

function descending(a: number, b: number): number {
  return a === b ? 0 : b > a ? 1 : -1;
}

/** Newest first, by release date and then position; an episode without a date sorts last. */
export function newestFirst(episodes: readonly Episode[]): Episode[] {
  const releasedMs = (episode: Episode) => {
    const ms = Date.parse(episode.releasedAt);
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  const positionOf = (episode: Episode) => episode.position ?? -Infinity;
  return [...episodes].sort((a, b) => descending(releasedMs(a), releasedMs(b)) || descending(positionOf(a), positionOf(b)));
}

/** Every episode of a podcast, newest first. */
export async function fetchEpisodes(connection: BridgeConnection, podcast: Pick<Podcast, 'itemId' | 'provider'>): Promise<Episode[]> {
  const raw = await callBridge(connection, 'music/podcasts/podcast_episodes', {
    item_id: podcast.itemId,
    provider_instance_id_or_domain: podcast.provider,
  });
  return newestFirst(list(raw).map(toEpisode).filter(present));
}

/** Podcast episodes the viewer has started and not finished, most recently played first. */
export async function fetchInProgress(connection: BridgeConnection): Promise<ResumeItem[]> {
  return list(await callBridge(connection, 'music/in_progress_items'))
    .map(toResumeItem)
    .filter(present);
}

/** Replaces the queue with one item. `queueId` is the queue of the group's coordinator. */
export async function playMedia(connection: BridgeConnection, queueId: string, uri: string): Promise<void> {
  await callBridge(connection, 'player_queues/play_media', { queue_id: queueId, media: [uri], option: 'replace' });
}

/** The media type segment of a Music Assistant uri (`library://radio/5` is `radio`), or null for anything else. */
export function mediaKindOf(uri: string): string | null {
  return /^[\w.-]+:\/\/(\w+)\//.exec(uri)?.[1] ?? null;
}
