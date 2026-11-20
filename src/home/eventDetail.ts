/** Which past timeline rows open a detail sheet, what each sheet reads from the recorder, and the pure
 * builders that turn that history into the sheet's numbers: a plant's soil around its watering, an
 * appliance run, and one resident's way in through the apartment door. */
import type { BrewRecord } from '../coffee/model';
import type { HouseEvent } from './houseEvents';
import type { HistoryPoint } from './eventHistory';

export const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/** One resident's way in: the phone's Bluetooth area and wifi tracker, as DoorEntry reads them. */
export interface ArrivalResident {
  name: string;
  areaSensor: string;
  tracker: string;
}

export const ARRIVAL_RESIDENTS: readonly ArrivalResident[] = [
  { name: 'Mikkel', areaSensor: 'sensor.bermuda_d6462f88944242db9e31bdff598edc25_100_40004_area', tracker: 'device_tracker.mikkels_ofx9p' },
  { name: 'Claudia', areaSensor: 'sensor.claudias_iphone_ble_area', tracker: 'device_tracker.claudias_iphone_2' },
  { name: 'Kristine', areaSensor: 'sensor.kristines_iphone_ble_area', tracker: 'device_tracker.kristines_iphone' },
];

export const APARTMENT_DOOR = 'binary_sensor.apartment_door_open';
export const APARTMENT_LOCK = 'lock.yale_bt';
export const LANDING_AREA = 'Landing';

const APPLIANCES = {
  'mdi:washing-machine': { kind: 'washer', label: 'Washer', state: 'sensor.washer_state', power: 'sensor.washer_plug_power' },
  'mdi:tumble-dryer': { kind: 'dryer', label: 'Dryer', state: 'sensor.dryer_state', power: 'sensor.dryer_plug_power' },
  'mdi:dishwasher': {
    kind: 'dish',
    label: 'Dishwasher',
    state: 'sensor.dishwasher_state',
    power: 'sensor.athom_smart_plug_v3_50ec44_power',
  },
} as const;

export type DetailSpec =
  | { kind: 'plant'; atMs: number; name: string; entity: string; low: number | null; peak: number | null }
  | {
      kind: 'appliance';
      atMs: number;
      appliance: 'washer' | 'dryer' | 'dish';
      label: string;
      stateEntity: string;
      powerEntity: string;
      kwh: number | null;
    }
  | { kind: 'arrival'; atMs: number; resident: ArrivalResident }
  | { kind: 'coffee'; atMs: number };

/** The sheets drawn from the recorder's history; a coffee sheet reads the brew ledger instead. */
export type HistorySpec = Exclude<DetailSpec, { kind: 'coffee' }>;

/** The lowercase ASCII letters and digits of a name, each run of anything else one "_": AppDaemon's plant slug. */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0080-\uffff]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A plant's soil sensor: `sensor.<slug>_soil_moisture` or the older `sensor.<slug>_moisture`, whichever exists. */
export function plantEntity(name: string, exists: (entityId: string) => boolean): string | null {
  const key = slug(name);
  return [`sensor.${key}_soil_moisture`, `sensor.${key}_moisture`].find(exists) ?? null;
}

const WATERED = /^Watered (.+?), soil (\d+(?:\.\d+)?)% to (\d+(?:\.\d+)?)%$/;
const FINISHED_KWH = /used (\d+(?:\.\d+)?) kWh/;
/** A resident coming in: a "Came home" row, or an apartment-door unlock that names a resident. */
export function arrivalResident(event: HouseEvent): ArrivalResident | null {
  if (!event.by) return null;
  const resident = ARRIVAL_RESIDENTS.find(r => r.name.toLowerCase() === event.by!.toLowerCase());
  if (!resident) return null;
  if (event.text === 'Came home') return resident;
  if (event.icon === 'mdi:lock-open-variant' && /^Apartment door unlocked/.test(event.text)) return resident;
  return null;
}

/** The detail sheet a row opens, or null when it opens none. `exists` says whether HA knows an entity. */
export function detailSpec(event: HouseEvent, exists: (entityId: string) => boolean): DetailSpec | null {
  const watered = WATERED.exec(event.text);
  if (watered && event.icon === 'mdi:watering-can-outline') {
    const entity = plantEntity(watered[1], exists);
    return entity ? { kind: 'plant', atMs: event.tsMs, name: watered[1], entity, low: Number(watered[2]), peak: Number(watered[3]) } : null;
  }
  const appliance = APPLIANCES[event.icon as keyof typeof APPLIANCES];
  if (appliance && / finished\b/.test(event.text)) {
    const kwh = FINISHED_KWH.exec(event.text);
    return {
      kind: 'appliance',
      atMs: event.tsMs,
      appliance: appliance.kind,
      label: appliance.label,
      stateEntity: appliance.state,
      powerEntity: appliance.power,
      kwh: kwh ? Number(kwh[1]) : null,
    };
  }
  if (event.icon === 'mdi:coffee' && event.text.startsWith('Coffee ready')) return { kind: 'coffee', atMs: event.tsMs };
  const resident = arrivalResident(event);
  return resident ? { kind: 'arrival', atMs: event.tsMs, resident } : null;
}

