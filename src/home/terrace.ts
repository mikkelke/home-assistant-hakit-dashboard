/** What the terrace shows: the water (the sea and the ice bath), the roof station's air and wind, and how that air feels
 * coming out of the water. Pure. */
import { addDays, startOfLocalDay } from '../energy/period';
import {
  ICE_BATH_SENSOR,
  OUTDOOR_HUMIDITY_SENSOR,
  OUTDOOR_TEMP_SENSOR,
  OUTDOOR_WIND_DIRECTION_SENSOR,
  OUTDOOR_WIND_GUST_SENSOR,
  OUTDOOR_WIND_SPEED_SENSOR,
} from '../config/entities';
import { holdToNow, rollingMean, type TempPoint } from '../utils/temperatureHistory';
import { parseHouseUpcoming, type HouseUpcomingRow } from './houseUpcoming';

/** HA area id of the rooftop, where the ice bath stands. */
export const TERRACE_AREA_ID = 'rooftop';

export const getNumber = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

/** A temperature to one decimal with a real minus sign, and never "-0.0". */
export function formatTemp(value: number): string {
  const digits = Math.abs(value).toFixed(1);
  return value < 0 && digits !== '0.0' ? `−${digits}` : digits;
}

// --- Water ---

export const getSeaTemperatureFeel = (temperature?: number) => {
  if (temperature === undefined) return undefined;
  if (temperature < 8) return 'Very cold';
  if (temperature < 13) return 'Cold';
  if (temperature < 18) return 'Fresh';
  if (temperature < 22) return 'Pleasant';
  if (temperature < 26) return 'Warm';
  return 'Very warm';
};

/** How frozen the ice bath looks, from 0 (10 °C and warmer) to 1 (0 °C and colder). */
export function frostFor(tempC: number): number {
  return Math.min(1, Math.max(0, (10 - tempC) / 10));
}

/** The word for the bath's water: its own ladder up to 13 °C, where it is a plunge and not a swim, and the sea's words
 * above it, so the two never disagree about a warm day. Lower case, as on the chips. */
export function iceBathWord(tempC: number): string {
  if (tempC < 3) return 'ice cold';
  if (tempC < 6) return 'baltic';
  if (tempC < 13) return 'cold';
  return (getSeaTemperatureFeel(tempC) ?? 'cold').toLowerCase();
}

/** The row of `sensor.house_upcoming` AppDaemon publishes while ice is likely on the bath. */
export const ICE_BATH_ROW_ID = 'ice:bath';

/** That row, or null. Whether ice is likely is AppDaemon's rule, so the dashboard has no temperature threshold of its own;
 * a publisher that has stopped lets its rows lapse with its lease. */
export function iceBathRow(attributes: unknown, nowMs: number): HouseUpcomingRow | null {
  return parseHouseUpcoming(attributes, nowMs).find(row => row.id === ICE_BATH_ROW_ID) ?? null;
}

// --- The roof station ---

export const toMetersPerSecond = (value: unknown, unit?: string) => {
  const numeric = getNumber(value);
  if (numeric === undefined) return undefined;
  const normalizedUnit = unit?.toLowerCase() ?? '';
  if (normalizedUnit.includes('km')) return numeric / 3.6;
  if (normalizedUnit.includes('mph')) return numeric * 0.44704;
  if (normalizedUnit.includes('kn')) return numeric * 0.514444;
  return numeric;
};

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass name for a bearing in degrees. */
export function compass16(deg: number): string {
  const n = ((deg % 360) + 360) % 360;
  return COMPASS_16[Math.round(n / 22.5) % 16];
}

/** Gust plausibility filter (critical): the station emits ~1 bogus spike/day (worst seen: 143
 * km/h during a 9 km/h hour). Reject readings failing basic physical plausibility - applied
 * before display AND before the pill classification. Ratio/absolute thresholds expressed in
 * m/s (our canonical unit here) so no separate km/h bookkeeping is needed. */
export function isPlausibleGustMs(gustMs: number, windMs: number): boolean {
  if (gustMs > 110 / 3.6) return false;
  if (windMs > 1 / 3.6 && gustMs > windMs * 4) return false;
  return true;
}

export interface EntityReading {
  state?: string;
  attributes?: Record<string, unknown>;
}

/** A wind sensor in m/s, by the unit it names; the roof station reports km/h, which is also what a missing unit is taken for. */
function windReadingMs(entity: EntityReading | undefined): number | null {
  const unit = typeof entity?.attributes?.unit_of_measurement === 'string' ? entity.attributes.unit_of_measurement : 'km/h';
  return toMetersPerSecond(entity?.state, unit) ?? null;
}

export interface TerraceReadings {
  waterC: number | null;
  airC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  /** Only a gust that passes the plausibility filter. */
  gustMs: number | null;
  /** Degrees the wind blows from. */
  fromDeg: number | null;
}

