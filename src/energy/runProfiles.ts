/** Parser for `sensor.appliance_run_profiles`, the per-programme energy profiles AppDaemon publishes.
 *
 * Wire format (entity attributes, schema 1):
 *
 *   schema: 1 | "1"
 *   appliances: {
 *     <appliance>: {
 *       programmes: [{
 *         key: string             programme identity, unique per appliance
 *         label: string
 *         n: int >= 1             cycles behind the profile
 *         energy_min: int         profile length in minutes; must equal the profile's length
 *         completion_min: int     conservative power onset -> machine really done, in minutes;
 *                                 optional (absent with too few trusted finishes): then unknown
 *         label_source: "confirmed" | "inferred" | "mixed"   absent means inferred; only
 *                                 "confirmed" counts as a confirmed label
 *         p: "16,27,0,..."        0.1 Wh per minute from power onset, comma-separated ints >= 0
 *       }, ...]                   most typical programme first
 *     }
 *   }
 *
 * The profile travels as a string because AppDaemon drops every 0 and False from published
 * attributes, which would silently shift a numeric array. For the same reason numbers may arrive as
 * numeric strings and a missing `label_source` reads as inferred. kWh is derived from the profile
 * (sum of p / 10 000), so it can never disagree with the energy the planner prices. Any malformed
 * field rejects the whole payload: no advice beats advice priced on a corrupted profile. */
import { RUN_PROFILE_MAX_MINUTES } from '../config/plan';

/** Accepted wire names per field, so a rename on the publishing side is a one-line change here. */
const WIRE = {
  schema: ['schema'],
  appliances: ['appliances'],
  programmes: ['programmes'],
  key: ['key'],
  label: ['label'],
  n: ['n'],
  energyMin: ['energy_min', 'run_min'],
  completionMin: ['completion_min', 'done_min'],
  labelSource: ['label_source'],
  profile: ['p', 'profile'],
} as const;

const SUPPORTED_SCHEMA = 1;
const LABEL_SOURCES: readonly string[] = ['confirmed', 'inferred', 'mixed'];
const PROFILE_PATTERN = /^\d+(,\d+)*$/;

export interface RunProfileProgramme {
  key: string;
  label: string;
  /** Cycles behind the profile. */
  n: number;
  /** Mean energy per run, derived from the profile. */
  kwh: number;
  /** Profile length in minutes; minute 0 starts at power onset. */
  energyMin: number;
  /** Conservative minutes from power onset until the machine is really done; never below `energyMin`.
   * Null when the publisher has too few trusted finishes: power can end well before the machine is
   * done, so the energy length is no stand-in. */
  completionMin: number | null;
  labelConfirmed: boolean;
  /** Energy per minute in Wh. */
  whPerMin: Float64Array;
  /** Running totals: `cumWh[i]` is the energy in minutes [0, i); length `energyMin + 1`. */
  cumWh: Float64Array;
}

export interface RunProfiles {
  appliances: Record<string, RunProfileProgramme[]>;
}

export type ParseRunProfilesResult = { ok: true; profiles: RunProfiles } | { ok: false; error: string };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(obj: Obj, names: readonly string[]): unknown {
  for (const name of names) if (obj[name] !== undefined) return obj[name];
  return undefined;
}

function toInt(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
}

class PayloadError extends Error {}

function fail(message: string): never {
  throw new PayloadError(message);
}

function parseProfile(value: unknown, where: string): Float64Array {
  if (typeof value !== 'string') fail(`${where}: profile must be a string`);
  const text = value.replace(/\s+/g, '');
  if (!PROFILE_PATTERN.test(text)) fail(`${where}: profile must be comma-separated integers >= 0`);
  const parts = text.split(',');
  if (parts.length > RUN_PROFILE_MAX_MINUTES) fail(`${where}: profile longer than ${RUN_PROFILE_MAX_MINUTES} minutes`);
  const wh = new Float64Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const dwh = Number(parts[i]);
    if (!Number.isSafeInteger(dwh)) fail(`${where}: profile value out of range`);
    wh[i] = dwh / 10;
  }
  return wh;
}

