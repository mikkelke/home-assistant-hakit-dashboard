import { describe, expect, it } from 'vitest';
import {
  CHART_DAYS,
  CHILL_BANDS,
  buildTerraceSeries,
  chillBand,
  compass16,
  dayTicks,
  formatTemp,
  frostFor,
  getNumber,
  getSeaTemperatureFeel,
  iceBathLevel,
  iceBathLine,
  iceBathPackedAway,
  iceBathRow,
  iceBathWord,
  iceWord,
  isPlausibleGustMs,
  temperatureAxis,
  terraceReadings,
  terraceSummary,
  toMetersPerSecond,
  windChillC,
} from '../terrace';
import {
  ICE_BATH_SENSOR,
  OUTDOOR_HUMIDITY_SENSOR,
  OUTDOOR_TEMP_SENSOR,
  OUTDOOR_WIND_DIRECTION_SENSOR,
  OUTDOOR_WIND_GUST_SENSOR,
  OUTDOOR_WIND_SPEED_SENSOR,
} from '../../config/entities';
import type { TempPoint } from '../../utils/temperatureHistory';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-25T12:00:00Z');

describe('formatTemp', () => {
  it('writes one decimal and a real minus sign', () => {
    expect(formatTemp(6)).toBe('6.0');
    expect(formatTemp(0.1)).toBe('0.1');
    expect(formatTemp(-3.14)).toBe('−3.1');
    expect(formatTemp(-10.34)).toBe('−10.3');
  });

  it('never writes a negative zero', () => {
    expect(formatTemp(0)).toBe('0.0');
    expect(formatTemp(-0.04)).toBe('0.0');
    expect(formatTemp(-0.06)).toBe('−0.1');
  });
});

describe('getNumber', () => {
  it('reads numbers and numeric text, and nothing else', () => {
    expect(getNumber('4.2')).toBe(4.2);
    expect(getNumber(0)).toBe(0);
    expect(getNumber('unavailable')).toBeUndefined();
    expect(getNumber('')).toBeUndefined();
    expect(getNumber(null)).toBeUndefined();
    expect(getNumber(undefined)).toBeUndefined();
  });
});

describe('frostFor', () => {
  it('is 0 from 10 degrees up, 1 from 0 down, and linear between', () => {
    expect(frostFor(25)).toBe(0);
    expect(frostFor(10)).toBe(0);
    expect(frostFor(5)).toBeCloseTo(0.5);
    expect(frostFor(0.1)).toBeCloseTo(0.99);
    expect(frostFor(0)).toBe(1);
    expect(frostFor(-4)).toBe(1);
  });
});

describe('iceBathWord', () => {
  it('climbs its own ladder up to 13 degrees', () => {
    expect(iceBathWord(-1)).toBe('ice cold');
    expect(iceBathWord(2.9)).toBe('ice cold');
    expect(iceBathWord(3)).toBe('baltic');
    expect(iceBathWord(5.9)).toBe('baltic');
    expect(iceBathWord(6)).toBe('cold');
    expect(iceBathWord(12.9)).toBe('cold');
  });

  it("hands over to the sea's words from 13 degrees, in lower case", () => {
    expect(iceBathWord(13)).toBe('fresh');
    expect(iceBathWord(17.9)).toBe('fresh');
    expect(iceBathWord(18)).toBe('pleasant');
    expect(iceBathWord(22)).toBe('warm');
    expect(iceBathWord(26)).toBe('very warm');
    for (const t of [13, 18, 22, 26, 30]) expect(iceBathWord(t)).toBe(getSeaTemperatureFeel(t)?.toLowerCase());
  });
});

describe('getSeaTemperatureFeel', () => {
  it('keeps the sea chip words and their limits', () => {
    expect(getSeaTemperatureFeel(undefined)).toBeUndefined();
    expect(getSeaTemperatureFeel(7.9)).toBe('Very cold');
    expect(getSeaTemperatureFeel(8)).toBe('Cold');
    expect(getSeaTemperatureFeel(12.9)).toBe('Cold');
    expect(getSeaTemperatureFeel(13)).toBe('Fresh');
    expect(getSeaTemperatureFeel(18)).toBe('Pleasant');
    expect(getSeaTemperatureFeel(22)).toBe('Warm');
    expect(getSeaTemperatureFeel(26)).toBe('Very warm');
  });
});

