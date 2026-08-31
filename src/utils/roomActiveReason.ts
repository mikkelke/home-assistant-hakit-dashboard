import type { HassEntities, HassEntity } from '../types';

/** Icon + short label per witness tier, matching room_active.py's own priority order
 * (bed > spot > room > channel) and the copy convention from the migration plan. */
const TIER_META: Record<string, { icon: string; label: string }> = {
  bed: { icon: 'mdi:bed', label: 'In bed' },
  spot: { icon: 'mdi:map-marker-radius', label: 'At a spot' },
  room: { icon: 'mdi:account', label: 'In the room' },
  channel: { icon: 'mdi:motion-sensor', label: 'Movement' },
};

const DEFAULT_ICON = 'mdi:account';

export interface RoomActiveReason {
  tier: string;
  tierLabel: string;
  icon: string;
  witnessEntityId: string | null;
  witnessLabel: string | null;
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function humanizeEntityId(entityId: string): string {
  const objectId = entityId.split('.').slice(1).join('.');
  return titleCase(objectId.split('_').join(' '));
}

/** Drops `zone`'s own words from the front of `words`, only when they match in full (e.g.
 * zone "kristines_room" strips a leading "Kristines Room"/"kristines room" pair but leaves
 * "Left Bedside" alone, since "Left" != "Bedroom"). Room context is already shown elsewhere
 * (the room title, the tier icon/label) - repeating it in the device name is just noise. */
function stripZonePrefix(words: string[], zone: string): string[] {
  const zoneWords = zone.split('_').filter(Boolean);
  let i = 0;
  while (i < zoneWords.length && words[i]?.toLowerCase() === zoneWords[i].toLowerCase()) {
    i++;
  }
  return i === zoneWords.length ? words.slice(i) : words;
}

/** HA auto-generates witness names like "Dining room presence Occupancy" or "Kristines room
 * desk presence Occupancy" - the zone name duplicates context already on screen, and the
 * device_class suffix ("Occupancy"/"Pir detection"/"Motion state") is verbose boilerplate.
 * This strips the zone prefix (see stripZonePrefix) and normalizes the suffix to a short
 * canonical word, leaving only what actually distinguishes this witness from its siblings -
 * "Desk", "PIR", "Bath Motion" - or "Presence" when nothing else was there to begin with. */
function prettifyWitnessName(raw: string, zone?: string): string {
  // This one device's auto-name embeds its Zigbee short address and repeats "Bed" twice -
  // no generic rule fixes both, hardcode it (this household's one pressure strip).
  if (/6b9c94/i.test(raw)) return 'Pressure Strip';

  let words = raw.trim().split(/\s+/).filter(Boolean);
  if (zone) words = stripZonePrefix(words, zone);

  let s = titleCase(words.join(' '));
  s = s.replace(/\bPir Detection\b/, 'PIR');
  s = s.replace(/\bMotion State\b/, 'Motion');
  s = s.replace(/\bOccupancy\b/, '');
  s = s.replace(/\s+/g, ' ').trim();

  if (s === '' || s === 'Presence') return 'Presence';

  // "<qualifier> Presence" -> "<Qualifier>": Presence is the default/implied reading, so
  // it's only worth keeping the word when nothing else survived to say instead.
  const withoutPresence = s
    .replace(/\bPresence\b/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutPresence || s;
}

function friendlyName(entity: HassEntity | undefined, entityId: string, zone?: string): string {
  const raw = entity?.attributes?.friendly_name;
  const base = typeof raw === 'string' && raw.trim() !== '' ? raw : humanizeEntityId(entityId);
  return prettifyWitnessName(base, zone);
}

/** Pulls the zone out of a room-active entity id (binary_sensor.<zone>_active), or undefined
 * if it doesn't match that shape. */
export function extractRoomActiveZone(entityId: string): string | undefined {
  return /^binary_sensor\.([a-z0-9_]+)_active$/.exec(entityId)?.[1];
}

/** Parses binary_sensor.<zone>_active's `reason` attribute value ("<tier>:<entity_id>", or
 * "all_clear" when nothing asserts) into a pretty tier + device label. `entities` is used
 * only to look up the witness's live friendly_name for display - if it's not available (e.g.
 * a past history entry, or a caller that doesn't track live state), the entity_id is
 * humanized instead, so this still degrades gracefully rather than failing. `zone` (the
 * owning room, e.g. "dining_room") is used only to trim that room's own name out of the
 * witness label - omit it and the label just keeps whatever HA called the room. Returns null
 * when `reason` is missing, "all_clear", or malformed - callers should fall back to a plain
 * "Occupied" label in that case, never show a broken one. */
export function parseRoomActiveReason(reason: unknown, entities?: HassEntities, zone?: string): RoomActiveReason | null {
  if (typeof reason !== 'string' || reason === 'all_clear') return null;

  const sep = reason.indexOf(':');
  if (sep === -1) return null;
  const tier = reason.slice(0, sep);
  const witnessEntityId = reason.slice(sep + 1);
  if (!witnessEntityId) return null;

  const meta = TIER_META[tier] ?? { icon: DEFAULT_ICON, label: 'Occupied' };
  return {
    tier,
    tierLabel: meta.label,
    icon: meta.icon,
    witnessEntityId,
    witnessLabel: friendlyName(entities?.[witnessEntityId], witnessEntityId, zone),
  };
}

/** Same as parseRoomActiveReason, but reads straight off a live presence entity (only
 * returns a result while it's actually "on" - an "off" entity may still carry a stale
 * `reason` attribute from its last active moment, which must never be shown as current).
 * Zone is derived automatically from the entity's own id. */
export function resolveRoomActiveReason(presenceEntity: HassEntity | undefined, entities: HassEntities): RoomActiveReason | null {
  if (!presenceEntity || presenceEntity.state !== 'on') return null;
  return parseRoomActiveReason(presenceEntity.attributes?.reason, entities, extractRoomActiveZone(presenceEntity.entity_id));
}
