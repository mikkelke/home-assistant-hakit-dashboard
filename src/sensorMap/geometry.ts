import type { Point, Rect, Wall, Zone } from './mapDoc';

/** Plan coordinates are metres with y running into the flat. A view is the plan point at the centre of the
 * canvas and a scale in screen pixels per metre. The drawing itself flips y (`yTop - y`) so the facade ends up
 * at the bottom of the screen. */
export interface View {
  cx: number;
  cy: number;
  s: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Px {
  x: number;
  y: number;
}

export const MAX_SCALE = 420;
const MIN_SCALE_OF_FIT = 0.6;
export const WALL_SNAP_M = 0.15;
export const WALL_SNAP_PX = 20;

/** Wall snap reach in metres at scale `s` (px per metre): a fixed finger distance, never under WALL_SNAP_M. */
export function wallSnapRadius(s: number): number {
  return s > 0 ? Math.max(WALL_SNAP_M, WALL_SNAP_PX / s) : WALL_SNAP_M;
}
const BOUNDARY_EPS = 0.01;

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

export function fitScale(size: Size, fit: Rect): number {
  return Math.min(size.w / (fit.x1 - fit.x0), size.h / (fit.y1 - fit.y0));
}

export function fitView(size: Size, fit: Rect): View {
  return { cx: (fit.x0 + fit.x1) / 2, cy: (fit.y0 + fit.y1) / 2, s: fitScale(size, fit) };
}

export function clampScale(size: Size, fit: Rect, s: number): number {
  return clamp(s, fitScale(size, fit) * MIN_SCALE_OF_FIT, MAX_SCALE);
}

/** Keeps the centre of the view inside `bounds`, so the plan cannot be panned out of reach. */
export function clampCentre(view: View, bounds: Rect): View {
  const cx = clamp(view.cx, bounds.x0, bounds.x1);
  const cy = clamp(view.cy, bounds.y0, bounds.y1);
  return cx === view.cx && cy === view.cy ? view : { ...view, cx, cy };
}

export function planToScreen(view: View, size: Size, x: number, y: number): Px {
  return { x: size.w / 2 + (x - view.cx) * view.s, y: size.h / 2 - (y - view.cy) * view.s };
}

export function screenToPlan(view: View, size: Size, px: number, py: number): Point {
  return [view.cx + (px - size.w / 2) / view.s, view.cy - (py - size.h / 2) / view.s];
}

/** The SVG viewBox of a view, in the flipped drawing space. */
export function viewBoxOf(view: View, size: Size, yTop: number): { x: number; y: number; w: number; h: number } {
  const w = size.w / view.s;
  const h = size.h / view.s;
  return { x: view.cx - w / 2, y: yTop - view.cy - h / 2, w, h };
}

export function zoomAt(view: View, size: Size, fit: Rect, bounds: Rect, factor: number, px: number, py: number): View {
  const s = clampScale(size, fit, view.s * factor);
  const [wx, wy] = screenToPlan(view, size, px, py);
  return clampCentre({ cx: wx - (px - size.w / 2) / s, cy: wy + (py - size.h / 2) / s, s }, bounds);
}

export function panBy(view: View, dxPx: number, dyPx: number, bounds: Rect): View {
  return clampCentre({ ...view, cx: view.cx - dxPx / view.s, cy: view.cy + dyPx / view.s }, bounds);
}

/** Where the view stood when two fingers touched down: the plan point under their midpoint, their spacing and
 * the scale. Every later move derives the whole view from this and the two fingers, so moving both fingers
 * without changing the spacing pans, and scaling and panning combine without drift. */
export interface PinchStart {
  anchor: Point;
  distance: number;
  scale: number;
}

const midpoint = (a: Px, b: Px): Px => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const spacing = (a: Px, b: Px) => Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);

export function pinchStart(view: View, size: Size, a: Px, b: Px): PinchStart {
  const mid = midpoint(a, b);
  return { anchor: screenToPlan(view, size, mid.x, mid.y), distance: spacing(a, b), scale: view.s };
}

export function pinchView(start: PinchStart, size: Size, fit: Rect, bounds: Rect, a: Px, b: Px): View {
  const s = clampScale(size, fit, (start.scale * spacing(a, b)) / start.distance);
  const mid = midpoint(a, b);
  return clampCentre({ cx: start.anchor[0] - (mid.x - size.w / 2) / s, cy: start.anchor[1] + (mid.y - size.h / 2) / s, s }, bounds);
}

