/**
 * Lamp light and sunlight on the plan, in plan metres with y up.
 *
 * A lamp lights what a straight line from it reaches without crossing a wall or a pane: walls and glazing are the
 * occluders, doorways are simply gaps between them, so light passes through an opening and stops at the next wall.
 * The visibility sweep is ported from houseplan-card (MIT, github.com/Matysh/houseplan-card, src/light-visibility.ts).
 */
import type { Plan, Point, Zone } from './mapDoc';

/** An opaque edge `[x1, y1, x2, y2]`. */
export type Segment = readonly [number, number, number, number];

const CORNER_NUDGE = 1e-5;
const ANGLE_EPS = 1e-9;

/** Every segment broken where it crosses another, so each crossing is an endpoint the sweep casts a ray at. */
export function splitAtIntersections(segments: readonly Segment[]): Segment[] {
  const cuts: number[][] = segments.map(() => []);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    const ax = a[2] - a[0];
    const ay = a[3] - a[1];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      const denominator = ax * (b[3] - b[1]) - ay * (b[2] - b[0]);
      if (Math.abs(denominator) < 1e-12) continue;
      const ox = b[0] - a[0];
      const oy = b[1] - a[1];
      const t = (ox * (b[3] - b[1]) - oy * (b[2] - b[0])) / denominator;
      const u = (ox * ay - oy * ax) / denominator;
      if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
      cuts[i].push(t);
      cuts[j].push(u);
    }
  }
  const out: Segment[] = [];
  segments.forEach((seg, i) => {
    if (!cuts[i].length) {
      out.push(seg);
      return;
    }
    const stops = [0, ...cuts[i].sort((left, right) => left - right), 1];
    for (let k = 1; k < stops.length; k++) {
      if (stops[k] - stops[k - 1] < 1e-9) continue;
      out.push([
        seg[0] + (seg[2] - seg[0]) * stops[k - 1],
        seg[1] + (seg[3] - seg[1]) * stops[k - 1],
        seg[0] + (seg[2] - seg[0]) * stops[k],
        seg[1] + (seg[3] - seg[1]) * stops[k],
      ]);
    }
  });
  return out;
}

function distanceToSegment(point: Point, seg: Segment): number {
  const dx = seg[2] - seg[0];
  const dy = seg[3] - seg[1];
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(point[0] - seg[0], point[1] - seg[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - seg[0]) * dx + (point[1] - seg[1]) * dy) / len2));
  return Math.hypot(point[0] - (seg[0] + t * dx), point[1] - (seg[1] + t * dy));
}

function rayHit(source: Point, dirX: number, dirY: number, seg: Segment): number {
  const ex = seg[2] - seg[0];
  const ey = seg[3] - seg[1];
  const denominator = dirX * ey - dirY * ex;
  if (Math.abs(denominator) < 1e-12) return Infinity;
  const ox = seg[0] - source[0];
  const oy = seg[1] - source[1];
  const t = (ox * ey - oy * ex) / denominator;
  if (!(t > 1e-9)) return Infinity;
  const s = (ox * dirY - oy * dirX) / denominator;
  if (s < -1e-9 || s > 1 + 1e-9) return Infinity;
  return t;
}

/** The region a point source within `radius` sees, as one ring; empty when the source sits on an occluder. */
export function visibilityPolygon(source: Point, radius: number, segments: readonly Segment[], arcSteps = 96): Point[] {
  if (!(radius > 0) || !Number.isFinite(source[0]) || !Number.isFinite(source[1])) return [];
  const near: Segment[] = [];
  for (const seg of segments) {
    const distance = distanceToSegment(source, seg);
    if (distance < 1e-7) return [];
    if (distance <= radius) near.push(seg);
  }
  const turn = Math.PI * 2;
  const angles: number[] = [];
  for (let i = 0; i < arcSteps; i++) angles.push((i / arcSteps) * turn);
  for (const seg of near) {
    for (const [px, py] of [
      [seg[0], seg[1]],
      [seg[2], seg[3]],
    ]) {
      const angle = Math.atan2(py - source[1], px - source[0]);
      angles.push(angle - CORNER_NUDGE, angle, angle + CORNER_NUDGE);
    }
  }
  for (let i = 0; i < angles.length; i++) angles[i] = ((angles[i] % turn) + turn) % turn;
  angles.sort((left, right) => left - right);
  const ring: Point[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const angle of angles) {
    if (angle - previous < ANGLE_EPS) continue;
    previous = angle;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let reach = radius;
    for (const seg of near) {
      const hit = rayHit(source, dirX, dirY, seg);
      if (hit < reach) reach = hit;
    }
    ring.push([source[0] + dirX * reach, source[1] + dirY * reach]);
  }
  return ring.length >= 3 ? ring : [];
}

function boxEdges(x0: number, y0: number, x1: number, y1: number): Segment[] {
  return [
    [x0, y0, x1, y0],
    [x1, y0, x1, y1],
    [x1, y1, x0, y1],
    [x0, y1, x0, y0],
  ];
}