function parseProgramme(raw: unknown, where: string): RunProfileProgramme {
  if (!isObj(raw)) fail(`${where}: not an object`);
  const key = pick(raw, WIRE.key);
  if (typeof key !== 'string' || key === '') fail(`${where}: missing key`);
  const at = `${where}.${key}`;
  const label = pick(raw, WIRE.label);
  if (typeof label !== 'string' || label === '') fail(`${at}: missing label`);
  const n = toInt(pick(raw, WIRE.n));
  if (n == null || n < 1) fail(`${at}: n must be an integer >= 1`);

  const whPerMin = parseProfile(pick(raw, WIRE.profile), at);
  const energyRaw = pick(raw, WIRE.energyMin);
  const energyMin = energyRaw === undefined ? whPerMin.length : toInt(energyRaw);
  if (energyMin !== whPerMin.length) fail(`${at}: energy_min does not match the profile length`);
  const completionRaw = pick(raw, WIRE.completionMin);
  const completion = completionRaw === undefined ? null : toInt(completionRaw);
  if (completionRaw !== undefined && (completion == null || completion < 1 || completion > 1440)) fail(`${at}: completion_min must be 1..1440`);

  const source = pick(raw, WIRE.labelSource);
  if (source !== undefined && !LABEL_SOURCES.includes(source as string)) fail(`${at}: unknown label_source`);

  const cumWh = new Float64Array(whPerMin.length + 1);
  for (let i = 0; i < whPerMin.length; i++) cumWh[i + 1] = cumWh[i] + whPerMin[i];

  return {
    key,
    label,
    n,
    kwh: cumWh[whPerMin.length] / 1000,
    energyMin,
    completionMin: completion == null ? null : Math.max(completion, energyMin),
    labelConfirmed: source === 'confirmed',
    whPerMin,
    cumWh,
  };
}

/** Parses the entity's attributes. */
export function parseRunProfiles(attributes: unknown): ParseRunProfilesResult {
  try {
    if (!isObj(attributes)) fail('attributes missing');
    if (toInt(pick(attributes, WIRE.schema)) !== SUPPORTED_SCHEMA) fail('unsupported schema');
    const appliancesRaw = pick(attributes, WIRE.appliances);
    if (!isObj(appliancesRaw)) fail('appliances missing');

    const appliances: Record<string, RunProfileProgramme[]> = {};
    for (const [appliance, entry] of Object.entries(appliancesRaw)) {
      const list = isObj(entry) ? pick(entry, WIRE.programmes) : undefined;
      if (list === undefined) {
        appliances[appliance] = [];
        continue;
      }
      if (!Array.isArray(list)) fail(`${appliance}: programmes must be a list`);
      const programmes = list.map((raw, i) => parseProgramme(raw, `${appliance}[${i}]`));
      if (new Set(programmes.map(p => p.key)).size !== programmes.length) fail(`${appliance}: duplicate programme key`);
      appliances[appliance] = programmes;
    }
    return { ok: true, profiles: { appliances } };
  } catch (err) {
    if (err instanceof PayloadError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Energy in Wh drawn in [fromMin, toMin) minutes after onset; fractional minutes interpolate
 * linearly within the minute. Bounds are clamped to the profile. */
export function energyBetweenWh(programme: Pick<RunProfileProgramme, 'cumWh' | 'whPerMin'>, fromMin: number, toMin: number): number {
  return cumAt(programme, toMin) - cumAt(programme, fromMin);
}

function cumAt({ cumWh, whPerMin }: Pick<RunProfileProgramme, 'cumWh' | 'whPerMin'>, minute: number): number {
  const length = whPerMin.length;
  if (minute <= 0) return 0;
  if (minute >= length) return cumWh[length];
  const whole = Math.floor(minute);
  return cumWh[whole] + (minute - whole) * whPerMin[whole];
}
