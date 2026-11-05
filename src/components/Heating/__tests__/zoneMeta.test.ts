import { describe, expect, it } from 'vitest';
import type { HassEntities } from '../../../types';
import {
  BEDROOM_THERMOSTAT,
  HEATING_SUPPLY_TEMP_SENSOR,
  WATER_W_PER_LPM_K,
  loopReturnSensorId,
  zoneThermostatId,
  type HeatingZone,
} from '../../../utils/heating';
import { LOOPS, loopRows } from '../zoneMeta';

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });

const entitiesOf = (...list: ReturnType<typeof entity>[]): HassEntities => Object.fromEntries(list.map(e => [e.entity_id, e]));

const calling = (zone: HeatingZone) => entity(zoneThermostatId(zone), 'heat', { hvac_action: 'heating' });
const idle = (zone: HeatingZone) => entity(zoneThermostatId(zone), 'heat', { hvac_action: 'idle' });
const supply = (tempC: number | string) => entity(HEATING_SUPPLY_TEMP_SENSOR, String(tempC));
const returns = (...tempsC: (number | string)[]) => tempsC.map((tempC, index) => entity(loopReturnSensorId(index + 1), String(tempC)));

/** Floor supply 41.3 and the loop returns of a day in early November. */
const RETURNS = [32.4, 31.1, 30.2, 34.7, 22.1, 33, 36.8];

describe('the floor loops', () => {
  it('are the seven loops of the manifold in order, with their fixed flows', () => {
    expect(LOOPS.map(loop => [loop.loop, loop.zone, loop.flowLpm])).toEqual([
      [1, 'family', 1.2],
      [2, 'kristines_room', 1.0],
      [3, 'claudias_room', 0.8],
      [4, 'family', 1.7],
      [5, 'bedroom', 1.1],
      [6, 'guest_bathroom', 0.3],
      [7, 'bathroom', 1.2],
    ]);
  });
});

describe('loopRows', () => {
  it('gives each loop its return and its drop from the floor supply', () => {
    const rows = loopRows(entitiesOf(supply(41.3), ...returns(...RETURNS)));
    expect(rows.map(row => row.returnC)).toEqual(RETURNS);
    expect(rows.map(row => Number(row.dropC?.toFixed(1)))).toEqual([8.9, 10.2, 11.1, 6.6, 19.2, 8.3, 4.5]);
  });

  it('gives the power of a loop only while its zone calls: flow x drop x 69.8', () => {
    const rows = loopRows(entitiesOf(supply(41.3), ...returns(...RETURNS), calling('family'), idle('kristines_room'), idle('bathroom')));
    expect(rows.map(row => row.calling)).toEqual([true, false, false, true, false, false, false]);
    expect(rows[0].watts).toBeCloseTo(1.2 * (41.3 - 32.4) * WATER_W_PER_LPM_K, 6);
    expect(rows[3].watts).toBeCloseTo(1.7 * (41.3 - 34.7) * WATER_W_PER_LPM_K, 6);
    expect(rows.filter(row => !row.calling).map(row => row.watts)).toEqual([null, null, null, null, null]);
    expect(Math.round(rows[0].watts ?? 0)).toBe(745);
    expect(Math.round(rows[3].watts ?? 0)).toBe(783);
  });

  it('has no power for any loop while no zone calls, however warm its return reads', () => {
    const rows = loopRows(entitiesOf(supply(41.3), ...returns(...RETURNS), idle('family')));
    expect(rows.every(row => !row.calling && row.watts === null)).toBe(true);
  });

  it('lets the two family loops share the family zone’s call', () => {
    const rows = loopRows(entitiesOf(supply(41.3), ...returns(...RETURNS), calling('family')));
    expect(rows.filter(row => row.calling).map(row => row.loop)).toEqual([1, 4]);
  });

  it('reads the bedroom loop from the bedroom thermostat, which belongs to no zone', () => {
    const rows = loopRows(entitiesOf(supply(41.3), ...returns(...RETURNS), entity(BEDROOM_THERMOSTAT, 'heat', { hvac_action: 'heating' })));
    expect(rows.filter(row => row.calling).map(row => row.loop)).toEqual([5]);
    expect(rows[4].watts).toBeCloseTo(1.1 * (41.3 - 22.1) * WATER_W_PER_LPM_K, 6);
  });

  it('gives a calling loop no power while its return or the supply cannot be read', () => {
    const noReturn = loopRows(entitiesOf(supply(41.3), ...returns('unavailable'), calling('family')));
    expect(noReturn[0]).toMatchObject({ returnC: null, dropC: null, calling: true, watts: null });
    const noSupply = loopRows(entitiesOf(supply('unavailable'), ...returns(...RETURNS), calling('family')));
    expect(noSupply.map(row => row.dropC)).toEqual([null, null, null, null, null, null, null]);
    expect(noSupply[0]).toMatchObject({ returnC: 32.4, calling: true, watts: null });
    const nothing = loopRows({});
    expect(nothing.every(row => row.returnC === null && row.dropC === null && row.watts === null && !row.calling)).toBe(true);
  });

  it('gives a calling loop that returns warmer than the supply zero watts, not a negative number', () => {
    const rows = loopRows(entitiesOf(supply(30), ...returns(32.4), calling('family')));
    expect(rows[0].dropC).toBeCloseTo(-2.4, 9);
    expect(rows[0].watts).toBe(0);
  });
});
