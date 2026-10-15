import { describe, expect, it } from 'vitest';
import {
  HANDLE_DISTANCE_M,
  bearingTo,
  decodeRange,
  distanceRange,
  footprintKind,
  footprintPath,
  fovOf,
  fp300Range,
  handlePoint,
  targetArcPath,
} from '../radarRange';

const zones = (from: number, to: number) => {
  let mask = 0;
  for (let zone = from; zone <= to; zone += 1) mask |= 1 << zone;
  return mask;
};

const pos = { x: 2, y: 1, h: null };

describe('FP300 detection range', () => {
  it('reads zones 0 to 18 as 0 to 4.75 m', () => {
    expect(fp300Range(524287)).toEqual({ r0: 0, r1: 4.75 });
    expect(fp300Range(zones(0, 18))).toEqual({ r0: 0, r1: 4.75 });
  });

  it('reads zones 2 to 15 as 0.5 to 4.0 m and 1 to 18 as 0.25 to 4.75 m', () => {
    expect(fp300Range(zones(2, 15))).toEqual({ r0: 0.5, r1: 4 });
    expect(fp300Range(zones(1, 18))).toEqual({ r0: 0.25, r1: 4.75 });
  });

  it('reads all 24 zones as 6 m and a single zone as one 25 cm band', () => {
    expect(fp300Range(zones(0, 23))).toEqual({ r0: 0, r1: 6 });
    expect(fp300Range(1 << 4)).toEqual({ r0: 1, r1: 1.25 });
  });

  it('has no range for an empty or invalid mask', () => {
    expect(fp300Range(0)).toBeNull();
    expect(fp300Range(-1)).toBeNull();
    expect(fp300Range(Number.NaN)).toBeNull();
  });
});

describe('distance radars and entity decoding', () => {
  it('covers from the sensor out to a configured distance', () => {
    expect(distanceRange(2)).toEqual({ r0: 0, r1: 2 });
    expect(distanceRange(0)).toBeNull();
    expect(distanceRange(Number.NaN)).toBeNull();
  });

  it('decodes a number entity by its unit', () => {
    expect(decodeRange('2', 'm')).toEqual({ r0: 0, r1: 2 });
    expect(decodeRange('524287')).toEqual({ r0: 0, r1: 4.75 });
    expect(decodeRange('unavailable', 'm')).toBeNull();
    expect(decodeRange('unknown')).toBeNull();
    expect(decodeRange(undefined)).toBeNull();
    expect(decodeRange('')).toBeNull();
    expect(decodeRange('0', 'm')).toBeNull();
  });
});

describe('footprint shape', () => {
  it('draws a cone for a known bearing, a ring for an owner stated all-round field, and a dashed ring when unknown', () => {
    expect(footprintKind({ state: 'known', deg: 90 }, 120)).toBe('cone');
    expect(footprintKind({ state: 'known', deg: 90 }, null)).toBe('cone');
    expect(footprintKind({ state: 'known', deg: 90 }, 360)).toBe('ring');
    expect(footprintKind({ state: 'omni' }, null)).toBe('ring');
    expect(footprintKind({ state: 'unknown' }, 120)).toBe('unknown');
  });

  it('gives a field of view of 120 degrees by default and a full circle without a known bearing', () => {
    expect(fovOf({ state: 'known', deg: 0 }, null)).toBe(120);
    expect(fovOf({ state: 'known', deg: 0 }, 90)).toBe(90);
    expect(fovOf({ state: 'omni' }, 90)).toBe(360);
    expect(fovOf({ state: 'unknown' }, 90)).toBe(360);
  });

  it('draws a cone from the sensor in the flipped drawing space', () => {
    const d = footprintPath(pos, { state: 'known', deg: 90 }, 120, { r0: 0, r1: 4 }, 9);
    expect(d).toBe('M2 8L5.464 6A4 4 0 0 0 -1.464 6Z');
  });

  it('cuts the near zone out of a cone when the range starts away from the sensor', () => {
    const d = footprintPath(pos, { state: 'known', deg: 90 }, 120, { r0: 0.5, r1: 4 }, 9);
    expect(d).toBe('M2.433 7.75L5.464 6A4 4 0 0 0 -1.464 6L1.567 7.75A0.5 0.5 0 0 1 2.433 7.75Z');
  });

  it('turns a cone with the bearing, counterclockwise from +x', () => {
    const east = footprintPath(pos, { state: 'known', deg: 0 }, 120, { r0: 0, r1: 4 }, 9);
    expect(east).toBe('M2 8L4 11.464A4 4 0 0 0 4 4.536Z');
  });

  it('draws a ring as two half arcs, with a second ring for a range that starts away from the sensor', () => {
    const omni = footprintPath(pos, { state: 'omni' }, null, { r0: 0, r1: 2 }, 9);
    expect(omni).toBe('M0 8A2 2 0 1 0 4 8A2 2 0 1 0 0 8Z');
    const annulus = footprintPath(pos, { state: 'unknown' }, null, { r0: 1, r1: 2 }, 9);
    expect(annulus).toBe('M0 8A2 2 0 1 0 4 8A2 2 0 1 0 0 8ZM1 8A1 1 0 1 0 3 8A1 1 0 1 0 1 8Z');
  });

  it('marks a field wider than a half circle with the large arc flag', () => {
    const d = footprintPath(pos, { state: 'known', deg: 90 }, 270, { r0: 0, r1: 1 }, 9);
    expect(d).toContain('A1 1 0 1 0');
  });
});

describe('the target arc', () => {
  it('runs across the cone at the reported distance', () => {
    expect(targetArcPath(pos, { state: 'known', deg: 90 }, 120, 2, 9)).toBe('M3.732 7A2 2 0 0 0 0.268 7');
  });

  it('is a full circle where there is no bearing', () => {
    expect(targetArcPath(pos, { state: 'omni' }, null, 1, 9)).toBe('M1 8A1 1 0 1 0 3 8A1 1 0 1 0 1 8Z');
    expect(targetArcPath(pos, { state: 'unknown' }, null, 1, 9)).toBe('M1 8A1 1 0 1 0 3 8A1 1 0 1 0 1 8Z');
  });
});

describe('the rotation handle', () => {
  it('sits on the axis of a known bearing, 1.2 m out, and due east otherwise', () => {
    const up = handlePoint(pos, { state: 'known', deg: 90 });
    expect(up[0]).toBeCloseTo(2);
    expect(up[1]).toBeCloseTo(1 + HANDLE_DISTANCE_M);
    expect(handlePoint(pos, { state: 'unknown' })).toEqual([2 + HANDLE_DISTANCE_M, 1]);
    expect(handlePoint(pos, { state: 'omni' })).toEqual([2 + HANDLE_DISTANCE_M, 1]);
  });

  it('turns a dragged point into a bearing snapped to 15 degrees', () => {
    expect(bearingTo(pos, 5, 1)).toBe(0);
    expect(bearingTo(pos, 2, 4)).toBe(90);
    expect(bearingTo(pos, 0, 1)).toBe(180);
    expect(bearingTo(pos, 2, -2)).toBe(270);
    expect(bearingTo(pos, 5, 1.9)).toBe(15);
    expect(bearingTo(pos, 5, 2.8)).toBe(30);
    expect(bearingTo(pos, 3, 0)).toBe(315);
  });

  it('keeps the bearing when the point is on top of the sensor', () => {
    expect(bearingTo(pos, 2.01, 1.01)).toBeNull();
  });
});
