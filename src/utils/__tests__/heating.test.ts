import { describe, expect, it } from 'vitest';
import { roomThermostat } from '../../config/entities';
import type { HassEntities } from '../../types';
import {
  HEATING_ZONES,
  blockIcons,
  canAdjustRoom,
  heatingSeasonOn,
  heatNum,
  liveZoneTarget,
  nudgeControl,
  nudgeButtonIds,
  parseDayBlocks,
  planModeMeta,
  setpointLimits,
  stepSetpoint,
  zoneHasNudge,
  zoneForThermostat,
  zoneSensorId,
  zoneTargetHelperId,
  zoneThermostatId,
} from '../heating';

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });

function entitiesOf(...list: ReturnType<typeof entity>[]): HassEntities {
  return Object.fromEntries(list.map(e => [e.entity_id, e]));
}

const kristineThermostat = entity('climate.kristines_room_thermostat', 'heat', { min_temp: 5, max_temp: 40, temperature: 21 });

describe('setpointLimits', () => {
  it('uses the thermostat min/max heat setpoint numbers over the climate min/max', () => {
    const entities = entitiesOf(
      entity('climate.bedroom_thermostat', 'heat', { min_temp: 5, max_temp: 40 }),
      entity('number.bedroom_thermostat_min_heat_setpoint', '7'),
      entity('number.bedroom_thermostat_max_heat_setpoint', '24')
    );
    expect(setpointLimits(entities, 'climate.bedroom_thermostat')).toEqual({ min: 7, max: 24 });
  });

  it('falls back to the climate min/max when the numbers are missing or unavailable', () => {
    const entities = entitiesOf(
      entity('climate.bedroom_thermostat', 'heat', { min_temp: 5, max_temp: 40 }),
      entity('number.bedroom_thermostat_max_heat_setpoint', 'unavailable')
    );
    expect(setpointLimits(entities, 'climate.bedroom_thermostat')).toEqual({ min: 5, max: 40 });
  });

  it("narrows to the zone sensor's lower/upper limit", () => {
    const entities = entitiesOf(
      kristineThermostat,
      entity('number.kristines_room_thermostat_min_heat_setpoint', '5'),
      entity('number.kristines_room_thermostat_max_heat_setpoint', '24'),
      entity('sensor.heating_zone_kristines_room', '21.5', { lower_limit: 19, upper_limit: 25 })
    );
    expect(setpointLimits(entities, 'climate.kristines_room_thermostat')).toEqual({ min: 19, max: 24 });
  });

  it('maps the family zone to the family room master thermostat', () => {
    const entities = entitiesOf(
      entity('climate.family_room_thermostat', 'heat', { min_temp: 5, max_temp: 40 }),
      entity('sensor.heating_zone_family', '22', { lower_limit: 19, upper_limit: 24 })
    );
    expect(setpointLimits(entities, 'climate.family_room_thermostat')).toEqual({ min: 19, max: 24 });
  });

  it('uses the living zone limits for the living room thermostat, independently of family', () => {
    const entities = entitiesOf(
      entity('climate.living_room_thermostat', 'heat', { min_temp: 5, max_temp: 40 }),
      entity('sensor.heating_zone_living', '21', { lower_limit: 20, upper_limit: 23 }),
      entity('sensor.heating_zone_family', '22', { lower_limit: 19, upper_limit: 24 })
    );
    expect(setpointLimits(entities, 'climate.living_room_thermostat')).toEqual({ min: 20, max: 23 });
  });

  it('ignores zone limits that would leave no range', () => {
    const entities = entitiesOf(
      kristineThermostat,
      entity('number.kristines_room_thermostat_max_heat_setpoint', '18'),
      entity('sensor.heating_zone_kristines_room', '21.5', { lower_limit: 19, upper_limit: 24 })
    );
    expect(setpointLimits(entities, 'climate.kristines_room_thermostat')).toEqual({ min: 5, max: 18 });
  });

  it('steps on the half-degree grid inside the limits', () => {
    expect(stepSetpoint(21.3, 0.5, { min: 19, max: 24 })).toBe(22);
    expect(stepSetpoint(24, 0.5, { min: 19, max: 24 })).toBe(24);
    expect(stepSetpoint(15, 0.5, { min: 19, max: 24 })).toBe(19);
  });

  it('steps on a given grid inside the limits without float noise', () => {
    expect(stepSetpoint(21, 1, { min: 19, max: 24 }, 1)).toBe(22);
    expect(stepSetpoint(23.5, 1, { min: 19, max: 24 }, 1)).toBe(24);
    expect(stepSetpoint(19.5, -1, { min: 19, max: 24 }, 1)).toBe(19);
    expect(stepSetpoint(21.6, 0.1, { min: 19, max: 24 }, 0.1)).toBe(21.7);
  });
});

