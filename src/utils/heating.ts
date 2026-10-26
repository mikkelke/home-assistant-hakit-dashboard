import type { HassEntities, HassEntity } from '../types';

/** The zones the AppDaemon heating controller plans, in display order. The bedroom has no zone. */
export const HEATING_ZONES = ['family', 'kristines_room', 'claudias_room', 'bathroom', 'guest_bathroom'] as const;
export type HeatingZone = (typeof HEATING_ZONES)[number];

export const HEATING_CONTROLLER_SENSOR = 'sensor.heating_controller';
export const HEATING_SEASON_SWITCH = 'input_boolean.heating_season';

/** Pipe clamps on the building's supply and return, in °C. */
export const HEATING_SUPPLY_TEMP_SENSOR = 'sensor.heating_room_floor_heating_supply';
export const HEATING_RETURN_TEMP_SENSOR = 'sensor.heating_room_floor_heating_return';

/** The bedroom is never heated and the controller has no zone for it, so it stays out of HEATING_ZONES. */
export const BEDROOM_THERMOSTAT = 'climate.bedroom_thermostat';

/** One press of a nudge button moves the nudge this far (the controller's nudge step). */
export const NUDGE_STEP_C = 0.5;

const FAMILY_THERMOSTAT = 'climate.family_room_thermostat';

export const zoneSensorId = (zone: HeatingZone) => `sensor.heating_zone_${zone}`;
export const zoneTargetHelperId = (zone: HeatingZone) => `input_number.heating_target_${zone}`;
export const zoneThermostatId = (zone: HeatingZone) => (zone === 'family' ? FAMILY_THERMOSTAT : `climate.${zone}_thermostat`);
export const nudgeButtonIds = (zone: HeatingZone) => ({
  warmer: `input_button.heating_${zone}_warmer`,
  colder: `input_button.heating_${zone}_colder`,
});

/** The controller zone a thermostat belongs to, or null for a thermostat outside the controller. */
export function zoneForThermostat(thermostatId: string): HeatingZone | null {
  return HEATING_ZONES.find(zone => zoneThermostatId(zone) === thermostatId) ?? null;
}

const NO_NUMBER = new Set(['', 'n/a', '<none>', 'unknown', 'unavailable', 'none']);

/** A published number: the controller sends zeroes and signed values as strings ("+0.5", "0") and
 * "n/a"/"<none>" for nothing. Missing or junk is null, never 0. */