describe('iceBathRow', () => {
  const attributes = (rows: unknown[], expires = '2026-11-25T12:15:00+00:00') => ({ expires, rows });
  const ICE = {
    id: 'ice:bath',
    kind: 'rain',
    title: 'Ice bath: thin ice at 0.1 C since 03:10',
    icon: 'mdi:snowflake',
    area: 'rooftop',
    level: 'thin',
  };
  const RAIN = { id: 'rain:terrace', kind: 'rain', title: 'Rain forecast', area: 'living_room' };

  it("finds the publisher's row among the others", () => {
    expect(iceBathRow(attributes([RAIN, ICE]), NOW)?.title).toBe('Ice bath: thin ice at 0.1 C since 03:10');
  });

  it('finds nothing when only other rows are there', () => {
    expect(iceBathRow(attributes([RAIN]), NOW)).toBeNull();
    expect(iceBathRow(attributes([]), NOW)).toBeNull();
  });

  it('finds nothing once the publisher has stopped and its lease has run out', () => {
    expect(iceBathRow(attributes([ICE], '2026-11-25T11:59:00+00:00'), NOW)).toBeNull();
  });

  it('finds nothing without attributes', () => {
    expect(iceBathRow(undefined, NOW)).toBeNull();
    expect(iceBathRow({}, NOW)).toBeNull();
  });
});

describe('iceBathLevel', () => {
  const row = (extra: Record<string, string> = {}) => {
    const rows = [{ id: 'ice:bath', kind: 'rain', title: 'Ice bath: thick ice at 0.1 C since 03:10', ...extra }];
    return iceBathRow({ expires: '2026-11-25T12:15:00+00:00', rows }, NOW);
  };

  it('is the level the row names', () => {
    expect(iceBathLevel(row({ level: 'thick' }))).toBe('thick');
    expect(iceBathLevel(row({ level: 'thin' }))).toBe('thin');
  });

  it('is thin for a row that names none, as the publisher had one rule before it told two levels apart', () => {
    expect(iceBathLevel(row())).toBe('thin');
    expect(iceBathLevel(row({ level: 'slush' }))).toBe('thin');
  });

  it('is none without a row', () => {
    expect(iceBathLevel(null)).toBeNull();
  });
});

describe('iceWord', () => {
  it('names the ice by its level', () => {
    expect(iceWord('thin')).toBe('thin ice');
    expect(iceWord('thick')).toBe('thick ice');
  });

  it('starts with a capital when asked', () => {
    expect(iceWord('thin', true)).toBe('Thin ice');
    expect(iceWord('thick', true)).toBe('Thick ice');
  });
});

describe('iceBathLine', () => {
  const line = (title: string) => iceBathLine({ title } as Parameters<typeof iceBathLine>[0]);

  it('drops the label and the level the badge above it says already', () => {
    expect(line('Ice bath: thin ice at 0.1 C since 03:10')).toBe('At 0.1 C since 03:10');
    expect(line('Ice bath: thick ice at -0.2 C since 25.11 22:40')).toBe('At -0.2 C since 25.11 22:40');
  });

  it('reads a row from before the two levels the same', () => {
    expect(line('Ice bath at 0.1 C since 03:10')).toBe('At 0.1 C since 03:10');
  });

  it('leaves any other title alone', () => {
    expect(line('Rain forecast')).toBe('Rain forecast');
  });
});