describe('liveZoneTarget', () => {
  const HELPER = 'input_number.heating_target_living';
  const helper = entity(HELPER, '21.5', { min: 19, max: 24, step: 0.5 });
  const sensor = (live: unknown, attributes: Record<string, unknown> = {}) =>
    entity('sensor.heating_zone_living', '21', { live, base_target: 21, ...attributes });

  it.each(['true', true])('steps the target helper of a zone published live as %j', live => {
    expect(liveZoneTarget(entitiesOf(sensor(live), helper), 'living')).toEqual({
      helperId: HELPER,
      value: 21.5,
      range: { min: 19, max: 24, step: 0.5 },
    });
  });

  it.each(['false', false, 'unknown', undefined])('leaves a zone published live as %j to its thermostat', live => {
    expect(liveZoneTarget(entitiesOf(sensor(live), helper), 'living')).toBeNull();
  });

  it('leaves a zone the controller does not publish to its thermostat', () => {
    expect(liveZoneTarget(entitiesOf(helper), 'living')).toBeNull();
    expect(liveZoneTarget(entitiesOf(sensor('true'), helper), 'family')).toBeNull();
    expect(liveZoneTarget(entitiesOf(sensor('true'), helper), null)).toBeNull();
  });

  it('reads the controller base target while the helper holds no number', () => {
    for (const state of ['unknown', 'unavailable']) {
      const unreadable = entity(HELPER, state, { min: 19, max: 24, step: 0.5 });
      expect(liveZoneTarget(entitiesOf(sensor('true'), unreadable), 'living')).toMatchObject({ value: 21 });
    }
    expect(liveZoneTarget(entitiesOf(sensor('true', { base_target: 'n/a' }), entity(HELPER, 'unknown')), 'living')).toMatchObject({
      value: null,
    });
  });

  it('has no range without the helper or one of its min, max and step', () => {
    expect(liveZoneTarget(entitiesOf(sensor('true')), 'living')).toEqual({ helperId: HELPER, value: 21, range: null });
    for (const attributes of [
      { max: 24, step: 0.5 },
      { min: 19, step: 0.5 },
      { min: 19, max: 24 },
      { min: 24, max: 19, step: 0.5 },
      { min: 19, max: 24, step: 0 },
    ]) {
      expect(liveZoneTarget(entitiesOf(sensor('true'), entity(HELPER, '21', attributes)), 'living')?.range).toBeNull();
    }
  });

  it('judges each zone by its own sensor and helper', () => {
    const family = entity('input_number.heating_target_family', '22', { min: 19, max: 24, step: 1 });
    const entities = entitiesOf(entity('sensor.heating_zone_family', '22', { live: 'true' }), sensor('false'), helper, family);
    expect(liveZoneTarget(entities, 'family')).toEqual({
      helperId: 'input_number.heating_target_family',
      value: 22,
      range: { min: 19, max: 24, step: 1 },
    });
    expect(liveZoneTarget(entities, 'living')).toBeNull();
  });
});

