import { useMemo } from 'react';
import { useWeather } from '@hakit/core';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
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

/** Home Assistant weather forecast entry (hourly or daily). */
type WeatherForecastEntry = {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation_probability?: number;
  precipitation?: number;
  wind_speed?: number;
  wind_bearing?: number;
};

/**
 * Data sources for QuickWeatherCard:
 * - Weather entity (entityId): condition; forecast via Hakit useWeather (same WebSocket subscription as the old WeatherCard).
 * - GW2000A sensors below: current live readings only (not forecast).
 */
const SENSOR_IDS = {
  outdoorTemp: 'sensor.gw2000a_outdoor_temperature',
  feelsLike: 'sensor.gw2000a_feels_like_temperature',
  humidity: 'sensor.gw2000a_humidity',
  dewpoint: 'sensor.gw2000a_dewpoint',
  windSpeed: 'sensor.gw2000a_wind_speed',
  windGust: 'sensor.gw2000a_wind_gust',
  windDirection: 'sensor.gw2000a_wind_direction',
  rainRate: 'sensor.gw2000a_rain_rate_piezo',
  rainDaily: 'sensor.gw2000a_daily_rain_piezo',
  pressureRelative: 'sensor.gw2000a_relative_pressure',
  pressureAbsolute: 'sensor.gw2000a_absolute_pressure',
  uv: 'sensor.gw2000a_uv_index',
} as const;

const CONDITION_ICONS: Record<string, string> = {
  'clear-night': 'mdi:weather-night',
  cloudy: 'mdi:weather-cloudy',
  exceptional: 'mdi:alert-circle-outline',
  fog: 'mdi:weather-fog',
  hail: 'mdi:weather-hail',
  lightning: 'mdi:weather-lightning',
  'lightning-rainy': 'mdi:weather-lightning-rainy',
  partlycloudy: 'mdi:weather-partly-cloudy',
  pouring: 'mdi:weather-pouring',
  rainy: 'mdi:weather-rainy',
  snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy',
  sunny: 'mdi:weather-sunny',
  windy: 'mdi:weather-windy',
  'windy-variant': 'mdi:weather-windy-variant',
};

function MetricPill({ icon, label, value, subvalue }: { icon: string; label: string; value: string; subvalue?: string }) {
  return (
    <div className='quick-weather-card__metric'>
      <div className='quick-weather-card__metric-icon'>
        <Icon icon={icon} />
      </div>
      <div className='quick-weather-card__metric-copy'>
        <span className='quick-weather-card__metric-label'>{label}</span>
        <span className='quick-weather-card__metric-value'>{value}</span>
        {subvalue ? <span className='quick-weather-card__metric-subvalue'>{subvalue}</span> : null}
      </div>
    </div>
  );
}

const getEntity = (entities: HassEntities, entityId: string) => entities?.[entityId] as EntityLike | undefined;

const getState = (entities: HassEntities, entityId: string) => getEntity(entities, entityId)?.state;