export function heatNum(value: unknown): number | null {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && NO_NUMBER.has(value.trim().toLowerCase())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A published list without the "<none>" placeholder the controller sends for an empty one. */
export function heatList(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter(item => item !== '<none>' && item != null) : [];
}

/** A published boolean ("true"/"false" strings). */
export function heatBool(value: unknown): boolean {
  return value === true || value === 'true';
}

export interface FloorReading {
  /** The room the thermometer sits in, spelled out: "living room" for sensor.living_room_floor_thermometer_temperature. */
  room: string;
  tempC: number;
}

/** The floor thermometers behind `floor_temps` ({entity_id: °C}, published for a zone with more than one),
 * without a thermometer that has no reading. */
export function floorReadings(raw: unknown): FloorReading[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  return Object.entries(raw).flatMap(([entityId, value]) => {
    const tempC = heatNum(value);
    const room = entityId
      .slice(entityId.indexOf('.') + 1)
      .replace(/_floor_thermometer_temperature$/, '')
      .replace(/_/g, ' ');
    return tempC == null ? [] : [{ room, tempC }];
  });
}

export interface SetpointLimits {
  min: number;
  max: number;
}

/** The range a direct thermostat setpoint may take: the thermostat's own min/max heat setpoint
 * numbers (falling back to the climate entity's min_temp/max_temp), narrowed to the controller
 * zone's lower/upper limit when the thermostat has a zone. */
export function setpointLimits(entities: HassEntities, thermostatId: string): SetpointLimits {
  const thermostat = entities[thermostatId];
  const objectId = thermostatId.slice(thermostatId.indexOf('.') + 1);
  const min = heatNum(entities[`number.${objectId}_min_heat_setpoint`]?.state) ?? heatNum(thermostat?.attributes?.min_temp) ?? 15;
  const max = heatNum(entities[`number.${objectId}_max_heat_setpoint`]?.state) ?? heatNum(thermostat?.attributes?.max_temp) ?? 25;
  const zone = zoneForThermostat(thermostatId);
  const attrs = zone ? entities[zoneSensorId(zone)]?.attributes : undefined;
  const lower = heatNum(attrs?.lower_limit);
  const upper = heatNum(attrs?.upper_limit);
  const narrowed = { min: lower == null ? min : Math.max(min, lower), max: upper == null ? max : Math.min(max, upper) };
  return narrowed.min <= narrowed.max ? narrowed : { min, max };
}

/** `current + delta` on a grid of `grid` degrees (the half degree unless given), kept inside `limits`. */
export function stepSetpoint(current: number, delta: number, limits: SetpointLimits, grid = 0.5): number {
  const onGrid = Math.round((current + delta) / grid) * grid;
  return Math.min(limits.max, Math.max(limits.min, Math.round(onGrid * 1e6) / 1e6));
}

export interface HelperRange extends SetpointLimits {
  step: number;
}

export interface LiveZoneTarget {
  helperId: string;
  /** The helper's value, else the controller's published base_target. */
  value: number | null;
  /** The helper's own min, max and step; null while the helper is missing or lacks one of them. */
  range: HelperRange | null;
}

/** The room target of a zone the controller writes. Its thermostat is locked and a direct setpoint
 * change is undone, so the room steps the zone's target helper instead. Null for a zone the controller
 * only shadows and for one it does not publish. */
export function liveZoneTarget(entities: HassEntities, zone: HeatingZone | null): LiveZoneTarget | null {
  const sensor = zone ? entities[zoneSensorId(zone)] : undefined;
  if (!zone || !sensor || !heatBool(sensor.attributes?.live)) return null;
  const helperId = zoneTargetHelperId(zone);
  const helper = entities[helperId];
  const min = heatNum(helper?.attributes?.min);
  const max = heatNum(helper?.attributes?.max);
  const step = heatNum(helper?.attributes?.step);
  const ranged = min != null && max != null && step != null && min <= max && step > 0;
  return {
    helperId,
    value: heatNum(helper?.state) ?? heatNum(sensor.attributes?.base_target),
    range: ranged ? { min, max, step } : null,
  };
}

export interface NudgeControl {
  nudge: number;
  /** Every nudge value between nudge_min and nudge_max, one per pip. */
  steps: number[];
  canWarmer: boolean;
  canColder: boolean;
}

const EPS = 1e-6;

/** Whether the warmer/colder buttons can still move the zone: not past nudge_min/nudge_max and not
 * taking the comfort `target` past lower_limit/upper_limit. */
export function nudgeControl(attrs: Record<string, unknown> | undefined, target: number | null): NudgeControl {
  const nudge = heatNum(attrs?.nudge) ?? 0;
  const min = heatNum(attrs?.nudge_min) ?? 0;
  const max = heatNum(attrs?.nudge_max) ?? 0;
  const lower = heatNum(attrs?.lower_limit);
  const upper = heatNum(attrs?.upper_limit);
  const steps: number[] = [];
  for (let v = min; v <= max + EPS; v += NUDGE_STEP_C) steps.push(Math.round(v * 2) / 2);
  return {
    nudge,
    steps,
    canWarmer: nudge < max - EPS && (target == null || upper == null || target + NUDGE_STEP_C <= upper + EPS),
    canColder: nudge > min + EPS && (target == null || lower == null || target - NUDGE_STEP_C >= lower - EPS),
  };
}

/** A zone whose residents nudge it: its sensor and both buttons exist and the nudge has room to move. */
export function zoneHasNudge(entities: HassEntities, zone: HeatingZone): boolean {
  const sensor = entities[zoneSensorId(zone)];
  const buttons = nudgeButtonIds(zone);
  if (!sensor || !entities[buttons.warmer] || !entities[buttons.colder]) return false;
  return (heatNum(sensor.attributes?.nudge_max) ?? 0) > (heatNum(sensor.attributes?.nudge_min) ?? 0);
}

/** In season unless the controller says off_season or the season switch is off. */
export function heatingSeasonOn(entities: HassEntities): boolean {
  const controller = entities[HEATING_CONTROLLER_SENSOR]?.state;
  const season = entities[HEATING_SEASON_SWITCH]?.state;
  if (controller === 'off_season' || season === 'off') return false;
  return season === 'on' || controller === 'shadow' || controller === 'live';
}

export function isHeating(thermostat: HassEntity | undefined): boolean {
  return thermostat?.attributes?.hvac_action === 'heating';
}

export interface DayBlock {
  startMin: number;
  endMin: number;
  mode: string;
  setpoint: number | null;
}

function minutesOf(clock: unknown): number | null {
  const match = typeof clock === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(clock.trim()) : null;
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= 24 * 60 ? minutes : null;
}

/** Today's plan from `day_blocks` ({start: "HH:MM", end: "HH:MM" | "24:00", mode, setpoint}),
 * without zero-length or malformed blocks. */
export function parseDayBlocks(raw: unknown): DayBlock[] {
  const blocks: DayBlock[] = [];
  for (const item of heatList(raw)) {
    if (typeof item !== 'object' || item === null) continue;
    const block = item as Record<string, unknown>;
    const startMin = minutesOf(block.start);
    const endMin = minutesOf(block.end);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    blocks.push({ startMin, endMin, mode: typeof block.mode === 'string' ? block.mode : '', setpoint: heatNum(block.setpoint) });
  }
  return blocks;
}

/** Mode icons centred on their blocks, dropping any closer than `minGapMin` to one already placed.
 * Blocks other than hold are placed first, then wider before narrower. */
export function blockIcons(blocks: DayBlock[], minGapMin: number): { centre: number; mode: string }[] {
  const candidates = blocks
    .map(block => ({ centre: (block.startMin + block.endMin) / 2, mode: block.mode, width: block.endMin - block.startMin }))
    .sort((a, b) => Number(a.mode === 'hold') - Number(b.mode === 'hold') || b.width - a.width);
  const placed: { centre: number; mode: string }[] = [];
  for (const { centre, mode } of candidates) {
    if (placed.every(icon => Math.abs(icon.centre - centre) >= minGapMin)) placed.push({ centre, mode });
  }
  return placed.sort((a, b) => a.centre - b.centre);
}

export interface PlanModeMeta {
  icon: string;
  label: string;
}

export const PLAN_MODES: Record<string, PlanModeMeta> = {
  hold: { icon: 'mdi:thermostat', label: 'Holding the plan' },
  floor_cap: { icon: 'mdi:heat-wave', label: 'Floor too warm' },
  sun_cut: { icon: 'mdi:white-balance-sunny', label: 'Sun cut' },
  window: { icon: 'mdi:window-open-variant', label: 'Window open' },
  settle: { icon: 'mdi:timer-sand', label: 'Settling after airing' },
  party: { icon: 'mdi:party-popper', label: 'Party' },
  guard: { icon: 'mdi:sleep', label: 'Bedtime guard' },
  fallback: { icon: 'mdi:help-circle-outline', label: 'Fallback, no room reading' },
};

export function planModeMeta(mode: string): PlanModeMeta {
  return PLAN_MODES[mode] ?? { icon: 'mdi:help-circle-outline', label: mode || 'Unknown' };
}

/** ISO datetime or bare "HH:MM" -> "HH:MM" in the viewer's clock. */
export function clockOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const bare = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (bare) return `${bare[1].padStart(2, '0')}:${bare[2]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The person whose room a zone is; nobody else but an administrator adjusts it. */
const ZONE_OWNERS: Partial<Record<HeatingZone, string>> = {
  kristines_room: 'person.kristine',
  claudias_room: 'person.claudia',
};

/** Whether the viewer may change a room's heating: an administrator everywhere, a resident only in their own room. */
export function canAdjustRoom(
  entities: HassEntities,
  viewer: { isAdmin: boolean | null; id: string | null },
  zone: HeatingZone | null
): boolean {
  if (viewer.isAdmin === true) return true;
  const owner = zone ? ZONE_OWNERS[zone] : undefined;
  if (!owner || !viewer.id) return false;
  return entities[owner]?.attributes?.user_id === viewer.id;
}
