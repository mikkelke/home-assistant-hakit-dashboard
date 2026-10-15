import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  centreOn,
  clampCentre,
  clampScale,
  fitScale,
  fitView,
  locate,
  markerNear,
  markerRadiusPx,
  panBy,
  pinchStart,
  pinchView,
  planToScreen,
  pointInPolygon,
  scaleBarLength,
  screenToPlan,
  snapToWall,
  viewBoxOf,
  zoneAt,
  zoomAt,
  type Size,
  type View,
} from '../geometry';
import { makeDoc } from './docFixtures';

const size: Size = { w: 800, h: 600 };
const doc = makeDoc();
const { fit, bounds, walls, zones } = doc.plan;

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe('view and screen conversion', () => {
  const view: View = { cx: 5, cy: 3, s: 40 };

  it('converts both ways without loss, with y running up on the plan and down on the screen', () => {
    const screen = planToScreen(view, size, 7.25, 1.5);
    const [x, y] = screenToPlan(view, size, screen.x, screen.y);
    near(x, 7.25);
    near(y, 1.5);
    expect(planToScreen(view, size, 5, 3)).toEqual({ x: 400, y: 300 });
    expect(planToScreen(view, size, 5, 4).y).toBeLessThan(300);
  });

  it('gives a viewBox in the flipped drawing space', () => {
    const box = viewBoxOf(view, size, 9);
    near(box.w, 20);
    near(box.h, 15);
    near(box.x, 5 - 10);
    near(box.y, 9 - 3 - 7.5);
  });

  it('fits the plan to the canvas and never lets the scale leave its limits', () => {
    const fitted = fitView(size, fit);
    near(fitted.cx, (fit.x0 + fit.x1) / 2);
    near(fitted.s, Math.min(800 / (fit.x1 - fit.x0), 600 / (fit.y1 - fit.y0)));
    expect(clampScale(size, fit, 0.001)).toBeCloseTo(fitScale(size, fit) * 0.6);
    expect(clampScale(size, fit, 1e9)).toBe(MAX_SCALE);
  });

  it('keeps the centre of a view inside the bounds', () => {
    const lost = clampCentre({ cx: 99, cy: -99, s: 10 }, bounds);
    expect([lost.cx, lost.cy]).toEqual([bounds.x1, bounds.y0]);
    const inside: View = { cx: 1, cy: 1, s: 10 };
    expect(clampCentre(inside, bounds)).toBe(inside);
  });

  it('centres on a point and zooms in to at least a given scale', () => {
    const v = centreOn({ cx: 0, cy: 0, s: 10 }, size, fit, bounds, 6, 2, 70);
    expect(v).toEqual({ cx: 6, cy: 2, s: 70 });
    expect(centreOn({ cx: 0, cy: 0, s: 200 }, size, fit, bounds, 6, 2, 70).s).toBe(200);
  });
});

describe('zoom and pan', () => {
  const view: View = { cx: 6, cy: 4, s: 40 };

  it('zooms about the pointer so the plan point under it stays under it', () => {
    const before = screenToPlan(view, size, 123, 456);
    const next = zoomAt(view, size, fit, bounds, 2, 123, 456);
    near(next.s, 80);
    const after = screenToPlan(next, size, 123, 456);
    near(after[0], before[0]);
    near(after[1], before[1]);
  });

  it('pans by the finger delta: dragging right moves the plan right, so the centre moves left', () => {
    const next = panBy(view, 40, -80, bounds);
    near(next.cx, 6 - 1);
    near(next.cy, 4 - 2);
  });
});

describe('two finger gestures', () => {
  const view: View = { cx: 6, cy: 4, s: 40 };
  const a = { x: 300, y: 300 };
  const b = { x: 500, y: 300 };

  it('pans by the finger delta when both fingers move equally, without changing the scale', () => {
    const start = pinchStart(view, size, a, b);
    const moved = pinchView(start, size, fit, bounds, { x: a.x + 80, y: a.y - 40 }, { x: b.x + 80, y: b.y - 40 });
    near(moved.s, view.s);
    near(moved.cx, view.cx - 80 / view.s);
    near(moved.cy, view.cy - 40 / view.s);
  });

  it('keeps the plan point it started on under the midpoint while the spacing changes', () => {
    const start = pinchStart(view, size, a, b);
    const a2 = { x: 250, y: 320 };
    const b2 = { x: 550, y: 280 };
    const next = pinchView(start, size, fit, bounds, a2, b2);
    near(next.s, view.s * (Math.hypot(300, 40) / 200), 4);
    const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
    const under = screenToPlan(next, size, mid.x, mid.y);
    near(under[0], start.anchor[0], 4);
    near(under[1], start.anchor[1], 4);
  });

  it('scales and pans in one move without drift: the same fingers always give the same view', () => {
    const start = pinchStart(view, size, a, b);
    const first = pinchView(start, size, fit, bounds, { x: 280, y: 310 }, { x: 540, y: 330 });
    const detour = pinchView(start, size, fit, bounds, { x: 100, y: 100 }, { x: 700, y: 500 });
    const again = pinchView(start, size, fit, bounds, { x: 280, y: 310 }, { x: 540, y: 330 });
    expect(detour).not.toEqual(first);
    expect(again).toEqual(first);
  });

  it('does not divide by zero when two fingers start on the same spot', () => {
    const start = pinchStart(view, size, a, a);
    const next = pinchView(start, size, fit, bounds, a, { x: a.x + 10, y: a.y });
    expect(Number.isFinite(next.s)).toBe(true);
  });

  it('clamps the scale of a pinch', () => {
    const start = pinchStart(view, size, a, b);
    expect(pinchView(start, size, fit, bounds, { x: 399, y: 300 }, { x: 401, y: 300 }).s).toBeCloseTo(fitScale(size, fit) * 0.6);
    expect(pinchView(start, size, fit, bounds, { x: 0, y: 0 }, { x: 800, y: 600 }).s).toBeLessThanOrEqual(MAX_SCALE);
  });
});

