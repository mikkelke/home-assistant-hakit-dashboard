/** What a room card's surface shows: the glow of its lights, frost at an open exterior opening while
 * it is cold out, and sleep. Pure. Rooms are HA area ids, except light lookups, which use the area
 * name's display key like `ROOM_LIGHTS` does (Claudia's room: area `office`, key `claudias_room`). */
import { roomFeelSensorId } from '../config/entities';
import { ROOM_LIGHTS } from '../config/lights';
import { asleepMembers, type StateReader } from './household';

export type AmbientEntity = { state: string; attributes?: Record<string, unknown> };
export type EntityReader = (entityId: string) => AmbientEntity | undefined;

export type Rgb = readonly [number, number, number];

/** Kelvin a light without colour temperature or colour counts as. */
export const PLAIN_LIGHT_KELVIN = 2700;

/** Glow alpha from a room at no brightness to all its lights at full. */
export const GLOW_ALPHA = { min: 0.08, max: 0.4 } as const;

const clampByte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

/** Black-body colour at `kelvin`, clamped to 1000 to 40000 K (Tanner Helland's fit). */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = Math.min(40_000, Math.max(1_000, Number.isFinite(kelvin) ? kelvin : PLAIN_LIGHT_KELVIN)) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clampByte(red), clampByte(green), clampByte(blue)];
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** `color_temp_kelvin` in colour-temperature mode, else `rgb_color` (xy, hs and rgb modes), else
 * the plain-light kelvin. */
export function lightRgb(light: AmbientEntity): Rgb {
  const attributes = light.attributes ?? {};
  const kelvin = attributes.color_temp_kelvin;
  if ((attributes.color_mode === 'color_temp' || attributes.color_mode == null) && isFiniteNumber(kelvin)) return kelvinToRgb(kelvin);
  const rgb = attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every(isFiniteNumber)) return [clampByte(rgb[0]), clampByte(rgb[1]), clampByte(rgb[2])];
  return kelvinToRgb(PLAIN_LIGHT_KELVIN);
}

/** Share of full brightness, 0 to 1; a light without a brightness counts as full. */
function brightnessShare(light: AmbientEntity): number {
  const brightness = light.attributes?.brightness;
  return isFiniteNumber(brightness) ? Math.min(1, Math.max(0, brightness / 255)) : 1;
}

export interface RoomGlow {
  rgb: Rgb;
  alpha: number;
}

/** The colour of the lights that are on, weighted by brightness, with an alpha by the room's share
 * of full brightness over its lights that report on or off. Null with no light on. */
export function roomGlow(lights: readonly (AmbientEntity | undefined)[]): RoomGlow | null {
  const known = lights.filter((light): light is AmbientEntity => light?.state === 'on' || light?.state === 'off');
  const on = known.filter(light => light.state === 'on');
  if (on.length === 0) return null;
  const weights = on.map(brightnessShare);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const colours = on.map(lightRgb);
  const channel = (i: 0 | 1 | 2) =>
    total > 0
      ? colours.reduce((sum, colour, k) => sum + colour[i] * weights[k], 0) / total
      : colours.reduce((sum, colour) => sum + colour[i], 0) / colours.length;
  const alpha = GLOW_ALPHA.min + (GLOW_ALPHA.max - GLOW_ALPHA.min) * (total / known.length);
  return { rgb: [clampByte(channel(0)), clampByte(channel(1)), clampByte(channel(2))], alpha: Math.round(alpha * 1000) / 1000 };
}

/** `ROOM_LIGHTS` key of an area's display name ("Claudias Room" -> `claudias_room`). */
export function roomDisplayKey(areaName: string): string {
  return areaName.toLowerCase().replace(/\s+/g, '_');
}

export function roomLightIds(areaName: string): readonly string[] {
  return ROOM_LIGHTS[roomDisplayKey(areaName)] ?? [];
}

/** Exterior windows and doors per HA area id. A rooftop door counts for the room it opens from and
 * for the Rooftop. */
