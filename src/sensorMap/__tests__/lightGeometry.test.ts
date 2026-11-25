import { describe, expect, it } from 'vitest';
import { outsidePanes, pointInPoly, sunDirection, sunShafts, visibilityPolygon, planOccluders, lampFields } from '../lightGeometry';
import type { Plan, Zone } from '../mapDoc';

const zone = (zone_id: string, poly: [number, number][], label: [number, number]): Zone => ({
  zone_id,
  name: zone_id,
  poly,
  ha_area_id: zone_id,
  active_entity: null,
  label,
  ceiling_m: null,
});

/** Two 4 x 4 rooms side by side, a 0.2 m wall between them with a 1 m doorway at y 1.5..2.5, and a south window in
 * room a. */
function twoRooms(): Plan {
  return {
    units: 'm',
    origin: '',
    bounds: { x0: -1, x1: 9, y0: -1, y1: 5 },
    fit: { x0: -1, x1: 9, y0: -1, y1: 5 },
    scale_rms_cm: null,
    walls: [
      { x0: -0.2, x1: 8.2, y0: 4, y1: 4.2 },
      { x0: -0.2, x1: 0, y0: -0.2, y1: 4.2 },
      { x0: 8, x1: 8.2, y0: -0.2, y1: 4.2 },
      { x0: 1.5, x1: 8.2, y0: -0.2, y1: 0 },
      { x0: -0.2, x1: 0.5, y0: -0.2, y1: 0 },
      { x0: 3.9, x1: 4.1, y0: 0, y1: 1.5 },
      { x0: 3.9, x1: 4.1, y0: 2.5, y1: 4 },
    ],
    doors: [],
    windows: [{ name: 'south', box: [0.5, -0.2, 1.5, 0], door: false }],
    zones: [
      zone(
        'a',
        [
          [0, 0],
          [3.9, 0],
          [3.9, 4],
          [0, 4],
        ],
        [2, 2]
      ),
      zone(
        'b',
        [
          [4.1, 0],
          [8, 0],
          [8, 4],
          [4.1, 4],
        ],
        [6, 2]
      ),
    ],
    clip_regions: [],
    zone_lines: [],
    annotations: [],
    compass: { x: 0, y: 0, rot: 0 },
  };
}

describe('visibilityPolygon', () => {
  it('passes through the doorway and stops at the wall', () => {
    const plan = twoRooms();
    const ring = visibilityPolygon([2, 2], 6, planOccluders(plan));
    expect(pointInPoly([6, 2], ring)).toBe(true);
    expect(pointInPoly([6, 0.5], ring)).toBe(false);
    expect(pointInPoly([3, 3.5], ring)).toBe(true);
    expect(pointInPoly([2, 4.5], ring)).toBe(false);
  });

  it('stops at a closed door and passes an open one', () => {
    const plan = {
      ...twoRooms(),
      doors: [
        {
          name: 'between',
          hinge: [3.9, 1.5] as [number, number],
          closed: [3.9, 2.5] as [number, number],
          open: [2.9, 1.5] as [number, number],
        },
      ],
    };
    expect(pointInPoly([6, 2], lampFields(plan).a)).toBe(true);
    expect(pointInPoly([6, 2], lampFields(plan, ['between']).a)).toBe(false);
    expect(pointInPoly([3, 2], lampFields(plan, ['between']).a)).toBe(true);
  });

  it('returns nothing for a source on a wall face', () => {
    expect(visibilityPolygon([3.9, 0.5], 6, planOccluders(twoRooms()))).toEqual([]);
  });

  it('gives every zone a field', () => {
    const fields = lampFields(twoRooms());
    expect(fields.a.length).toBeGreaterThan(3);
    expect(fields.b.length).toBeGreaterThan(3);
  });
});

describe('sun', () => {
  it('points north at azimuth 0 and east at 90 with the plan up north', () => {
    expect(sunDirection(0, 0)[1]).toBeCloseTo(1);
    expect(sunDirection(90, 0)[0]).toBeCloseTo(1);
  });

  it('finds the outside pane and its room', () => {
    const panes = outsidePanes(twoRooms());
    expect(panes).toHaveLength(1);
    expect(panes[0].zoneId).toBe('a');
    expect(panes[0].outward).toEqual([0, -1]);
  });

  it('shines in from the south and not from the north or below the horizon', () => {
    const panes = outsidePanes(twoRooms());
    const [shaft] = sunShafts(panes, 180, 20, 0);
    expect(shaft.zoneId).toBe('a');
    expect(shaft.to[1]).toBeGreaterThan(shaft.from[1]);
    expect(sunShafts(panes, 0, 20, 0)).toEqual([]);
    expect(sunShafts(panes, 180, 1, 0)).toEqual([]);
  });

  it('reaches further when the sun is low', () => {
    const panes = outsidePanes(twoRooms());
    const depth = (elevation: number) => {
      const [shaft] = sunShafts(panes, 180, elevation, 0);
      return shaft.to[1] - shaft.from[1];
    };
    expect(depth(15)).toBeGreaterThan(depth(50));
  });
});
