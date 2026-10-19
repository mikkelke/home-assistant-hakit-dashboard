import type { Connection } from 'home-assistant-js-websocket';
import { list } from './api';
import type { Item, Status } from './types';

/** A series on DR. */
export interface DrShow {
  id: string;
  title: string;
  path: string;
  /** DR's own image URL, used as it is; null when DR has none. */
  poster: string | null;
  overview: string;
}

export interface DrResult extends DrShow {
  following: boolean;
}

export interface DrFollowed extends DrShow {
  /** Episodes DR lists; null until the first sync. */
  listed: number | null;
  /** How many of the listed episodes are downloaded. */
  downloaded: number;
}

/** What the detail sheet opens with: the show, and what the opener already knows about following it. */
export interface DrOpen {
  show: DrShow;
  following: boolean;
  /** The progress, when the opener has it (the followed list); null when it still has to be fetched. */
  entry: DrFollowed | null;
}

function showOf<T extends DrShow>(raw: T): T {
  return { ...raw, poster: raw.poster || null, overview: raw.overview ?? '' };
}

function followedOf(raw: DrFollowed): DrFollowed {
  return { ...showOf(raw), listed: raw.listed ?? null, downloaded: raw.downloaded ?? 0 };
}

export async function searchDr(conn: Connection, query: string): Promise<DrResult[]> {
  const raw = await conn.sendMessagePromise<{ results?: unknown }>({ type: 'media_requests/drtv_search', query });
  return list<DrResult>(raw.results).map(result => ({ ...showOf(result), following: result.following === true }));
}

export async function fetchDrFollowing(conn: Connection): Promise<DrFollowed[]> {
  const raw = await conn.sendMessagePromise<{ series?: unknown }>({ type: 'media_requests/drtv_following' });
  return list<DrFollowed>(raw.series).map(followedOf);
}

export async function followDr(conn: Connection, path: string): Promise<DrFollowed> {
  return followedOf(await conn.sendMessagePromise<DrFollowed>({ type: 'media_requests/drtv_follow', path }));
}

/** The series id travels as `seriesId`: the message's own `id` is the connection's command counter. */
export async function unfollowDr(conn: Connection, seriesId: string): Promise<void> {
  await conn.sendMessagePromise({ type: 'media_requests/drtv_unfollow', seriesId });
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** DR wins for shows DR has: Seerr TV items titled like one of `dr` are dropped. The very same array when none are. */
export function withoutDrTitles(items: Item[], dr: ReadonlyArray<DrShow>): Item[] {
  if (dr.length === 0) return items;
  const titles = new Set(dr.map(show => normalizeTitle(show.title)));
  const kept = items.filter(item => item.mediaType !== 'tv' || !titles.has(normalizeTitle(item.title)));
  return kept.length === items.length ? items : kept;
}

/** How far a followed series is, in the Seerr status vocabulary, so the same icons and tones apply. */
export function drStatus({ listed, downloaded }: Pick<DrFollowed, 'listed' | 'downloaded'>): Exclude<Status, 'none'> {
  if (listed === null) return 'pending';
  if (downloaded === 0) return 'processing';
  return downloaded >= listed ? 'available' : 'partial';
}

export function progressText({ listed, downloaded }: Pick<DrFollowed, 'listed' | 'downloaded'>): string {
  return listed === null ? 'Waiting for first download' : `${downloaded} of ${listed} episodes in Plex`;
}

/** A DR id is digits; this turns it into the number that picks a placeholder colour. */
export function drSeed(id: string): number {
  return Number.parseInt(id, 10) || 0;
}