describe('nudgeControl', () => {
  const attrs = (nudge: string, extra: Record<string, unknown> = {}) => ({
    nudge,
    nudge_min: '-1.0',
    nudge_max: '+1.0',
    lower_limit: 19,
    upper_limit: 24,
    ...extra,
  });

  it('allows both directions inside the nudge range and limits', () => {
    const control = nudgeControl(attrs('+0.0'), 21.5);
    expect(control).toMatchObject({ nudge: 0, canWarmer: true, canColder: true });
    expect(control.steps).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it('disables warmer at nudge_max and colder at nudge_min', () => {
    expect(nudgeControl(attrs('+1.0'), 22)).toMatchObject({ canWarmer: false, canColder: true });
    expect(nudgeControl(attrs('-1.0'), 21)).toMatchObject({ canWarmer: true, canColder: false });
  });

  it('disables warmer when the next step passes upper_limit, colder below lower_limit', () => {
    expect(nudgeControl(attrs('+0.0'), 23.5)).toMatchObject({ canWarmer: true });
    expect(nudgeControl(attrs('+0.0'), 23.6)).toMatchObject({ canWarmer: false, canColder: true });
    expect(nudgeControl(attrs('+0.0'), 19.5)).toMatchObject({ canColder: true });
    expect(nudgeControl(attrs('+0.0'), 19.4)).toMatchObject({ canWarmer: true, canColder: false });
  });

  it('moves nowhere for a zone without a nudge range or attributes', () => {
    expect(nudgeControl({ nudge: '+0.0', nudge_min: '+0.0', nudge_max: '+0.0' }, 22)).toMatchObject({ canWarmer: false, canColder: false });
    expect(nudgeControl(undefined, null)).toMatchObject({ nudge: 0, steps: [0], canWarmer: false, canColder: false });
  });
});

describe('zone helpers', () => {
  it('places living immediately after family and maps its entities', () => {
    expect(HEATING_ZONES).toEqual(['family', 'living', 'kristines_room', 'claudias_room', 'bathroom', 'guest_bathroom']);
    expect(zoneSensorId('living')).toBe('sensor.heating_zone_living');
    expect(zoneTargetHelperId('living')).toBe('input_number.heating_target_living');
    expect(nudgeButtonIds('living')).toEqual({
      warmer: 'input_button.heating_living_warmer',
      colder: 'input_button.heating_living_colder',
    });
    expect(zoneThermostatId('living')).toBe('climate.living_room_thermostat');
    expect(zoneForThermostat('climate.living_room_thermostat')).toBe('living');
    expect(zoneThermostatId('family')).toBe('climate.family_room_thermostat');
    expect(zoneForThermostat('climate.family_room_thermostat')).toBe('family');
    expect(zoneForThermostat('climate.living_thermostat')).toBeNull();
    expect(zoneForThermostat('climate.bedroom_thermostat')).toBeNull();
  });

  it.each(['living_room', 'Living Room'])('routes the %s area to its own controller zone', areaId => {
    const thermostat = roomThermostat(areaId);
    expect(thermostat).toEqual({ entityId: 'climate.living_room_thermostat', shared: false, sharedNote: null });
    expect(zoneForThermostat(thermostat!.entityId)).toBe('living');
  });

  it.each(['kitchen', 'dining_room', 'hallway'])('keeps %s in the shared family zone', areaId => {
    const thermostat = roomThermostat(areaId);
    expect(thermostat).toEqual({
      entityId: 'climate.family_room_thermostat',
      shared: true,
      sharedNote: 'Shared by the kitchen, dining and hallway',
    });
    expect(zoneForThermostat(thermostat!.entityId)).toBe('family');
  });

  it('describes floor_cap as a floor that is too warm', () => {
    expect(planModeMeta('floor_cap')).toEqual({ icon: 'mdi:heat-wave', label: 'Floor too warm' });
    expect(parseDayBlocks([{ start: '00:00', end: '24:00', mode: 'floor_cap', setpoint: '19' }])).toEqual([
      { startMin: 0, endMin: 1440, mode: 'floor_cap', setpoint: 19 },
    ]);
  });

  it('reads published numbers, never turning nothing into 0', () => {
    expect(heatNum('+0.5')).toBe(0.5);
    expect(heatNum('0')).toBe(0);
    expect(heatNum('n/a')).toBeNull();
    expect(heatNum('<none>')).toBeNull();
    expect(heatNum(null)).toBeNull();
  });

  it('knows which zones take nudges', () => {
    const entities = entitiesOf(
      entity('sensor.heating_zone_kristines_room', '21.5', { nudge_min: '-1.0', nudge_max: '+1.0' }),
      entity('input_button.heating_kristines_room_warmer', 'unknown'),
      entity('input_button.heating_kristines_room_colder', 'unknown'),
      entity('sensor.heating_zone_family', '22', { nudge_min: '+0.0', nudge_max: '+0.0' })
    );
    expect(zoneHasNudge(entities, 'kristines_room')).toBe(true);
    expect(zoneHasNudge(entities, 'family')).toBe(false);
    expect(zoneHasNudge(entities, 'claudias_room')).toBe(false);
  });

  it('allows living nudges only when both buttons exist', () => {
    const sensor = entity('sensor.heating_zone_living', '21', { nudge_min: '-1.0', nudge_max: '+1.0' });
    const warmer = entity('input_button.heating_living_warmer', 'unknown');
    const colder = entity('input_button.heating_living_colder', 'unknown');
    expect(zoneHasNudge(entitiesOf(sensor), 'living')).toBe(false);
    expect(zoneHasNudge(entitiesOf(sensor, warmer), 'living')).toBe(false);
    expect(zoneHasNudge(entitiesOf(sensor, colder), 'living')).toBe(false);
    expect(zoneHasNudge(entitiesOf(sensor, warmer, colder), 'living')).toBe(true);
  });

  it('is off season when the controller or the switch says so', () => {
    expect(
      heatingSeasonOn(entitiesOf(entity('sensor.heating_controller', 'off_season'), entity('input_boolean.heating_season', 'on')))
    ).toBe(false);
    expect(heatingSeasonOn(entitiesOf(entity('sensor.heating_controller', 'shadow'), entity('input_boolean.heating_season', 'off')))).toBe(
      false
    );
    expect(heatingSeasonOn(entitiesOf(entity('sensor.heating_controller', 'shadow'), entity('input_boolean.heating_season', 'on')))).toBe(
      true
    );
    expect(heatingSeasonOn({})).toBe(false);
  });

  it('drops zero-length and malformed day blocks', () => {
    expect(
      parseDayBlocks([
        { start: '00:04', end: '15:23', mode: 'hold', setpoint: '21.5' },
        { start: '15:23', end: '15:23', mode: 'hold', setpoint: '22.0' },
        { start: '15:23', end: '24:00', mode: 'sun_cut', setpoint: '21.0' },
        { start: 'x', end: '24:00', mode: 'hold' },
        '<none>',
      ])
    ).toEqual([
      { startMin: 4, endMin: 923, mode: 'hold', setpoint: 21.5 },
      { startMin: 923, endMin: 1440, mode: 'sun_cut', setpoint: 21 },
    ]);
    expect(parseDayBlocks(['<none>'])).toEqual([]);
  });

  it('spaces the strip icons so none overlap', () => {
    const blocks = parseDayBlocks([
      { start: '00:00', end: '06:00', mode: 'hold' },
      { start: '06:00', end: '06:30', mode: 'window' },
      { start: '06:30', end: '24:00', mode: 'hold' },
    ]);
    expect(blockIcons(blocks, 86)).toEqual([
      { centre: 180, mode: 'hold' },
      { centre: 375, mode: 'window' },
      { centre: 915, mode: 'hold' },
    ]);
    expect(blockIcons(blocks, 200).map(icon => icon.mode)).toEqual(['window', 'hold']);
  });
});

describe('canAdjustRoom', () => {
  const people = {
    'person.kristine': { entity_id: 'person.kristine', state: 'home', attributes: { user_id: 'u-kristine' } },
    'person.claudia': { entity_id: 'person.claudia', state: 'home', attributes: { user_id: 'u-claudia' } },
  } as unknown as HassEntities;

  it('lets an administrator adjust every room', () => {
    expect(canAdjustRoom(people, { isAdmin: true, id: 'u-admin' }, 'family')).toBe(true);
    expect(canAdjustRoom(people, { isAdmin: true, id: 'u-admin' }, null)).toBe(true);
  });

  it('lets a resident adjust their own room and no other', () => {
    expect(canAdjustRoom(people, { isAdmin: false, id: 'u-kristine' }, 'kristines_room')).toBe(true);
    expect(canAdjustRoom(people, { isAdmin: false, id: 'u-kristine' }, 'claudias_room')).toBe(false);
    expect(canAdjustRoom(people, { isAdmin: false, id: 'u-claudia' }, 'family')).toBe(false);
  });

  it('adjusts nothing while the viewer is unresolved', () => {
    expect(canAdjustRoom(people, { isAdmin: null, id: null }, 'kristines_room')).toBe(false);
  });
});
