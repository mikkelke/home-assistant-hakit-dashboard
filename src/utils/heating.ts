import type { HassEntities, HassEntity } from '../types';

/** The zones the AppDaemon heating controller plans, in display order. The bedroom has no zone. */
export const HEATING_ZONES = ['family', 'kristines_room', 'claudias_room', 'bathroom', 'guest_bathroom'] as const;
export type HeatingZone = (typeof HEATING_ZONES)[number];

export const HEATING_CONTROLLER_SENSOR = 'sensor.heating_controller';
export const HEATING_SEASON_SWITCH = 'input_boolean.heating_season';

/** Pipe probes on the floor circuit's mixed supply and its return, in °C. */
export const HEATING_SUPPLY_TEMP_SENSOR = 'sensor.heating_room_floor_heating_supply';
export const HEATING_RETURN_TEMP_SENSOR = 'sensor.heating_room_floor_heating_return';

/** Pipe probes on the building's own supply before the mixing tee and on the water sent back to it, in °C. */
export const BUILDING_SUPPLY_TEMP_SENSOR = 'sensor.heating_room_primary_supply';
export const BUILDING_RETURN_TEMP_SENSOR = 'sensor.heating_room_primary_return';

/** The return-pipe probe of one floor loop, numbered by its wiring-centre zone (actuator cap 1-x). */
export const loopReturnSensorId = (loop: number) => `sensor.heating_room_zone_${loop}_return`;

/** The bedroom is never heated and the controller has no zone for it, so it stays out of HEATING_ZONES. */
export const BEDROOM_THERMOSTAT = 'climate.bedroom_thermostat';

/** One press of a nudge button moves the nudge this far (the controller's nudge step). */
export const NUDGE_STEP_C = 0.5;

/** The room a zone's thermostat and `heating_active` sensor are named after; the family zone's is the family room. */
export const zoneRoomId = (zone: HeatingZone) => (zone === 'family' ? 'family_room' : zone);

export const zoneSensorId = (zone: HeatingZone) => `sensor.heating_zone_${zone}`;
export const zoneTargetHelperId = (zone: HeatingZone) => `input_number.heating_target_${zone}`;
export const zoneThermostatId = (zone: HeatingZone) => `climate.${zoneRoomId(zone)}_thermostat`;
/** On while the zone's thermostat calls for heat; its history is the zone's call timeline. */
export const zoneCallSensorId = (zone: HeatingZone) => `binary_sensor.${zoneRoomId(zone)}_heating_active`;
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
  warm: { icon: 'mdi:thermometer-check', label: 'Warm enough' },
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

/** The controller's `last_signal` as the sheet shows it: the last change somebody made to a zone. */
export interface LastSignal {
  /** Who made it, capitalised; null when the controller could not tell. */
  who: string | null;
  direction: 'warmer' | 'colder' | null;
  /** `ha` is the app, `keypad` the thermostat itself; anything else is left unnamed. */
  source: string | null;
  /** "HH:MM" on the viewer's clock. */
  clock: string | null;
  /** Null when it happened today; "Thu" within the last week; "5 Nov" before that. */
  day: string | null;
}

