import type { Facing, Pos } from './mapDoc';

export interface RadarRange {
  r0: number;
  r1: number;
}

export const DEFAULT_FOV_DEG = 120;
const FP300_ZONES = 24;
const FP300_ZONE_M = 0.25;
export const HANDLE_DISTANCE_M = 1.2;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** An Aqara FP300 stores its detection range as a bitmask of 24 zones of 25 cm each, nearest zone first: the
 * range runs from the start of the lowest set zone to the end of the highest. */
export function fp300Range(mask: number): RadarRange | null {
  const bits = Math.trunc(mask);
  if (!Number.isFinite(bits) || bits <= 0) return null;
  let lowest = -1;
  let highest = -1;
  for (let zone = 0; zone < FP300_ZONES; zone += 1) {
    if ((bits >> zone) & 1) {
      if (lowest < 0) lowest = zone;
      highest = zone;
    }
  }
  if (lowest < 0) return null;
  return { r0: round2(lowest * FP300_ZONE_M), r1: round2((highest + 1) * FP300_ZONE_M) };
}

/** A radar that reports its range as a distance in metres covers everything from the sensor out to it. */
export function distanceRange(metres: number): RadarRange | null {
  return Number.isFinite(metres) && metres > 0 ? { r0: 0, r1: round2(metres) } : null;
}

/** The range a `number` entity describes: a distance when its unit is metres, otherwise an FP300 bitmask. */
export function decodeRange(state: string | undefined, unit?: string): RadarRange | null {
  if (state === undefined || state === '') return null;
  const value = Number(state);
  if (!Number.isFinite(value)) return null;
  return unit === 'm' ? distanceRange(value) : fp300Range(value);
}

export function fovOf(facing: Facing, fovDeg: number | null): number {
  return facing.state === 'known' ? Math.min(fovDeg ?? DEFAULT_FOV_DEG, 360) : 360;
}

export type FootprintKind = 'cone' | 'ring' | 'unknown';

/** A cone for a known bearing, a full ring for an owner stated all-round field, and a dashed ring where the
 * bearing is not known: the footprint is never guessed. */
export function footprintKind(facing: Facing, fovDeg: number | null): FootprintKind {
  if (facing.state === 'unknown') return 'unknown';
  return fovOf(facing, fovDeg) >= 360 ? 'ring' : 'cone';
}

const num = (value: number) => String(Number(value.toFixed(3)));

function point(pos: Pos, radius: number, deg: number, yTop: number): string {
  const rad = (deg * Math.PI) / 180;
  return `${num(pos.x + radius * Math.cos(rad))} ${num(yTop - (pos.y + radius * Math.sin(rad)))}`;
}

function ring(pos: Pos, radius: number, yTop: number): string {
  const y = num(yTop - pos.y);
  return `M${num(pos.x - radius)} ${y}A${num(radius)} ${num(radius)} 0 1 0 ${num(pos.x + radius)} ${y}A${num(radius)} ${num(radius)} 0 1 0 ${num(pos.x - radius)} ${y}Z`;
}

/** SVG path data, in the flipped drawing space (`yTop - y`), for the area a radar covers: an annular sector for
 * a known bearing, a ring otherwise. Fill it with the evenodd rule. */
export function footprintPath(pos: Pos, facing: Facing, fovDeg: number | null, range: RadarRange, yTop: number): string {
  const kind = footprintKind(facing, fovDeg);
  if (kind !== 'cone' || facing.state !== 'known') return ring(pos, range.r1, yTop) + (range.r0 > 0 ? ring(pos, range.r0, yTop) : '');
  const fov = fovOf(facing, fovDeg);
  const a0 = facing.deg - fov / 2;
  const a1 = facing.deg + fov / 2;
  const large = fov > 180 ? 1 : 0;
  const outer = `A${num(range.r1)} ${num(range.r1)} 0 ${large} 0 ${point(pos, range.r1, a1, yTop)}`;
  if (range.r0 <= 0) return `M${num(pos.x)} ${num(yTop - pos.y)}L${point(pos, range.r1, a0, yTop)}${outer}Z`;
  const inner = `A${num(range.r0)} ${num(range.r0)} 0 ${large} 1 ${point(pos, range.r0, a0, yTop)}`;
  return `M${point(pos, range.r0, a0, yTop)}L${point(pos, range.r1, a0, yTop)}${outer}L${point(pos, range.r0, a1, yTop)}${inner}Z`;
}

/** The arc at `distance` metres across the footprint: where a target is, though no bearing is known, so no
 * point on the axis is claimed. */
export function targetArcPath(pos: Pos, facing: Facing, fovDeg: number | null, distance: number, yTop: number): string {
  const kind = footprintKind(facing, fovDeg);
  if (kind !== 'cone' || facing.state !== 'known') return ring(pos, distance, yTop);
  const fov = fovOf(facing, fovDeg);
  const large = fov > 180 ? 1 : 0;
  return `M${point(pos, distance, facing.deg - fov / 2, yTop)}A${num(distance)} ${num(distance)} 0 ${large} 0 ${point(pos, distance, facing.deg + fov / 2, yTop)}`;
}

/** Where the rotation handle of a selected radar sits, in plan coordinates: on the axis of a known bearing,
 * due east of the sensor otherwise. */
export function handlePoint(pos: Pos, facing: Facing): [number, number] {
  const deg = facing.state === 'known' ? facing.deg : 0;
  const rad = (deg * Math.PI) / 180;
  return [pos.x + HANDLE_DISTANCE_M * Math.cos(rad), pos.y + HANDLE_DISTANCE_M * Math.sin(rad)];
}

/** The bearing from a radar to a plan point, counterclockwise from +x and snapped to `stepDeg`; null when the
 * point is too close to say. */
export function bearingTo(pos: Pos, x: number, y: number, stepDeg = 15): number | null {
  const dx = x - pos.x;
  const dy = y - pos.y;
  if (Math.hypot(dx, dy) < 0.05) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (((Math.round(deg / stepDeg) * stepDeg) % 360) + 360) % 360;
}
