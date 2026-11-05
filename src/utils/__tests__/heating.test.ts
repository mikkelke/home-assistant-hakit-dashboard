import { describe, expect, it } from 'vitest';
import { roomThermostat } from '../../config/entities';
import type { HassEntities } from '../../types';
import {
  HEATING_ZONES,
  airGap,
  blockIcons,
  canAdjustRoom,
  floorReadings,
  heatingSeasonOn,
  heatNum,
  liveZoneTarget,
  loopPowerW,
  nudgeControl,
  nudgeButtonIds,
  parseDayBlocks,
  planModeMeta,
  setpointLimits,
  stepSetpoint,
  zoneCallSensorId,
  zoneChip,
  zoneHasNudge,
  zoneForThermostat,
  zoneRoomId,
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
  const HELPER = 'input_number.heating_target_family';
  const helper = entity(HELPER, '21.5', { min: 19, max: 24, step: 0.5 });
  const sensor = (live: unknown, attributes: Record<string, unknown> = {}) =>
    entity('sensor.heating_zone_family', '21', { live, base_target: 21, ...attributes });

  it.each(['true', true])('steps the target helper of a zone published live as %j', live => {
    expect(liveZoneTarget(entitiesOf(sensor(live), helper), 'family')).toEqual({
      helperId: HELPER,
      value: 21.5,
      range: { min: 19, max: 24, step: 0.5 },
    });
  });

  it.each(['false', false, 'unknown', undefined])('leaves a zone published live as %j to its thermostat', live => {
    expect(liveZoneTarget(entitiesOf(sensor(live), helper), 'family')).toBeNull();
  });

  it('leaves a zone the controller does not publish to its thermostat', () => {
    expect(liveZoneTarget(entitiesOf(helper), 'family')).toBeNull();
    expect(liveZoneTarget(entitiesOf(sensor('true'), helper), 'kristines_room')).toBeNull();
    expect(liveZoneTarget(entitiesOf(sensor('true'), helper), null)).toBeNull();
  });

  it('reads the controller base target while the helper holds no number', () => {
    for (const state of ['unknown', 'unavailable']) {
      const unreadable = entity(HELPER, state, { min: 19, max: 24, step: 0.5 });
      expect(liveZoneTarget(entitiesOf(sensor('true'), unreadable), 'family')).toMatchObject({ value: 21 });
    }
    expect(liveZoneTarget(entitiesOf(sensor('true', { base_target: 'n/a' }), entity(HELPER, 'unknown')), 'family')).toMatchObject({
      value: null,
    });
  });

  it('has no range without the helper or one of its min, max and step', () => {
    expect(liveZoneTarget(entitiesOf(sensor('true')), 'family')).toEqual({ helperId: HELPER, value: 21, range: null });
    for (const attributes of [
      { max: 24, step: 0.5 },
      { min: 19, step: 0.5 },
      { min: 19, max: 24 },
      { min: 24, max: 19, step: 0.5 },
      { min: 19, max: 24, step: 0 },
    ]) {
      expect(liveZoneTarget(entitiesOf(sensor('true'), entity(HELPER, '21', attributes)), 'family')?.range).toBeNull();
    }
  });

  it('judges each zone by its own sensor and helper', () => {
    const kristine = entity('input_number.heating_target_kristines_room', '22', { min: 19, max: 24, step: 1 });
    const entities = entitiesOf(entity('sensor.heating_zone_kristines_room', '22', { live: 'true' }), sensor('false'), helper, kristine);
    expect(liveZoneTarget(entities, 'kristines_room')).toEqual({
      helperId: 'input_number.heating_target_kristines_room',
      value: 22,
      range: { min: 19, max: 24, step: 1 },
    });
    expect(liveZoneTarget(entities, 'family')).toBeNull();
  });
});