/** How far a ledger brew's start may lie from its "Coffee ready" row. */
const BREW_MATCH_MS = 20 * MIN_MS;

/** The finished brew a "Coffee ready" row stands for: the complete brew nearest the row, at most 20 minutes away. */
export function brewForRow(brews: readonly BrewRecord[], rowMs: number): BrewRecord | null {
  let best: BrewRecord | null = null;
  for (const brew of brews) {
    if (brew.outcome !== 'complete' || brew.atMs == null || Math.abs(brew.atMs - rowMs) >= BREW_MATCH_MS) continue;
    if (best == null || Math.abs(brew.atMs - rowMs) < Math.abs(best.atMs! - rowMs)) best = brew;
  }
  return best;
}

/** The time a sheet's history covers, in epoch ms, never past now. */
export function detailWindow(spec: HistorySpec, nowMs: number): { startMs: number; endMs: number } {
  const span = (before: number, after: number) => ({ startMs: spec.atMs - before, endMs: Math.min(nowMs, spec.atMs + after) });
  switch (spec.kind) {
    case 'plant':
      return span(24 * HOUR_MS, 24 * HOUR_MS);
    case 'appliance':
      return span(6 * HOUR_MS, 10 * MIN_MS);
    case 'arrival':
      return span(10 * MIN_MS, 3 * MIN_MS);
  }
}

/** The entities a sheet's history needs. */
export function detailEntities(spec: HistorySpec): string[] {
  switch (spec.kind) {
    case 'plant':
      return [spec.entity];
    case 'appliance':
      return [spec.stateEntity, spec.powerEntity];
    case 'arrival':
      return [spec.resident.areaSensor, spec.resident.tracker, APARTMENT_LOCK, APARTMENT_DOOR];
  }
}

/** The numeric readings of a series, unreadable states dropped. */
export function numeric(points: readonly HistoryPoint[]): { ts: number; value: number }[] {
  const out: { ts: number; value: number }[] = [];
  for (const p of points) {
    const value = Number(p.state);
    if (p.state !== '' && Number.isFinite(value)) out.push({ ts: p.ts, value });
  }
  return out;
}

/** The value in force at `ms`: the last reading at or before it, else null. */
export function valueAt(points: readonly { ts: number; value: number }[], ms: number): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.ts > ms) break;
    found = p.value;
  }
  return found;
}

/** One appliance run ending at the row: when it started, how long it ran and its peak power. */
export function applianceRun(
  statePoints: readonly HistoryPoint[],
  powerPoints: readonly HistoryPoint[],
  finishMs: number
): { startMs: number | null; minutes: number | null; peakW: number | null } {
  let startMs: number | null = null;
  let previous: string | null = null;
  for (const p of statePoints) {
    if (p.ts > finishMs + MIN_MS) break;
    if (p.state === 'Running' && previous !== 'Running' && previous !== 'Paused') startMs = p.ts;
    previous = p.state;
  }
  const inRun = numeric(powerPoints).filter(p => (startMs == null || p.ts >= startMs) && p.ts <= finishMs + MIN_MS);
  const peakW = inRun.length > 0 ? Math.max(...inRun.map(p => p.value)) : null;
  return { startMs, minutes: startMs == null ? null : Math.round((finishMs - startMs) / MIN_MS), peakW };
}

export type ArrivalStepKey = 'landing' | 'unlock' | 'door' | 'inside' | 'wifi';

export interface ArrivalStep {
  key: ArrivalStepKey;
  label: string;
  /** When it happened, or null when the history does not show it. */
  atMs: number | null;
  /** Seconds relative to the door opening (or to the unlock when the door contact missed it). */
  offsetS: number | null;
}

export interface ArrivalPath {
  /** The moment the steps count from: the door opening, else the unlock, else the row. */
  anchorMs: number;
  doorSeen: boolean;
  steps: ArrivalStep[];
}

const UNKNOWN_AREAS = new Set(['', 'unknown', 'unavailable', 'not_home', 'away', 'none']);

/** One arrival as a path: heard on the landing, the door unlocked, the door opened, first heard inside, back on wifi.
 * Reads the window around the row; each step is the one nearest the door that fits. */
