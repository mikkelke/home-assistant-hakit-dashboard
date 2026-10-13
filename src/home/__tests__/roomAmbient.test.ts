import { describe, expect, it, vi } from 'vitest';
import { home } from '../../energy/__tests__/testUtils';
import { asleepMembers, HOUSEHOLD, isHouseNight, isNightHour } from '../household';
import {
  AREA_EXTERIOR_CONTACTS,
  asleepAreaIds,
  GLOW_ALPHA,
  isAreaFrosty,
  isAreaOpen,
  kelvinToRgb,
  lightRgb,
  pickOutdoorTemperature,
  roomDisplayKey,
  roomGlow,
  roomLightIds,
  type AmbientEntity,
  type EntityReader,
} from '../roomAmbient';

const DOOR_1 = 'binary_sensor.rooftop_door_1_contact';
const DOOR_2 = 'binary_sensor.rooftop_door_2_contact';

/** Every exterior contact closed, the feel sensors quiet, then the overrides. */
function house(overrides: Record<string, AmbientEntity> = {}): EntityReader {
  const entities: Record<string, AmbientEntity> = {};
  for (const ids of Object.values(AREA_EXTERIOR_CONTACTS)) for (const id of ids) entities[id] = { state: 'off' };
  Object.assign(entities, overrides);
  return id => entities[id];
}

const states = (on: string[]) => (id: string) => (on.includes(id) ? 'on' : 'off');

describe('kelvinToRgb', () => {
  it('is white at 6600 K and warm at 2700 K', () => {
    expect(kelvinToRgb(6600)).toEqual([255, 255, 255]);
    expect(kelvinToRgb(2700)).toEqual([255, 167, 87]);
    expect(kelvinToRgb(2200)).toEqual([255, 146, 39]);
    expect(kelvinToRgb(4000)).toEqual([255, 206, 166]);
  });

  it('cools steadily from candle to daylight', () => {
    const blues = [2000, 2500, 3000, 4000, 5000, 6000].map(k => kelvinToRgb(k)[2]);
    expect(blues).toEqual([...blues].sort((a, b) => a - b));
    expect(new Set(blues).size).toBe(blues.length);
  });

  it('clamps out-of-range and missing values', () => {
    expect(kelvinToRgb(500)).toEqual(kelvinToRgb(1000));
    expect(kelvinToRgb(90_000)).toEqual(kelvinToRgb(40_000));
    expect(kelvinToRgb(Number.NaN)).toEqual(kelvinToRgb(2700));
  });
});

describe('roomGlow', () => {
  const ct = (kelvin: number, brightness?: number): AmbientEntity => ({
    state: 'on',
    attributes: {
      color_mode: 'color_temp',
      color_temp_kelvin: kelvin,
      rgb_color: [255, 0, 0],
      ...(brightness != null ? { brightness } : {}),
    },
  });

  it('is null with every light off or unavailable', () => {
    expect(roomGlow([])).toBeNull();
    expect(roomGlow([{ state: 'off' }, { state: 'unavailable' }, undefined])).toBeNull();
  });

  it('takes the hue from colour temperature, rgb_color in xy mode, else 2700 K', () => {
    expect(lightRgb(ct(4000))).toEqual(kelvinToRgb(4000));
    expect(lightRgb({ state: 'on', attributes: { color_mode: 'xy', rgb_color: [255, 120, 40], color_temp_kelvin: 6500 } })).toEqual([
      255, 120, 40,
    ]);
    expect(lightRgb({ state: 'on', attributes: { color_mode: 'onoff' } })).toEqual(kelvinToRgb(2700));
    expect(lightRgb({ state: 'on', attributes: { color_mode: 'brightness', brightness: 255 } })).toEqual(kelvinToRgb(2700));
  });

  it('maps brightness onto alpha from 0.08 to 0.40', () => {
    expect(roomGlow([ct(2700, 255)])).toEqual({ rgb: kelvinToRgb(2700), alpha: GLOW_ALPHA.max });
    expect(roomGlow([ct(2700, 0)])?.alpha).toBe(GLOW_ALPHA.min);
    expect(roomGlow([ct(2700, 51)])?.alpha).toBe(0.144);
    expect(roomGlow([{ state: 'on', attributes: { color_mode: 'onoff' } }])?.alpha).toBe(GLOW_ALPHA.max);
  });

  it('counts the room share over the lights that report, and weights the hue by brightness', () => {
    const glow = roomGlow([ct(2200, 255), { state: 'off' }, { state: 'unavailable' }, ct(6600, 85)]);
    expect(glow?.alpha).toBe(0.222);
    const warm = kelvinToRgb(2200);
    expect(glow?.rgb).toEqual([255, Math.round((warm[1] * 3 + 255) / 4), Math.round((warm[2] * 3 + 255) / 4)]);
  });

  it('looks lights up by display key, not area id', () => {
    expect(roomDisplayKey('Claudias Room')).toBe('claudias_room');
    expect(roomLightIds('Claudias Room')).toEqual(['light.claudias_room_ceiling_lights', 'light.claudias_room_string_lights']);
    expect(roomLightIds('office')).toEqual([]);
    expect(roomLightIds('Living room')).toHaveLength(3);
  });
});

