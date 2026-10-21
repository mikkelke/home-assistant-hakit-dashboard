import type { HouseBuilder } from './builder';
import { DAY, HOUR, MINUTE, dailyWave, iso, rng } from './time';

const CONDITIONS = ['cloudy', 'rainy', 'partlycloudy', 'cloudy', 'pouring', 'partlycloudy', 'sunny', 'cloudy'];

function dailyForecast(now: number) {
  const noise = rng(31);
  const start = Math.floor(now / DAY) * DAY + 10 * HOUR;
  return Array.from({ length: 8 }, (_, day) => {
    const high = 11 + Math.round(noise() * 4);
    return {
      datetime: iso(start + (day + 1) * DAY),
      condition: CONDITIONS[day % CONDITIONS.length],
      temperature: high,
      templow: high - 4 - Math.round(noise() * 2),
      precipitation: Math.round(noise() * 60) / 10,
      precipitation_probability: Math.round(noise() * 100),
      wind_speed: 14 + Math.round(noise() * 14),
      wind_bearing: 220 + Math.round(noise() * 60),
    };
  });
}

function hourlyForecast(now: number) {
  const noise = rng(57);
  const start = Math.ceil(now / HOUR) * HOUR;
  return Array.from({ length: 48 }, (_, hour) => ({
    datetime: iso(start + hour * HOUR),
    condition: hour % 9 < 3 ? 'rainy' : hour % 9 < 6 ? 'cloudy' : 'partlycloudy',
    temperature: Math.round((10.5 + Math.sin(((hour - 4) / 24) * Math.PI * 2) * 2 + noise()) * 10) / 10,
    precipitation: hour % 9 < 3 ? Math.round(noise() * 18) / 10 : 0,
    precipitation_probability: hour % 9 < 3 ? 70 + Math.round(noise() * 25) : Math.round(noise() * 30),
    wind_speed: 15 + Math.round(noise() * 12),
    wind_bearing: 230 + Math.round(noise() * 40),
  }));
}

