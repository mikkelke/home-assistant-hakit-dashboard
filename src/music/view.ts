import { homeWallTime } from '../energy/homeTime';
import type { Episode, Podcast, Radio } from './api';

/** The station name without a trailing codec tag, which radio directories add: `DR P3 (AAC)` reads `DR P3`. */
export function radioLabel(name: string): string {
  return name.replace(/\s*\((?:aac\+?|mp3|ogg|opus|flac|hls|\d+\s*k(?:bps)?)\)\s*$/i, '');
}

/** Favorites first, each group in its given order. */
export function favoritesFirst(radios: readonly Radio[]): Radio[] {
  return [...radios.filter(radio => radio.favorite), ...radios.filter(radio => !radio.favorite)];
}

export function podcastsByName(podcasts: readonly Podcast[]): Podcast[] {
  return [...podcasts].sort((a, b) => a.name.localeCompare(b.name, 'da'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2 Oct 2026`, on the house's calendar; empty for a missing or unreadable timestamp. */
export function formatReleased(releasedAt: string): string {
  const ms = Date.parse(releasedAt);
  if (Number.isNaN(ms)) return '';
  const { year, month, day } = homeWallTime(ms);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `45 min`, `2 h`, `1 h 30 min`. */
export function formatRunTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** What an episode row shows about listening progress; `fraction` is how far in, or null without a known length. */
export type EpisodeMark = { kind: 'played' } | { kind: 'resume'; fraction: number | null } | null;

export function episodeMark(episode: Episode): EpisodeMark {
  if (episode.fullyPlayed) return { kind: 'played' };
  if (episode.resumeMs <= 0) return null;
  const fraction = episode.durationS === null ? null : Math.min(1, episode.resumeMs / 1000 / episode.durationS);
  return { kind: 'resume', fraction };
}
