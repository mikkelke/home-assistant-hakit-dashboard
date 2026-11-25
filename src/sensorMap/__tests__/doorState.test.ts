import { describe, expect, it } from 'vitest';
import { closedDoorNames, doorState } from '../doorState';
import type { Door } from '../mapDoc';

const door = (name: string): Door => ({ name, hinge: [0, 0], closed: [1, 0], open: [0, 1] });

describe('doorState', () => {
  it('reads on as open and off as closed', () => {
    expect(doorState('binary_sensor.a', { state: 'on' })).toBe('open');
    expect(doorState('binary_sensor.a', { state: 'off' })).toBe('closed');
  });

  it('tells a silent sensor from no sensor', () => {
    expect(doorState('binary_sensor.a', { state: 'unavailable' })).toBe('unknown');
    expect(doorState('binary_sensor.a', undefined)).toBe('unknown');
    expect(doorState(undefined, undefined)).toBe('none');
  });

  it('keeps a door fixed shut closed without a sensor', () => {
    expect(doorState({ closed: true }, undefined)).toBe('closed');
  });

  it('names only the doors reported or fixed closed', () => {
    const states: Record<string, { state: string }> = { 'binary_sensor.a': { state: 'off' }, 'binary_sensor.b': { state: 'on' } };
    const names = closedDoorNames(
      [door('A'), door('B'), door('C'), door('D'), door('E')],
      { A: 'binary_sensor.a', B: 'binary_sensor.b', D: 'binary_sensor.d', E: { closed: true } },
      id => states[id]
    );
    expect(names).toEqual(['A', 'E']);
  });
});
