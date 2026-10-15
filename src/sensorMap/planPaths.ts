import type { Door, Glazing, Point } from './mapDoc';

const num = (value: number) => String(Number(value.toFixed(3)));

/** SVG path data for a polygon, in the flipped drawing space (`yTop - y`). */
export function polyPath(poly: readonly Point[], yTop: number): string {
  return `M${poly.map(([x, y]) => `${num(x)} ${num(yTop - y)}`).join('L')}Z`;
}

/** A door as its open leaf and the dashed arc the leaf sweeps from open to closed around the hinge. */
export function doorPaths(door: Door, yTop: number): { leaf: string; arc: string } {
  const [hx, hy] = door.hinge;
  const [cx, cy] = door.closed;
  const [ox, oy] = door.open;
  const radius = Math.hypot(ox - hx, oy - hy);
  const open = [ox - hx, -(oy - hy)];
  const closed = [cx - hx, -(cy - hy)];
  const sweep = open[0] * closed[1] - open[1] * closed[0] > 0 ? 1 : 0;
  return {
    leaf: `M${num(hx)} ${num(yTop - hy)}L${num(ox)} ${num(yTop - oy)}`,
    arc: `M${num(ox)} ${num(yTop - oy)}A${num(radius)} ${num(radius)} 0 0 ${sweep} ${num(cx)} ${num(yTop - cy)}`,
  };
}

/** The centre line of glazing along its long side, or null for a door opening, which is drawn as a frame only. */
export function glazingLine(window: Glazing, yTop: number): { x1: number; y1: number; x2: number; y2: number } | null {
  if (window.door) return null;
  const [x0, y0, x1, y1] = window.box;
  if (x1 - x0 > y1 - y0) {
    const y = yTop - (y0 + y1) / 2;
    return { x1: x0, y1: y, x2: x1, y2: y };
  }
  const x = (x0 + x1) / 2;
  return { x1: x, y1: yTop - y0, x2: x, y2: yTop - y1 };
}
