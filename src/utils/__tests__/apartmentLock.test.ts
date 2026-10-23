import { describe, expect, it, vi } from 'vitest';
import {
  APARTMENT_ENTRY_SECURE_ENTITY,
  APARTMENT_LOCK_CLOUD_ENTITY as CLOUD,
  APARTMENT_LOCK_ENTITY as TRUTH,
  FRONT_DOOR_LOCK_ENTITY as BLE,
} from '../../config/entities';
import type { HassEntity } from '../../types';
import { deriveHomePulseSummary } from '../homePulse';
import { apartmentLockToggleCommand, resolveApartmentLock } from '../apartmentLock';

const NOW = Date.parse('2026-10-22T15:03:50+02:00');
const iso = (age = 0) => new Date(NOW - age).toISOString();
const entity = (entity_id: string, state: string, attributes = {}, last_changed = iso(30_000)): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed,
  last_updated: iso(),
});
const world = (...values: HassEntity[]) => Object.fromEntries(values.map(value => [value.entity_id, value]));
const truth = (state: string, age = 0) => entity(TRUTH, state, { computed_at: iso(age) });
const resolve = (...values: HassEntity[]) => resolveApartmentLock(world(...values), NOW);

describe('the shared apartment lock truth', () => {
  it.each([
    ['locked', 'unlocked', 'locked', 'unlock'],
    ['unlocked', 'locked', 'unlocked', 'lock'],
    ['locked', 'locked', 'unlocked', 'unlock'],
  ])('uses semantic %s while the twins say %s/%s', (state, ble, cloud, service) => {
    const result = resolve(truth(state), entity(BLE, ble), entity(CLOUD, cloud));
    expect(result).toMatchObject({ state, degraded: false, sourceEntityId: TRUTH });
    expect(result.command).toEqual({ domain: 'lock', service, target: { entity_id: BLE } });
  });

  it.each(['unknown', 'locking', 'unlocking', 'jammed'])('preserves semantic %s without inventing an unlocked toggle', state => {
    const result = resolve(
      truth(state),
      entity(BLE, 'unlocked'),
      entity(CLOUD, 'unlocked'),
      entity(APARTMENT_ENTRY_SECURE_ENTITY, 'off', { lock_state: 'unlocked', lock_source_used: 'fallback_ble' })
    );
    expect(result.state).toBe(state);
    expect(result.command).toBeNull();
    expect(result.degraded).toBe(false);
  });

  it.each(['unavailable', 'missing', 'stale'])('uses agreement in degraded mode when the publisher is %s', condition => {
    const source =
      condition === 'missing' ? [] : [truth(condition === 'unavailable' ? condition : 'locked', condition === 'stale' ? 180_001 : 0)];
    const result = resolve(...source, entity(BLE, 'unlocked'), entity(CLOUD, 'unlocked'));
    expect(result).toMatchObject({ state: 'unlocked', degraded: true, command: { service: 'lock' } });
  });

  it('does not expire push-only twins just because they have not changed all day', () => {
    const raw = entity(CLOUD, 'locked', {}, iso(86_400_000));
    raw.last_updated = iso(86_400_000);
    expect(resolve(raw)).toMatchObject({ state: 'locked', degraded: true, command: { target: { entity_id: CLOUD } } });
  });

  it('keeps a fresh semantic state even if the lock last changed days ago', () => {
    const source = truth('locked');
    source.last_changed = iso(172_800_000);
    expect(resolve(source, entity(BLE, 'unlocked'))).toMatchObject({ state: 'locked', degraded: false });
  });

  it('does not infer freshness from HA restoring a semantic entity', () => {
    expect(resolve(truth('locked', 180_001), entity(BLE, 'locked'), entity(CLOUD, 'unlocked'))).toMatchObject({
      state: 'unknown',
      degraded: true,
      command: null,
    });
  });

  it.each([{}, { computed_at: 'not a date' }, { computed_at: iso(-300_000) }])('requires a usable semantic heartbeat: %j', attributes => {
    expect(resolve(entity(TRUTH, 'locked', attributes), entity(BLE, 'locked'), entity(CLOUD, 'unlocked'))).toMatchObject({
      state: 'unknown',
      degraded: true,
      command: null,
    });
  });

  it('does not arbitrate conflicting raw twins by timestamp or prefer BLE', () => {
    expect(resolve(entity(BLE, 'unlocked', {}, iso(1_000)), entity(CLOUD, 'locked', {}, iso(60_000)))).toMatchObject({
      state: 'unknown',
      command: null,
    });
  });

  it.each(['unknown', 'unavailable'])('uses the sole valid twin when the other is %s', state => {
    expect(resolve(entity(BLE, state), entity(CLOUD, 'locked'))).toMatchObject({
      state: 'locked',
      degraded: true,
      command: { service: 'unlock', target: { entity_id: CLOUD } },
    });
  });

  it('retains semantic display with no usable command transport', () => {
    expect(resolve(truth('locked'), entity(BLE, 'unknown'), entity(CLOUD, 'unavailable'))).toMatchObject({
      state: 'locked',
      command: null,
      actionLabel: 'Apartment lock control unavailable',
    });
  });

  it('uses neither an unrelated front-door lock nor the combined door-secure binary as lock truth', () => {
    const result = resolve(
      entity('lock.front_door', 'unlocked'),
      entity('lock.intercomproxy_front_door', 'unlocked'),
      entity(APARTMENT_ENTRY_SECURE_ENTITY, 'off', { lock_state: 'unlocked' })
    );
    expect(result).toMatchObject({ present: false, state: 'unknown', command: null });
    expect(resolve(truth('locked'), entity(BLE, 'locked'), entity(APARTMENT_ENTRY_SECURE_ENTITY, 'off', { door_open: true })).state).toBe(
      'locked'
    );
  });

  it('measures unlocked duration from semantic truth, not an old BLE report', () => {
    expect(resolve(truth('unlocked'), entity(BLE, 'unlocked', {}, iso(3_600_000))).since).toBe(iso(30_000));
    expect(resolve(entity(BLE, 'unlocked', {}, iso(3_600_000)), entity(CLOUD, 'unlocked', {}, iso(60_000))).since).toBe(iso(60_000));
  });

  it('rechecks freshness and intent at the tap without sending the opposite command', () => {
    const entities = world(truth('locked'), entity(BLE, 'unlocked'), entity(CLOUD, 'locked'));
    expect(apartmentLockToggleCommand(entities, 'unlock', NOW)?.service).toBe('unlock');
    expect(apartmentLockToggleCommand(entities, 'unlock', NOW + 180_001)).toBeNull();
    entities[TRUTH] = truth('unlocked');
    expect(apartmentLockToggleCommand(entities, 'unlock', NOW)).toBeNull();
    expect(apartmentLockToggleCommand(entities, undefined, NOW)).toBeNull();
  });

  it('uses semantic state and duration for the away-home lock alert', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      const entities = world(
        truth('locked'),
        entity(BLE, 'unlocked', {}, iso(3_600_000)),
        entity(CLOUD, 'locked'),
        entity('binary_sensor.apartment_door_open', 'off')
      );
      const alerts = () => deriveHomePulseSummary([], entities).chips.filter(chip => chip.id === 'lock-alert');
      expect(alerts()).toEqual([]);
      entities[TRUTH] = truth('unlocked');
      expect(alerts()).toEqual([]);
      entities[TRUTH].last_changed = iso(300_000);
      expect(alerts()).toMatchObject([{ label: 'Unlocked 5m' }]);
      entities[TRUTH] = truth('unknown');
      expect(alerts()).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  it('reselects one usable apartment transport before sending', () => {
    const entities = world(truth('locked'), entity(BLE, 'unavailable'), entity(CLOUD, 'locked'));
    expect(apartmentLockToggleCommand(entities, 'unlock', NOW)).toEqual({
      domain: 'lock',
      service: 'unlock',
      target: { entity_id: CLOUD },
    });
  });
});
