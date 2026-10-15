import { locate, zoneAt } from './geometry';
import { round2, type Door, type Fingerprint, type Plan, type Point, type Wall, type Zone } from './mapDoc';

/** How far a survey point keeps from a wall and from the edge of its zone, in metres. */
export const WALL_CLEARANCE_M = 0.4;
const GRID_M = 0.1;
const AREA_PER_POINT_M2 = 7;
const MAX_PER_ZONE = 4;
const MIN_PER_ZONE = 2;
const TERRACE_OUT_M = 1;
/** What the clearance may shrink to, in order, for a zone that has no point at the full clearance. */
const RELAXED_CLEARANCES_M = [0.3, 0.2, 0.1];

export type SurveyKind = 'room' | 'door' | 'terrace';

export interface SurveyPoint {
  /** Stable while the plan is: a zone id and a number, or a slug of the door's name. */
  id: string;
  /** The place in the walking order, from 1. */
  n: number;
  at: Point;
  kind: SurveyKind;
  /** The zone the point lies in; null on a doorway and outside. */
  zone_id: string | null;
  label: string;
}

export interface SurveyOptions {
  clearanceM?: number;
  areaPerPointM2?: number;
  maxPerZone?: number;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function distanceToSegment(px: number, py: number, [x1, y1]: Point, [x2, y2]: Point): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(Math.max(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0), 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distanceToEdges(poly: readonly Point[], x: number, y: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1)
    nearest = Math.min(nearest, distanceToSegment(x, y, poly[j], poly[i]));
  return nearest;
}

/** Zero inside the wall. */
const distanceToWall = (wall: Wall, x: number, y: number): number =>
  Math.hypot(Math.max(wall.x0 - x, 0, x - wall.x1), Math.max(wall.y0 - y, 0, y - wall.y1));

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function areaOf(poly: readonly Point[]): number {
  let twice = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) twice += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(twice) / 2;
}

interface Candidate {
  at: Point;
  /** The distance to the nearest wall or zone edge. */
  room: number;
}

/** Every grid point inside the zone that keeps `clearance` from its edges and from every wall. */
function candidatesOf(plan: Plan, zone: Zone, clearance: number): Candidate[] {
  const xs = zone.poly.map(point => point[0]);
  const ys = zone.poly.map(point => point[1]);
  const out: Candidate[] = [];
  for (let y = Math.ceil(Math.min(...ys) / GRID_M) * GRID_M; y <= Math.max(...ys); y += GRID_M) {
    for (let x = Math.ceil(Math.min(...xs) / GRID_M) * GRID_M; x <= Math.max(...xs); x += GRID_M) {
      if (locate(x, y, zone.poly) !== 'in') continue;
      const room = Math.min(distanceToEdges(zone.poly, x, y), ...plan.walls.map(wall => distanceToWall(wall, x, y)));
      if (room >= clearance - 1e-9) out.push({ at: [round2(x), round2(y)], room });
    }
  }
  return out;
}

/** The points of a zone: the one deepest inside it, then each next one as far as it can be from all those chosen and from
 * the fixed points. */
function spread(candidates: readonly Candidate[], count: number, fixed: readonly Point[]): Point[] {
  const chosen: Point[] = [];
  let first: Candidate | null = null;
  for (const candidate of candidates) if (first === null || candidate.room > first.room) first = candidate;
  if (first === null) return chosen;
  chosen.push(first.at);
  while (chosen.length < count) {
    let best: Point | null = null;
    let bestGap = -1;
    for (const candidate of candidates) {
      const gap = Math.min(...[...chosen, ...fixed].map(other => distance(candidate.at, other)));
      if (gap > bestGap) {
        best = candidate.at;
        bestGap = gap;
      }
    }
    const pick = best;
    if (pick === null || chosen.some(point => point[0] === pick[0] && point[1] === pick[1])) break;
    chosen.push(pick);
  }
  return chosen;
}

/** The middle of the opening: the glazing box of a door that has one, otherwise halfway between hinge and closed leaf. */
function doorwayOf(plan: Plan, door: Door): Point {
  const opening = plan.windows.find(window => window.door && window.name === door.name);
  if (opening) return [round2((opening.box[0] + opening.box[2]) / 2), round2((opening.box[1] + opening.box[3]) / 2)];
  return [round2((door.hinge[0] + door.closed[0]) / 2), round2((door.hinge[1] + door.closed[1]) / 2)];
}

/** A point `out` metres from a terrace door, on the side its leaf swings to, or on the other when that one is blocked. */
function terraceOf(plan: Plan, door: Door, at: Point, out: number): Point | null {
  const dx = door.open[0] - door.hinge[0];
  const dy = door.open[1] - door.hinge[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  for (const side of [1, -1]) {
    const x = at[0] + (side * dx * out) / length;
    const y = at[1] + (side * dy * out) / length;
    const blocked = zoneAt(plan.zones, x, y) !== null || plan.walls.some(wall => distanceToWall(wall, x, y) < 0.2);
    if (!blocked) return [round2(x), round2(y)];
  }
  return null;
}

type Unnumbered = Omit<SurveyPoint, 'n'>;

const pathLength = (points: readonly Unnumbered[]) => points.slice(1).reduce((sum, point, i) => sum + distance(points[i].at, point.at), 0);

/** A walking order: nearest next from the entrance, then shortened by reversing stretches of it while that helps. */
function walkingOrder(points: readonly Unnumbered[]): Unnumbered[] {
  if (points.length < 3) return [...points];
  let start = points.findIndex(point => point.kind === 'door' && /front|entr/i.test(point.label));
  if (start < 0) start = points.findIndex(point => point.kind === 'door');
  const left = [...points];
  const path = [left.splice(Math.max(start, 0), 1)[0]];
  while (left.length > 0) {
    const here = path[path.length - 1].at;
    let next = 0;
    for (let i = 1; i < left.length; i += 1) if (distance(here, left[i].at) < distance(here, left[next].at)) next = i;
    path.push(left.splice(next, 1)[0]);
  }
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 1; i < path.length - 1; i += 1) {
      for (let j = i + 1; j < path.length; j += 1) {
        const trial = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (pathLength(trial) < pathLength(path) - 1e-9) {
          path.splice(0, path.length, ...trial);
          improved = true;
        }
      }
    }
  }
  return path;
}

