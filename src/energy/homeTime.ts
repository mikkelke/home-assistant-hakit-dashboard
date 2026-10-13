/** Wall-clock arithmetic in the house's time zone, independent of the viewing device's zone. Pure:
 * every function takes epoch ms. */
import { HOME_TIME_ZONE } from '../config/plan';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: HOME_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export interface HomeWallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function homeWallTime(ms: number): HomeWallTime {
  const out: HomeWallTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  for (const part of partsFormatter.formatToParts(ms)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute') {
      out[part.type] = Number(part.value);
    }
  }
  return out;
}

/** "YYYY-MM-DD" of the home-time calendar day containing `ms`. */
export function homeDayKey(ms: number): string {
  const { year, month, day } = homeWallTime(ms);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function offsetMs(ms: number): number {
  const t = homeWallTime(ms);
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  return asUtc - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** Epoch ms of a home-time wall clock reading. Day overflow (day 32, hour 24) rolls over like
 * `Date.UTC`. A reading repeated by the autumn fall-back resolves to its first occurrence; a reading
 * skipped by the spring-forward gap is moved forward by the gap's length. */
export function homeWallTimeToMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const before = asUtc - offsetMs(asUtc - DAY_MS);
  const after = asUtc - offsetMs(asUtc + DAY_MS);
  const valid = [before, after].filter(ms => ms + offsetMs(ms) === asUtc);
  return valid.length > 0 ? Math.min(...valid) : before;
}

/** Start of the home-time calendar day containing `ms`. */
export function homeDayStartMs(ms: number): number {
  const { year, month, day } = homeWallTime(ms);
  return homeWallTimeToMs(year, month, day);
}

/** Start of the home-time calendar day after the one starting at (or containing) `ms`. */
export function nextHomeDayStartMs(ms: number): number {
  const { year, month, day } = homeWallTime(homeDayStartMs(ms) + DAY_MS + 2 * 3_600_000);
  return homeWallTimeToMs(year, month, day);
}

/** First instant strictly after `afterMs` whose home-time clock reads `hour:minute`. */
export function nextHomeClockMs(afterMs: number, hour: number, minute = 0): number {
  const { year, month, day } = homeWallTime(afterMs);
  for (let add = 0; add < 3; add++) {
    const ms = homeWallTimeToMs(year, month, day + add, hour, minute);
    if (ms > afterMs) return ms;
  }
  return homeWallTimeToMs(year, month, day + 3, hour, minute);
}
