/** The living sky above the grid: its phase from the sun's elevation, where the sun or moon stands on
 * the day's arc, cloud cover and wind. Pure. */

const DAY_MS = 86_400_000;

export type SkyPhase = 'night' | 'dawn' | 'dusk' | 'morning' | 'evening' | 'day';

/** Sun elevation in degrees below which the sky reads as night, and above which as full day. */
export const SKY_ELEVATION = { night: -6, day: 8 } as const;

export function skyPhase(elevation: number | null, rising: boolean): SkyPhase {
  if (elevation == null) return 'day';
  if (elevation < SKY_ELEVATION.night) return 'night';
  if (elevation < 0) return rising ? 'dawn' : 'dusk';
  if (elevation < SKY_ELEVATION.day) return rising ? 'morning' : 'evening';
  return 'day';
}

/** The arc drawn from sunrise (left) to sunset (right) in the sky's 358 x 152 drawing. */
export const SKY_ARC = { from: [20, 104], control: [179, -60], to: [338, 104], width: 358 } as const;

/** Point `t` (0 to 1) along the arc: `x` as a share of the width, `y` in drawing units. */
export function arcPoint(t: number): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, t));
  const v = 1 - u;
  const x = v * v * SKY_ARC.from[0] + 2 * v * u * SKY_ARC.control[0] + u * u * SKY_ARC.to[0];
  const y = v * v * SKY_ARC.from[1] + 2 * v * u * SKY_ARC.control[1] + u * u * SKY_ARC.to[1];
  return { x: x / SKY_ARC.width, y };
}

export interface CelestialPosition {
  body: 'sun' | 'moon';
  /** 0 at the left end of the arc, 1 at the right. */
  t: number;
}

/** The sun from sunrise to sunset, the moon from sunset to sunrise. `sun.sun` only names the next
 * rising and setting; the last one is taken as a day before. */
export function celestialPosition(sunUp: boolean, nextRisingMs: number | null, nextSettingMs: number | null, nowMs: number): CelestialPosition | null {
  if (nextRisingMs == null || nextSettingMs == null) return null;
  const [startMs, endMs] = sunUp ? [nextRisingMs - DAY_MS, nextSettingMs] : [nextSettingMs - DAY_MS, nextRisingMs];
  if (endMs <= startMs) return null;
  return { body: sunUp ? 'sun' : 'moon', t: Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs))) };
}

/** Clouds drawn for a cover in percent. */
export function cloudCount(coveragePct: number | null): number {
  if (coveragePct == null || coveragePct < 20) return 0;
  if (coveragePct < 50) return 1;
  return coveragePct < 80 ? 2 : 3;
}

/** Whole m/s from km/h. */
export function windMs(kmh: number | null): number | null {
  return kmh == null ? null : Math.round(kmh / 3.6);
}

/** Rotation of an up-pointing arrow so it points where the wind blows to, from the bearing it blows
 * from. */
export function windArrowDeg(fromDeg: number): number {
  return (((fromDeg + 180) % 360) + 360) % 360;
}
