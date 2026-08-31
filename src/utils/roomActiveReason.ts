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

function humanizeEntityId(entityId: string): string {
  const objectId = entityId.split('.').slice(1).join('.');
  return objectId
    .split('_')
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function friendlyName(entity: HassEntity | undefined, entityId: string): string {
  const raw = entity?.attributes?.friendly_name;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : humanizeEntityId(entityId);
}

/** Parses binary_sensor.<zone>_active's `reason` attribute value ("<tier>:<entity_id>", or
 * "all_clear" when nothing asserts) into a pretty tier + device label. `entities` is used
 * only to look up the witness's live friendly_name for display - if it's not available (e.g.
 * a past history entry, or a caller that doesn't track live state), the entity_id is
 * humanized instead, so this still degrades gracefully rather than failing. Returns null
 * when `reason` is missing, "all_clear", or malformed - callers should fall back to a plain
 * "Occupied" label in that case, never show a broken one. */
export function parseRoomActiveReason(reason: unknown, entities?: HassEntities): RoomActiveReason | null {
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
    witnessLabel: friendlyName(entities?.[witnessEntityId], witnessEntityId),
  };
}

/** Same as parseRoomActiveReason, but reads straight off a live presence entity (only
 * returns a result while it's actually "on" - an "off" entity may still carry a stale
 * `reason` attribute from its last active moment, which must never be shown as current). */
export function resolveRoomActiveReason(presenceEntity: HassEntity | undefined, entities: HassEntities): RoomActiveReason | null {
  if (!presenceEntity || presenceEntity.state !== 'on') return null;
  return parseRoomActiveReason(presenceEntity.attributes?.reason, entities);
}
