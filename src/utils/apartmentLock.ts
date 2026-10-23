import { APARTMENT_LOCK_CLOUD_ENTITY, APARTMENT_LOCK_ENTITY, FRONT_DOOR_LOCK_ENTITY } from '../config/entities';
import type { HassEntities, HassEntity } from '../types';

type LockState = 'locked' | 'unlocked' | 'locking' | 'unlocking' | 'jammed' | 'unknown';
type LockAction = 'lock' | 'unlock';

// LockHealth publishes computed_at every 60 s, even without a physical lock event.
// Three missed ticks mean the publisher has stopped; raw twins are push-only and
// MUST NOT be expired by their last_changed/last_updated age.
const PUBLISHER_MAX_AGE_MS = 180_000;
const TWIN_IDS = [FRONT_DOOR_LOCK_ENTITY, APARTMENT_LOCK_CLOUD_ENTITY] as const;

const PRESENTATION: Record<LockState, { label: string; icon: string }> = {
  locked: { label: 'Locked', icon: 'mdi:lock' },
  unlocked: { label: 'Unlocked', icon: 'mdi:lock-open-variant' },
  locking: { label: 'Locking', icon: 'mdi:lock-clock' },
  unlocking: { label: 'Unlocking', icon: 'mdi:lock-clock' },
  jammed: { label: 'Jammed', icon: 'mdi:lock-alert' },
  unknown: { label: 'Unknown', icon: 'mdi:lock-question' },
};

function lockState(raw: string | undefined): LockState {
  return raw && Object.hasOwn(PRESENTATION, raw) ? (raw as LockState) : 'unknown';
}

function publisherIsFresh(entity: HassEntity, nowMs: number): boolean {
  // computed_at survives HA restart/restore, unlike an entity's last_updated.
  const computed = entity.attributes.computed_at;
  if (typeof computed !== 'string') return false;
  const age = nowMs - Date.parse(computed);
  return Number.isFinite(age) && age >= -60_000 && age <= PUBLISHER_MAX_AGE_MS;
}

/** One display/toggle model for the apartment. Arbitration stays in LockHealth.
 * A live publisher's unknown is deliberate (e.g. an unresolved restart tie), not
 * permission to choose a raw twin or EntryTruth's fallback_ble attribute.
 * If the publisher is absent/down/stale, fall back only to agreeing valid twins
 * or the sole valid twin. Disagreement remains unknown; never pick a timestamp winner.
 */
export function resolveApartmentLock(entities: HassEntities | undefined, nowMs = Date.now()) {
  const semantic = entities?.[APARTMENT_LOCK_ENTITY];
  const twins = TWIN_IDS.flatMap(id => (entities?.[id] ? [entities[id]] : []));
  const validTwins = twins.filter(entity => lockState(entity.state) !== 'unknown');
  const semanticLive = !!semantic && semantic.state !== 'unavailable' && publisherIsFresh(semantic, nowMs);
  const agrees = validTwins.length > 0 && validTwins.every(entity => entity.state === validTwins[0].state);
  const source = semanticLive ? semantic : agrees ? validTwins[0] : undefined;
  const state = lockState(source?.state);
  const degraded = !semanticLive;

  // A fallback duration begins at the newest agreeing report. Never carry an old
  // BLE unlock duration across a semantic lock/relock, or use entry_secure's
  // last_changed (opening the door changes it independently of the lock).
  const since = semanticLive
    ? semantic.last_changed
    : agrees && validTwins.every(entity => entity.last_changed && Number.isFinite(Date.parse(entity.last_changed)))
      ? validTwins.reduce((latest, entity) => (Date.parse(entity.last_changed!) > Date.parse(latest.last_changed!) ? entity : latest))
          .last_changed
      : undefined;
  // Prefer the local command transport when reachable. Its reported state does
  // not determine intent; a stale-but-reachable BLE twin can still accept unlock.
  const target = twins.find(entity => entity.state === 'locked' || entity.state === 'unlocked');
  const service: LockAction | null = state === 'locked' ? 'unlock' : state === 'unlocked' ? 'lock' : null;
  const command = target && service ? { domain: 'lock', service, target: { entity_id: target.entity_id } } : null;
  const actionLabel = command
    ? command.service === 'unlock'
      ? 'Unlock the apartment'
      : 'Lock the apartment'
    : state === 'locked' || state === 'unlocked'
      ? 'Apartment lock control unavailable'
      : `Apartment lock ${PRESENTATION[state].label.toLowerCase()}`;

  return {
    state,
    ...PRESENTATION[state],
    present: !!semantic || twins.length > 0,
    degraded,
    sourceEntityId: source?.entity_id ?? null,
    historyEntityId: semantic?.entity_id ?? twins[0]?.entity_id ?? null,
    since,
    command,
    actionLabel,
  };
}

/** Re-read at the tap, including publisher freshness and transport availability.
 * If truth changed since the label was drawn, do not send the opposite command.
 */
export function apartmentLockToggleCommand(entities: HassEntities, expected: LockAction | undefined, nowMs = Date.now()) {
  const { command } = resolveApartmentLock(entities, nowMs);
  return command?.service === expected ? command : null;
}