/**
 * The places a survey asks for a capture. Every zone gets at least two, more when it is large (one per 7 square metres,
 * at most four), spread through it and never closer than `clearanceM` to a wall or the edge of the zone. Every door
 * gets one in its opening, and a terrace door, one outside it. The result is in a walking order from the entrance.
 */
export function surveyPoints(plan: Plan, options: SurveyOptions = {}): SurveyPoint[] {
  const clearance = options.clearanceM ?? WALL_CLEARANCE_M;
  const perPoint = options.areaPerPointM2 ?? AREA_PER_POINT_M2;
  const most = options.maxPerZone ?? MAX_PER_ZONE;
  const taken = new Set<string>();
  const unique = (id: string) => {
    let name = id;
    for (let n = 2; taken.has(name); n += 1) name = `${id}-${n}`;
    taken.add(name);
    return name;
  };

  const fixed: Unnumbered[] = [];
  for (const door of plan.doors) {
    const at = doorwayOf(plan, door);
    fixed.push({
      id: unique(`door-${slug(door.name)}`),
      at,
      kind: 'door',
      zone_id: zoneAt(plan.zones, at[0], at[1])?.zone_id ?? null,
      label: door.name,
    });
    if (/terrace/i.test(door.name)) {
      const outside = terraceOf(plan, door, at, TERRACE_OUT_M);
      if (outside)
        fixed.push({
          id: unique(`terrace-${slug(door.name)}`),
          at: outside,
          kind: 'terrace',
          zone_id: null,
          label: `${door.name} (outside)`,
        });
    }
  }

  const rooms: Unnumbered[] = [];
  const fixedAt = fixed.map(point => point.at);
  for (const zone of plan.zones) {
    const count = Math.min(most, Math.max(MIN_PER_ZONE, Math.ceil(areaOf(zone.poly) / perPoint)));
    let candidates: Candidate[] = [];
    for (const level of [clearance, ...RELAXED_CLEARANCES_M.filter(value => value < clearance)]) {
      candidates = candidatesOf(plan, zone, level);
      if (candidates.length > 0) break;
    }
    spread(candidates, count, fixedAt).forEach((at, index) =>
      rooms.push({
        id: unique(`${zone.zone_id}-${index + 1}`),
        at,
        kind: 'room',
        zone_id: zone.zone_id,
        label: `${zone.name} ${index + 1}`,
      })
    );
  }

  return walkingOrder([...fixed, ...rooms]).map((point, index) => ({ ...point, n: index + 1 }));
}

export type SurveyStatus = 'todo' | 'done' | 'skipped';

export interface SurveyProgress {
  status: Record<string, SurveyStatus>;
  /** The newest capture of each point that has one. */
  latest: Record<string, Fingerprint>;
  total: number;
  done: number;
  skipped: number;
  /** Points whose newest capture holds no Wi-Fi reading. */
  noWifi: number;
}

/** A point is done once a capture was made for it, whatever it caught; skipping a point that was captured changes nothing. */
export function surveyProgress(
  points: readonly SurveyPoint[],
  items: readonly Fingerprint[],
  skipped: ReadonlySet<string>
): SurveyProgress {
  const latest: Record<string, Fingerprint> = {};
  for (const item of items) {
    if (item.survey_id === null) continue;
    const known = latest[item.survey_id];
    if (!known || item.at >= known.at) latest[item.survey_id] = item;
  }
  const status: Record<string, SurveyStatus> = {};
  let done = 0;
  let skippedCount = 0;
  let noWifi = 0;
  for (const point of points) {
    const capture = latest[point.id];
    if (capture) {
      status[point.id] = 'done';
      done += 1;
      if (capture.wifi.dbm === null) noWifi += 1;
    } else if (skipped.has(point.id)) {
      status[point.id] = 'skipped';
      skippedCount += 1;
    } else status[point.id] = 'todo';
  }
  return { status, latest, total: points.length, done, skipped: skippedCount, noWifi };
}

/** The next point still to do after `after` in the walking order, wrapping round; the first one when `after` is null. */
export function nextPoint(points: readonly SurveyPoint[], progress: SurveyProgress, after: string | null): SurveyPoint | null {
  const from = after === null ? -1 : points.findIndex(point => point.id === after);
  for (let step = 1; step <= points.length; step += 1) {
    const point = points[(from + step + points.length) % points.length];
    if (progress.status[point.id] === 'todo') return point;
  }
  return null;
}