describe('iceBathPackedAway', () => {
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const sensor = (state: string, updatedMsAgo: number, reportedMsAgo?: number) => ({
    state,
    last_updated: ago(updatedMsAgo),
    ...(reportedMsAgo === undefined ? {} : { last_reported: ago(reportedMsAgo) }),
  });

  it('is out while the sensor reports', () => {
    expect(iceBathPackedAway(sensor('0.4', 2 * 60_000), NOW)).toBe(false);
  });

  it('is still out after 11 hours without an update', () => {
    expect(iceBathPackedAway(sensor('0.4', 11 * HOUR), NOW)).toBe(false);
  });

  it('is packed away after 13 hours without an update', () => {
    expect(iceBathPackedAway(sensor('0.4', 13 * HOUR), NOW)).toBe(true);
  });

  it('is still out at exactly 12 hours and packed away just after', () => {
    expect(iceBathPackedAway(sensor('0.4', 12 * HOUR), NOW)).toBe(false);
    expect(iceBathPackedAway(sensor('0.4', 12 * HOUR + 1), NOW)).toBe(true);
  });

  it('is packed away when the sensor is missing', () => {
    expect(iceBathPackedAway(undefined, NOW)).toBe(true);
  });

  it('keeps the bath out through an outage, which the sensor reports as unavailable', () => {
    expect(iceBathPackedAway(sensor('unavailable', 3 * HOUR), NOW)).toBe(false);
    expect(iceBathPackedAway(sensor('unknown', 3 * HOUR), NOW)).toBe(false);
  });

  it('is packed away once it has been unavailable or unknown for 13 hours', () => {
    expect(iceBathPackedAway(sensor('unavailable', 13 * HOUR), NOW)).toBe(true);
    expect(iceBathPackedAway(sensor('unknown', 13 * HOUR), NOW)).toBe(true);
  });

  it('follows the newer of last_updated and last_reported, since a steady reading only moves the second', () => {
    expect(iceBathPackedAway(sensor('0.0', 20 * HOUR, 5 * 60_000), NOW)).toBe(false);
    expect(iceBathPackedAway(sensor('0.0', 20 * HOUR, 14 * HOUR), NOW)).toBe(true);
    expect(iceBathPackedAway(sensor('0.0', 2 * HOUR, 20 * HOUR), NOW)).toBe(false);
  });

  it('ignores a timestamp it cannot read', () => {
    expect(iceBathPackedAway({ state: '0.4', last_updated: 'yesterday', last_reported: ago(HOUR) }, NOW)).toBe(false);
    expect(iceBathPackedAway({ state: '0.4', last_updated: 'yesterday', last_reported: ago(13 * HOUR) }, NOW)).toBe(true);
  });

  it('reads the age as unknown without timestamps: a reading keeps the bath out, none puts it away', () => {
    expect(iceBathPackedAway({ state: '0.4' }, NOW)).toBe(false);
    expect(iceBathPackedAway({ state: 'unavailable' }, NOW)).toBe(true);
    expect(iceBathPackedAway({ state: 'unknown', last_updated: 'never' }, NOW)).toBe(true);
    expect(iceBathPackedAway({}, NOW)).toBe(true);
  });

  it('is not fooled by a timestamp ahead of the clock', () => {
    expect(iceBathPackedAway(sensor('0.4', -5 * 60_000), NOW)).toBe(false);
  });
});

describe('terraceSummary', () => {
  it('names the water with its word, then the air and how it feels', () => {
    expect(terraceSummary({ waterC: 6, iceLevel: null, airC: 4.2, feelsC: 0 })).toBe('Ice bath 6.0° cold · air 4.2° · feels 0.0°');
  });

  it('says how thick the ice is once, in place of the word for the water', () => {
    expect(terraceSummary({ waterC: 0.3, iceLevel: 'thin', airC: -2, feelsC: -6.04 })).toBe(
      'Ice bath 0.3° · Thin ice · air −2.0° · feels −6.0°'
    );
    expect(terraceSummary({ waterC: 0.1, iceLevel: 'thick', airC: -2, feelsC: -6.04 })).toBe(
      'Ice bath 0.1° · Thick ice · air −2.0° · feels −6.0°'
    );
  });

  it('leaves out what has no reading', () => {
    expect(terraceSummary({ waterC: 6, iceLevel: null, airC: null, feelsC: null })).toBe('Ice bath 6.0° cold');
    expect(terraceSummary({ waterC: 6, iceLevel: null, airC: 12.5, feelsC: null })).toBe('Ice bath 6.0° cold · air 12.5°');
    expect(terraceSummary({ waterC: null, iceLevel: 'thick', airC: -2, feelsC: null })).toBe('Thick ice · air −2.0°');
  });

  it('starts with a capital when the water is left out', () => {
    expect(terraceSummary({ waterC: null, iceLevel: null, airC: 4.2, feelsC: 1.7 })).toBe('Air 4.2° · feels 1.7°');
  });

  it('is empty when nothing has a reading', () => {
    expect(terraceSummary({ waterC: null, iceLevel: null, airC: null, feelsC: null })).toBe('');
  });
});

