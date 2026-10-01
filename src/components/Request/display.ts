import type { Item, Status } from './types';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

export const STATUS_ICON: Record<Exclude<Status, 'none'>, string> = {
  available: 'mdi:check',
  pending: 'mdi:clock-outline',
  processing: 'mdi:download',
  partial: 'mdi:circle-half-full',
};

export const STATUS_LABEL: Record<Exclude<Status, 'none'>, string> = {
  available: 'In Plex',
  pending: 'Requested',
  processing: 'Preparing',
  partial: 'Partly in Plex',
};

export function posterUrl(posterPath: string): string {
  return `${POSTER_BASE}${posterPath}`;
}

/** Stable per-title colour for posters that have no artwork. */
export function placeholderGradient(tmdbId: number): string {
  const hue = (tmdbId * 47) % 360;
  return `linear-gradient(160deg, hsl(${hue} 45% 32%), hsl(${hue} 50% 12%))`;
}

export function itemKey(item: Pick<Item, 'mediaType' | 'tmdbId'>): string {
  return `${item.mediaType}:${item.tmdbId}`;
}

/** `items` with the status of `key` replaced; the very same array when nothing changes. */
export function withStatus<T extends Pick<Item, 'mediaType' | 'tmdbId' | 'status'>>(items: T[], key: string, status: Status): T[] {
  if (!items.some(item => itemKey(item) === key && item.status !== status)) return items;
  return items.map(item => (itemKey(item) === key ? { ...item, status } : item));
}

export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