/** The terrace's readings out of the entities, each null while its sensor is unknown or unavailable. */
export function terraceReadings(entities: Record<string, EntityReading | undefined>): TerraceReadings {
  const number = (id: string) => getNumber(entities[id]?.state) ?? null;
  const windMs = windReadingMs(entities[OUTDOOR_WIND_SPEED_SENSOR]);
  const gust = windReadingMs(entities[OUTDOOR_WIND_GUST_SENSOR]);
  return {
    waterC: number(ICE_BATH_SENSOR),
    airC: number(OUTDOOR_TEMP_SENSOR),
    humidityPct: number(OUTDOOR_HUMIDITY_SENSOR),
    windMs,
    gustMs: gust != null && isPlausibleGustMs(gust, windMs ?? 0) ? gust : null,
    fromDeg: number(OUTDOOR_WIND_DIRECTION_SENSOR),
  };
}

// --- Out of the water ---

/** The warmest air the wind chill formula holds for; warmer air has no chill to name. */
export const CHILL_MAX_AIR_C = 10;

/** Wind chill in °C, by the Environment Canada and NWS formula of 2001: valid for air of 10 °C or colder and wind above
 * 4.8 km/h; outside that it feels like the air. */
export function windChillC(airC: number, windKmh: number): number {
  if (airC > CHILL_MAX_AIR_C || windKmh <= 4.8) return airC;
  const speedTerm = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * airC - 11.37 * speedTerm + 0.3965 * airC * speedTerm;
}

export type ChillBand = 'chilly' | 'cold' | 'biting' | 'frostbite';

/** Mildest first; each band's step on the four-step bar is its index plus one. */
export const CHILL_BANDS: readonly { band: ChillBand; label: string; range: string }[] = [
  { band: 'chilly', label: 'chilly', range: 'above 0°' },
  { band: 'cold', label: 'cold', range: '0 to −9°' },
  { band: 'biting', label: 'biting', range: '−10 to −27°' },
  { band: 'frostbite', label: 'frostbite risk', range: '−28° and below' },
];

/** The band a felt temperature falls in: above 0 chilly, down to -9 cold, down to -27 biting, -28 and colder frostbite risk. */
export function chillBand(feelsC: number): ChillBand {
  if (feelsC > 0) return 'chilly';
  if (feelsC > -10) return 'cold';
  if (feelsC > -28) return 'biting';
  return 'frostbite';
}

// --- The week ---

const DAY_MS = 86_400_000;

/** Days drawn on the terrace chart. */
export const CHART_DAYS = 7;

export interface TerraceSeries {
  water: TempPoint[];
  air: TempPoint[];
  /** The air's mean over the 24 h before each point. */
  airMean: TempPoint[];
  startMs: number;
  endMs: number;
}

/** The week's three lines ending at `nowMs`, each held to now at its live reading. The mean is taken over every fetched
 * point and cut to the week afterwards, so even its first point is a whole day's mean. */
export function buildTerraceSeries(input: {
  water: TempPoint[];
  air: TempPoint[];
  waterNow: number | null;
  airNow: number | null;
  nowMs: number;
}): TerraceSeries {
  const startMs = input.nowMs - CHART_DAYS * DAY_MS;
  const air = holdToNow(input.air, input.airNow, input.nowMs);
  const inWeek = (point: TempPoint) => point.ts >= startMs;
  return {
    water: holdToNow(input.water, input.waterNow, input.nowMs).filter(inWeek),
    air: air.filter(inWeek),
    airMean: rollingMean(air, DAY_MS).filter(inWeek),
    startMs,
    endMs: input.nowMs,
  };
}

/** The axis for a chart of `values` that always holds 0°: bounds on whole steps of 1, 2, 5, 10 or 20 with a gridline on
 * each step, the finest step that keeps it to seven intervals. */
export function temperatureAxis(values: readonly number[]): { lo: number; hi: number; ticks: number[] } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  let axis = { lo: 0, hi: 0, step: 20 };
  for (const step of [1, 2, 5, 10, 20]) {
    axis = { lo: Math.floor((min - 0.5) / step) * step, hi: Math.ceil((max + 0.5) / step) * step, step };
    if ((axis.hi - axis.lo) / step <= 7) break;
  }
  const ticks: number[] = [];
  for (let tick = axis.lo; tick <= axis.hi; tick += axis.step) ticks.push(tick);
  return { lo: axis.lo, hi: axis.hi, ticks };
}

/** A line for each local midnight inside the span, named by the weekday that starts there. */
export function dayTicks(startMs: number, endMs: number): { ts: number; label: string }[] {
  const ticks: { ts: number; label: string }[] = [];
  for (let at = addDays(startOfLocalDay(startMs), 1); at < endMs; at = addDays(at, 1)) {
    ticks.push({ ts: at, label: new Date(at).toLocaleDateString('en-GB', { weekday: 'short' }) });
  }
  return ticks;
}