describe('toMetersPerSecond', () => {
  it('converts by the unit it is given', () => {
    expect(toMetersPerSecond('36', 'km/h')).toBeCloseTo(10);
    expect(toMetersPerSecond('10', 'm/s')).toBe(10);
    expect(toMetersPerSecond('10', 'mph')).toBeCloseTo(4.4704);
    expect(toMetersPerSecond('10', 'kn')).toBeCloseTo(5.14444);
    expect(toMetersPerSecond('gust', 'km/h')).toBeUndefined();
  });
});

describe('compass16', () => {
  it('names the sixteen points', () => {
    expect(compass16(0)).toBe('N');
    expect(compass16(11.2)).toBe('N');
    expect(compass16(11.3)).toBe('NNE');
    expect(compass16(90)).toBe('E');
    expect(compass16(337.5)).toBe('NNW');
    expect(compass16(359)).toBe('N');
    expect(compass16(-90)).toBe('W');
    expect(compass16(450)).toBe('E');
  });
});

describe('isPlausibleGustMs', () => {
  it('rejects the stations bogus spikes and keeps ordinary gusts', () => {
    expect(isPlausibleGustMs(143 / 3.6, 9 / 3.6)).toBe(false);
    expect(isPlausibleGustMs(111 / 3.6, 100 / 3.6)).toBe(false);
    expect(isPlausibleGustMs(13 / 3.6, 7.8 / 3.6)).toBe(true);
    expect(isPlausibleGustMs(5, 0)).toBe(true);
  });
});

describe('terraceReadings', () => {
  const entities = (overrides: Record<string, { state: string; attributes?: Record<string, unknown> }> = {}) => ({
    [ICE_BATH_SENSOR]: { state: '0.1' },
    [OUTDOOR_TEMP_SENSOR]: { state: '-3.1' },
    [OUTDOOR_HUMIDITY_SENSOR]: { state: '79' },
    [OUTDOOR_WIND_SPEED_SENSOR]: { state: '28.08', attributes: { unit_of_measurement: 'km/h' } },
    [OUTDOOR_WIND_GUST_SENSOR]: { state: '48.24', attributes: { unit_of_measurement: 'km/h' } },
    [OUTDOOR_WIND_DIRECTION_SENSOR]: { state: '330' },
    ...overrides,
  });

  it('reads every sensor, the wind in m/s', () => {
    const readings = terraceReadings(entities());
    expect(readings.waterC).toBe(0.1);
    expect(readings.airC).toBe(-3.1);
    expect(readings.humidityPct).toBe(79);
    expect(readings.windMs).toBeCloseTo(7.8);
    expect(readings.gustMs).toBeCloseTo(13.4);
    expect(readings.fromDeg).toBe(330);
  });

  it('takes a wind sensor without a unit for km/h, and a named unit for what it says', () => {
    expect(terraceReadings(entities({ [OUTDOOR_WIND_SPEED_SENSOR]: { state: '36' } })).windMs).toBeCloseTo(10);
    expect(
      terraceReadings(entities({ [OUTDOOR_WIND_SPEED_SENSOR]: { state: '10', attributes: { unit_of_measurement: 'm/s' } } })).windMs
    ).toBe(10);
  });

  it('leaves out a gust that is not plausible', () => {
    const readings = terraceReadings(
      entities({ [OUTDOOR_WIND_GUST_SENSOR]: { state: '143', attributes: { unit_of_measurement: 'km/h' } } })
    );
    expect(readings.gustMs).toBeNull();
    expect(readings.windMs).toBeCloseTo(7.8);
  });

  it('gives null for a sensor that is missing, unknown or unavailable', () => {
    const readings = terraceReadings({ [ICE_BATH_SENSOR]: { state: 'unavailable' }, [OUTDOOR_TEMP_SENSOR]: { state: 'unknown' } });
    expect(readings).toEqual({ waterC: null, airC: null, humidityPct: null, windMs: null, gustMs: null, fromDeg: null });
  });
});

