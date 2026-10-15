import { decodeRange, type RadarRange } from './radarRange';

export interface EntityLike {
  state: string;
  attributes?: Record<string, unknown>;
}

export type States = Readonly<Record<string, EntityLike | undefined>>;

export const POWER_ON_W = 5;

export interface Live {
  /** Something is happening at this device: presence, a person in the bed, vibration, a load running, music playing, smoke. */
  lit: boolean;
  pir: boolean;
  open: boolean;
  alert: boolean;
  targetDistance: number | null;
  range: RadarRange | null;
  temperature: string | null;
  unavailable: boolean;
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isOn = (entity: EntityLike | undefined) => entity?.state === 'on';

function temperatureOf(entity: EntityLike | undefined): string | null {
  if (!entity) return null;
  const value = entity.state === 'unavailable' || entity.state === 'unknown' ? null : asNumber(entity.state);
  const reading = value ?? asNumber(entity.attributes?.current_temperature);
  return reading === null ? null : `${reading.toFixed(1)}°`;
}

/** What the entities bound to a device say, by the rules for each binding. A binding the device does not have
 * says nothing. */
export function liveOf(bindings: Readonly<Record<string, string>>, states: States): Live {
  const entity = (role: string) => (bindings[role] ? states[bindings[role]] : undefined);
  const bound = Object.values(bindings);
  const target = asNumber(entity('target_distance')?.state);
  const power = asNumber(entity('power')?.state);
  const smoke = isOn(entity('smoke'));
  const range = bindings.range
    ? decodeRange(entity('range')?.state, entity('range')?.attributes?.unit_of_measurement as string | undefined)
    : null;
  return {
    lit:
      isOn(entity('presence')) ||
      isOn(entity('bed')) ||
      isOn(entity('vibration')) ||
      (power !== null && power > POWER_ON_W) ||
      entity('media_player')?.state === 'playing' ||
      smoke,
    pir: isOn(entity('pir')),
    open: isOn(entity('contact')),
    alert: smoke,
    targetDistance: target !== null && target > 0 ? target : null,
    range,
    temperature: temperatureOf(entity('temperature')),
    unavailable: bound.length > 0 && bound.every(id => !states[id] || states[id]?.state === 'unavailable'),
  };
}

export type ZoneState = 'on' | 'off' | 'unknown';

export interface ZoneLive {
  state: ZoneState;
  settling: boolean;
  stale: boolean;
  reason: string | null;
  tier: string | null;
  confidence: string | null;
  witnesses: string[];
  computedAt: string | null;
}

const truthy = (value: unknown) => value === true || value === 'true';
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** A `binary_sensor.<zone>_active` entity: the room's occupancy as the house decides it, and why. */
export function zoneLive(entity: EntityLike | undefined): ZoneLive {
  const attributes = entity?.attributes ?? {};
  return {
    state: entity?.state === 'on' ? 'on' : entity?.state === 'off' ? 'off' : 'unknown',
    settling: truthy(attributes.settling),
    stale: truthy(attributes.stale),
    reason: text(attributes.reason),
    tier: text(attributes.tier),
    confidence: text(attributes.confidence),
    witnesses: stringList(attributes.witness_states),
    computedAt: text(attributes.computed_at),
  };
}