export function addWeather(h: HouseBuilder): void {
  const { now } = h;
  h.put('sun.sun', 'below_horizon', {
    friendly_name: 'Sun',
    elevation: -7.8,
    azimuth: 262.1,
    rising: false,
    next_rising: iso(now + 12.9 * HOUR),
    next_setting: iso(now + 23.2 * HOUR),
    next_dawn: iso(now + 12.2 * HOUR),
    next_dusk: iso(now + 23.9 * HOUR),
  });
  h.put('weather.forecast_home', 'cloudy', {
    friendly_name: 'Forecast Home',
    temperature: 11.4,
    temperature_unit: '°C',
    humidity: 82,
    pressure: 1008.4,
    pressure_unit: 'hPa',
    wind_speed: 18,
    wind_speed_unit: 'km/h',
    wind_bearing: 240,
    cloud_coverage: 85,
    visibility: 24,
    visibility_unit: 'km',
    dew_point: 8.4,
    supported_features: 7,
  });
  const station: Array<[string, number, string, Record<string, unknown>]> = [
    ['outdoor_temperature', 10.8, 'Outdoor temperature', { unit_of_measurement: '°C', device_class: 'temperature' }],
    ['humidity', 83, 'Humidity', { unit_of_measurement: '%', device_class: 'humidity' }],
    ['wind_speed', 17.3, 'Wind speed', { unit_of_measurement: 'km/h', device_class: 'wind_speed' }],
    ['wind_gust', 28.1, 'Wind gust', { unit_of_measurement: 'km/h', device_class: 'wind_speed' }],
    ['wind_direction', 248, 'Wind direction', { unit_of_measurement: '°' }],
    ['rain_rate_piezo', 0, 'Rain rate', { unit_of_measurement: 'mm/h' }],
    ['daily_rain_piezo', 0.8, 'Daily rain', { unit_of_measurement: 'mm', device_class: 'precipitation' }],
    ['uv_index', 0, 'UV index', { unit_of_measurement: 'UV index' }],
    ['solar_radiation', 0, 'Solar radiation', { unit_of_measurement: 'W/m²' }],
    ['solar_lux', 0, 'Solar lux', { unit_of_measurement: 'lx', device_class: 'illuminance' }],
    ['relative_pressure', 1008.4, 'Relative pressure', { unit_of_measurement: 'hPa', device_class: 'pressure' }],
    ['absolute_pressure', 1006.9, 'Absolute pressure', { unit_of_measurement: 'hPa', device_class: 'pressure' }],
    ['dewpoint', 8.1, 'Dewpoint', { unit_of_measurement: '°C', device_class: 'temperature' }],
  ];
  for (const [id, value, name, attributes] of station) {
    h.put(`sensor.gw2000a_${id}`, value, { friendly_name: name, state_class: 'measurement', ...attributes }, { ago: 3 });
  }
  const outdoor = dailyWave(10.8, 2.6, 71);
  h.history['sensor.gw2000a_outdoor_temperature'] = Array.from({ length: 24 * 6 + 1 }, (_, step) => {
    const t = now - 24 * HOUR + step * 10 * MINUTE;
    return { t, state: String(step === 24 * 6 ? 10.8 : outdoor(t)) };
  });
  h.statistics['sensor.gw2000a_outdoor_temperature'] = (start, end) => {
    if (end > now || start < now - 8 * DAY) return null;
    const mean = outdoor(start + 30 * MINUTE);
    return { mean, min: mean - 0.3, max: mean + 0.3 };
  };
  h.put(
    'sensor.ecowitt_feels_like_temp_8351',
    9.2,
    { friendly_name: 'Feels like', unit_of_measurement: '°C', device_class: 'temperature' },
    { ago: 3 }
  );
  h.put('sensor.ecowitt_24h_rain_8351', 2.4, { friendly_name: '24 h rain', unit_of_measurement: 'mm' }, { ago: 3 });
  h.put(
    'sensor.kobenhavns_havn_ii_water_temperature',
    12.1,
    { friendly_name: 'Harbour water temperature', unit_of_measurement: '°C', device_class: 'temperature' },
    { ago: 20 }
  );
  h.put('binary_sensor.weather_opening_alert_active', 'off', { friendly_name: 'Opening alert' });
  h.put('binary_sensor.weather_opening_alert_window_rain', 'off', { friendly_name: 'Window rain alert' });
  h.put('binary_sensor.weather_opening_alert_rooftop_rain', 'off', { friendly_name: 'Rooftop rain alert' });
  h.put('sensor.weather_opening_alert_priority', 'none', { friendly_name: 'Opening alert priority' });
  h.put('sensor.weather_opening_alert_target_area', 'none', { friendly_name: 'Opening alert area' });

  h.ws['weather/subscribe_forecast'] = (message, context) => {
    context.event({ type: message.forecast_type, forecast: message.forecast_type === 'hourly' ? hourlyForecast(now) : dailyForecast(now) });
    return null;
  };

  h.rest.push({
    match: /api\.met\.no\/weatherapi\/locationforecast/,
    respond: () => {
      const start = Math.ceil(now / HOUR) * HOUR;
      const noise = rng(5);
      const timeseries = Array.from({ length: 70 }, (_, step) => {
        const at = start + step * 3 * HOUR;
        const cloudy = noise() > 0.4;
        const summary = {
          summary: { symbol_code: cloudy ? 'cloudy' : 'partlycloudy_day' },
          details: { precipitation_amount: cloudy ? 0.4 : 0 },
        };
        return {
          time: iso(at),
          data: {
            instant: { details: { air_temperature: 8 + noise() * 6, wind_speed: 3 + noise() * 6, wind_from_direction: 240 } },
            next_1_hours: summary,
            next_6_hours: { ...summary, details: { air_temperature_max: 12, air_temperature_min: 7, precipitation_amount: 0.6 } },
            next_12_hours: { summary: { symbol_code: 'cloudy' } },
          },
        };
      });
      return { body: JSON.stringify({ type: 'Feature', properties: { timeseries } }) };
    },
  });
}
