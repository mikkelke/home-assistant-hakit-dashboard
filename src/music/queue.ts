import { SONOS_SPEAKERS } from '../config/speakers';
import type { HassEntities } from '../types';

/** The Music Assistant queue to play on for a speaker. The entity reports the queue its speaker is playing (a grouped
 * follower reports its leader's), which is null while it has none; the speaker's own player id is then its queue. */
export function queueIdFor(entities: HassEntities | undefined, speakerId: string): string | null {
  const active = entities?.[speakerId]?.attributes?.active_queue;
  if (typeof active === 'string' && active !== '') return active;
  return SONOS_SPEAKERS.find(speaker => speaker.id === speakerId)?.maPlayerId ?? null;
}