describe('windChillC', () => {
  // The Environment Canada and NWS formula of 2001.
  it('gives the published values', () => {
    expect(windChillC(-10, 20)).toBeCloseTo(-17.86, 1);
    expect(windChillC(0, 10)).toBeCloseTo(-3.31, 1);
    expect(windChillC(-20, 30)).toBeCloseTo(-32.56, 1);
  });

  it("matches the roof station's own feels-like reading", () => {
    expect(windChillC(1.9, 13.68)).toBeCloseTo(-1.83, 1);
  });

  it('is valid from 10 degrees down and above 4.8 km/h, and feels like the air outside that', () => {
    expect(windChillC(10, 20)).toBeLessThan(10);
    expect(windChillC(10.1, 20)).toBe(10.1);
    expect(windChillC(-5, 4.81)).toBeLessThan(-5);
    expect(windChillC(-5, 4.8)).toBe(-5);
    expect(windChillC(-5, 0)).toBe(-5);
  });
});

describe('chillBand', () => {
  it('names the band by the felt temperature', () => {
    expect(chillBand(12)).toBe('chilly');
    expect(chillBand(0.1)).toBe('chilly');
    expect(chillBand(0)).toBe('cold');
    expect(chillBand(-9)).toBe('cold');
    expect(chillBand(-9.9)).toBe('cold');
    expect(chillBand(-10)).toBe('biting');
    expect(chillBand(-27)).toBe('biting');
    expect(chillBand(-27.9)).toBe('biting');
    expect(chillBand(-28)).toBe('frostbite');
    expect(chillBand(-40)).toBe('frostbite');
  });

  it('has a step on the bar for each band, lowest first', () => {
    expect(CHILL_BANDS.map(step => step.band)).toEqual(['chilly', 'cold', 'biting', 'frostbite']);
    expect(CHILL_BANDS.map(step => step.label)).toEqual(['chilly', 'cold', 'biting', 'frostbite risk']);
  });
});

describe('buildTerraceSeries', () => {
  /** One point an hour from `fromMs` up to the hour before `NOW`, each at `value(hoursBeforeNow)`. */
  const hourly = (fromMs: number, value: (hoursBeforeNow: number) => number): TempPoint[] => {
    const points: TempPoint[] = [];
    for (let ts = fromMs; ts < NOW; ts += HOUR) points.push({ ts, value: value((NOW - ts) / HOUR) });
    return points;
  };

  it('cuts the week out of the eight days it was given', () => {
    const series = buildTerraceSeries({
      water: hourly(NOW - 8 * DAY, () => 2),
      air: hourly(NOW - 8 * DAY, () => -1),
      waterNow: null,
      airNow: null,
      nowMs: NOW,
    });
    expect(series.endMs).toBe(NOW);
    expect(series.startMs).toBe(NOW - CHART_DAYS * DAY);
    for (const line of [series.water, series.air, series.airMean]) {
      expect(line[0].ts).toBeGreaterThanOrEqual(series.startMs);
      expect(line.at(-1)!.ts).toBeLessThan(NOW);
    }
    expect(series.water).toHaveLength(7 * 24);
  });

  it("makes the mean's first point of the week a whole day's mean, from the day before the week", () => {
    // 5 degrees on the day before the week, -5 on every day in it: a mean that only saw the week would start at -5.
    const air = hourly(NOW - 8 * DAY, hoursBefore => (hoursBefore > (7 * DAY) / HOUR ? 5 : -5));
    const series = buildTerraceSeries({ water: [], air, waterNow: null, airNow: null, nowMs: NOW });
    expect(series.airMean[0].value).toBeGreaterThan(-5);
    expect(series.airMean.at(-1)!.value).toBeCloseTo(-5);
  });

  it('holds each line to now at its live reading, and only when it knows it', () => {
    const water = hourly(NOW - 8 * DAY, () => 2);
    const air = hourly(NOW - 8 * DAY, () => -1);
    const held = buildTerraceSeries({ water, air, waterNow: 0.1, airNow: -3.1, nowMs: NOW });
    expect(held.water.at(-1)).toEqual({ ts: NOW, value: 0.1 });
    expect(held.air.at(-1)).toEqual({ ts: NOW, value: -3.1 });
    expect(held.airMean.at(-1)!.ts).toBe(NOW);
    const unknown = buildTerraceSeries({ water, air, waterNow: null, airNow: null, nowMs: NOW });
    expect(unknown.water.at(-1)!.ts).toBeLessThan(NOW);
  });

  it('draws nothing from nothing', () => {
    const series = buildTerraceSeries({ water: [], air: [], waterNow: 1, airNow: 1, nowMs: NOW });
    expect(series.water).toEqual([]);
    expect(series.air).toEqual([]);
    expect(series.airMean).toEqual([]);
  });
});

