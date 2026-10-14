/** Quiet hours as SonosNotifier keeps them: no announcement from the start clock until the end clock on
 * the house clock, across midnight. Pure. */
import { homeWallTime, nextHomeClockMs } from '../energy/homeTime';
import { parseClock } from './upcoming';

export interface QuietHours {
  /** Minutes after midnight on the house clock. */
  startMin: number;
  endMin: number;
}

/** SonosNotifier's window for a helper it cannot read. */
const FALLBACK: QuietHours = { startMin: 22 * 60, endMin: 7 * 60 };

function clockMin(state: string | undefined): number | null {
  const time = parseClock(state);
  return time ? time.hour * 60 + time.minute : null;
}

/** The window the two helper states give; one that does not read as a clock falls back on its own. */
export function readQuietHours(startState: string | undefined, endState: string | undefined): QuietHours {
  return { startMin: clockMin(startState) ?? FALLBACK.startMin, endMin: clockMin(endState) ?? FALLBACK.endMin };
}

/** SonosNotifier's own test: at or after the start, or before the end, on the house clock. */
export function isQuietAt(quiet: QuietHours, ms: number): boolean {
  const { hour, minute } = homeWallTime(ms);
  const min = hour * 60 + minute;
  return min >= quiet.startMin || min < quiet.endMin;
}

/** The first start strictly after `nowMs`. */
export function nextQuietStartMs(quiet: QuietHours, nowMs: number): number {
  return nextHomeClockMs(nowMs, Math.floor(quiet.startMin / 60), quiet.startMin % 60);
}

/** "HH:MM" the window ends at. */
export function quietEndClock(quiet: QuietHours): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(quiet.endMin / 60))}:${pad(quiet.endMin % 60)}`;
}
