import { useHass } from '@hakit/core';
import {
  OUTDOOR_RAIN_RATE_SENSOR,
  OUTDOOR_TEMP_SENSOR,
  OUTDOOR_WIND_DIRECTION_SENSOR,
  OUTDOOR_WIND_SPEED_SENSOR,
  SUN_ENTITY,
  WEATHER_ENTITY,
} from '../../config/entities';
import { pickOutdoorTemperature } from '../../home/roomAmbient';
import { cloudCount, skyPhase, windMs, type SkyPhase } from '../../home/sky';
import { useNowMs } from '../../hooks/useNowMs';

type Reading = { state?: string; last_changed?: string } | undefined;

/** The roof station's last change is read in buckets of this many ms, so its minute-by-minute
 * updates do not re-render the sky. */
const STATION_BUCKET_MS = 600_000;

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function reading(entity: Reading): number | null {
  return entity && entity.state !== 'unknown' && entity.state !== 'unavailable' ? toNumber(entity.state) : null;
}

const roundTo = (value: number | null, step: number) => (value == null ? null : Math.round(value / step) * step);

function stationBucket(...entities: Reading[]): number | null {
  const changed = entities.map(entity => Date.parse(entity?.last_changed ?? '')).filter(Number.isFinite);
  return changed.length > 0 ? Math.ceil(Math.max(...changed) / STATION_BUCKET_MS) : null;
}

const timeMs = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);

export interface SkyReadings {
  phase: SkyPhase;
  sunUp: boolean;
  nextRisingMs: number | null;
  nextSettingMs: number | null;
  condition: string | undefined;
  clouds: number;
  raining: boolean;
  tempC: number | null;
  /** Whole m/s. */
  windMs: number | null;
  /** Degrees the wind blows from, to the nearest 10. */
  windFromDeg: number | null;
  nowMs: number;
}

/** What the sky shows, each value its own primitive selector: the sun, the roof station and the
 * forecast change far more often than anything else on the home screen, so only the sky re-renders
 * for them, and only when a shown value changes. */
export function useSky(): SkyReadings {
  const nowMs = useNowMs();
  const sunUp = useHass(s => s.entities[SUN_ENTITY]?.state === 'above_horizon');
  const phase = useHass(s => {
    const sun = s.entities[SUN_ENTITY];
    return skyPhase(toNumber(sun?.attributes?.elevation), sun?.attributes?.rising === true);
  });
  const nextRising = useHass(s => s.entities[SUN_ENTITY]?.attributes?.next_rising);
  const nextSetting = useHass(s => s.entities[SUN_ENTITY]?.attributes?.next_setting);
  const condition = useHass(s => s.entities[WEATHER_ENTITY]?.state);
  const clouds = useHass(s => cloudCount(toNumber(s.entities[WEATHER_ENTITY]?.attributes?.cloud_coverage)));
  const forecastC = useHass(s => toNumber(s.entities[WEATHER_ENTITY]?.attributes?.temperature));
  const forecastWind = useHass(s => windMs(toNumber(s.entities[WEATHER_ENTITY]?.attributes?.wind_speed)));
  const forecastFrom = useHass(s => roundTo(toNumber(s.entities[WEATHER_ENTITY]?.attributes?.wind_bearing), 10));
  const stationC = useHass(s => reading(s.entities[OUTDOOR_TEMP_SENSOR]));
  const stationWind = useHass(s => windMs(reading(s.entities[OUTDOOR_WIND_SPEED_SENSOR])));
  const stationFrom = useHass(s => roundTo(reading(s.entities[OUTDOOR_WIND_DIRECTION_SENSOR]), 10));
  const raining = useHass(s => (reading(s.entities[OUTDOOR_RAIN_RATE_SENSOR]) ?? 0) > 0);
  const bucket = useHass(s => stationBucket(s.entities[OUTDOOR_TEMP_SENSOR], s.entities[OUTDOOR_WIND_SPEED_SENSOR]));

  const outdoor = pickOutdoorTemperature({
    stationC,
    stationChangedMs: bucket == null ? [] : [bucket * STATION_BUCKET_MS],
    forecastC,
    nowMs,
  });
  const stationLive = outdoor.quietMin == null;
  return {
    phase,
    sunUp,
    nextRisingMs: timeMs(nextRising),
    nextSettingMs: timeMs(nextSetting),
    condition,
    clouds,
    raining,
    tempC: outdoor.tempC,
    windMs: stationLive ? (stationWind ?? forecastWind) : (forecastWind ?? stationWind),
    windFromDeg: stationLive ? (stationFrom ?? forecastFrom) : (forecastFrom ?? stationFrom),
    nowMs,
  };
}
