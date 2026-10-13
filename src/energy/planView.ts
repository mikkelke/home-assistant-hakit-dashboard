/** Display helpers for the Energy page's Plan tab. Pure; all times are epoch ms, read in home time. */
import { homeDayStartMs, homeWallTime, nextHomeDayStartMs } from './homeTime';
import type { PricePointMs } from './priceTimeline';

const HOUR_MS = 3_600_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Home-time hours of the grid operator's peak tariff, from the price entity's `tariffs` attribute
 * (`{ tariffs: { "0": kr, ..., "23": kr } }`): every hour charged the day's highest tariff. Null
 * when the attribute is missing or malformed, or when the tariff is flat. */
export function peakHoursFromTariffs(tariffs: unknown): number[] | null {
  const table = typeof tariffs === 'object' && tariffs !== null ? (tariffs as { tariffs?: unknown }).tariffs : undefined;
  if (typeof table !== 'object' || table === null) return null;
  const byHour = new Map<number, number>();
  for (const [key, value] of Object.entries(table)) {
    const hour = Number(key);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || typeof value !== 'number' || !Number.isFinite(value)) return null;
    byHour.set(hour, value);
  }
  if (byHour.size !== 24) return null;
  const values = Array.from(byHour.values());
  const max = Math.max(...values);
  if (max === Math.min(...values)) return null;
  return Array.from(byHour.keys())
    .filter(hour => byHour.get(hour) === max)
    .sort((a, b) => a - b);
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/** The peak-tariff stretches of [fromMs, toMs), hour by hour in home time. */
export function peakWindows(fromMs: number, toMs: number, peakHours: readonly number[] | null): TimeWindow[] {
  if (!peakHours || peakHours.length === 0) return [];
  const windows: TimeWindow[] = [];
  for (let ms = Math.floor(fromMs / HOUR_MS) * HOUR_MS; ms < toMs; ms += HOUR_MS) {
    if (!peakHours.includes(homeWallTime(ms).hour)) continue;
    const last = windows[windows.length - 1];
    if (last && last.endMs === ms) last.endMs = ms + HOUR_MS;
    else windows.push({ startMs: ms, endMs: ms + HOUR_MS });
  }
  return windows;
}

export interface DayOutlookPoint {
  dayStartMs: number;
  minPrice: number;
  maxPrice: number;
  meanPrice: number;
  /** At least one hour comes from the forecast rather than published prices. */
  estimated: boolean;
}

/** Fewest priced hours for a day to be summarised; a thinner day is the ragged end of the forecast. */
const OUTLOOK_MIN_HOURS = 20;

/** One min/mean/max summary per home-time day, starting with the day that contains `fromMs`, until
 * the first day without enough priced hours or `maxDays` days. */
export function dailyOutlook(timeline: readonly PricePointMs[], fromMs: number, maxDays: number): DayOutlookPoint[] {
  const byDay = new Map<number, PricePointMs[]>();
  for (const point of timeline) {
    const day = homeDayStartMs(point.ms);
    const list = byDay.get(day);
    if (list) list.push(point);
    else byDay.set(day, [point]);
  }
  const out: DayOutlookPoint[] = [];
  for (let day = homeDayStartMs(fromMs); out.length < maxDays; day = nextHomeDayStartMs(day)) {
    const points = byDay.get(day);
    if (!points || points.length < OUTLOOK_MIN_HOURS) break;
    const prices = points.map(p => p.price);
    out.push({
      dayStartMs: day,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      meanPrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      estimated: points.some(p => p.estimated),
    });
  }
  return out;
}

export function weekdayShort(ms: number): string {
  const { year, month, day } = homeWallTime(ms);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** When `startMs` falls, relative to `nowMs`: "today", "tonight" (18:00 to 06:00 next morning),
 * "tomorrow", or a weekday. */
export function relativeDayWord(startMs: number, nowMs: number): string {
  const today = homeDayStartMs(nowMs);
  const tomorrow = nextHomeDayStartMs(today);
  const hour = homeWallTime(startMs).hour;
  if (startMs >= today && startMs < tomorrow) return hour >= 18 ? 'tonight' : 'today';
  if (startMs >= tomorrow && startMs < nextHomeDayStartMs(tomorrow)) return hour < 6 ? 'tonight' : 'tomorrow';
  return weekdayShort(startMs);
}

function decimal(value: number, decimals: number): string {
  return value.toLocaleString('da-DK', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Delay-knob position in the machine's own terms: "30 min", "1,5 h", "13 h". */
export function knobLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${decimal(minutes / 60, minutes % 60 === 0 ? 0 : 1)} h`;
}

/** "2 h 10 min", "2 h", "45 min". */
export function durationLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A bare Danish number, e.g. `krValue(1.236)` -> "1,24". */
export function krValue(value: number, decimals = 2): string {
  return decimal(value, decimals);
}

/** The programme's name for the household: the publisher's pooled "typical" profile reads as "Usual". */
export function programmeLabel(programme: { key: string; label: string }): string {
  return programme.key === 'typical' ? 'Usual' : programme.label;
}

export interface PressChips {
  /** When the cycle starts, unless that is right away. */
  start: string | null;
  knob: string | null;
  /** When to press, only when it matters within the hour. */
  press: string | null;
}

/** The short instructions for a plan: start time, knob position and press window. */
export function pressChips(
  plan: {
    kind: 'now' | 'knob' | 'wait';
    knobMin: number;
    pressFromMs: number;
    pressUntilMs: number;
    showPressBy: boolean;
    startMs: number;
  },
  clock: (ms: number) => string
): PressChips {
  const from = clock(plan.pressFromMs);
  const until = clock(plan.pressUntilMs);
  let press: string | null = null;
  if (plan.kind === 'wait') press = plan.showPressBy && until !== from ? `press ${from}–${until}` : `press from ${from}`;
  else if (plan.showPressBy) press = `press by ${until}`;
  return {
    start: plan.kind === 'now' ? null : `start ${clock(plan.startMs)}`,
    knob: plan.knobMin > 0 ? `set knob ${knobLabel(plan.knobMin)}` : null,
    press,
  };
}