describe('exterior openings and frost', () => {
  it('opens the living room on rooftop door 1 while its window is closed', () => {
    const read = house({ [DOOR_1]: { state: 'on' } });
    expect(isAreaOpen('living_room', read)).toBe(true);
    expect(isAreaOpen('office', read)).toBe(false);
    expect(isAreaOpen('rooftop', read)).toBe(true);
  });

  it("opens Claudia's room, area office, on rooftop door 2", () => {
    const read = house({ [DOOR_2]: { state: 'on' } });
    expect(isAreaOpen('office', read)).toBe(true);
    expect(isAreaOpen('claudias_room', read)).toBe(false);
    expect(isAreaOpen('living_room', read)).toBe(false);
    expect(isAreaOpen('rooftop', read)).toBe(true);
  });

  it('opens a room on any of its windows', () => {
    const read = house({
      'binary_sensor.dining_room_window_1_contact': { state: 'unavailable' },
      'binary_sensor.dining_room_window_3_contact': { state: 'on' },
    });
    expect(isAreaOpen('dining_room', read)).toBe(true);
    expect(isAreaOpen('kitchen', read)).toBe(false);
  });

  it("falls back to the feel sensor only when none of the room's contacts reads", () => {
    const feelOpen = { state: '21.0', attributes: { window_open: 'true' } };
    expect(isAreaOpen('hallway', house({ 'sensor.hallway_feel': feelOpen }))).toBe(true);
    expect(isAreaOpen('bathroom', house({ 'sensor.bathroom_feel': feelOpen }))).toBe(false);
    expect(
      isAreaOpen('bathroom', house({ 'sensor.bathroom_feel': feelOpen, 'binary_sensor.bathroom_window_contact': { state: 'unavailable' } }))
    ).toBe(true);
    expect(isAreaOpen('hallway', house({ 'sensor.hallway_feel': { state: 'unavailable', attributes: { window_open: 'true' } } }))).toBe(
      false
    );
    expect(isAreaOpen('office', house({ [DOOR_2]: { state: 'unknown' }, 'sensor.claudias_room_feel': feelOpen }))).toBe(true);
  });

  it('shows frost only below 12 °C, and reads the outdoor temperature only while open', () => {
    const open = house({ 'binary_sensor.bedroom_window_contact': { state: 'on' } });
    expect(isAreaFrosty('bedroom', open, () => 11.9)).toBe(true);
    expect(isAreaFrosty('bedroom', open, () => 12)).toBe(false);
    expect(isAreaFrosty('bedroom', open, () => null)).toBe(false);
    const outdoor = vi.fn(() => 4.8);
    expect(isAreaFrosty('kitchen', open, outdoor)).toBe(false);
    expect(outdoor).not.toHaveBeenCalled();
  });
});

describe('pickOutdoorTemperature', () => {
  const nowMs = Date.parse('2026-10-13T13:34:00Z');
  const minutesAgo = (min: number) => nowMs - min * 60_000;

  it('uses the roof while either station sensor changed in the last 30 minutes', () => {
    expect(pickOutdoorTemperature({ stationC: 9.4, stationChangedMs: [minutesAgo(50), minutesAgo(2)], forecastC: 12.1, nowMs })).toEqual({
      tempC: 9.4,
      source: 'roof',
      quietMin: null,
    });
    expect(pickOutdoorTemperature({ stationC: 9.4, stationChangedMs: [minutesAgo(30)], forecastC: 12.1, nowMs }).source).toBe('roof');
  });

  it('falls back to the forecast while the station is quiet', () => {
    expect(pickOutdoorTemperature({ stationC: 9.4, stationChangedMs: [minutesAgo(31), minutesAgo(45)], forecastC: 12.1, nowMs })).toEqual({
      tempC: 12.1,
      source: 'forecast',
      quietMin: 31,
    });
  });

  it('takes whichever reading exists', () => {
    expect(pickOutdoorTemperature({ stationC: 9.4, stationChangedMs: [minutesAgo(90)], forecastC: null, nowMs })).toEqual({
      tempC: 9.4,
      source: 'roof',
      quietMin: 90,
    });
    expect(pickOutdoorTemperature({ stationC: null, stationChangedMs: [], forecastC: 12.1, nowMs }).source).toBe('forecast');
    expect(pickOutdoorTemperature({ stationC: null, stationChangedMs: [Number.NaN], forecastC: null, nowMs })).toEqual({
      tempC: null,
      source: null,
      quietMin: null,
    });
  });
});

describe('sleep and night', () => {
  it('maps each person to their room by area id', () => {
    expect(HOUSEHOLD.map(member => [member.key, member.roomAreaId])).toEqual([
      ['mikkel', 'bedroom'],
      ['kristine', 'kristines_room'],
      ['claudia', 'office'],
    ]);
    expect(asleepAreaIds(states(['input_boolean.mikkel_sleep_mode', 'input_boolean.claudia_sleep_mode']))).toEqual(
      new Set(['bedroom', 'office'])
    );
    expect(asleepAreaIds(states([])).size).toBe(0);
    expect(asleepMembers(() => undefined)).toEqual([]);
  });

  it('counts 23:00 to 06:00 house time as night, across the autumn change', () => {
    expect(isNightHour(home(2026, 10, 13, 22, 59))).toBe(false);
    expect(isNightHour(home(2026, 10, 13, 23))).toBe(true);
    expect(isNightHour(home(2026, 10, 14, 5, 59))).toBe(true);
    expect(isNightHour(home(2026, 10, 14, 6))).toBe(false);
    expect(isNightHour(home(2026, 10, 25, 2, 30) + 3_600_000)).toBe(true);
    expect(isNightHour(home(2026, 10, 25, 6))).toBe(false);
  });

  it('is night by day while anyone sleeps', () => {
    const noon = home(2026, 10, 13, 12);
    expect(isHouseNight(noon, states([]))).toBe(false);
    expect(isHouseNight(noon, states(['input_boolean.kristine_sleep_mode']))).toBe(true);
  });
});