describe('floorReadings', () => {
  const LIVING = 'sensor.living_room_floor_thermometer_temperature';
  const DINING = 'sensor.dining_room_floor_thermometer_temperature';

  it('names each floor thermometer after its room, in the published order', () => {
    expect(floorReadings({ [LIVING]: 23.5, [DINING]: '24.0' })).toEqual([
      { room: 'living room', tempC: 23.5 },
      { room: 'dining room', tempC: 24 },
    ]);
  });

  it('drops a thermometer that has no reading', () => {
    expect(floorReadings({ [LIVING]: 'unavailable', [DINING]: 24.5 })).toEqual([{ room: 'dining room', tempC: 24.5 }]);
  });

  it.each([undefined, null, '<none>', 24, ['sensor.living_room_floor_thermometer_temperature']])('reads %j as no floors', raw => {
    expect(floorReadings(raw)).toEqual([]);
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
  it('plans the open family room as one zone and maps each zone to its entities', () => {
    expect(HEATING_ZONES).toEqual(['family', 'kristines_room', 'claudias_room', 'bathroom', 'guest_bathroom']);
    expect(zoneSensorId('family')).toBe('sensor.heating_zone_family');
    expect(zoneTargetHelperId('family')).toBe('input_number.heating_target_family');
    expect(zoneThermostatId('family')).toBe('climate.family_room_thermostat');
    expect(zoneForThermostat('climate.family_room_thermostat')).toBe('family');
    expect(zoneThermostatId('kristines_room')).toBe('climate.kristines_room_thermostat');
    expect(zoneForThermostat('climate.kristines_room_thermostat')).toBe('kristines_room');
    expect(nudgeButtonIds('kristines_room')).toEqual({
      warmer: 'input_button.heating_kristines_room_warmer',
      colder: 'input_button.heating_kristines_room_colder',
    });
  });

  it('knows no zone for a thermostat the controller does not plan', () => {
    expect(zoneForThermostat('climate.living_room_thermostat')).toBeNull();
    expect(zoneForThermostat('climate.bedroom_thermostat')).toBeNull();
  });

  it.each([
    ['living_room', 'Shared with the kitchen, dining and hallway'],
    ['Living Room', 'Shared with the kitchen, dining and hallway'],
    ['kitchen', 'Shared with the living area'],
    ['dining_room', 'Shared with the living area'],
    ['hallway', 'Shared with the living area'],
  ])('routes the %s area to the shared family zone', (areaId, sharedNote) => {
    const thermostat = roomThermostat(areaId);
    expect(thermostat).toEqual({ entityId: 'climate.family_room_thermostat', shared: true, sharedNote });
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

  it('allows nudges only when both buttons exist', () => {
    const sensor = entity('sensor.heating_zone_kristines_room', '21.5', { nudge_min: '-1.0', nudge_max: '+1.0' });
    const warmer = entity('input_button.heating_kristines_room_warmer', 'unknown');
    const colder = entity('input_button.heating_kristines_room_colder', 'unknown');
    expect(zoneHasNudge(entitiesOf(sensor), 'kristines_room')).toBe(false);
    expect(zoneHasNudge(entitiesOf(sensor, warmer), 'kristines_room')).toBe(false);
    expect(zoneHasNudge(entitiesOf(sensor, colder), 'kristines_room')).toBe(false);
    expect(zoneHasNudge(entitiesOf(sensor, warmer, colder), 'kristines_room')).toBe(true);
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

describe('the entities of a zone', () => {
  it('names the thermostat and the call sensor after the room, which is the family room for the family zone', () => {
    expect(HEATING_ZONES.map(zoneRoomId)).toEqual(['family_room', 'kristines_room', 'claudias_room', 'bathroom', 'guest_bathroom']);
    expect(HEATING_ZONES.map(zoneThermostatId)).toEqual([
      'climate.family_room_thermostat',
      'climate.kristines_room_thermostat',
      'climate.claudias_room_thermostat',
      'climate.bathroom_thermostat',
      'climate.guest_bathroom_thermostat',
    ]);
    expect(HEATING_ZONES.map(zoneCallSensorId)).toEqual([
      'binary_sensor.family_room_heating_active',
      'binary_sensor.kristines_room_heating_active',
      'binary_sensor.claudias_room_heating_active',
      'binary_sensor.bathroom_heating_active',
      'binary_sensor.guest_bathroom_heating_active',
    ]);
  });
});

describe('airGap', () => {
  it('is the air minus the target to a tenth, signed', () => {
    expect(airGap(22.1, 22.5)).toEqual({ value: -0.4, tone: 'ok' });
    expect(airGap(23.7, 21.5)).toEqual({ value: 2.2, tone: 'warm' });
    expect(airGap(19.6, 21.5)).toEqual({ value: -1.9, tone: 'cold' });
  });

  it('is unknown while the air or the target is', () => {
    expect(airGap(null, 21.5)).toBeNull();
    expect(airGap(21.5, null)).toBeNull();
    expect(airGap(null, null)).toBeNull();
  });

  it('keeps half a degree either way as on target and calls anything past it warm or cold', () => {
    expect(airGap(23, 22.5)?.tone).toBe('ok');
    expect(airGap(22, 22.5)?.tone).toBe('ok');
    expect(airGap(23.1, 22.5)).toEqual({ value: 0.6, tone: 'warm' });
    expect(airGap(21.9, 22.5)).toEqual({ value: -0.6, tone: 'cold' });
  });

  it('judges the gap as shown, so a reading that rounds into the band is inside it', () => {
    expect(airGap(23.04, 22.5)).toEqual({ value: 0.5, tone: 'ok' });
    expect(airGap(21.96, 22.5)).toEqual({ value: -0.5, tone: 'ok' });
  });

  it('rounds a half tenth away from zero on both sides', () => {
    expect(airGap(22.75, 22.5)?.value).toBe(0.3);
    expect(airGap(22.25, 22.5)?.value).toBe(-0.3);
  });

  it('is a plain zero, never negative zero, when the air is on the target', () => {
    for (const air of [22.5, 22.52, 22.48]) {
      const gap = airGap(air, 22.5);
      expect(Object.is(gap?.value, 0)).toBe(true);
      expect(gap?.tone).toBe('ok');
    }
  });
});

describe('zoneChip', () => {
  const floorAtCap = { floor_temp: 24.3, floor_max_c: 24.5 };
  const sunCut = { plan_mode: 'sun_cut', setpoint_now: 21, next_setpoint: 22, next_change_at: '06:00' };

  it('shows the floor against its cap first, over a plan mode and a next change', () => {
    expect(zoneChip({ ...floorAtCap, ...sunCut }, 21.5)).toEqual({ kind: 'floor', floorC: 24.3, maxC: 24.5 });
  });

  it('counts a floor within 0.3 of its cap, at it or past it, as at the cap', () => {
    const chip = (floorC: number) => zoneChip({ floor_temp: floorC, floor_max_c: 24.5 }, 21.5)?.kind;
    expect(chip(24.1)).toBeUndefined();
    expect(chip(24.2)).toBe('floor');
    expect(chip(24.5)).toBe('floor');
    expect(chip(25.1)).toBe('floor');
  });

  it('has no floor chip without both the floor and its cap', () => {
    expect(zoneChip({ floor_temp: 26, floor_max_c: null }, 21.5)).toBeNull();
    expect(zoneChip({ floor_temp: 26 }, 21.5)).toBeNull();
    expect(zoneChip({ floor_max_c: 24.5 }, 21.5)).toBeNull();
    expect(zoneChip({ floor_temp: 'unavailable', floor_max_c: 24.5, ...sunCut }, 21.5)?.kind).toBe('mode');
  });

  it('shows a plan mode other than hold, with the next change and which way it goes', () => {
    expect(zoneChip(sunCut, 21.5)).toEqual({ kind: 'mode', mode: 'sun_cut', next: { setpoint: 22, at: '06:00', direction: 'up' } });
    expect(zoneChip({ plan_mode: 'window', setpoint_now: 21.5, next_setpoint: 19, next_change_at: '23:00' }, 21.5)).toEqual({
      kind: 'mode',
      mode: 'window',
      next: { setpoint: 19, at: '23:00', direction: 'down' },
    });
  });

  it('shows a plan mode alone when nothing is planned next', () => {
    expect(zoneChip({ plan_mode: 'party' }, 21.5)).toEqual({
      kind: 'mode',
      mode: 'party',
      next: { setpoint: null, at: null, direction: null },
    });
  });

  it('shows the next setpoint change while the plan is held, and prefers a mode over it', () => {
    const held = { plan_mode: 'hold', setpoint_now: 21.5, next_setpoint: 19, next_change_at: '23:00' };
    expect(zoneChip(held, 21.5)).toEqual({ kind: 'next', next: { setpoint: 19, at: '23:00', direction: 'down' } });
    expect(zoneChip({ ...held, plan_mode: 'guard' }, 21.5)?.kind).toBe('mode');
    expect(zoneChip({ ...held, plan_mode: undefined }, 21.5)?.kind).toBe('next');
    expect(zoneChip({ ...held, plan_mode: '' }, 21.5)?.kind).toBe('next');
  });

  it('judges the direction against the target when the setpoint now is unknown, and has none when they are equal', () => {
    const next = { plan_mode: 'hold', next_setpoint: 22, next_change_at: '07:00' };
    expect(zoneChip(next, 21.5)).toEqual({ kind: 'next', next: { setpoint: 22, at: '07:00', direction: 'up' } });
    expect(zoneChip(next, null)).toEqual({ kind: 'next', next: { setpoint: 22, at: '07:00', direction: null } });
    expect(zoneChip({ ...next, setpoint_now: 22 }, 21.5)).toEqual({ kind: 'next', next: { setpoint: 22, at: '07:00', direction: null } });
  });

  it("reads the time of the next change on the viewer's clock", () => {
    const at = new Date(2026, 10, 6, 6, 5);
    const chip = zoneChip({ next_setpoint: 22, next_change_at: at.toISOString() }, 21.5);
    expect(chip).toEqual({ kind: 'next', next: { setpoint: 22, at: '06:05', direction: 'up' } });
  });

  it('shows nothing when the plan is held and no change is known', () => {
    expect(zoneChip({ plan_mode: 'hold' }, 21.5)).toBeNull();
    expect(zoneChip({ plan_mode: 'hold', next_setpoint: 22 }, 21.5)).toBeNull();
    expect(zoneChip({ plan_mode: 'hold', next_change_at: '06:00' }, 21.5)).toBeNull();
    expect(zoneChip({ plan_mode: 'hold', next_setpoint: '<none>', next_change_at: '<none>' }, 21.5)).toBeNull();
    expect(zoneChip({}, 21.5)).toBeNull();
    expect(zoneChip(undefined, null)).toBeNull();
  });
});

describe('loopPowerW', () => {
  it('is the flow times the drop times what a litre a minute carries per kelvin', () => {
    expect(loopPowerW(1.2, 8.9)).toBeCloseTo(745.464, 3);
    expect(loopPowerW(1.7, 6.6)).toBeCloseTo(783.156, 3);
    expect(loopPowerW(1, 1)).toBeCloseTo(69.8, 9);
  });

  it('is unknown while the drop is', () => {
    expect(loopPowerW(1.2, null)).toBeNull();
  });

  it('is never below zero when the loop returns warmer than the supply', () => {
    expect(loopPowerW(1.2, -2)).toBe(0);
    expect(loopPowerW(0, 5)).toBe(0);
  });
});
