import type { Speaker } from '../types';

// All Sonos speakers for grouping. Replace entity IDs and names with your own.
export const SONOS_SPEAKERS: Speaker[] = [
  { id: 'media_player.living_room', name: 'Living Room', maPlayerId: 'RINCON_74CA6064C9BF01400' },
  { id: 'media_player.kitchen', name: 'Kitchen', maPlayerId: 'RINCON_F0F6C1A525A201400' },
  { id: 'media_player.dining_room', name: 'Dining room', maPlayerId: 'RINCON_C43875EC190201400' },
  { id: 'media_player.bedroom', name: 'Bedroom', maPlayerId: 'RINCON_F0F6C1A526E601400' },
  { id: 'media_player.bathroom', name: 'Bathroom', maPlayerId: 'RINCON_F0F6C1A5264A01400' },
  { id: 'media_player.guest_bathroom', name: 'Guest bathroom', maPlayerId: 'RINCON_804AF2CB366601400' },
  { id: 'media_player.claudias_room', name: 'Claudias room', maPlayerId: 'RINCON_804AF2CB397801400' },
  { id: 'media_player.kristines_room', name: 'Kristines room', maPlayerId: 'RINCON_804AF2CB391401400' },
  { id: 'media_player.rooftop', name: 'Rooftop', maPlayerId: 'RINCON_74CA6021706E01400' },
];

/** The speakers the family-room volume sync covers (`speakers` in family_room_volume_sync.yaml). */
export const FAMILY_ZONE: string[] = [
  'media_player.living_room',
  'media_player.kitchen',
  'media_player.dining_room',
  'media_player.rooftop',
];

type SpeakerEntities = Record<string, { attributes?: { group_members?: unknown } } | undefined> | null | undefined;

function listedMembers(entities: SpeakerEntities, id: string): string[] {
  const raw = entities?.[id]?.attributes?.group_members;
  return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
}

/** The speakers a speaker plays with, coordinator first. Only a coordinator's `group_members` is trusted: Music Assistant
 * leaves a member's own list stale or empty, so a speaker no coordinator lists plays alone. */
export function groupOf(entities: SpeakerEntities, id: string): string[] {
  for (const speaker of SONOS_SPEAKERS) {
    const members = listedMembers(entities, speaker.id);
    if (members.length > 1 && members[0] === speaker.id && members.includes(id)) return members;
  }
  return [id];
}

// media_player entities whose raw-Sonos sibling does not follow the `${id}_2`
// convention (empty today; add entries if a speaker is renamed in HA without
// its raw Sonos twin following).
const RAW_SONOS_ENTITY_OVERRIDES: Record<string, string> = {};

// Raw Sonos integration entity for a base (Music Assistant) media_player id.
export function rawSonosEntityId(baseId: string): string {
  return RAW_SONOS_ENTITY_OVERRIDES[baseId] ?? `${baseId}_2`;
}
