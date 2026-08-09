import { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWeather, useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import type { HassEntities, HassEntity } from '../../types';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { Timeline } from '../Timeline';
import { getWeatherConditionIcon } from './weatherIcons';
import './QuickWeatherCard.css';

interface QuickWeatherCardProps {
  entityId: string;
  entities: HassEntities;
}

type EntityLike = {
  state?: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
};

/** Home Assistant weather forecast entry (hourly or daily). Fields beyond what Hakit's own
 * ForecastAttribute type declares (precipitation, wind_gust_speed, wind_bearing, is_daytime)
 * still arrive on the underlying object whenever the integration provides them - read
 * defensively via toForecastEntry rather than widening Hakit's type. */
type WeatherForecastEntry = {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation_probability?: number;
  precipitation?: number;
  wind_speed?: number;
  wind_gust_speed?: number;
  wind_bearing?: number;
  is_daytime?: boolean;
  bucketHours?: number;
};

interface ConnectionWithAuth {
  options?: { auth?: { accessToken?: string }; accessToken?: string };
  auth?: { accessToken?: string };
}

/**
 * Data sources for QuickWeatherCard:
 * - Weather entity (entityId): condition + forecast via Hakit useWeather (same WebSocket subscription as the old WeatherCard).
 * - GW2000A sensors below: current live readings only (not forecast).
 *
 * The two headline numbers (temperature, wind) come off the GW2000A - they are MEASURED, on this
 * roof. The weather entity is MODELLED for a grid square and is only the fallback. Before
 * 2026-08-09 it was the other way round, and the card read 20.3° / 13.3 km/h off met.no while the
 * roof said 21.4° / 6.5 km/h. Everything with a future in it (ribbon, peaks, week rows, rain and
 * gust notes) is still forecast, because the station cannot know what happens next.
 */
const SENSOR_IDS = {
  outdoorTemp: 'sensor.gw2000a_outdoor_temperature',
  seaTemperature: 'sensor.kobenhavns_havn_ii_water_temperature',
  dewpoint: 'sensor.gw2000a_dewpoint',
  windSpeed: 'sensor.gw2000a_wind_speed',
  windGust: 'sensor.gw2000a_wind_gust',
  windDirection: 'sensor.gw2000a_wind_direction',
  rainDaily: 'sensor.gw2000a_daily_rain_piezo',
  uv: 'sensor.gw2000a_uv_index',
  pressureRelative: 'sensor.gw2000a_relative_pressure',
  pressureAbsolute: 'sensor.gw2000a_absolute_pressure',
} as const;
/** HA automation's own opening/rain call - when it says so, the rain alert always shows. */
const WINDOW_RAIN_ALERT_ENTITY = 'binary_sensor.weather_opening_alert_window_rain';
/** Rain against an open TERRACE DOOR - a roof door in rain is water damage, not a draught
 * (user 2026-08-07: "they cannot be open in rain"). Separate HA automation, shown red. */
const ROOFTOP_RAIN_ALERT_ENTITY = 'binary_sensor.weather_opening_alert_rooftop_rain';
const TERRACE_DOOR_LIVING = 'binary_sensor.rooftop_door_1_contact';
const TERRACE_DOOR_CLAUDIA = 'binary_sensor.rooftop_door_2_contact';
/** Friendly titles for the shared entity-history modal (wind row + facts tiles). */
const HISTORY_LABELS: Record<string, string> = {
  [SENSOR_IDS.windSpeed]: 'Wind',
  [SENSOR_IDS.rainDaily]: 'Rain today',
  [SENSOR_IDS.uv]: 'UV',
  [SENSOR_IDS.seaTemperature]: 'Sea temperature',
};

/** The roof stops being the headline once it has said nothing for this long - a dead station
 * reading 21.4° forever is worse than a forecast that is merely modelled. */
const STATION_QUIET_MIN = 30;
/** Hero chip threshold: under a whole degree the roof and the model do not really disagree. */
const TEMP_CHIP_MIN_DIFF_C = 1.0;
/** Wind sub-line threshold, in km/h regardless of the row's display unit. */
const WIND_NOTE_MIN_DIFF_KMH = 3;
/** A gust is only worth naming when it beats the sustained wind by more than this (m/s). */
const GUST_CLAUSE_MIN_MARGIN_MS = 1.0;
/** Roof-vs-forecast sheet window. */
const COMPARE_WINDOW_HOURS = 24;

const getEntity = (entities: HassEntities, entityId: string) => entities?.[entityId] as EntityLike | undefined;
const getState = (entities: HassEntities, entityId: string) => getEntity(entities, entityId)?.state;

const getNumber = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const getSeaTemperatureFeel = (temperature?: number) => {
  if (temperature === undefined) return undefined;
  if (temperature < 8) return 'Very cold';
  if (temperature < 13) return 'Cold';
  if (temperature < 18) return 'Fresh';
  if (temperature < 22) return 'Pleasant';
  if (temperature < 26) return 'Warm';
  return 'Very warm';
};

const toMetersPerSecond = (value: unknown, unit?: string) => {
  const numeric = getNumber(value);
  if (numeric === undefined) return undefined;
  const normalizedUnit = unit?.toLowerCase() ?? '';
  if (normalizedUnit.includes('km')) return numeric / 3.6;
  if (normalizedUnit.includes('mph')) return numeric * 0.44704;
  if (normalizedUnit.includes('kn')) return numeric * 0.514444;
  return numeric;
};

/** Header/hero condition word - lowercase throughout ("partly cloudy", not "Partly Cloudy"). */
function lowerCondition(condition?: string): string {
  if (!condition) return '—';
  return condition
    .replace(/partlycloudy/i, 'partly cloudy')
    .split('-')
    .join(' ')
    .toLowerCase();
}

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass name for a bearing in degrees. */
function compass16(deg: number): string {
  const n = ((deg % 360) + 360) % 360;
  return COMPASS_16[Math.round(n / 22.5) % 16];
}

/** Terrace axis: the sector the wind row and storm alert both care about. */
function isTerraceAxis(bearingDeg: number): boolean {
  const b = ((bearingDeg % 360) + 360) % 360;
  return b >= 300 && b <= 350;
}

/** Gust plausibility filter (critical): the station emits ~1 bogus spike/day (worst seen: 143
 * km/h during a 9 km/h hour). Reject readings failing basic physical plausibility - applied
 * before display AND before the pill classification. Ratio/absolute thresholds expressed in
 * m/s (our canonical unit here) so no separate km/h bookkeeping is needed. */
function isPlausibleGustMs(gustMs: number, windMs: number): boolean {
  if (gustMs > 110 / 3.6) return false;
  if (windMs > 1 / 3.6 && gustMs > windMs * 4) return false;
  return true;
}

function classifyGustWord(gustMs: number): string {
  if (gustMs < 5) return 'Calm';
  if (gustMs < 10) return 'Light';
  if (gustMs < 14) return 'Fresh';
  if (gustMs < 18) return 'Strong';
  if (gustMs < 25) return 'Storm';
  return 'Violent';
}

function uvWord(uv: number): string {
  if (uv <= 2) return 'low';
  if (uv <= 5) return 'moderate';
  if (uv <= 7) return 'high';
  if (uv <= 10) return 'very high';
  return 'extreme';
}

function formatWindValue(value: number, unit: 'km/h' | 'm/s'): string {
  return unit === 'm/s' ? value.toFixed(1) : Math.round(value).toString();
}

/** `base`'s calendar day at a fixed local hour (copied from TonightCard's tick/window math). */
function atHour(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Clamp any timestamp to a 0-100% position within [startMs, endMs] (same idea as TonightCard). */
function pctOf(ms: number, startMs: number, endMs: number): number {
  if (!Number.isFinite(ms) || endMs <= startMs) return 0;
  const pct = ((ms - startMs) / (endMs - startMs)) * 100;
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}

interface Span {
  left: number;
  width: number;
}

function spanPct(startMs: number, endMs: number, barStartMs: number, barEndMs: number): Span {
  const left = pctOf(startMs, barStartMs, barEndMs);
  const width = Math.max(0, pctOf(endMs, barStartMs, barEndMs) - left);
  return { left, width };
}

/** Darken a #rrggbb color by `amount` (0-1) - used for night-hour ribbon cells. */
function darkenHex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Base ribbon color for a condition string - six buckets per spec, unrecognized conditions
 * fall back to the partly-cloudy tone rather than guessing. */
function conditionBaseColor(condition?: string): string {
  const c = (condition ?? '').toLowerCase();
  if (c === 'fog') return '#5b6f7d';
  if (c.includes('snow')) return '#8aa6bd';
  if (c.includes('rain') || c === 'pouring' || c.includes('lightning')) return '#46687e';
  if (c.includes('clear') || c === 'sunny') return '#f0b429';
  if (c === 'cloudy') return '#4a6d86';
  return '#7a97ad';
}

/** Night = HA's own is_daytime when the forecast provides it (real sunrise/sunset derived),
 * else the hour<6/hour>21 fallback. */
function isNightHour(entry: WeatherForecastEntry): boolean {
  if (entry.is_daytime != null) return !entry.is_daytime;
  const hour = new Date(entry.datetime).getHours();
  return hour < 6 || hour > 21;
}

function hourColor(entry: WeatherForecastEntry): string {
  const base = conditionBaseColor(entry.condition);
  return isNightHour(entry) ? darkenHex(base, 0.55) : base;
}

/** Per-hour gust in m/s - forecasts rarely publish a real gust field, so this is almost always
 * the ×1.4 sustained-wind estimate the spec calls for. */
function hourGustMs(entry: WeatherForecastEntry, unit: string): number | undefined {
  const gust = entry.wind_gust_speed ?? (entry.wind_speed != null ? entry.wind_speed * 1.4 : undefined);
  return toMetersPerSecond(gust, unit);
}

/** Turn hour-center color stops into one CSS gradient - single stop per hour lets the browser
 * cross-fade between adjacent hours (same idea as TonightCard's barGradient, simpler here
 * because this fill has no track-color gaps to preserve). */
function ribbonGradient(stops: { pct: number; color: string }[]): string {
  const sorted = [...stops].sort((a, b) => a.pct - b.pct);
  const parts: string[] = [];
  if (sorted[0].pct > 0) parts.push(`${sorted[0].color} 0%`);
  for (const s of sorted) parts.push(`${s.color} ${s.pct.toFixed(2)}%`);
  if (sorted[sorted.length - 1].pct < 100) parts.push(`${sorted[sorted.length - 1].color} 100%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

interface TickCandidate {
  pct: number;
  label: string;
  priority: number;
  /** Forecast temperature at that tick, shown under the time (user 2026-08-01). */
  temp?: string;
}

/** Greedy tick de-dup: highest-priority ticks (now, then the window edges) win; anything within
 * minGapPct of an already-accepted tick is dropped. */
function pickTicks(candidates: TickCandidate[], minGapPct: number): TickCandidate[] {
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  const accepted: TickCandidate[] = [];
  for (const c of ordered) {
    if (accepted.every(a => Math.abs(a.pct - c.pct) >= minGapPct)) accepted.push(c);
  }
  return accepted.sort((a, b) => a.pct - b.pct);
}

/** Storm-warning-class thresholds (rarely fires by design): terrace-axis gusts >=21 m/s, or any-
 * direction gusts >=24 m/s, scanning the next 24h of hourly forecast. Names the first hit. */
function findStormHour(hours: WeatherForecastEntry[], nowMs: number, windUnit: string): WeatherForecastEntry | null {
  const horizon = nowMs + 24 * 3600_000;
  const inWindow = hours
    .filter(h => {
      const t = Date.parse(h.datetime);
      return Number.isFinite(t) && t >= nowMs && t <= horizon;
    })
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
  for (const h of inWindow) {
    const gustMs = hourGustMs(h, windUnit);
    if (gustMs == null) continue;
    const bearing = getNumber(h.wind_bearing);
    const onTerraceAxis = bearing != null && isTerraceAxis(bearing);
    if (gustMs >= 24 || (gustMs >= 21 && onTerraceAxis)) return h;
  }
  return null;
}

/** First hour with any precipitation within `withinMs` of now - used for the rain alert's time
 * and (with a wider horizon) the binary-sensor-forced case. */
function findFirstRainHour(hours: WeatherForecastEntry[], nowMs: number, withinMs: number): WeatherForecastEntry | null {
  const horizon = nowMs + withinMs;
  const candidates = hours
    .filter(h => {
      const t = Date.parse(h.datetime);
      return Number.isFinite(t) && t >= nowMs && t <= horizon && (h.precipitation ?? 0) > 0;
    })
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
  return candidates[0] ?? null;
}

/** Highest forecast gust within `horizonMs` of now, with the hour it happens. */
function findPeakGustWithin(
  hours: WeatherForecastEntry[],
  nowMs: number,
  horizonMs: number,
  windUnit: string
): { ms: number; atIso: string } | null {
  let best: { ms: number; atIso: string } | null = null;
  for (const h of hours) {
    const t = Date.parse(h.datetime);
    if (!Number.isFinite(t) || t < nowMs || t > nowMs + horizonMs) continue;
    const g = hourGustMs(h, windUnit);
    if (g == null) continue;
    if (!best || g > best.ms) best = { ms: g, atIso: h.datetime };
  }
  return best;
}

/** Highest forecast gust anywhere within the given calendar day (used by the week rows). */
function dailyPeakGustMs(hours: WeatherForecastEntry[], dayKey: string, windUnit: string): number | undefined {
  let peak: number | undefined;
  for (const h of hours) {
    if (getLocalDayKey(h.datetime) !== dayKey) continue;
    const g = hourGustMs(h, windUnit);
    if (g != null && (peak == null || g > peak)) peak = g;
  }
  return peak;
}

/** Today's remaining peak temperature (with its hour) - read straight off the hourly forecast,
 * no separate max sensor exists. */
function findTodayPeak(hours: WeatherForecastEntry[], todayKey: string): { temp: number; atIso: string } | null {
  let best: { temp: number; atIso: string } | null = null;
  for (const h of hours) {
    if (getLocalDayKey(h.datetime) !== todayKey) continue;
    if (h.temperature == null) continue;
    if (!best || h.temperature > best.temp) best = { temp: h.temperature, atIso: h.datetime };
  }
  return best;
}

/** Overnight low through the next occurrence of 06:00 ("tonight"). */
function findTonightLow(hours: WeatherForecastEntry[], nowMs: number, tonightEndMs: number): number | null {
  let min: number | null = null;
  for (const h of hours) {
    const t = Date.parse(h.datetime);
    if (!Number.isFinite(t) || t < nowMs || t > tonightEndMs) continue;
    if (h.temperature == null) continue;
    if (min == null || h.temperature < min) min = h.temperature;
  }
  return min;
}

/** Count of window contacts currently open, matched by the standard
 * binary_sensor.<area>_window_contact naming convention (no house-wide list to keep in sync). */
function countOpenWindows(entities: HassEntities): number {
  let n = 0;
  for (const [id, entity] of Object.entries(entities ?? {})) {
    if (/^binary_sensor\..+_window_contact$/.test(id) && entity?.state === 'on') n++;
  }
  return n;
}

/** Parse forecast array from weather entity attributes. */
function getForecastList(attributes: Record<string, unknown>): WeatherForecastEntry[] {
  const raw = attributes?.forecast;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is WeatherForecastEntry =>
      item != null && typeof item === 'object' && typeof (item as WeatherForecastEntry).datetime === 'string'
  ) as WeatherForecastEntry[];
}

function getLocalDayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Split forecast into hourly (rest of today) and daily (next days). */
function splitForecast(forecast: WeatherForecastEntry[]) {
  const now = new Date();
  const todayKey = getLocalDayKey(now);
  const hourly: WeatherForecastEntry[] = [];
  const dailyByDay = new Map<string, WeatherForecastEntry[]>();

  for (const entry of forecast) {
    const dt = new Date(entry.datetime);
    if (Number.isNaN(dt.getTime())) continue;
    const entryDay = getLocalDayKey(dt);
    const isToday = entryDay === todayKey;
    if (isToday && dt >= now) {
      hourly.push(entry);
    }
    if (!dailyByDay.has(entryDay)) dailyByDay.set(entryDay, []);
    dailyByDay.get(entryDay)!.push(entry);
  }

  // Sort hourly by datetime; take up to 24 slots for "rest of day"
  hourly.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  const hourlyRestOfDay = hourly.slice(0, 24);

  // Build daily list: one entry per day (include today so user can click for hourly)
  const sortedDays = Array.from(dailyByDay.keys()).sort();
  const daily: WeatherForecastEntry[] = [];
  for (const day of sortedDays) {
    const entries = dailyByDay.get(day)!;
    const best = entries.length === 1 ? entries[0] : entries[Math.min(12, Math.floor(entries.length / 2))];
    daily.push(best);
  }

  return { hourly: hourlyRestOfDay, daily: daily.slice(0, 6) };
}

function formatHour(datetime: string) {
  const d = new Date(datetime);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDay(datetime: string) {
  const d = new Date(datetime);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const isTomorrow = new Date(today);
  isTomorrow.setDate(isTomorrow.getDate() + 1);
  if (d.toDateString() === isTomorrow.toDateString()) return 'Tomorrow';
  if (isToday) return 'Today';
  return d.toLocaleDateString([], { weekday: 'short' });
}

/** Week-row label - always the bare weekday abbreviation (unlike formatDay's "Today"/"Tomorrow",
 * which is still used for the hourly day-popup title). */
function shortWeekday(datetime: string) {
  const d = new Date(datetime);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { weekday: 'short' });
}

/** Normalize a Hakit or raw-attribute forecast entry to our shape. Fields undeclared by Hakit's
 * ForecastAttribute type (precipitation, wind_gust_speed, wind_bearing, is_daytime) still arrive
 * on the underlying object when the integration provides them - read them defensively rather
 * than widening Hakit's own type. */
function toForecastEntry(e: Record<string, unknown>): WeatherForecastEntry {
  return {
    datetime: String(e.datetime ?? ''),
    condition: typeof e.condition === 'string' ? e.condition : undefined,
    temperature: getNumber(e.temperature),
    templow: getNumber(e.templow),
    precipitation_probability: getNumber(e.precipitation_probability),
    precipitation: getNumber(e.precipitation),
    wind_speed: getNumber(e.wind_speed),
    wind_gust_speed: getNumber(e.wind_gust_speed),
    wind_bearing: getNumber(e.wind_bearing),
    is_daytime: typeof e.is_daytime === 'boolean' ? e.is_daytime : undefined,
  };
}

function formatBucketLabel(entry: WeatherForecastEntry) {
  if (entry.bucketHours && entry.bucketHours > 1) {
    return `${formatHour(entry.datetime)} · ${entry.bucketHours}h`;
  }
  return formatHour(entry.datetime);
}

/* ---------------------------------------------------------------------------------------------
 * Roof vs forecast: measured station history overlaid on the weather entity's own attribute
 * history. Timeline can't carry this - it renders a list of discrete state events, not a numeric
 * chart, and its `secondaryEntityId` only merges a second event stream into the same list. Hence
 * the small SVG below rather than a Timeline extension.
 * ------------------------------------------------------------------------------------------- */

type CompareMetric = 'temperature' | 'wind';
type CompareStatus = 'loading' | 'ready' | 'error';

interface SeriesPoint {
  t: number;
  v: number;
}

interface CompareSeries {
  measured: SeriesPoint[];
  modelled: SeriesPoint[];
  startMs: number;
  endMs: number;
  metric: CompareMetric;
}

/** One row of HA's /api/history/period response (full form - see fetchCompareSeries). */
interface HistoryRow {
  state?: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

/** Sensor history -> numeric series. `last_updated` first: an attribute-only tick moves that and
 * not `last_changed`, which is exactly what the weather entity does between condition changes. */
function toStatePoints(rows: HistoryRow[]): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const row of rows) {
    const t = Date.parse(row.last_updated ?? row.last_changed ?? '');
    const v = getNumber(row.state);
    if (!Number.isFinite(t) || v === undefined) continue;
    points.push({ t, v });
  }
  return points.sort((a, b) => a.t - b.t);
}

/** Weather-entity history -> numeric series read off ATTRIBUTES: °C for temperature, km/h for
 * wind (each row carries its own wind_speed_unit, so a unit change mid-window still converts). */
function toAttributePoints(rows: HistoryRow[], metric: CompareMetric): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const row of rows) {
    const t = Date.parse(row.last_updated ?? row.last_changed ?? '');
    if (!Number.isFinite(t) || !row.attributes) continue;
    if (metric === 'temperature') {
      const v = getNumber(row.attributes.temperature);
      if (v === undefined) continue;
      points.push({ t, v });
    } else {
      const unit = typeof row.attributes.wind_speed_unit === 'string' ? row.attributes.wind_speed_unit : undefined;
      const ms = toMetersPerSecond(row.attributes.wind_speed, unit);
      if (ms === undefined) continue;
      points.push({ t, v: ms * 3.6 });
    }
  }
  return points.sort((a, b) => a.t - b.t);
}

/** Linearly interpolated value at `t`, or undefined outside the series' own range - the two
 * series are paced very differently (roof every ~4 min, weather entity roughly hourly). */
function sampleSeries(points: SeriesPoint[], t: number): number | undefined {
  if (points.length === 0) return undefined;
  if (t < points[0].t || t > points[points.length - 1].t) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (b.t === a.t) return a.v;
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

interface CompareStats {
  meanDiff: number;
  maxDiff: number;
  maxDiffMs: number;
}

/** Signed roof-minus-forecast statistics, sampled on a fixed 10-minute grid so the denser series
 * doesn't outvote the sparser one. */
function computeCompareStats(series: CompareSeries): CompareStats | null {
  const STEP_MS = 10 * 60_000;
  // Grid snapped to whole ten-minute clock times so "biggest gap at 14:00" reads as a time
  // somebody could look up, not 14:02.
  const gridStart = Math.ceil(series.startMs / STEP_MS) * STEP_MS;
  let sum = 0;
  let count = 0;
  let maxDiff = 0;
  let maxDiffMs = gridStart;
  for (let t = gridStart; t <= series.endMs; t += STEP_MS) {
    const measured = sampleSeries(series.measured, t);
    const modelled = sampleSeries(series.modelled, t);
    if (measured === undefined || modelled === undefined) continue;
    const diff = measured - modelled;
    sum += diff;
    if (count === 0 || Math.abs(diff) > Math.abs(maxDiff)) {
      maxDiff = diff;
      maxDiffMs = t;
    }
    count += 1;
  }
  return count === 0 ? null : { meanDiff: sum / count, maxDiff, maxDiffMs };
}

function compareUnitLabel(metric: CompareMetric): string {
  return metric === 'temperature' ? '°C' : 'km/h';
}

/** One sentence under the chart: the average signed gap, then the worst moment. */
function compareSummary(stats: CompareStats, metric: CompareMetric): string {
  const suffix = metric === 'temperature' ? '°' : ' km/h';
  const above = metric === 'temperature' ? 'warmer' : 'windier';
  const below = metric === 'temperature' ? 'cooler' : 'calmer';
  const lead =
    Math.abs(stats.meanDiff) < 0.05
      ? `The roof matched the forecast over ${COMPARE_WINDOW_HOURS} h`
      : `The roof ran ${Math.abs(stats.meanDiff).toFixed(1)}${suffix} ${stats.meanDiff > 0 ? above : below} than forecast over ${COMPARE_WINDOW_HOURS} h`;
  const sign = stats.maxDiff >= 0 ? '+' : '-';
  return `${lead} · biggest gap ${sign}${Math.abs(stats.maxDiff).toFixed(1)}${suffix} at ${formatHHMM(new Date(stats.maxDiffMs))}`;
}

const COMPARE_VIEW_WIDTH = 340;
const COMPARE_VIEW_HEIGHT = 170;
const COMPARE_PAD = { top: 12, right: 8, bottom: 22, left: 30 };

/** First whole 6-hour clock time at or after `startMs` (06:00, 12:00, … - never 12:17). */
function firstSixHourTick(startMs: number): number {
  const d = new Date(startMs);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + ((6 - (d.getHours() % 6)) % 6));
  return d.getTime() < startMs ? d.getTime() + 6 * 3600_000 : d.getTime();
}

/** Two numeric series on one pair of axes: measured solid amber, modelled dashed and muted. */
function CompareChart({ series }: { series: CompareSeries }) {
  const { measured, modelled, startMs, endMs, metric } = series;
  if (measured.length === 0 && modelled.length === 0) return null;

  const plotLeft = COMPARE_PAD.left;
  const plotRight = COMPARE_VIEW_WIDTH - COMPARE_PAD.right;
  const plotTop = COMPARE_PAD.top;
  const plotBottom = COMPARE_VIEW_HEIGHT - COMPARE_PAD.bottom;

  // Folded rather than spread into Math.min - the roof's wind sensor alone puts ~900 points in a
  // 24 h window, and an argument list is the wrong shape for that.
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (const point of measured) {
    if (point.v < rawMin) rawMin = point.v;
    if (point.v > rawMax) rawMax = point.v;
  }
  for (const point of modelled) {
    if (point.v < rawMin) rawMin = point.v;
    if (point.v > rawMax) rawMax = point.v;
  }
  const headroom = Math.max(0.5, (rawMax - rawMin) * 0.12);
  const axisMin = metric === 'wind' ? Math.max(0, rawMin - headroom) : rawMin - headroom;
  const axisMax = rawMax + headroom;
  const axisSpan = axisMax > axisMin ? axisMax - axisMin : 1;

  const xFor = (t: number) => plotLeft + ((t - startMs) / Math.max(1, endMs - startMs)) * (plotRight - plotLeft);
  const yFor = (v: number) => plotBottom - ((v - axisMin) / axisSpan) * (plotBottom - plotTop);
  const pathFor = (points: SeriesPoint[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.t).toFixed(1)} ${yFor(p.v).toFixed(1)}`).join(' ');

  const gridValues = [axisMin, axisMin + axisSpan / 2, axisMax];
  const timeTicks: number[] = [];
  for (let t = firstSixHourTick(startMs); t <= endMs; t += 6 * 3600_000) timeTicks.push(t);

  return (
    <svg
      className='quick-weather-compare-chart'
      viewBox={`0 0 ${COMPARE_VIEW_WIDTH} ${COMPARE_VIEW_HEIGHT}`}
      role='img'
      aria-label={`Measured against forecast over the last ${COMPARE_WINDOW_HOURS} hours`}
    >
      {gridValues.map(value => (
        <g key={`grid-${value}`}>
          <line className='quick-weather-compare-grid' x1={plotLeft} y1={yFor(value)} x2={plotRight} y2={yFor(value)} />
          <text className='quick-weather-compare-axis' x={plotLeft - 5} y={yFor(value) + 3} textAnchor='end'>
            {metric === 'temperature' ? `${Math.round(value)}°` : Math.round(value)}
          </text>
        </g>
      ))}
      {timeTicks.map(t => (
        <text key={`tick-${t}`} className='quick-weather-compare-axis' x={xFor(t)} y={COMPARE_VIEW_HEIGHT - 6} textAnchor='middle'>
          {formatHHMM(new Date(t))}
        </text>
      ))}
      {modelled.length > 0 && <path className='quick-weather-compare-modelled' d={pathFor(modelled)} />}
      {measured.length > 0 && <path className='quick-weather-compare-measured' d={pathFor(measured)} />}
    </svg>
  );
}

export function QuickWeatherCard({ entityId, entities }: QuickWeatherCardProps) {
  const weatherEntity = getEntity(entities, entityId);
  const weatherDaily = useWeather(entityId as Parameters<typeof useWeather>[0], { type: 'daily' });
  const weatherHourly = useWeather(entityId as Parameters<typeof useWeather>[0], { type: 'hourly' });
  const connection = useHass((state: unknown) => (state as { connection?: ConnectionWithAuth | null }).connection ?? undefined);
  const hassUrl = useHass((state: unknown) => (state as { hassUrl?: string | null }).hassUrl ?? null);
  const [extendedForecast, setExtendedForecast] = useState<WeatherForecastEntry[]>([]);

  const getAccessToken = useCallback((): string | null => {
    try {
      if (!connection) return null;
      const conn = connection as ConnectionWithAuth;
      if (conn.options?.auth?.accessToken) return conn.options.auth.accessToken;
      if (conn.options?.accessToken) return conn.options.accessToken;
      if (conn.auth?.accessToken) return conn.auth.accessToken;
      return null;
    } catch {
      return null;
    }
  }, [connection]);

  useEffect(() => {
    let cancelled = false;

    const fetchExtendedForecast = async () => {
      const accessToken = getAccessToken();
      if (!accessToken) {
        if (!cancelled) setExtendedForecast([]);
        return;
      }

      try {
        const url = new URL('/api/config', window.location.origin);
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const config = (await response.json()) as { latitude?: number; longitude?: number; elevation?: number };
        const lat = config.latitude;
        const lon = config.longitude;
        const alt = config.elevation ?? 0;

        if (lat === undefined || lon === undefined) {
          if (!cancelled) setExtendedForecast([]);
          return;
        }

        const metUrl = new URL('https://aa015h6buqvih86i1.api.met.no/weatherapi/locationforecast/2.0/complete');
        metUrl.searchParams.set('lat', String(lat));
        metUrl.searchParams.set('lon', String(lon));
        metUrl.searchParams.set('altitude', String(Math.round(alt)));

        const metResponse = await fetch(metUrl.toString(), {
          headers: { 'User-Agent': 'home-assistant-hakit-dashboard/1.0 (weather popup)' },
        });
        if (!metResponse.ok) throw new Error(`Met.no HTTP ${metResponse.status}`);

        const metData = (await metResponse.json()) as {
          properties?: {
            timeseries?: Array<{
              time?: string;
              data?: {
                instant?: { details?: Record<string, unknown> };
                next_1_hours?: { details?: Record<string, unknown>; summary?: { symbol_code?: string } };
                next_6_hours?: { details?: Record<string, unknown>; summary?: { symbol_code?: string } };
                next_12_hours?: { details?: Record<string, unknown>; summary?: { symbol_code?: string } };
              };
            }>;
          };
        };

        const timeseries = metData.properties?.timeseries ?? [];
        const now = Date.now();
        const laterBuckets: WeatherForecastEntry[] = timeseries.flatMap(item => {
          const datetime = item.time;
          if (!datetime) return [];
          const ts = new Date(datetime).getTime();
          if (!Number.isFinite(ts) || ts < now) return [];

          const nextHours = item.data?.next_6_hours ?? item.data?.next_12_hours;
          const bucketHours = item.data?.next_6_hours ? 6 : item.data?.next_12_hours ? 12 : undefined;
          if (!nextHours || !bucketHours) return [];

          return [
            {
              datetime,
              bucketHours,
              condition: nextHours.summary?.symbol_code
                ?.replace(/_day$|_night$/i, '')
                .replace(/fair/i, 'partlycloudy')
                .replace(/clearsky/i, 'sunny')
                .replace(/heavyrain|lightrain|rainshowers|rain/i, 'rainy')
                .replace(/lightsleet|heavysleet|sleet/i, 'snowy-rainy')
                .replace(/lightsnow|heavysnow|snowshowers|snow/i, 'snowy'),
              temperature: getNumber(item.data?.instant?.details?.air_temperature),
              precipitation: getNumber(nextHours.details?.precipitation_amount),
              precipitation_probability: getNumber(nextHours.details?.probability_of_precipitation),
              wind_speed: getNumber(item.data?.instant?.details?.wind_speed),
              wind_bearing: getNumber(item.data?.instant?.details?.wind_from_direction),
            } satisfies WeatherForecastEntry,
          ];
        });

        if (!cancelled) {
          setExtendedForecast(laterBuckets);
        }
      } catch {
        if (!cancelled) setExtendedForecast([]);
      }
    };

    void fetchExtendedForecast();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  // Now-tick: same pattern as TonightCard (lazy useState initializer covers the first render;
  // only the interval callback ever calls setState, never the render body itself). Every
  // "now"-dependent value below reads this state rather than constructing a fresh Date.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now.getTime();

  const { hourlyAll, daily } = useMemo(() => {
    const fromAttr = getForecastList(weatherEntity?.attributes ?? {});
    const fromAttrSplit = splitForecast(fromAttr);
    const dailyList = weatherDaily?.forecast?.forecast ?? [];
    const hourlyList = weatherHourly?.forecast?.forecast ?? [];
    const dailyMapped = (dailyList.length > 0 ? dailyList : fromAttrSplit.daily)
      .map(e => toForecastEntry(e as unknown as Record<string, unknown>))
      .slice(0, 6);
    const futureHourly = (hourlyList.length > 0 ? hourlyList : fromAttrSplit.hourly)
      .map(e => toForecastEntry(e as unknown as Record<string, unknown>))
      .filter(e => new Date(e.datetime).getTime() >= nowMs);
    const lastHourlyTs = futureHourly.length > 0 ? new Date(futureHourly[futureHourly.length - 1].datetime).getTime() : 0;
    const extraFutureBuckets = extendedForecast.filter(entry => new Date(entry.datetime).getTime() > lastHourlyTs);
    const hourlyAllSlots = [...futureHourly, ...extraFutureBuckets].slice(0, 7 * 24); /* for day-detail popup when a day is clicked */
    return { hourlyAll: hourlyAllSlots, daily: dailyMapped };
  }, [weatherEntity?.attributes, weatherDaily?.forecast, weatherHourly?.forecast, extendedForecast, nowMs]);

  const [selectedDayDatetime, setSelectedDayDatetime] = useState<string | null>(null);
  const toggleDay = useCallback((datetime: string) => {
    setSelectedDayDatetime(prev => (prev === datetime ? null : datetime));
  }, []);
  const closeDayPopup = useCallback(() => {
    setSelectedDayDatetime(null);
  }, []);
  const { requestClose: requestCloseDayPopup } = useModalBackButton({
    isOpen: selectedDayDatetime !== null,
    onRequestClose: closeDayPopup,
    historyKey: 'quick-weather-day-popup',
  });

  const selectedDayHourly = useMemo(() => {
    if (!selectedDayDatetime) return [];
    const selectedDateKey = getLocalDayKey(selectedDayDatetime);
    return hourlyAll.filter(e => getLocalDayKey(e.datetime) === selectedDateKey);
  }, [selectedDayDatetime, hourlyAll]);

  const selectedDayHasCoarseBuckets = selectedDayHourly.some(entry => (entry.bucketHours ?? 1) > 1);

  // Shared entity-history modal (wind row + facts tiles) - one Timeline popup, whichever
  // entityId was last tapped. Same push/back-button pattern as WeatherCard's old per-row
  // modal, generalized to a single instance instead of one per row.
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null);
  const closeHistory = useCallback(() => setHistoryEntityId(null), []);
  const { requestClose: requestCloseHistory } = useModalBackButton({
    isOpen: historyEntityId !== null,
    onRequestClose: closeHistory,
    historyKey: 'quick-weather-history',
  });

  // Roof vs forecast sheet - same portaled markup as the history modal above.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('temperature');
  const [compareSeries, setCompareSeries] = useState<CompareSeries | null>(null);
  const [compareStatus, setCompareStatus] = useState<CompareStatus>('loading');
  const openCompare = useCallback(() => setCompareOpen(true), []);
  const closeCompare = useCallback(() => setCompareOpen(false), []);
  const { requestClose: requestCloseCompare } = useModalBackButton({
    isOpen: compareOpen,
    onRequestClose: closeCompare,
    historyKey: 'quick-weather-compare',
  });
  const {
    handleTouchStart: handleCompareTouchStart,
    handleTouchMove: handleCompareTouchMove,
    handleTouchEnd: handleCompareTouchEnd,
  } = useSwipeToClose(requestCloseCompare);

  useEffect(() => {
    if (!compareOpen) return;
    let cancelled = false;
    setCompareStatus('loading');

    // significant_changes_only=0 is REQUIRED: the weather entity's temperature moves without its
    // state (the condition word) moving, and those attribute-only rows are dropped otherwise -
    // measured on this box, 26 rows in 24 h became 8. minimal_response must be ABSENT, not 0: HA
    // reads that flag by presence, so `minimal_response=0` still strips the attributes we came for
    // (measured: 26 rows with a temperature became 1).
    const fetchCompareSeries = async () => {
      const endMs = Date.now();
      const startMs = endMs - COMPARE_WINDOW_HOURS * 3600_000;
      const accessToken = getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const fetchHistory = async (targetEntityId: string): Promise<HistoryRow[]> => {
        const url = new URL(`/api/history/period/${new Date(startMs).toISOString()}`, window.location.origin);
        url.searchParams.set('filter_entity_id', targetEntityId);
        url.searchParams.set('end_time', new Date(endMs).toISOString());
        url.searchParams.set('significant_changes_only', '0');
        const response = await fetch(url.toString(), { method: 'GET', headers, credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        if (!Array.isArray(data) || data.length === 0) return [];
        return (Array.isArray(data[0]) ? data[0] : data) as HistoryRow[];
      };

      try {
        const stationEntityId = compareMetric === 'wind' ? SENSOR_IDS.windSpeed : SENSOR_IDS.outdoorTemp;
        const [stationRows, forecastRows] = await Promise.all([fetchHistory(stationEntityId), fetchHistory(entityId)]);
        if (cancelled) return;
        setCompareSeries({
          measured: toStatePoints(stationRows),
          modelled: toAttributePoints(forecastRows, compareMetric),
          startMs,
          endMs,
          metric: compareMetric,
        });
        setCompareStatus('ready');
      } catch {
        if (cancelled) return;
        setCompareSeries(null);
        setCompareStatus('error');
      }
    };

    void fetchCompareSeries();
    return () => {
      cancelled = true;
    };
  }, [compareOpen, compareMetric, entityId, getAccessToken]);

  if (!weatherEntity) {
    return (
      <div className='quick-weather-card quick-weather-card--empty'>
        <div className='quick-weather-card__empty'>
          <Icon icon='mdi:weather-cloudy-alert' />
          <span>Weather entity not found</span>
        </div>
      </div>
    );
  }

  const attributes = weatherEntity.attributes ?? {};
  const condition = weatherEntity.state;
  const conditionIcon = getWeatherConditionIcon(condition);
  const conditionLabel = lowerCondition(condition);
  const forecastWindUnit = typeof attributes.wind_speed_unit === 'string' ? attributes.wind_speed_unit : 'km/h';
  const todayKey = getLocalDayKey(now);

  // Roof station health first - it decides which source the two headline numbers come from, so it
  // has to be known before either of them is picked.
  const outdoorTempEntity = getEntity(entities, SENSOR_IDS.outdoorTemp);
  const windSpeedEntity = getEntity(entities, SENSOR_IDS.windSpeed);
  const stationChangeMs = [outdoorTempEntity, windSpeedEntity]
    .map(e => Date.parse(e?.last_changed ?? e?.last_updated ?? ''))
    .filter(Number.isFinite);
  const stationAgeMin = stationChangeMs.length ? Math.round((nowMs - Math.max(...stationChangeMs)) / 60000) : null;
  const stationQuiet = stationAgeMin != null && stationAgeMin > STATION_QUIET_MIN;
  /** Roof stale: fall back to the model for the headline numbers, and say so on the card. */
  const preferForecast = stationQuiet;

  const stationTemp = getNumber(outdoorTempEntity?.state);
  const forecastTemp = getNumber(attributes.temperature);
  const currentTemp = preferForecast ? (forecastTemp ?? stationTemp) : (stationTemp ?? forecastTemp);
  const tempSource: 'roof' | 'forecast' | undefined =
    currentTemp === undefined
      ? undefined
      : preferForecast && forecastTemp !== undefined
        ? 'forecast'
        : stationTemp !== undefined
          ? 'roof'
          : 'forecast';
  // Chip only when the two genuinely disagree - a tenth of a degree is not news. Suppressed
  // while the roof is quiet: comparing a stale reading against a live forecast measures how
  // long the sensor has been silent, not how wrong the model is, and the hero already says
  // "from forecast · roof quiet N min" in that state.
  const tempDiff = stationTemp !== undefined && forecastTemp !== undefined ? stationTemp - forecastTemp : undefined;
  const tempChipText =
    !stationQuiet && tempDiff !== undefined && Math.abs(tempDiff) >= TEMP_CHIP_MIN_DIFF_C
      ? `${Math.abs(tempDiff).toFixed(1)}° ${tempDiff > 0 ? 'over' : 'under'} forecast`
      : null;

  const dewpoint = getNumber(getState(entities, SENSOR_IDS.dewpoint));

  const seaTemperatureEntity = getEntity(entities, SENSOR_IDS.seaTemperature);
  const seaTemperature = getNumber(seaTemperatureEntity?.state);
  const seaTemperatureFeel = getSeaTemperatureFeel(seaTemperature);

  // Wind - roof first, forecast only as fallback (user 2026-08-09, "for consistency" with the
  // temperature, knowingly accepting that the roof sits sheltered and reads lower than met.no).
  const windDirection = getNumber(getState(entities, SENSOR_IDS.windDirection));
  const windDirLabel = windDirection != null ? compass16(windDirection) : '—';
  const stationWindMs = toMetersPerSecond(getState(entities, SENSOR_IDS.windSpeed), 'km/h');
  const forecastWindMs = toMetersPerSecond(
    attributes.wind_speed,
    typeof attributes.wind_speed_unit === 'string' ? attributes.wind_speed_unit : undefined
  );
  const windSpeedMs = preferForecast ? (forecastWindMs ?? stationWindMs) : (stationWindMs ?? forecastWindMs);
  const windSource: 'roof' | 'forecast' | undefined =
    windSpeedMs === undefined
      ? undefined
      : preferForecast && forecastWindMs !== undefined
        ? 'forecast'
        : stationWindMs !== undefined
          ? 'roof'
          : 'forecast';
  const rawGustMs = toMetersPerSecond(getState(entities, SENSOR_IDS.windGust), 'km/h');
  // The spike filter keeps its ORIGINAL basis (forecast wind first, station second) on purpose.
  // Judged against the roof's OWN sustained reading it starts discarding real weather: a sheltered
  // anemometer averages near nothing while still catching brief eddies, and over the 24 h to
  // 2026-08-09 that rejected 89 of 1658 moments - "gust 19.4 km/h, roof wind 2.5 km/h" and
  // similar. The filter exists for the ~1 bogus spike a day (143 km/h against a 9 km/h hour),
  // which either basis still catches.
  const gustBasisMs = forecastWindMs ?? stationWindMs;
  const gustPlausible = rawGustMs !== undefined && gustBasisMs !== undefined && isPlausibleGustMs(rawGustMs, gustBasisMs);
  const gustMs = gustPlausible ? rawGustMs : undefined;
  const pillBasisMs = gustMs ?? windSpeedMs;
  const windWord = pillBasisMs !== undefined ? classifyGustWord(pillBasisMs) : undefined;

  const showMsUnit = gustMs !== undefined && gustMs >= 14;
  const windUnitLabel: 'km/h' | 'm/s' = showMsUnit ? 'm/s' : 'km/h';
  const windSpeedDisplay = windSpeedMs !== undefined ? (showMsUnit ? windSpeedMs : windSpeedMs * 3.6) : undefined;
  const gustDisplay = gustMs !== undefined ? (showMsUnit ? gustMs : gustMs * 3.6) : undefined;

  const peakGustNext12h = findPeakGustWithin(hourlyAll, nowMs, 12 * 3600_000, forecastWindUnit);
  const showPeak = peakGustNext12h != null && gustMs !== undefined && peakGustNext12h.ms > gustMs;
  const peakGustDisplay = peakGustNext12h != null ? (showMsUnit ? peakGustNext12h.ms : peakGustNext12h.ms * 3.6) : undefined;
  const downTheTerrace = windDirection != null && isTerraceAxis(windDirection);

  const windSubParts: string[] = [];
  // Gusts only when they actually exceed the sustained wind - "9 km/h, gusts 9 km/h" is noise.
  // The +1 m/s floor arrived with the roof-first switch (2026-08-09): the ratio alone was tuned
  // against the forecast's smooth wind, and against the roof's own low sheltered average it
  // fired on ~4 readings in 5, including physically meaningless pairs like 4.5 -> 5 km/h.
  // Both sides are now the same anemometer, so the gap is real when it is more than a metre.
  if (
    gustDisplay !== undefined &&
    windSpeedMs !== undefined &&
    gustMs !== undefined &&
    gustMs > windSpeedMs * 1.05 &&
    gustMs - windSpeedMs >= GUST_CLAUSE_MIN_MARGIN_MS
  )
    windSubParts.push(`gusts ${formatWindValue(gustDisplay, windUnitLabel)} ${windUnitLabel}`);
  // What the model says, but only when the big number is the roof's and the two are far enough
  // apart to be worth a line. Threshold is 3 km/h whatever unit the row happens to be showing.
  const stationWindKmh = stationWindMs !== undefined ? stationWindMs * 3.6 : undefined;
  const forecastWindKmh = forecastWindMs !== undefined ? forecastWindMs * 3.6 : undefined;
  if (
    windSource === 'roof' &&
    stationWindKmh !== undefined &&
    forecastWindKmh !== undefined &&
    forecastWindMs !== undefined &&
    Math.abs(stationWindKmh - forecastWindKmh) >= WIND_NOTE_MIN_DIFF_KMH
  ) {
    const forecastDisplay = showMsUnit ? forecastWindMs : forecastWindKmh;
    windSubParts.push(`forecast says ${formatWindValue(forecastDisplay, windUnitLabel)} ${windUnitLabel}`);
  }
  if (showPeak && peakGustDisplay !== undefined && peakGustNext12h) {
    windSubParts.push(
      `reaching ${formatWindValue(peakGustDisplay, windUnitLabel)} ${windUnitLabel} at ${formatHHMM(new Date(peakGustNext12h.atIso))}`
    );
  }
  if (downTheTerrace) windSubParts.push('down the terrace');
  const showWindRow = windSpeedMs !== undefined || gustMs !== undefined;

  // Storm alert - terrace-axis or any-direction extreme gusts in the next 24h of forecast.
  const stormHour = findStormHour(hourlyAll, nowMs, forecastWindUnit);
  const hasStormAlert = stormHour != null;
  const windColor = hasStormAlert ? '#f59e0b' : '#a3b8cc';
  const windColorFaint = hasStormAlert ? 'rgba(245,158,11,0.22)' : 'rgba(163,184,204,0.22)';

  // Rain alert - open windows + rain due soon, or the HA automation's own call.
  const windowsOpenCount = countOpenWindows(entities);
  const forcedRainAlert = getState(entities, WINDOW_RAIN_ALERT_ENTITY) === 'on';
  const rainHour = findFirstRainHour(hourlyAll, nowMs, forcedRainAlert ? 24 * 3600_000 : 6 * 3600_000);
  const showRainAlert = windowsOpenCount > 0 && (rainHour != null || forcedRainAlert);
  const rainAlertTimeMs = rainHour ? Date.parse(rainHour.datetime) : nowMs;
  // Terrace-door rain is its own, louder story: HA's rooftop alert plus which door it is.
  const rooftopRainAlert = getState(entities, ROOFTOP_RAIN_ALERT_ENTITY) === 'on';
  const livingDoorOpen = getState(entities, TERRACE_DOOR_LIVING) === 'on';
  const claudiaDoorOpen = getState(entities, TERRACE_DOOR_CLAUDIA) === 'on';
  const terraceDoorLabel =
    livingDoorOpen && claudiaDoorOpen
      ? 'both terrace doors are open'
      : livingDoorOpen
        ? 'the living-room terrace door is open'
        : claudiaDoorOpen
          ? "Claudia's terrace door is open"
          : 'a terrace door is open';

  // Hero sub-line - today's remaining peak, tonight's low (through the next 06:00), dew point.
  const todayPeak = findTodayPeak(hourlyAll, todayKey);
  const tonightEndMs = (() => {
    const today6 = atHour(now, 6).getTime();
    return today6 > nowMs ? today6 : today6 + 24 * 3600_000;
  })();
  const tonightLow = findTonightLow(hourlyAll, nowMs, tonightEndMs);
  const heroParts: string[] = [];
  // Only promise a peak that is actually still coming and warmer than right now - it read
  // "up to 22° at 20:00" while the thermometer said 23° (user 2026-07-31).
  if (todayPeak && currentTemp !== undefined && todayPeak.temp > currentTemp + 0.5)
    heroParts.push(`up to ${Math.round(todayPeak.temp)}° at ${formatHHMM(new Date(todayPeak.atIso))}`);
  if (tonightLow != null) heroParts.push(`down to ${Math.round(tonightLow)}° tonight`);
  if (dewpoint !== undefined) heroParts.push(`dew ${Math.round(dewpoint)}°`);
  // Provenance, said ONCE and only when the hero is not the roof's own reading. This replaces the
  // old footer line, which reported the age in a different place from the number it explained.
  const heroSourceNote =
    tempSource === 'forecast'
      ? stationQuiet && stationAgeMin != null
        ? `from forecast · roof quiet ${stationAgeMin} min`
        : 'from forecast'
      : stationQuiet && stationAgeMin != null
        ? `roof quiet ${stationAgeMin} min`
        : null;

  // Ribbon window: a ROLLING 18 h from now-2h (user 2026-07-31 - it used to stop at midnight,
  // so rain during the night was literally off the end of the bar). 18 h always covers tonight
  // and reaches into tomorrow morning, whatever time of day you look. SNAPPED to the whole
  // hour so every tick lands on a round clock time (17:00, 20:00, …) instead of 17:37.
  const windowStartMs = new Date(nowMs - 2 * 3600_000).setMinutes(0, 0, 0);
  const windowEndMs = windowStartMs + 18 * 3600_000;
  const ribbonHours = hourlyAll.filter(h => {
    const t = Date.parse(h.datetime);
    return Number.isFinite(t) && t > windowStartMs && t <= windowEndMs;
  });
  const showRibbon = ribbonHours.length > 0;

  const isNightNow = now.getHours() < 6 || now.getHours() > 21;
  const nowAnchorColor = isNightNow ? darkenHex(conditionBaseColor(condition), 0.55) : conditionBaseColor(condition);
  const ribbonStops = showRibbon
    ? [
        { pct: pctOf(nowMs, windowStartMs, windowEndMs), color: nowAnchorColor },
        ...ribbonHours.map(h => ({
          pct: pctOf(Date.parse(h.datetime) + ((h.bucketHours ?? 1) * 3600_000) / 2, windowStartMs, windowEndMs),
          color: hourColor(h),
        })),
      ]
    : [];
  const ribbonGradientCss = showRibbon ? ribbonGradient(ribbonStops) : '';

  const hourSpan = (h: WeatherForecastEntry) =>
    spanPct(Date.parse(h.datetime), Date.parse(h.datetime) + (h.bucketHours ?? 1) * 3600_000, windowStartMs, windowEndMs);
  // A rain hour is either measurable millimetres OR a real chance of them: met.no reports
  // light showers as probability with precipitation still 0.0, so keying on mm alone would
  // silently call a 60%-chance night "dry" (user 2026-07-31).
  const RAIN_PROB_PCT = 40;
  const isRainHour = (h: WeatherForecastEntry) => (h.precipitation ?? 0) > 0 || (h.precipitation_probability ?? 0) >= RAIN_PROB_PCT;
  const rainHours = ribbonHours.filter(isRainHour);
  const rainBandSpans = rainHours.map(hourSpan);
  const gustHoursPred = (h: WeatherForecastEntry) => {
    const g = hourGustMs(h, forecastWindUnit);
    return g != null && g >= 14;
  };
  const gustHours = ribbonHours.filter(gustHoursPred);
  const gustBandSpans = gustHours.map(hourSpan);
  const widestRainIdx = rainBandSpans.length ? rainBandSpans.reduce((best, s, i, arr) => (s.width > arr[best].width ? i : best), 0) : -1;
  const widestGustIdx = gustBandSpans.length ? gustBandSpans.reduce((best, s, i, arr) => (s.width > arr[best].width ? i : best), 0) : -1;
  const nowRibbonPct = pctOf(nowMs, windowStartMs, windowEndMs);

  // Condition words ON the strip. Without them the ribbon carries no text at all on a dry,
  // calm evening (user 2026-07-31: "I do not see any text in the time line") - rain and gust
  // labels only exist when there is rain or gust. Runs of one condition get named, widest
  // first, and the word takes black or white depending on how dark that stretch is.
  const conditionRuns = (() => {
    const runs: Array<{ from: number; to: number; condition?: string; night: boolean }> = [];
    for (const h of ribbonHours) {
      const t = Date.parse(h.datetime);
      if (!Number.isFinite(t)) continue;
      const end = t + (h.bucketHours ?? 1) * 3600_000;
      const last = runs[runs.length - 1];
      if (last && last.condition === h.condition) last.to = end;
      else runs.push({ from: t, to: end, condition: h.condition, night: isNightHour(h) });
    }
    return runs
      .map(r => ({ ...r, span: spanPct(r.from, r.to, windowStartMs, windowEndMs) }))
      .filter(r => r.span.width >= 14)
      .sort((a, b) => b.span.width - a.span.width)
      .slice(0, 2);
  })();
  /** Dark stretches need a light word; bright ones (sunny amber) need a dark one. */
  const wordIsLight = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.5;
  };

  // Rain/gust said in WORDS under the bar. Colour alone wasn't readable (user 2026-07-31:
  // "I see just color"), and a narrow band - which is what a two-hour shower looks like on an
  // 18 h bar - is too thin to carry its own label. Each run becomes "02:00-05:00".
  const runRanges = (hours: WeatherForecastEntry[], pred: (h: WeatherForecastEntry) => boolean) => {
    const out: Array<{ from: number; to: number }> = [];
    for (const h of hours) {
      const t = Date.parse(h.datetime);
      if (!Number.isFinite(t)) continue;
      const end = t + (h.bucketHours ?? 1) * 3600_000;
      if (!pred(h)) continue;
      const last = out[out.length - 1];
      if (last && t - last.to <= 30 * 60_000) last.to = end;
      else out.push({ from: t, to: end });
    }
    return out;
  };
  const fmtRange = (r: { from: number; to: number }) => `${formatHHMM(new Date(r.from))}–${formatHHMM(new Date(r.to))}`;
  const rainRanges = showRibbon ? runRanges(ribbonHours, isRainHour) : [];
  const gustRanges = showRibbon ? runRanges(ribbonHours, gustHoursPred) : [];
  const rainTotalMm = rainHours.reduce((sum, h) => sum + (h.precipitation ?? 0), 0);
  const ribbonNotes: Array<{ kind: 'rain' | 'gust' | 'dry'; text: string }> = [];
  if (rainRanges.length > 0) {
    const shown = rainRanges.slice(0, 2).map(fmtRange).join(', ');
    const more = rainRanges.length > 2 ? ` +${rainRanges.length - 2}` : '';
    const maxProb = Math.max(...rainHours.map(h => h.precipitation_probability ?? 0));
    // Millimetres when the forecast commits to an amount, otherwise the chance it is quoting.
    const tail = rainTotalMm >= 0.1 ? ` · ${rainTotalMm.toFixed(1)} mm` : maxProb > 0 ? ` · ${Math.round(maxProb)}% chance` : '';
    ribbonNotes.push({ kind: 'rain', text: `Rain ${shown}${more}${tail}` });
  } else if (showRibbon) {
    // Saying nothing read as broken (user 2026-07-31: "still not clear") - a dry window is
    // an answer, and it's the one being asked for.
    ribbonNotes.push({ kind: 'dry', text: `Dry until ${formatHHMM(new Date(windowEndMs))}` });
  }
  if (gustRanges.length > 0) {
    ribbonNotes.push({ kind: 'gust', text: `Gusts ${gustRanges.slice(0, 2).map(fmtRange).join(', ')}` });
  }

  // A steady 3-hourly ruler, always the same round clock times whether or not the weather does
  // anything (user 2026-07-31). The rain and gust HOURS are named in words underneath, so the
  // ticks no longer have to mark events - they just have to make the bar readable as a clock.
  const TICK_STEP_MS = 3 * 3600_000;
  /** Forecast temperature at a moment - the hour bucket containing it. */
  const tempAt = (ms: number): number | undefined => {
    for (const h of hourlyAll) {
      const t = Date.parse(h.datetime);
      if (!Number.isFinite(t)) continue;
      if (ms >= t && ms < t + (h.bucketHours ?? 1) * 3600_000) return h.temperature;
    }
    return undefined;
  };
  const roundTicks: TickCandidate[] = [];
  for (let t = windowStartMs; t <= windowEndMs; t += TICK_STEP_MS) {
    const temp = tempAt(t);
    roundTicks.push({
      pct: pctOf(t, windowStartMs, windowEndMs),
      label: formatHHMM(new Date(t)),
      priority: 2,
      temp: temp != null ? `${Math.round(temp)}°` : undefined,
    });
  }
  const tickCandidates: TickCandidate[] = showRibbon
    ? [
        {
          pct: nowRibbonPct,
          label: formatHHMM(now),
          priority: 3,
          temp: currentTemp != null ? `${Math.round(currentTemp)}\u00b0` : undefined,
        },
        ...roundTicks,
      ]
    : [];
  const ticks = pickTicks(tickCandidates, 7);

  // Week rows - up to 4 days, today excluded (the ribbon already tells today's story).
  const weekDays = daily.filter(d => getLocalDayKey(d.datetime) !== todayKey).slice(0, 4);
  const dayLows = weekDays.map(d => d.templow ?? d.temperature).filter((v): v is number => v != null);
  const dayHighs = weekDays.map(d => d.temperature ?? d.templow).filter((v): v is number => v != null);
  const rangeMin = dayLows.length ? Math.min(...dayLows) : 0;
  const rangeMax = dayHighs.length ? Math.max(...dayHighs) : 0;
  const rangeSpan = rangeMax > rangeMin ? rangeMax - rangeMin : 1;

  // Facts row.
  const rainDaily = getNumber(getState(entities, SENSOR_IDS.rainDaily));
  const uvIndex = getNumber(getState(entities, SENSOR_IDS.uv));
  const pressureEntityId = entities?.[SENSOR_IDS.pressureRelative] ? SENSOR_IDS.pressureRelative : SENSOR_IDS.pressureAbsolute;
  const pressure = getNumber(getState(entities, pressureEntityId));

  // Only while the sheet is up - otherwise the minute tick would re-walk both series for nothing.
  const compareStats = compareOpen && compareSeries ? computeCompareStats(compareSeries) : null;

  const historyEntity = historyEntityId ? entities?.[historyEntityId] : undefined;
  const historyTitle = historyEntityId
    ? (HISTORY_LABELS[historyEntityId] ??
      (typeof historyEntity?.attributes?.friendly_name === 'string' ? historyEntity.attributes.friendly_name : historyEntityId))
    : '';

  return (
    <div className='quick-weather-card'>
      <div className='quick-weather-header'>
        <span className={`quick-weather-glyph${hasStormAlert ? ' is-alert' : ''}`}>
          <Icon icon={conditionIcon} aria-hidden='true' />
        </span>
        <span className='quick-weather-title'>Weather</span>
        <span className={`quick-weather-state${hasStormAlert ? ' is-alert' : ''}`}>
          {currentTemp !== undefined ? `${Math.round(currentTemp)}°` : '—'} · {conditionLabel}
        </span>
      </div>

      {(hasStormAlert || showRainAlert || rooftopRainAlert) && (
        <div className='quick-weather-alerts'>
          {rooftopRainAlert && (
            <div className='quick-weather-alert quick-weather-alert--terrace'>
              <Icon icon='mdi:water-alert' aria-hidden='true' />
              <span>Rain — {terraceDoorLabel}</span>
            </div>
          )}
          {hasStormAlert && stormHour && (
            <div className='quick-weather-alert quick-weather-alert--storm'>
              <Icon icon='mdi:weather-windy-variant' aria-hidden='true' />
              <span>Storm on the terrace from {formatHHMM(new Date(stormHour.datetime))}</span>
            </div>
          )}
          {showRainAlert && (
            <div className='quick-weather-alert quick-weather-alert--rain'>
              <Icon icon='mdi:weather-pouring' aria-hidden='true' />
              <span>
                Rain at {formatHHMM(new Date(rainAlertTimeMs))} · {windowsOpenCount} window{windowsOpenCount === 1 ? '' : 's'} open
              </span>
            </div>
          )}
        </div>
      )}

      <div className='quick-weather-hero'>
        <div className='quick-weather-hero-row'>
          <div
            className='quick-weather-hero-value is-tappable'
            role='button'
            tabIndex={0}
            aria-label='Open roof versus forecast'
            onClick={openCompare}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openCompare();
              }
            }}
          >
            {currentTemp !== undefined ? Math.round(currentTemp) : '—'}
            <sup className='quick-weather-hero-deg'>°</sup>
          </div>
          {tempChipText && (
            <button type='button' className='quick-weather-hero-chip' onClick={openCompare}>
              <Icon icon='mdi:chart-line' aria-hidden='true' />
              {tempChipText}
            </button>
          )}
        </div>
        {(heroSourceNote || heroParts.length > 0) && (
          <div className='quick-weather-hero-sub'>
            {heroSourceNote && <span className={`quick-weather-hero-source${stationQuiet ? ' is-quiet' : ''}`}>{heroSourceNote}</span>}
            {heroSourceNote && heroParts.length > 0 && ' · '}
            {heroParts.join(' · ')}
          </div>
        )}
      </div>

      {showRibbon && (
        <div
          className='quick-weather-ribbon is-tappable'
          role='button'
          tabIndex={0}
          aria-label='Open today by hour'
          onClick={() => setSelectedDayDatetime(new Date(nowMs).toISOString())}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSelectedDayDatetime(new Date(nowMs).toISOString());
            }
          }}
        >
          <div className='quick-weather-ribbon-track'>
            <div className='quick-weather-ribbon-fill' style={{ background: ribbonGradientCss }} />
            {conditionRuns.map(r => {
              const color = r.night ? darkenHex(conditionBaseColor(r.condition), 0.55) : conditionBaseColor(r.condition);
              return (
                <span
                  key={`cond-${r.from}`}
                  className={`quick-weather-ribbon-condition${wordIsLight(color) ? ' is-light' : ''}`}
                  style={{ left: `${r.span.left + r.span.width / 2}%` }}
                >
                  {lowerCondition(r.condition)}
                </span>
              );
            })}
            {rainBandSpans.map((s, i) => (
              <div
                key={`rain-${i}`}
                className='quick-weather-ribbon-band quick-weather-ribbon-band--rain'
                style={{ left: `${s.left}%`, width: `${s.width}%` }}
              >
                {i === widestRainIdx && s.width >= 5 && <span className='quick-weather-ribbon-word'>rain</span>}
              </div>
            ))}
            {gustBandSpans.map((s, i) => (
              <div
                key={`gust-${i}`}
                className='quick-weather-ribbon-band quick-weather-ribbon-band--gust'
                style={{ left: `${s.left}%`, width: `${s.width}%` }}
              >
                {i === widestGustIdx && s.width >= 5 && <span className='quick-weather-ribbon-word'>gusts</span>}
              </div>
            ))}
            <div className='quick-weather-ribbon-now' style={{ left: `${nowRibbonPct}%` }} />
          </div>
          <div className='quick-weather-ribbon-ticks'>
            {ticks.map((t, i) => (
              <span
                key={`${t.pct}-${i}`}
                className={`quick-weather-ribbon-tick${t.priority === 3 ? ' is-now' : ''}`}
                style={{ left: `${t.pct}%` }}
              >
                {t.label}
                {t.temp && <span className='quick-weather-ribbon-tick-temp'>{t.temp}</span>}
              </span>
            ))}
          </div>
          {ribbonNotes.length > 0 && (
            <div className='quick-weather-ribbon-notes'>
              {ribbonNotes.map(n => (
                <span key={n.kind} className={`quick-weather-ribbon-note is-${n.kind}`}>
                  {n.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {showWindRow && (
        <div
          className='quick-weather-wind-row'
          role='button'
          tabIndex={0}
          onClick={() => setHistoryEntityId(SENSOR_IDS.windSpeed)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setHistoryEntityId(SENSOR_IDS.windSpeed);
            }
          }}
        >
          <svg className='quick-weather-compass' width='40' height='40' viewBox='0 0 52 52' aria-hidden='true'>
            <circle cx='26' cy='26' r='23' fill='none' stroke={windColorFaint} strokeWidth='2' />
            <text x='26' y='9' textAnchor='middle' dominantBaseline='central' className='quick-weather-compass-n'>
              N
            </text>
            <g transform={`rotate(${windDirection ?? 0} 26 26)`}>
              <path d='M26 9 L31 30 L26 26.5 L21 30 Z' fill={windColor} />
            </g>
            <text x='26' y='30' textAnchor='middle' dominantBaseline='central' className='quick-weather-compass-label' fill={windColor}>
              {windDirLabel}
            </text>
          </svg>
          <div className='quick-weather-wind-mid'>
            <div className='quick-weather-wind-speed'>
              {windSpeedDisplay !== undefined ? `${formatWindValue(windSpeedDisplay, windUnitLabel)} ${windUnitLabel}` : '—'}
              {windSource && <span className='quick-weather-wind-source'>{windSource}</span>}
            </div>
            {windSubParts.length > 0 && <div className='quick-weather-wind-sub'>{windSubParts.join(' · ')}</div>}
          </div>
          {windWord && <span className={`quick-weather-wind-pill${hasStormAlert ? ' is-alert' : ''}`}>{windWord}</span>}
        </div>
      )}

      {weekDays.length > 0 && (
        <div className='quick-weather-week'>
          {weekDays.map(d => {
            const low = d.templow ?? d.temperature;
            const high = d.temperature ?? d.templow;
            const peakGustMs = dailyPeakGustMs(hourlyAll, getLocalDayKey(d.datetime), forecastWindUnit);
            const peakGustDisplayDay = peakGustMs != null ? (showMsUnit ? peakGustMs : peakGustMs * 3.6) : undefined;
            const barLeft = low != null ? ((low - rangeMin) / rangeSpan) * 100 : 0;
            const barWidth = low != null && high != null ? ((high - low) / rangeSpan) * 100 : 0;
            return (
              <div
                key={d.datetime}
                className='quick-weather-week-row'
                role='button'
                tabIndex={0}
                onClick={() => toggleDay(d.datetime)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleDay(d.datetime);
                  }
                }}
              >
                <span className='quick-weather-week-day'>{shortWeekday(d.datetime)}</span>
                <Icon className='quick-weather-week-icon' icon={getWeatherConditionIcon(d.condition)} />
                <span className={`quick-weather-week-gust${peakGustMs != null && peakGustMs >= 14 ? ' is-strong' : ''}`}>
                  {peakGustDisplayDay != null ? `${formatWindValue(peakGustDisplayDay, windUnitLabel)}${windUnitLabel}` : ''}
                </span>
                <span className='quick-weather-week-low'>{low != null ? `${Math.round(low)}°` : '—'}</span>
                <div className='quick-weather-week-bar'>
                  <div className='quick-weather-week-bar-fill' style={{ left: `${barLeft}%`, width: `${barWidth}%` }} />
                </div>
                <span className='quick-weather-week-high'>{high != null ? `${Math.round(high)}°` : '—'}</span>
              </div>
            );
          })}
        </div>
      )}

      {selectedDayDatetime != null && (
        <div className='quick-weather-card__day-popup' role='dialog' aria-modal aria-labelledby='day-popup-title'>
          <div className='quick-weather-card__day-popup-backdrop' onClick={requestCloseDayPopup} aria-hidden />
          <div className='quick-weather-card__day-popup-panel'>
            <div className='quick-weather-card__day-popup-header'>
              <h3 id='day-popup-title' className='quick-weather-card__day-popup-title'>
                {formatDay(selectedDayDatetime)} — {selectedDayHasCoarseBuckets ? 'detailed forecast' : 'by hour'}
              </h3>
              <button type='button' className='quick-weather-card__day-popup-close' onClick={requestCloseDayPopup} aria-label='Close'>
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='quick-weather-card__day-popup-body'>
              {selectedDayHourly.length > 0 ? (
                <ul className='quick-weather-card__hour-list'>
                  {selectedDayHourly.map((entry, i) => (
                    <li key={`sd-${i}-${entry.datetime}`} className='quick-weather-card__hour-row'>
                      <span className='quick-weather-card__hour-time'>{formatBucketLabel(entry)}</span>
                      <div className='quick-weather-card__hour-icon'>
                        <Icon icon={getWeatherConditionIcon(entry.condition)} />
                      </div>
                      <span className='quick-weather-card__hour-temp'>
                        {entry.temperature != null ? `${Math.round(entry.temperature)}°` : '—'}
                      </span>
                      {entry.precipitation_probability != null && entry.precipitation_probability > 0 && (
                        <span className='quick-weather-card__hour-pop'>
                          <Icon icon='mdi:weather-rainy' aria-hidden />
                          {Math.round(entry.precipitation_probability)}%
                        </span>
                      )}
                      {(() => {
                        // Wind per hour (user 2026-07-31) - sustained, then the gust when it is
                        // meaningfully stronger. Gusts are what the terrace cares about, and on the
                        // ribbon they only draw a band above 14 m/s, so this is where you see them.
                        const wMs = toMetersPerSecond(entry.wind_speed, forecastWindUnit);
                        const gMs = toMetersPerSecond(entry.wind_gust_speed, forecastWindUnit);
                        if (wMs == null && gMs == null) return null;
                        const strong = gMs != null && gMs >= 14;
                        const fmt = (ms: number) => (showMsUnit ? `${ms.toFixed(0)} m/s` : `${Math.round(ms * 3.6)} km/h`);
                        return (
                          <span className={`quick-weather-card__hour-wind${strong ? ' is-strong' : ''}`}>
                            <Icon icon='mdi:weather-windy' aria-hidden />
                            {wMs != null ? fmt(wMs) : '—'}
                            {gMs != null && wMs != null && gMs > wMs * 1.05 && (
                              <span className='quick-weather-card__hour-gust'>{fmt(gMs)}</span>
                            )}
                          </span>
                        );
                      })()}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='quick-weather-card__forecast-empty'>No hourly data for this day.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {(rainDaily !== undefined || uvIndex !== undefined || pressure !== undefined) && (
        <div className='quick-weather-facts'>
          {rainDaily !== undefined && (
            <button type='button' className='quick-weather-fact' onClick={() => setHistoryEntityId(SENSOR_IDS.rainDaily)}>
              <span className='quick-weather-fact-label'>Rain today</span>
              <span className='quick-weather-fact-value'>{rainDaily.toFixed(1)} mm</span>
            </button>
          )}
          {uvIndex !== undefined && (
            <button type='button' className='quick-weather-fact' onClick={() => setHistoryEntityId(SENSOR_IDS.uv)}>
              <span className='quick-weather-fact-label'>UV</span>
              <span className='quick-weather-fact-value'>{uvIndex.toFixed(0)}</span>
              <span className='quick-weather-fact-sub'>{uvWord(uvIndex)}</span>
            </button>
          )}
          {seaTemperature !== undefined && (
            <button type='button' className='quick-weather-fact' onClick={() => setHistoryEntityId(SENSOR_IDS.seaTemperature)}>
              <span className='quick-weather-fact-label'>Sea</span>
              <span className='quick-weather-fact-value'>{Math.round(seaTemperature)}°</span>
              {seaTemperatureFeel && <span className='quick-weather-fact-sub'>{seaTemperatureFeel.toLowerCase()}</span>}
            </button>
          )}
        </div>
      )}

      {/* Station health used to live in a footer of its own. It now rides on the hero sub-line,
          next to the number it explains - said once, where it means something. */}

      {historyEntityId &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className='person-info-overlay'
            role='presentation'
            onClick={() => requestCloseHistory()}
            onMouseDown={e => e.stopPropagation()}
          >
            <div
              className='person-info-modal person-timeline-modal'
              role='dialog'
              aria-label={`${historyTitle} history`}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className='modal-header'>
                <span className='modal-title'>{historyTitle}</span>
                <button className='modal-close' onClick={() => requestCloseHistory()}>
                  <Icon icon='mdi:close' />
                </button>
              </div>
              <div className='modal-timeline-content'>
                <Timeline
                  entityId={historyEntityId}
                  entity={historyEntity ?? ({ entity_id: historyEntityId, state: '', attributes: {} } as HassEntity)}
                  hassUrl={hassUrl}
                  hours={168}
                  limit={100}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Roof vs forecast. MUST be portaled to document.body: the mobile room-detail panel carries
          a CSS transform, and a position:fixed sheet inside it lands a whole viewport away. */}
      {compareOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className='person-info-overlay'
            role='presentation'
            onClick={() => requestCloseCompare()}
            onMouseDown={e => e.stopPropagation()}
          >
            <div
              className='person-info-modal person-timeline-modal quick-weather-compare-modal'
              role='dialog'
              aria-label='Roof versus forecast'
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={handleCompareTouchStart}
              onTouchMove={handleCompareTouchMove}
              onTouchEnd={handleCompareTouchEnd}
            >
              <div className='modal-header'>
                <span className='modal-title'>Roof vs forecast</span>
                <button className='modal-close' onClick={() => requestCloseCompare()}>
                  <Icon icon='mdi:close' />
                </button>
              </div>
              <div className='modal-timeline-content quick-weather-compare-body'>
                <div className='quick-weather-compare-switch'>
                  <button
                    type='button'
                    className={`quick-weather-compare-tab${compareMetric === 'temperature' ? ' is-active' : ''}`}
                    aria-pressed={compareMetric === 'temperature'}
                    onClick={() => setCompareMetric('temperature')}
                  >
                    Temperature
                  </button>
                  <button
                    type='button'
                    className={`quick-weather-compare-tab${compareMetric === 'wind' ? ' is-active' : ''}`}
                    aria-pressed={compareMetric === 'wind'}
                    onClick={() => setCompareMetric('wind')}
                  >
                    Wind
                  </button>
                </div>

                {compareStatus === 'loading' && (
                  <p className='quick-weather-compare-note'>Loading the last {COMPARE_WINDOW_HOURS} hours…</p>
                )}
                {compareStatus === 'error' && <p className='quick-weather-compare-note'>History is not available right now.</p>}
                {compareStatus === 'ready' && compareSeries && (
                  <>
                    <CompareChart series={compareSeries} />
                    <div className='quick-weather-compare-legend'>
                      <span className='quick-weather-compare-key is-measured'>Roof</span>
                      <span className='quick-weather-compare-key is-modelled'>Forecast</span>
                      <span className='quick-weather-compare-unit'>{compareUnitLabel(compareSeries.metric)}</span>
                    </div>
                    <p className='quick-weather-compare-summary'>
                      {compareStats
                        ? compareSummary(compareStats, compareSeries.metric)
                        : `The roof and the forecast have no overlapping history in the last ${COMPARE_WINDOW_HOURS} h.`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