const asText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function signalDay(raw: unknown, now: Date): string | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.toDateString() === now.toDateString()) return null;
  const daysAgo = (now.getTime() - d.getTime()) / 86_400_000;
  return daysAgo < 6
    ? d.toLocaleDateString('en-GB', { weekday: 'short' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function readLastSignal(raw: unknown, now: Date = new Date()): LastSignal | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const signal = raw as Record<string, unknown>;
  const name = asText(signal.who)?.replace(/_/g, ' ') ?? null;
  return {
    who: name && name.toLowerCase() !== 'unknown' ? name.charAt(0).toUpperCase() + name.slice(1) : null,
    direction: signal.direction === 'warmer' || signal.direction === 'colder' ? signal.direction : null,
    source: asText(signal.source),
    clock: clockOf(signal.at),
    day: signalDay(signal.at, now),
  };
}

function signalPlace(source: string | null): string {
  switch (source) {
    case 'ha':
    case 'button':
      return ' in the app';
    case 'keypad':
      return ' on the thermostat';
    default:
      return '';
  }
}

/** "Mikkel turned it up in the app at 06:42"; whatever the controller did not say is left out. */
export function lastSignalText({ who, direction, source, clock, day }: LastSignal): string {
  const verb = direction === 'warmer' ? 'turned it up' : direction === 'colder' ? 'turned it down' : 'changed it';
  const when = clock ? `${day ? ` on ${day}` : ''} at ${clock}` : '';
  return `${who ?? 'Someone'} ${verb}${signalPlace(source)}${when}`;
}

/** How far air may sit from its target before the heating page calls it off, in °C. */
export const AIR_GAP_BAND_C = 0.5;

export interface AirGap {
  /** Air minus target, rounded to a tenth: +2.0 is two degrees warmer than the target. */
  value: number;
  /** `ok` inside the band, `warm` above it, `cold` below it. */
  tone: 'ok' | 'warm' | 'cold';
}

/** The air reading against the zone's target, null while either is unknown. */
export function airGap(airC: number | null, targetC: number | null): AirGap | null {
  if (airC == null || targetC == null) return null;
  const raw = airC - targetC;
  // Rounded away from zero on both sides, and never -0.
  const value = (Math.sign(raw) * Math.round(Math.abs(raw) * 10)) / 10 || 0;
  return { value, tone: value > AIR_GAP_BAND_C ? 'warm' : value < -AIR_GAP_BAND_C ? 'cold' : 'ok' };
}

/** A floor within this many °C of its maximum, or past it, counts as at the cap. */
export const FLOOR_NEAR_CAP_C = 0.3;

export interface NextChange {
  setpoint: number | null;
  /** "HH:MM" on the viewer's clock. */
  at: string | null;
  /** Against the setpoint now (else the target); null when either is unknown or they are equal. */
  direction: 'up' | 'down' | null;
}

/** The one chip a zone row shows. */
export type ZoneChip =
  | { kind: 'floor'; floorC: number; maxC: number }
  | { kind: 'mode'; mode: string; next: NextChange }
  | { kind: 'next'; next: NextChange & { setpoint: number; at: string } };

/** What a zone row says besides its air and gap, by priority: the floor at its cap, else a plan mode other than hold
 * with its next change, else the next setpoint change, else nothing. */
export function zoneChip(attrs: Record<string, unknown> | undefined, targetC: number | null): ZoneChip | null {
  const floorC = heatNum(attrs?.floor_temp);
  const maxC = heatNum(attrs?.floor_max_c);
  if (floorC != null && maxC != null && floorC >= maxC - FLOOR_NEAR_CAP_C - EPS) return { kind: 'floor', floorC, maxC };

  const setpoint = heatNum(attrs?.next_setpoint);
  const at = clockOf(attrs?.next_change_at);
  const from = heatNum(attrs?.setpoint_now) ?? targetC;
  const direction = setpoint == null || from == null || setpoint === from ? null : setpoint > from ? 'up' : 'down';

  const mode = typeof attrs?.plan_mode === 'string' ? attrs.plan_mode : '';
  if (mode && mode !== 'hold') return { kind: 'mode', mode, next: { setpoint, at, direction } };
  if (setpoint != null && at != null) return { kind: 'next', next: { setpoint, at, direction } };
  return null;
}

/** Watts that one litre of water per minute carries for each kelvin it cools: 4.18 kJ per kg and K over 60 s. */
export const WATER_W_PER_LPM_K = 69.8;

/** What a floor loop hands to its room: its flow (L/min) x the temperature drop (floor supply - loop return) x 69.8.
 * Never below 0; null while the drop is unknown. */
export function loopPowerW(flowLpm: number, dropC: number | null): number | null {
  return dropC == null ? null : Math.max(0, flowLpm * dropC * WATER_W_PER_LPM_K);
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