const getNumber = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const formatCondition = (value?: string) => {
  if (!value) return 'Weather';
  return value
    .split('-')
    .join(' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

const getConditionTone = (condition?: string) => {
  if (!condition) return 'neutral';
  if (condition.includes('rain') || condition === 'pouring' || condition === 'lightning') return 'rain';
  if (condition.includes('snow') || condition === 'hail') return 'snow';
  if (condition.includes('clear') || condition === 'sunny') return 'sun';
  if (condition.includes('wind')) return 'wind';
  if (condition === 'fog' || condition === 'cloudy' || condition === 'partlycloudy') return 'cloud';
  return 'neutral';
};

/** Wind speed (m/s) above which we show a heavy-wind warning. ~10.8 m/s ≈ 39 km/h (strong wind). */
const HEAVY_WIND_MS = 10.8;
/** Gust speed (m/s) above which we show a wind warning. ~13.9 m/s ≈ 50 km/h. */
const HEAVY_GUST_MS = 13.9;

const isHeavyWind = (windMs?: number, gustMs?: number) =>
  (windMs != null && windMs >= HEAVY_WIND_MS) || (gustMs != null && gustMs >= HEAVY_GUST_MS);

const getDirectionLabel = (deg?: number) => {
  if (deg === undefined || Number.isNaN(deg)) return '—';
  const normalized = ((deg % 360) + 360) % 360;
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(normalized / 45) % 8];
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

const getRelativeTimeLabel = (dateValue?: string) => {
  if (!dateValue) return 'Live';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Live';

  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** Parse forecast array from weather entity attributes. */
function getForecastList(attributes: Record<string, unknown>): WeatherForecastEntry[] {
  const raw = attributes?.forecast;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is WeatherForecastEntry =>
      item != null && typeof item === 'object' && typeof (item as WeatherForecastEntry).datetime === 'string'
  ) as WeatherForecastEntry[];
}

/** Split forecast into hourly (rest of today) and daily (next days). */
function splitForecast(forecast: WeatherForecastEntry[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourly: WeatherForecastEntry[] = [];
  const dailyByDay = new Map<string, WeatherForecastEntry[]>();

  for (const entry of forecast) {
    const dt = new Date(entry.datetime);
    if (Number.isNaN(dt.getTime())) continue;
    const entryDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).toISOString().slice(0, 10);
    const isToday = entryDay === todayStart.toISOString().slice(0, 10);
    if (isToday && dt >= now) {
      hourly.push(entry);
    }
    if (!dailyByDay.has(entryDay)) dailyByDay.set(entryDay, []);
    dailyByDay.get(entryDay)!.push(entry);
  }

  // Sort hourly by datetime; take up to 24 slots for "rest of day"
  hourly.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  const hourlyRestOfDay = hourly.slice(0, 24);

  // Build daily list: one entry per day; skip today only if we already show it in hourly
  const sortedDays = Array.from(dailyByDay.keys()).sort();
  const daily: WeatherForecastEntry[] = [];
  const skipTodayInDaily = hourlyRestOfDay.length > 0;
  for (const day of sortedDays) {
    if (skipTodayInDaily && day === todayStart.toISOString().slice(0, 10)) continue;
    const entries = dailyByDay.get(day)!;
    const best = entries.length === 1 ? entries[0] : entries[Math.min(12, Math.floor(entries.length / 2))];
    daily.push(best);
  }

  return { hourly: hourlyRestOfDay, daily: daily.slice(0, 5) };
}

function formatHour(datetime: string) {
  const d = new Date(datetime);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

/** Map Hakit forecast entry to our shape (same fields). */
function toForecastEntry(e: {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation_probability?: number;
}): WeatherForecastEntry {
  return {
    datetime: e.datetime,
    condition: e.condition,
    temperature: e.temperature,
    templow: e.templow,
    precipitation_probability: e.precipitation_probability,
  };
}

export function QuickWeatherCard({ entityId, entities }: QuickWeatherCardProps) {
  const weatherEntity = getEntity(entities, entityId);
  const weatherDaily = useWeather(entityId as Parameters<typeof useWeather>[0], { type: 'daily' });
  const weatherHourly = useWeather(entityId as Parameters<typeof useWeather>[0], { type: 'hourly' });

  const { hourly, daily } = useMemo(() => {
    const fromAttr = getForecastList(weatherEntity?.attributes ?? {});
    const fromAttrSplit = splitForecast(fromAttr);
    const dailyList = weatherDaily?.forecast?.forecast ?? [];
    const hourlyList = weatherHourly?.forecast?.forecast ?? [];
    const dailyMapped = (dailyList.length > 0 ? dailyList : fromAttrSplit.daily).map(toForecastEntry).slice(0, 5);
    const now = new Date();
    const hourlyRest = (hourlyList.length > 0 ? hourlyList : fromAttrSplit.hourly)
      .map(toForecastEntry)
      .filter(e => new Date(e.datetime).getTime() >= now.getTime())
      .slice(0, 24);
    return { hourly: hourlyRest, daily: dailyMapped };
  }, [weatherEntity?.attributes, weatherDaily?.forecast, weatherHourly?.forecast]);

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
  const tone = getConditionTone(condition);
  const conditionIcon = CONDITION_ICONS[condition ?? ''] ?? 'mdi:weather-partly-cloudy';

  const currentTemp = getNumber(attributes.temperature) ?? getNumber(getState(entities, SENSOR_IDS.outdoorTemp));
  const currentTempUnit = typeof attributes.temperature_unit === 'string' ? attributes.temperature_unit : '°C';
  const feelsLike = getNumber(getState(entities, SENSOR_IDS.feelsLike));
  const humidity = getNumber(attributes.humidity) ?? getNumber(getState(entities, SENSOR_IDS.humidity));
  const dewpoint = getNumber(getState(entities, SENSOR_IDS.dewpoint));
  const pressure =
    getNumber(attributes.pressure) ??
    getNumber(getState(entities, SENSOR_IDS.pressureRelative)) ??
    getNumber(getState(entities, SENSOR_IDS.pressureAbsolute));

  const windDirection = getNumber(getState(entities, SENSOR_IDS.windDirection));
  const windDirectionLabel = getDirectionLabel(windDirection);

  const windSpeedMs =
    toMetersPerSecond(attributes.wind_speed, typeof attributes.wind_speed_unit === 'string' ? attributes.wind_speed_unit : undefined) ??
    toMetersPerSecond(getState(entities, SENSOR_IDS.windSpeed), 'km/h');

  const gustMs = toMetersPerSecond(getState(entities, SENSOR_IDS.windGust), 'km/h');
  const rainRate = getNumber(getState(entities, SENSOR_IDS.rainRate));
  const rainDaily = getNumber(getState(entities, SENSOR_IDS.rainDaily));
  const uvIndex = getNumber(getState(entities, SENSOR_IDS.uv));

  const tempUnit = currentTempUnit;

  return (
    <div className={`quick-weather-card quick-weather-card--${tone}`}>
      <div className='quick-weather-card__glow' />

      <div className='quick-weather-card__hero'>
        <div className='quick-weather-card__identity'>
          <div className='quick-weather-card__icon-wrap'>
            <Icon icon={conditionIcon} />
          </div>

          <div className='quick-weather-card__title-group'>
            <span className='quick-weather-card__eyebrow'>Quick weather</span>
            <h3 className='quick-weather-card__title'>{formatCondition(condition)}</h3>
            <span className='quick-weather-card__timestamp'>
              {getRelativeTimeLabel(weatherEntity.last_updated || weatherEntity.last_changed)}
            </span>
          </div>
        </div>

        <div className='quick-weather-card__hero-side'>
          <div className='quick-weather-card__temperature'>
            {currentTemp !== undefined ? `${currentTemp.toFixed(0)}${currentTempUnit}` : '—'}
          </div>
          <div className='quick-weather-card__hero-meta'>
            <span>{feelsLike !== undefined ? `Feels ${feelsLike.toFixed(0)}°C` : 'Feels —'}</span>
            <span>{humidity !== undefined ? `${humidity.toFixed(0)}% humidity` : 'Humidity —'}</span>
          </div>
        </div>
      </div>

      <div className='quick-weather-card__summary-row'>
        <div className='quick-weather-card__wind-pill'>
          <div className='quick-weather-card__wind-icon'>
            <Icon icon='mdi:navigation-variant' style={{ transform: `rotate(${windDirection ?? 0}deg)` }} />
          </div>
          <div className='quick-weather-card__wind-copy'>
            <span className='quick-weather-card__wind-label'>
              Wind
              {isHeavyWind(windSpeedMs, gustMs) && (
                <span className='quick-weather-card__wind-warning' title='Heavy wind'>
                  <Icon icon='mdi:weather-hurricane' aria-hidden />
                </span>
              )}
            </span>
            <span className='quick-weather-card__wind-value'>
              {windSpeedMs !== undefined ? `${windSpeedMs.toFixed(1)} m/s` : '—'}
              {windDirectionLabel !== '—' ? ` · ${windDirectionLabel}` : ''}
            </span>
          </div>
        </div>

        <div className='quick-weather-card__badges'>
          <span className='quick-weather-card__badge'>
            <Icon icon='mdi:weather-pouring' />
            {rainRate !== undefined ? `${rainRate.toFixed(1)} mm/h now` : 'No live rain'}
          </span>
          <span className='quick-weather-card__badge'>
            <Icon icon='mdi:weather-rainy' />
            {rainDaily !== undefined ? `${rainDaily.toFixed(1)} mm today` : 'Rain total —'}
          </span>
          <span className='quick-weather-card__badge'>
            <Icon icon='mdi:weather-sunny-alert' />
            {uvIndex !== undefined ? `UV ${uvIndex.toFixed(0)}` : 'UV —'}
          </span>
        </div>
      </div>

      <div className='quick-weather-card__metrics-grid'>
        <MetricPill
          icon='mdi:water-percent'
          label='Humidity'
          value={humidity !== undefined ? `${humidity.toFixed(0)}%` : '—'}
          subvalue={dewpoint !== undefined ? `Dew point ${dewpoint.toFixed(1)}°C` : undefined}
        />
        <MetricPill
          icon='mdi:weather-windy'
          label='Wind / gust'
          value={windSpeedMs !== undefined ? `${windSpeedMs.toFixed(1)} m/s` : '—'}
          subvalue={gustMs !== undefined ? `Gusts ${gustMs.toFixed(1)} m/s` : windDirectionLabel !== '—' ? windDirectionLabel : undefined}
        />
        <MetricPill icon='mdi:gauge' label='Pressure' value={pressure !== undefined ? `${pressure.toFixed(0)} hPa` : '—'} />
        <MetricPill
          icon='mdi:thermometer-lines'
          label='Temperature'
          value={currentTemp !== undefined ? `${currentTemp.toFixed(0)}${currentTempUnit}` : '—'}
          subvalue={feelsLike !== undefined ? `Feels like ${feelsLike.toFixed(0)}°C` : undefined}
        />
      </div>

      <div className='quick-weather-card__forecast-shell'>
        {hourly.length > 0 && (
          <>
            <div className='quick-weather-card__forecast-header'>
              <span>Rest of today</span>
              <span className='quick-weather-card__forecast-subtitle'>By hour</span>
            </div>
            <div className='quick-weather-card__hourly'>
              {hourly.map((entry, i) => (
                <div key={`h-${i}-${entry.datetime}`} className='quick-weather-card__forecast-item'>
                  <span className='quick-weather-card__forecast-time'>{formatHour(entry.datetime)}</span>
                  <div className='quick-weather-card__forecast-icon'>
                    <Icon icon={CONDITION_ICONS[entry.condition ?? ''] ?? 'mdi:weather-partly-cloudy'} />
                  </div>
                  <span className='quick-weather-card__forecast-temp'>
                    {entry.temperature != null ? `${Math.round(entry.temperature)}${tempUnit}` : '—'}
                  </span>
                  {entry.precipitation_probability != null && entry.precipitation_probability > 0 && (
                    <span className='quick-weather-card__forecast-pop'>
                      <Icon icon='mdi:weather-rainy' aria-hidden />
                      {entry.precipitation_probability}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className='quick-weather-card__forecast-header'>
          <span>Forecast</span>
          <span className='quick-weather-card__forecast-subtitle'>{daily.length > 0 ? 'Next few days' : 'No forecast data'}</span>
        </div>
        {daily.length > 0 ? (
          <div className='quick-weather-card__daily'>
            {daily.map((entry, i) => (
              <div key={`d-${i}-${entry.datetime}`} className='quick-weather-card__forecast-item quick-weather-card__forecast-item--daily'>
                <span className='quick-weather-card__forecast-day'>{formatDay(entry.datetime)}</span>
                <div className='quick-weather-card__forecast-icon'>
                  <Icon icon={CONDITION_ICONS[entry.condition ?? ''] ?? 'mdi:weather-partly-cloudy'} />
                </div>
                <span className='quick-weather-card__forecast-temp'>
                  {entry.templow != null && entry.temperature != null
                    ? `${Math.round(entry.templow)}–${Math.round(entry.temperature)}${tempUnit}`
                    : entry.temperature != null
                      ? `${Math.round(entry.temperature)}${tempUnit}`
                      : '—'}
                </span>
                {entry.precipitation_probability != null && entry.precipitation_probability > 0 && (
                  <span className='quick-weather-card__forecast-pop'>
                    <Icon icon='mdi:weather-rainy' aria-hidden />
                    {entry.precipitation_probability}%
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className='quick-weather-card__forecast-empty'>
            Hourly and daily forecast appear here when your weather integration provides them.
          </p>
        )}
      </div>
    </div>
  );
}