export function centreOn(view: View, size: Size, fit: Rect, bounds: Rect, x: number, y: number, minScale: number): View {
  return clampCentre({ cx: x, cy: y, s: clampScale(size, fit, Math.max(view.s, minScale)) }, bounds);
}

export type Location = 'in' | 'on' | 'out';

/** Where a point lies against a polygon; within a centimetre of an edge counts as on it. */
export function locate(x: number, y: number, poly: Point[]): Location {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [x1, y1] = poly[j];
    const [x2, y2] = poly[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : clamp(((x - x1) * dx + (y - y1) * dy) / lengthSq, 0, 1);
    if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= BOUNDARY_EPS) return 'on';
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside ? 'in' : 'out';
}

export const pointInPolygon = (x: number, y: number, poly: Point[]): boolean => locate(x, y, poly) === 'in';

/** The zone a point is in, or null when it is outside every zone or on a boundary. */
export function zoneAt(zones: readonly Zone[], x: number, y: number): Zone | null {
  let hit: Zone | null = null;
  for (const zone of zones) {
    const where = locate(x, y, zone.poly);
    if (where === 'on') return null;
    if (where === 'in' && hit === null) hit = zone;
  }
  return hit;
}

interface Candidate {
  x: number;
  y: number;
  distance: number;
}

function nearestOnRect(wall: Wall, x: number, y: number): Candidate {
  const outside = x < wall.x0 || x > wall.x1 || y < wall.y0 || y > wall.y1;
  if (outside) {
    const nx = clamp(x, wall.x0, wall.x1);
    const ny = clamp(y, wall.y0, wall.y1);
    return { x: nx, y: ny, distance: Math.hypot(x - nx, y - ny) };
  }
  const faces: Candidate[] = [
    { x: wall.x0, y, distance: x - wall.x0 },
    { x: wall.x1, y, distance: wall.x1 - x },
    { x, y: wall.y0, distance: y - wall.y0 },
    { x, y: wall.y1, distance: wall.y1 - y },
  ];
  return faces.reduce((best, face) => (face.distance < best.distance ? face : best));
}

const FACE_EPS = 0.001;

function strictlyInside(wall: Wall, c: Candidate): boolean {
  return c.x > wall.x0 + FACE_EPS && c.x < wall.x1 - FACE_EPS && c.y > wall.y0 + FACE_EPS && c.y < wall.y1 - FACE_EPS;
}

/** The nearest point on a wall face within `maxDist` metres, never one buried inside another wall. */
export function snapToWall(walls: readonly Wall[], x: number, y: number, maxDist = WALL_SNAP_M): Px | null {
  const candidates = walls
    .map(wall => ({ wall, c: nearestOnRect(wall, x, y) }))
    .filter(({ c }) => c.distance <= maxDist)
    .sort((a, b) => a.c.distance - b.c.distance);
  for (const { wall, c } of candidates) {
    if (!walls.some(other => other !== wall && strictlyInside(other, c))) return { x: c.x, y: c.y };
  }
  return null;
}

/** Radius in screen pixels of a marker body: it grows with the zoom, within limits. */
export function markerRadiusPx(s: number): number {
  return clamp(0.17 * s, 8.5, 14);
}

const NICE_LENGTHS_M = [0.1, 0.25, 0.5, 1, 2, 5, 10];

/** The longest round length that fits `maxPx` at this scale, for a scale bar. */
export function scaleBarLength(s: number, maxPx = 150): number {
  let best = NICE_LENGTHS_M[0];
  for (const length of NICE_LENGTHS_M) if (length * s <= maxPx) best = length;
  return best;
}

export interface MarkerPoint {
  key: string;
  x: number;
  y: number;
}

/**
 * The marker for a press at screen point `px`: the one whose centre is nearest, within `radiusPx`. Touch targets
 * overlap in a crowded plan, and the one drawn last would win a plain hit test; the nearest centre is what the
 * finger meant. `prefer`, the selected marker, wins whenever the press is inside its own target, so it can be
 * dragged from where it sits.
 */
export function markerNear(
  markers: readonly MarkerPoint[],
  view: View,
  size: Size,
  px: Px,
  radiusPx: number,
  prefer: string | null = null
): string | null {
  let best: string | null = null;
  let bestDistance = radiusPx;
  for (const marker of markers) {
    const at = planToScreen(view, size, marker.x, marker.y);
    const distance = Math.hypot(at.x - px.x, at.y - px.y);
    if (marker.key === prefer && distance <= radiusPx) return marker.key;
    if (distance <= bestDistance) {
      best = marker.key;
      bestDistance = distance;
    }
  }
  return best;
}