describe('polygons', () => {
  const byId = Object.fromEntries(zones.map(zone => [zone.zone_id, zone]));

  it('tells inside from outside for a rectangle', () => {
    expect(pointInPolygon(2, 2, byId.alpha.poly)).toBe(true);
    expect(pointInPolygon(5, 2, byId.alpha.poly)).toBe(false);
  });

  it('handles an L-shaped room: the notch is outside, both arms are inside', () => {
    const l = byId.gamma.poly;
    expect(pointInPolygon(11, 5, l)).toBe(true);
    expect(pointInPolygon(9, 3, l)).toBe(true);
    expect(pointInPolygon(9, 5, l)).toBe(false);
    expect(pointInPolygon(12.5, 3, l)).toBe(false);
    expect(locate(10.005, 5, l)).toBe('on');
  });

  it('names the zone a point is in, and nothing on a shared boundary or outside every zone', () => {
    expect(zoneAt(zones, 2, 2)?.zone_id).toBe('alpha');
    expect(zoneAt(zones, 6, 3)?.zone_id).toBe('beta');
    expect(zoneAt(zones, 11, 5)?.zone_id).toBe('gamma');
    expect(zoneAt(zones, 4, 2)).toBeNull();
    expect(zoneAt(zones, 4.004, 2)).toBeNull();
    expect(zoneAt(zones, 9, 5)).toBeNull();
    expect(zoneAt(zones, -3, -3)).toBeNull();
  });

  it('puts every zone centre in its own zone', () => {
    for (const zone of zones) expect(zoneAt(zones, zone.label[0], zone.label[1])?.zone_id).toBe(zone.zone_id);
  });
});

describe('snapping to a wall face', () => {
  it('lands on the nearest face within fifteen centimetres', () => {
    expect(snapToWall(walls, 0.2, 4)).toEqual({ x: 0.1, y: 4 });
    expect(snapToWall(walls, 6, 0.2)).toEqual({ x: 6, y: 0.1 });
    expect(snapToWall(walls, 5, 0.04)).toEqual({ x: 5, y: 0 });
  });

  it('does nothing beyond fifteen centimetres', () => {
    expect(snapToWall(walls, 0.26, 4)).toBeNull();
    expect(snapToWall(walls, 7, 3)).toBeNull();
  });

  it('chooses the nearer of two faces and a thinner limit when asked', () => {
    expect(snapToWall(walls, 4.0, 2)).toEqual({ x: 3.95, y: 2 });
    expect(snapToWall(walls, 4.1, 2)).toEqual({ x: 4.05, y: 2 });
    expect(snapToWall(walls, 0.2, 4, 0.05)).toBeNull();
  });

  it('never picks a face buried inside another wall', () => {
    const cross = [
      { x0: 0, x1: 6, y0: 2.9, y1: 3.1 },
      { x0: 2.9, x1: 3.1, y0: 0, y1: 6 },
    ];
    expect(snapToWall(cross, 3.0, 3.15)).toEqual({ x: 2.9, y: 3.15 });
  });
});

describe('marker size and scale bar', () => {
  it('grows a marker with the zoom between 8.5 and 14 px', () => {
    expect(markerRadiusPx(10)).toBe(8.5);
    expect(markerRadiusPx(60)).toBeCloseTo(10.2);
    expect(markerRadiusPx(400)).toBe(14);
  });

  it('picks the longest round length that fits', () => {
    expect(scaleBarLength(40)).toBe(2);
    expect(scaleBarLength(100)).toBe(1);
    expect(scaleBarLength(500)).toBe(0.25);
    expect(scaleBarLength(1)).toBe(10);
    expect(scaleBarLength(5000)).toBe(0.1);
  });
});

describe('which marker a press means', () => {
  const view: View = { cx: 6, cy: 4, s: 40 };
  const at = (x: number, y: number) => planToScreen(view, size, x, y);
  const markers = [
    { key: 'a', x: 5, y: 4 },
    { key: 'b', x: 5.3, y: 4 },
    { key: 'far', x: 9, y: 4 },
  ];

  it('picks the marker whose centre is nearest, not the one drawn last', () => {
    const press = at(5.05, 4);
    expect(markerNear(markers, view, size, press, 22)).toBe('a');
    expect(markerNear([...markers].reverse(), view, size, press, 22)).toBe('a');
    expect(markerNear(markers, view, size, at(5.28, 4), 22)).toBe('b');
  });

  it('finds none outside every target', () => {
    expect(markerNear(markers, view, size, at(7, 4), 22)).toBeNull();
    expect(markerNear([], view, size, at(5, 4), 22)).toBeNull();
  });

  it('prefers the selected marker whenever the press is inside its own target, so it can be dragged from where it sits', () => {
    expect(markerNear(markers, view, size, at(5.2, 4), 22, 'a')).toBe('a');
    expect(markerNear(markers, view, size, at(5.2, 4), 22, 'b')).toBe('b');
    expect(markerNear(markers, view, size, at(5.2, 4), 22, 'far')).toBe('b');
  });
});