/** The plan's walls and panes as occluders. Doorways are the gaps between them. */
export function planOccluders(plan: Plan): Segment[] {
  const edges: Segment[] = [];
  for (const wall of plan.walls) edges.push(...boxEdges(wall.x0, wall.y0, wall.x1, wall.y1));
  for (const glazing of plan.windows) {
    const [x0, y0, x1, y1] = glazing.box;
    edges.push(...boxEdges(x0, y0, x1, y1));
  }
  return splitAtIntersections(edges);
}

export function pointInPoly([x, y]: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const zoneAt = (point: Point, zones: readonly Zone[]): Zone | undefined => zones.find(zone => pointInPoly(point, zone.poly));

/** How far a lamp's light reaches, in metres. */
export const LAMP_REACH_M = 6;

/** What each zone's lamps light, seen from the zone's label point. Depends on the plan only, never on a lamp's state. */
export function lampFields(plan: Plan): Record<string, Point[]> {
  const occluders = planOccluders(plan);
  const out: Record<string, Point[]> = {};
  for (const zone of plan.zones) out[zone.zone_id] = visibilityPolygon(zone.label, LAMP_REACH_M, occluders);
  return out;
}

/** The sun below this elevation, in degrees, casts nothing worth drawing. */
export const SUN_MIN_ELEVATION = 3;
/** A pane only lets the sun in when it is this square to it: the cosine of the angle between the pane's outward
 * normal and the direction to the sun. */
const SUN_MIN_COS = 0.05;
/** Height of a pane's head above the floor, metres: the far end of the floor patch the sun lights. */
const PANE_HEAD_M = 2.1;
const SHAFT_MIN_M = 0.6;
const SHAFT_MAX_M = 6;
const PROBE_STEP_M = 0.25;
const OUTSIDE_REACH_M = 8;

/** The direction toward the sun on the plan, y up, for an azimuth measured clockwise from north, given the compass's
 * clockwise rotation of north from plan up. */
export function sunDirection(azimuthDeg: number, northRotDeg: number): Point {
  const angle = ((azimuthDeg + northRotDeg) * Math.PI) / 180;
  return [Math.sin(angle), Math.cos(angle)];
}

/** One sunlit floor patch: the parallelogram the sun throws through a pane, the zone it falls in, and the gradient
 * axis from the pane's inner face to the patch's far edge. */
export interface SunShaft {
  id: string;
  zoneId: string;
  quad: Point[];
  from: Point;
  to: Point;
}

interface Pane {
  id: string;
  zoneId: string;
  /** The inner face's two ends. */
  a: Point;
  b: Point;
  /** Unit normal pointing out of the flat. */
  outward: Point;
}

/** The panes in an outside wall, each with the zone on its inner side. A pane between two rooms, or onto the
 * stairwell with a room behind it, has a zone outward within reach and lets in no sun. */
export function outsidePanes(plan: Plan): Pane[] {
  const panes: Pane[] = [];
  plan.windows.forEach((glazing, index) => {
    const [x0, y0, x1, y1] = glazing.box;
    const alongX = x1 - x0 >= y1 - y0;
    const mid: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
    const half = alongX ? (y1 - y0) / 2 : (x1 - x0) / 2;
    for (const sign of [1, -1]) {
      const n: Point = alongX ? [0, sign] : [sign, 0];
      const inner: Point = [mid[0] - n[0] * (half + 0.15), mid[1] - n[1] * (half + 0.15)];
      const zone = zoneAt(inner, plan.zones);
      if (!zone) continue;
      let blocked = false;
      for (let d = half + PROBE_STEP_M; d <= OUTSIDE_REACH_M; d += PROBE_STEP_M) {
        if (zoneAt([mid[0] + n[0] * d, mid[1] + n[1] * d], plan.zones)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const a: Point = alongX ? [x0, sign > 0 ? y0 : y1] : [sign > 0 ? x0 : x1, y0];
      const b: Point = alongX ? [x1, sign > 0 ? y0 : y1] : [sign > 0 ? x0 : x1, y1];
      panes.push({ id: `${index}`, zoneId: zone.zone_id, a, b, outward: n });
      return;
    }
  });
  return panes;
}

/** The floor patches the sun lights through the outside panes right now. */
export function sunShafts(panes: readonly Pane[], azimuthDeg: number, elevationDeg: number, northRotDeg: number): SunShaft[] {
  if (!(elevationDeg >= SUN_MIN_ELEVATION)) return [];
  const toSun = sunDirection(azimuthDeg, northRotDeg);
  const reach = Math.min(SHAFT_MAX_M, Math.max(SHAFT_MIN_M, PANE_HEAD_M / Math.tan((elevationDeg * Math.PI) / 180)));
  const out: SunShaft[] = [];
  for (const pane of panes) {
    const cos = pane.outward[0] * toSun[0] + pane.outward[1] * toSun[1];
    if (cos <= SUN_MIN_COS) continue;
    const d: Point = [-toSun[0] * reach, -toSun[1] * reach];
    const { a, b } = pane;
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const depth = reach * cos;
    out.push({
      id: pane.id,
      zoneId: pane.zoneId,
      quad: [a, b, [b[0] + d[0], b[1] + d[1]], [a[0] + d[0], a[1] + d[1]]],
      from: mid,
      to: [mid[0] - pane.outward[0] * depth, mid[1] - pane.outward[1] * depth],
    });
  }
  return out;
}