describe('temperatureAxis', () => {
  const intervals = (axis: { lo: number; hi: number; ticks: number[] }) => axis.ticks.length - 1;

  it('always holds 0 degrees, whatever the values are', () => {
    for (const values of [[4, 9], [-6, -2], [-3, 8], [], [0]]) {
      const axis = temperatureAxis(values);
      expect(axis.lo).toBeLessThan(0);
      expect(axis.hi).toBeGreaterThan(0);
      expect(axis.ticks).toContain(0);
    }
  });

  it('holds every value, with a gridline on each step and at most seven intervals', () => {
    for (const values of [
      [-7.8, 6.2],
      [0.3, 11.4],
      [-26, 14],
      [-2.5, 3.5],
      [18.2, 24.9],
    ]) {
      const axis = temperatureAxis(values);
      expect(axis.lo).toBeLessThanOrEqual(Math.min(...values));
      expect(axis.hi).toBeGreaterThanOrEqual(Math.max(...values));
      expect(intervals(axis)).toBeLessThanOrEqual(7);
      expect(axis.ticks[0]).toBe(axis.lo);
      expect(axis.ticks.at(-1)).toBe(axis.hi);
      const step = axis.ticks[1] - axis.ticks[0];
      expect([1, 2, 5, 10, 20]).toContain(step);
      axis.ticks.forEach((tick, i) => expect(tick).toBe(axis.lo + i * step));
    }
  });

  it('takes the finest step that keeps to seven intervals', () => {
    const narrow = temperatureAxis([-2, 3]);
    expect(narrow.ticks[1] - narrow.ticks[0]).toBe(1);
    const wide = temperatureAxis([-26, 14]);
    expect(wide.ticks[1] - wide.ticks[0]).toBe(10);
  });
});

describe('dayTicks', () => {
  it('has a line at each local midnight inside the span, named by the weekday that starts there', () => {
    const start = NOW - 7 * DAY;
    const ticks = dayTicks(start, NOW);
    expect(ticks.length).toBeGreaterThanOrEqual(6);
    expect(ticks.length).toBeLessThanOrEqual(7);
    let previous = start;
    for (const tick of ticks) {
      const at = new Date(tick.ts);
      expect([at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([0, 0, 0]);
      expect(tick.ts).toBeGreaterThan(previous);
      expect(tick.ts).toBeLessThan(NOW);
      expect(tick.label).toBe(at.toLocaleDateString('en-GB', { weekday: 'short' }));
      previous = tick.ts;
    }
  });

  it('is empty for a span inside one day', () => {
    const midday = new Date(2026, 10, 25, 12).getTime();
    expect(dayTicks(midday, midday + HOUR)).toEqual([]);
  });
});
