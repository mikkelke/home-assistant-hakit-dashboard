import { describe, expect, it } from 'vitest';
import type { HassEntities } from '../../types';
import { heatingSeasonOn, heatNum, nudgeControl, parseDayBlocks, setpointLimits, stepSetpoint, zoneHasNudge } from '../heating';

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
});
