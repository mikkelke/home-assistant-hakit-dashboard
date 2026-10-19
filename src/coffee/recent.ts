/** `/media/coffee/recent.json`, read through `shell_command.coffee_recent`: the last 60 days of brew curves at 2 s, and
 * the bands each was compared with. Files may hold plain numbers (tenths) where entities hold CSV strings. */
import { readArchiveIndex } from '../utils/haArchive';
import { COFFEE_RECENT_SERVICE } from './entities';
import { numberOf, parsePourEvents, parseTenths, text, timeOf, type PourEvent } from './model';

export interface RecentCurve {
  id: string;
  t0Ms: number | null;
  stepS: number;
  cup: (number | null)[];
  water: (number | null)[];
  pours: PourEvent[];
  endS: number | null;
  baselineId: string | null;
}

export interface RecentBand {
  n: number;
  stepS: number;
  cupLo: (number | null)[];
  cupHi: (number | null)[];
  waterLo: (number | null)[];
  waterHi: (number | null)[];
  planWater: (number | null)[];
}

export interface CoffeeRecentData {
  generatedAtMs: number | null;
  stepS: number;
  curves: Record<string, RecentCurve>;
  bands: Record<string, RecentBand>;
}

const series = (value: unknown) => parseTenths(value);

function pourEvents(value: unknown): PourEvent[] {
  if (!Array.isArray(value)) return parsePourEvents(value);
  return value.flatMap(item => {
    if (!Array.isArray(item) || item.length < 2) return [];
    const [s, index] = item.map(Number);
    return Number.isFinite(s) && Number.isInteger(index) && index >= 0 ? [{ s, index }] : [];
  });
}

export function parseCoffeeRecent(raw: unknown): CoffeeRecentData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const stepS = numberOf(data.step_s) ?? 2;
  const curves: Record<string, RecentCurve> = {};
  for (const item of Array.isArray(data.brews) ? data.brews : []) {
    if (typeof item !== 'object' || item === null) continue;
    const brew = item as Record<string, unknown>;
    const id = text(brew.id);
    if (!id) continue;
    curves[id] = {
      id,
      t0Ms: timeOf(brew.t0),
      stepS: numberOf(brew.step_s) ?? stepS,
      cup: series(brew.cup),
      water: series(brew.water),
      pours: pourEvents(brew.pours),
      endS: numberOf(brew.end_s),
      baselineId: text(brew.baseline_id),
    };
  }
  const bands: Record<string, RecentBand> = {};
  const rawBands = typeof data.bands === 'object' && data.bands !== null ? (data.bands as Record<string, unknown>) : {};
  for (const [id, value] of Object.entries(rawBands)) {
    if (typeof value !== 'object' || value === null) continue;
    const band = value as Record<string, unknown>;
    bands[id] = {
      n: numberOf(band.n) ?? 0,
      stepS: numberOf(band.step_s) ?? stepS,
      cupLo: series(band.cup_lo),
      cupHi: series(band.cup_hi),
      waterLo: series(band.water_lo),
      waterHi: series(band.water_hi),
      planWater: series(band.plan_water),
    };
  }
  return { generatedAtMs: timeOf(data.generated_at), stepS, curves, bands };
}

/** The recent curves, or null while the file does not exist yet. */
export async function readCoffeeRecent(): Promise<CoffeeRecentData | null> {
  const raw = await readArchiveIndex(COFFEE_RECENT_SERVICE);
  return raw == null ? null : parseCoffeeRecent(raw);
}
