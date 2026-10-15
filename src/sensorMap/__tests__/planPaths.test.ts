import { describe, expect, it } from 'vitest';
import { doorPaths, glazingLine, polyPath } from '../planPaths';

describe('plan paths in the flipped drawing space', () => {
  it('writes a polygon with y flipped about the top', () => {
    expect(
      polyPath(
        [
          [0, 0],
          [4, 0],
          [4, 2.5],
        ],
        9
      )
    ).toBe('M0 9L4 9L4 6.5Z');
  });

  it('draws a door leaf from the hinge to the open tip and an arc to the closed tip', () => {
    const door = {
      name: 'Test door',
      hinge: [4, 2] as [number, number],
      closed: [4, 3] as [number, number],
      open: [5, 2] as [number, number],
    };
    const { leaf, arc } = doorPaths(door, 9);
    expect(leaf).toBe('M4 7L5 7');
    expect(arc).toBe('M5 7A1 1 0 0 0 4 6');
  });

  it('sweeps the other way for a door that opens the other way round', () => {
    const door = {
      name: 'Other door',
      hinge: [4, 2] as [number, number],
      closed: [4, 3] as [number, number],
      open: [3, 2] as [number, number],
    };
    expect(doorPaths(door, 9).arc).toBe('M3 7A1 1 0 0 1 4 6');
  });

  it('draws glazing as a line along its long side, and none for a door opening', () => {
    expect(glazingLine({ name: 'w', box: [1, -0.05, 3, 0.05], door: false }, 9)).toEqual({ x1: 1, y1: 9, x2: 3, y2: 9 });
    expect(glazingLine({ name: 'w', box: [0, 1, 0.1, 4], door: false }, 9)).toEqual({ x1: 0.05, y1: 8, x2: 0.05, y2: 5 });
    expect(glazingLine({ name: 'w', box: [0, 1, 0.1, 4], door: true }, 9)).toBeNull();
  });
});