export const AREA_EXTERIOR_CONTACTS: Readonly<Record<string, readonly string[]>> = {
  bathroom: ['binary_sensor.bathroom_window_contact'],
  bedroom: ['binary_sensor.bedroom_window_contact'],
  dining_room: [
    'binary_sensor.dining_room_window_1_contact',
    'binary_sensor.dining_room_window_2_contact',
    'binary_sensor.dining_room_window_3_contact',
  ],
  kitchen: ['binary_sensor.kitchen_window_contact'],
  kristines_room: ['binary_sensor.kristines_room_window_contact'],
  living_room: ['binary_sensor.living_room_window_contact', 'binary_sensor.rooftop_door_1_contact'],
  office: ['binary_sensor.rooftop_door_2_contact'],
  rooftop: ['binary_sensor.rooftop_door_1_contact', 'binary_sensor.rooftop_door_2_contact'],
};

const hasReading = (entity: AmbientEntity | undefined) =>
  entity != null && entity.state !== '' && entity.state !== 'unknown' && entity.state !== 'unavailable';

/** Any of the area's exterior contacts reads open. Only when none of them reads on or off does the
 * area's feel sensor's `window_open` decide. */
export function isAreaOpen(areaId: string, read: EntityReader): boolean {
  const states = (AREA_EXTERIOR_CONTACTS[areaId] ?? []).map(id => read(id)?.state);
  if (states.includes('on')) return true;
  if (states.includes('off')) return false;
  const feelId = roomFeelSensorId(areaId);
  const feel = feelId ? read(feelId) : undefined;
  const windowOpen = feel?.attributes?.window_open;
  return hasReading(feel) && (windowOpen === true || windowOpen === 'true');
}

/** Outdoor °C below which an open opening shows frost. */
export const FROST_BELOW_C = 12;

/** Frost: the area is open and it is colder out than `FROST_BELOW_C`. The outdoor temperature is
 * only asked for while the area is open. */
export function isAreaFrosty(areaId: string, read: EntityReader, outdoorC: () => number | null): boolean {
  if (!isAreaOpen(areaId, read)) return false;
  const tempC = outdoorC();
  return tempC != null && tempC < FROST_BELOW_C;
}

/** The roof station stops being the outdoor reading once neither its temperature nor its wind has
 * changed for longer than this many minutes. */
export const STATION_QUIET_MIN = 30;

export interface OutdoorTemperatureInput {
  stationC: number | null;
  /** last_changed of the station's temperature and wind sensors, epoch ms. */
  stationChangedMs: readonly number[];
  forecastC: number | null;
  nowMs: number;
}

export interface OutdoorTemperature {
  tempC: number | null;
  source: 'roof' | 'forecast' | null;
  /** Minutes since the station last changed, when it is quiet; else null. */
  quietMin: number | null;
}

/** The roof reading while the station is live, the forecast while it is quiet; either one when the
 * other is missing. */
export function pickOutdoorTemperature({ stationC, stationChangedMs, forecastC, nowMs }: OutdoorTemperatureInput): OutdoorTemperature {
  const changed = stationChangedMs.filter(Number.isFinite);
  const ageMin = changed.length > 0 ? Math.round((nowMs - Math.max(...changed)) / 60_000) : null;
  const quietMin = ageMin != null && ageMin > STATION_QUIET_MIN ? ageMin : null;
  if (quietMin != null && forecastC != null) return { tempC: forecastC, source: 'forecast', quietMin };
  if (stationC != null) return { tempC: stationC, source: 'roof', quietMin };
  return forecastC != null ? { tempC: forecastC, source: 'forecast', quietMin } : { tempC: null, source: null, quietMin };
}

/** Area ids whose occupant is in sleep mode. */
export function asleepAreaIds(readState: StateReader): Set<string> {
  return new Set(asleepMembers(readState).map(member => member.roomAreaId));
}
