import { describe, expect, it } from 'vitest';
import { liveOf, zoneLive, type EntityLike } from '../live';

const states = (map: Record<string, string | EntityLike>) =>
  Object.fromEntries(Object.entries(map).map(([id, value]) => [id, typeof value === 'string' ? { state: value } : value]));

describe('live state by binding', () => {
  it('lights a radar while its presence entity is on, and shows the PIR as a dot', () => {
    const bindings = { presence: 'binary_sensor.a_presence', pir: 'binary_sensor.a_pir' };
    expect(liveOf(bindings, states({ 'binary_sensor.a_presence': 'on', 'binary_sensor.a_pir': 'off' }))).toMatchObject({
      lit: true,
      pir: false,
    });
    expect(liveOf(bindings, states({ 'binary_sensor.a_presence': 'off', 'binary_sensor.a_pir': 'on' }))).toMatchObject({
      lit: false,
      pir: true,
    });
  });

  it('reads the target distance and shows none for zero', () => {
    const bindings = { target_distance: 'sensor.a_distance' };
    expect(liveOf(bindings, states({ 'sensor.a_distance': '2.4' })).targetDistance).toBe(2.4);
    expect(liveOf(bindings, states({ 'sensor.a_distance': '0' })).targetDistance).toBeNull();
    expect(liveOf(bindings, states({ 'sensor.a_distance': 'unavailable' })).targetDistance).toBeNull();
  });

  it('decodes the range from an FP300 mask or a distance in metres', () => {
    expect(liveOf({ range: 'number.a_range' }, states({ 'number.a_range': '524287' })).range).toEqual({ r0: 0, r1: 4.75 });
    expect(
      liveOf({ range: 'number.a_range' }, states({ 'number.a_range': { state: '2', attributes: { unit_of_measurement: 'm' } } })).range
    ).toEqual({ r0: 0, r1: 2 });
    expect(liveOf({ range: 'number.a_range' }, states({})).range).toBeNull();
  });

  it('marks a contact as open while it is on', () => {
    const bindings = { contact: 'binary_sensor.d_contact' };
    expect(liveOf(bindings, states({ 'binary_sensor.d_contact': 'on' })).open).toBe(true);
    expect(liveOf(bindings, states({ 'binary_sensor.d_contact': 'off' })).open).toBe(false);
  });

  it('lights a bed sensor, a load above 5 W, a playing speaker and a smoke alarm', () => {
    expect(liveOf({ bed: 'binary_sensor.b' }, states({ 'binary_sensor.b': 'on' })).lit).toBe(true);
    expect(liveOf({ power: 'sensor.p' }, states({ 'sensor.p': '5.1' })).lit).toBe(true);
    expect(liveOf({ power: 'sensor.p' }, states({ 'sensor.p': '5' })).lit).toBe(false);
    expect(liveOf({ power: 'sensor.p' }, states({ 'sensor.p': '0.4' })).lit).toBe(false);
    expect(liveOf({ media_player: 'media_player.m' }, states({ 'media_player.m': 'playing' })).lit).toBe(true);
    expect(liveOf({ media_player: 'media_player.m' }, states({ 'media_player.m': 'paused' })).lit).toBe(false);
    expect(liveOf({ smoke: 'binary_sensor.s' }, states({ 'binary_sensor.s': 'on' }))).toMatchObject({ lit: true, alert: true });
  });

  it('formats a temperature from a sensor or the reading of a climate entity', () => {
    expect(liveOf({ temperature: 'sensor.t' }, states({ 'sensor.t': '21.46' })).temperature).toBe('21.5°');
    expect(
      liveOf({ temperature: 'climate.c' }, states({ 'climate.c': { state: 'heat', attributes: { current_temperature: 19.2 } } }))
        .temperature
    ).toBe('19.2°');
    expect(liveOf({ temperature: 'sensor.t' }, states({ 'sensor.t': 'unavailable' })).temperature).toBeNull();
  });

  it('is unavailable when every bound entity is missing or unavailable, and not when none are bound', () => {
    expect(liveOf({ presence: 'binary_sensor.a' }, states({})).unavailable).toBe(true);
    expect(
      liveOf(
        { presence: 'binary_sensor.a', pir: 'binary_sensor.b' },
        states({ 'binary_sensor.a': 'unavailable', 'binary_sensor.b': 'unavailable' })
      ).unavailable
    ).toBe(true);
    expect(
      liveOf(
        { presence: 'binary_sensor.a', pir: 'binary_sensor.b' },
        states({ 'binary_sensor.a': 'unavailable', 'binary_sensor.b': 'off' })
      ).unavailable
    ).toBe(false);
    expect(liveOf({}, states({})).unavailable).toBe(false);
  });

  it('says nothing for a device with no bindings', () => {
    expect(liveOf({}, states({ 'binary_sensor.a': 'on' }))).toEqual({
      lit: false,
      pir: false,
      open: false,
      alert: false,
      targetDistance: null,
      range: null,
      temperature: null,
      unavailable: false,
    });
  });
});

describe('a zone occupancy entity', () => {
  it('reads state, flags, reason and witnesses, taking string booleans as the house writes them', () => {
    const zone = zoneLive({
      state: 'on',
      attributes: {
        settling: 'true',
        stale: 'false',
        reason: 'presence',
        tier: 'strong',
        confidence: 'high',
        witness_states: ['a=on', 'b=off'],
        computed_at: '2030-01-01T10:00:00Z',
      },
    });
    expect(zone).toEqual({
      state: 'on',
      settling: true,
      stale: false,
      reason: 'presence',
      tier: 'strong',
      confidence: 'high',
      witnesses: ['a=on', 'b=off'],
      computedAt: '2030-01-01T10:00:00Z',
    });
  });

  it('is unknown for a missing or unavailable entity and takes real booleans too', () => {
    expect(zoneLive(undefined).state).toBe('unknown');
    expect(zoneLive({ state: 'unavailable' }).state).toBe('unknown');
    expect(zoneLive({ state: 'off', attributes: { stale: true } })).toMatchObject({ state: 'off', stale: true, settling: false });
  });
});