export function arrivalPath(
  history: Readonly<Record<string, readonly HistoryPoint[]>>,
  resident: ArrivalResident,
  rowMs: number
): ArrivalPath {
  const area = history[resident.areaSensor] ?? [];
  const tracker = history[resident.tracker] ?? [];
  const lock = history[APARTMENT_LOCK] ?? [];
  const door = history[APARTMENT_DOOR] ?? [];

  const near = (
    points: readonly HistoryPoint[],
    test: (p: HistoryPoint, prev: HistoryPoint | null) => boolean,
    from: number,
    to: number
  ) => {
    let best: number | null = null;
    let prev: HistoryPoint | null = null;
    for (const p of points) {
      if (p.ts >= from && p.ts <= to && test(p, prev) && (best == null || Math.abs(p.ts - rowMs) < Math.abs(best - rowMs))) best = p.ts;
      prev = p;
    }
    return best;
  };
  const edgeTo = (state: string) => (p: HistoryPoint, prev: HistoryPoint | null) => p.state === state && prev?.state !== state;

  const unlockMs = near(lock, edgeTo('unlocked'), rowMs - 5 * MIN_MS, rowMs + MIN_MS);
  const doorMs = near(door, edgeTo('on'), (unlockMs ?? rowMs) - MIN_MS, rowMs + 2 * MIN_MS);
  const anchorMs = doorMs ?? unlockMs ?? rowMs;

  // The start of the last stretch on the landing before the door.
  let landingMs: number | null = null;
  let onLanding = false;
  for (const p of area) {
    if (p.ts > anchorMs + 15_000) break;
    const here = p.state === LANDING_AREA;
    if (here && !onLanding && p.ts >= anchorMs - 10 * MIN_MS) landingMs = p.ts;
    onLanding = here;
  }
  const insideMs = area.find(p => p.ts > anchorMs && p.state !== LANDING_AREA && !UNKNOWN_AREAS.has(p.state.toLowerCase()))?.ts ?? null;
  const wifiMs = near(tracker, edgeTo('home'), anchorMs - 5 * MIN_MS, anchorMs + 3 * MIN_MS);

  const step = (key: ArrivalStepKey, label: string, atMs: number | null): ArrivalStep => ({
    key,
    label,
    atMs,
    offsetS: atMs == null ? null : Math.round((atMs - anchorMs) / 1000),
  });
  return {
    anchorMs,
    doorSeen: doorMs != null,
    steps: [
      step('landing', 'Heard on the landing', landingMs),
      step('unlock', 'Door unlocked', unlockMs),
      step('door', doorMs != null ? 'Door opened' : 'Door opening not seen', doorMs),
      step('inside', 'First heard inside', insideMs),
      step('wifi', 'On the home wifi', wifiMs),
    ],
  };
}

/** How the door was unlocked, from the row's own words. */
export function unlockMethod(event: Pick<HouseEvent, 'text'>): string {
  if (/unlocked on arrival$/.test(event.text)) return 'Auto-unlock';
  if (/^Apartment door unlocked/.test(event.text)) return 'Unlocked';
  return 'Door was open';
}

/** The same resident's earlier arrivals, newest first, at most `max`. */
export function earlierArrivals(events: readonly HouseEvent[], resident: ArrivalResident, beforeMs: number, max = 7): HouseEvent[] {
  const out: HouseEvent[] = [];
  for (const event of [...events].sort((a, b) => b.tsMs - a.tsMs)) {
    if (event.tsMs >= beforeMs) continue;
    if (arrivalResident(event)?.name !== resident.name) continue;
    out.push(event);
    if (out.length >= max) break;
  }
  return out;
}

/** "+16 s", "-1 min 22 s". */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  const abs = Math.abs(seconds);
  if (abs < 60) return `${sign}${abs} s`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s === 0 ? `${sign}${m} min` : `${sign}${m} min ${s} s`;
}

/** The plant behind a maintenance row's id (`maint:plant:<slug>`): its soil sensor and, from the timeline's rows, its
 * last watering; null for any other row or a plant without a soil sensor. */
export function plantOfRow(
  rowId: string,
  events: readonly HouseEvent[],
  exists: (entityId: string) => boolean
): { entity: string; wateredMs: number | null } | null {
  const prefix = 'maint:plant:';
  if (!rowId.startsWith(prefix)) return null;
  const key = rowId.slice(prefix.length);
  const entity = plantEntity(key, exists);
  if (!entity) return null;
  let wateredMs: number | null = null;
  for (const event of events) {
    const match = WATERED.exec(event.text);
    if (match && slug(match[1]) === key && (wateredMs == null || event.tsMs > wateredMs)) wateredMs = event.tsMs;
  }
  return { entity, wateredMs };
}
