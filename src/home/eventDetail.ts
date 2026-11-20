/** Which past timeline rows open a detail sheet, what each sheet reads from the recorder, and the pure
 * builders that turn that history into the sheet's numbers: a plant's soil around its watering, an
 * appliance run, and one resident's way in through the apartment door. */
import type { BrewRecord } from '../coffee/model';
import type { MapEntry } from '../components/Vacuum/maps';
import { SESSION_MAP_LAG_MS, mapEntryMs, roberBoundary } from '../components/Vacuum/sessionRooms';
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

export const NIGHT_ENTITIES = {
  feel: 'sensor.bedroom_feel',
  co2: 'sensor.airdot_b49928_co2',
  heating: 'binary_sensor.bedroom_heating_active',
  night: 'input_boolean.house_night_mode',
} as const;

export const ROBER_AREA_ENTITY = 'sensor.rober2_total_cleaning_area';
export const DELIVERY_ENTITY = 'sensor.home_delivery';

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

/** The appliance an "<X> emptied" row names, by its label. */
const EMPTIED = /^(Washer|Dryer|Dishwasher) emptied$/;
const WOLT_DELIVERED = /^Wolt order from (.+) delivered$/;

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
      /** Set on an "emptied" row: the run is the last one that finished before the row. */
      emptied: boolean;
    }
  | { kind: 'arrival'; atMs: number; resident: ArrivalResident }
  | { kind: 'coffee'; atMs: number }
  | { kind: 'rober'; atMs: number }
  | { kind: 'wolt'; atMs: number; title: string }
  | { kind: 'night'; atMs: number };

/** The sheets drawn from the recorder's states; a coffee sheet reads the brew ledger, a Wolt sheet the delivery
 * sensor's attributes. */
export type HistorySpec = Exclude<DetailSpec, { kind: 'coffee' } | { kind: 'wolt' }>;

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

/** A rober2 row that names rooms it left out: a closed door at the end of a round, or a room it couldn't reach. */
const ROBER_SKIP = /^Vacuum skipped .+ - doors closed$|^Room skipped/;
/** How far a round may stretch either side of one of its rows. */
const ROBER_ROUND_MAX_MS = 6 * HOUR_MS;
/** The longest night read after a "Night mode on" row. */
const NIGHT_MAX_MS = 14 * HOUR_MS;

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
      emptied: false,
    };
  }
  const emptied = event.icon === 'mdi:basket-check' ? EMPTIED.exec(event.text) : null;
  if (emptied) {
    const of = Object.values(APPLIANCES).find(a => a.label === emptied[1])!;
    return {
      kind: 'appliance',
      atMs: event.tsMs,
      appliance: of.kind,
      label: of.label,
      stateEntity: of.state,
      powerEntity: of.power,
      kwh: null,
      emptied: true,
    };
  }
  if (event.icon === 'mdi:coffee' && event.text.startsWith('Coffee ready')) return { kind: 'coffee', atMs: event.tsMs };
  if (roberBoundary(event) || (event.icon === 'mdi:robot-vacuum' && ROBER_SKIP.test(event.effect ?? event.text))) {
    return { kind: 'rober', atMs: event.tsMs };
  }
  const wolt = event.icon === 'mdi:moped' ? WOLT_DELIVERED.exec(event.text) : null;
  if (wolt) return { kind: 'wolt', atMs: event.tsMs, title: wolt[1] };
  if (event.icon === 'mdi:weather-night' && event.text === 'Night mode on') return { kind: 'night', atMs: event.tsMs };
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
      return spec.emptied ? span(30 * HOUR_MS, 5 * MIN_MS) : span(6 * HOUR_MS, 10 * MIN_MS);
    case 'arrival':
      return span(10 * MIN_MS, 3 * MIN_MS);
    case 'rober':
      return span(ROBER_ROUND_MAX_MS, ROBER_ROUND_MAX_MS);
    case 'night':
      return span(30 * MIN_MS, NIGHT_MAX_MS);
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
    case 'rober':
      return [ROBER_AREA_ENTITY];
    case 'night':
      return [NIGHT_ENTITIES.feel, NIGHT_ENTITIES.co2, NIGHT_ENTITIES.heating, NIGHT_ENTITIES.night];
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

/** When the run before `ms` finished: the last change out of Running or Paused at or before it, else null. */
export function runFinishBefore(statePoints: readonly HistoryPoint[], ms: number): number | null {
  let finish: number | null = null;
  let previous: string | null = null;
  for (const p of statePoints) {
    if (p.ts > ms) break;
    const running = p.state === 'Running' || p.state === 'Paused';
    if (!running && (previous === 'Running' || previous === 'Paused')) finish = p.ts;
    previous = p.state;
  }
  return finish;
}

/** One Rober2 round around a tapped row: from its start row (or the first room when the feed has none) to its end row,
 * the rooms it saved a map for, the rooms it left out and the area it covered. */
export interface RoberRoundDetail {
  startMs: number | null;
  endMs: number | null;
  /** The last room's map time: where a round with no end row is known to have got to. */
  lastRoomMs: number | null;
  /** Why it ended, in the app's words: "All queued rooms cleaned", "Someone came home", ... */
  endReason: string | null;
  rooms: { room: string; atMs: number; map: MapEntry }[];
  skipped: string[];
  areaM2: number | null;
}

/** "Vacuum skipped Bedroom, Bathroom - doors closed" -> ["Bedroom", "Bathroom"]; "Couldn't reach the Hallway ..." ->
 * ["Hallway"]. */
export function skippedRooms(event: Pick<HouseEvent, 'cause' | 'effect' | 'text'>): string[] {
  const doors = /^Vacuum skipped (.+) - doors closed$/.exec(event.effect ?? event.text);
  if (doors) return doors[1].split(', ').filter(Boolean);
  const reach = /^Couldn't reach the (.+) after several tries$/.exec(event.cause ?? '');
  return reach ? [reach[1]] : [];
}

export function roberRound(
  events: readonly HouseEvent[],
  maps: readonly MapEntry[],
  areaPoints: readonly HistoryPoint[],
  rowMs: number
): RoberRoundDetail {
  const rober = events.filter(e => e.icon === 'mdi:robot-vacuum').sort((a, b) => a.tsMs - b.tsMs);
  const isStart = (e: HouseEvent) => roberBoundary(e) === 'start';
  const isEnd = (e: HouseEvent) => roberBoundary(e) === 'end';
  const tapped = rober.find(e => e.tsMs === rowMs) ?? null;
  let start: HouseEvent | null = null;
  if (tapped && isStart(tapped)) start = tapped;
  else {
    const candidate = [...rober].reverse().find(e => isStart(e) && e.tsMs <= rowMs && rowMs - e.tsMs <= ROBER_ROUND_MAX_MS) ?? null;
    // A round that already ended between that start and the row is not the row's round.
    const endedBetween = candidate != null && rober.some(e => isEnd(e) && e.tsMs > candidate.tsMs && e.tsMs < rowMs);
    start = endedBetween ? null : candidate;
  }
  const fromMs = start?.tsMs ?? rowMs;
  // The round ends at its end row, unless another round starts first: then it ended without one.
  const nextStart = rober.find(e => isStart(e) && e.tsMs > fromMs) ?? null;
  const candidate =
    tapped && isEnd(tapped) ? tapped : (rober.find(e => isEnd(e) && e.tsMs >= fromMs && e.tsMs - fromMs <= ROBER_ROUND_MAX_MS) ?? null);
  const end = candidate && (nextStart == null || candidate.tsMs <= nextStart.tsMs || candidate === tapped) ? candidate : null;
  const startMs = start?.tsMs ?? null;
  const endMs = end?.tsMs ?? null;
  const roomFrom = startMs ?? (endMs != null ? endMs - ROBER_ROUND_MAX_MS : rowMs);
  const roomTo = endMs != null ? endMs + SESSION_MAP_LAG_MS : Math.min(nextStart?.tsMs ?? Infinity, roomFrom + ROBER_ROUND_MAX_MS);
  const rooms = maps
    .flatMap(map => {
      const atMs = mapEntryMs(map);
      return atMs != null && map.room && !map.room.startsWith('stuck') && atMs >= roomFrom && atMs <= roomTo
        ? [{ room: map.room, atMs: endMs != null ? Math.min(atMs, endMs) : atMs, map }]
        : [];
    })
    .sort((a, b) => a.atMs - b.atMs);
  const skipped: string[] = [];
  for (const e of rober) {
    if (e.tsMs < roomFrom || e.tsMs > (endMs ?? roomTo) + MIN_MS) continue;
    for (const room of skippedRooms(e)) if (!skipped.includes(room)) skipped.push(room);
  }
  const area = numeric(areaPoints);
  const firstMs = startMs ?? rooms[0]?.atMs ?? null;
  const lastRoomMs = rooms.length > 0 ? rooms[rooms.length - 1].atMs : null;
  const lastMs = endMs ?? lastRoomMs;
  const before = firstMs != null ? valueAt(area, firstMs) : null;
  const after = lastMs != null ? valueAt(area, lastMs + 10 * MIN_MS) : null;
  const areaM2 = before != null && after != null && after >= before ? Math.round((after - before) * 10) / 10 : null;
  const endReason = end ? (end.cause ?? end.text) : null;
  return { startMs: firstMs, endMs, lastRoomMs, endReason, rooms, skipped, areaM2 };
}

/** One state of the delivery sensor with what it held. */
export interface DeliverySnapshot {
  ts: number;
  deliveries: readonly { source?: string; title?: string; stage?: string; eta?: string | null }[];
}

export interface WoltOrder {
  orderedMs: number | null;
  /** The start of the courier's last stretch on the way: Wolt flips back to "preparing" while it waits at the
   * restaurant, so the first "on the way" is not the pickup. */
  pickedUpMs: number | null;
  arrivingMs: number | null;
  deliveredMs: number;
  firstEtaMs: number | null;
  lastEtaMs: number | null;
}

/** A Wolt order's way to the door, from the delivery sensor's states up to its "delivered" row. */
export function woltOrder(snapshots: readonly DeliverySnapshot[], title: string, deliveredMs: number): WoltOrder {
  let orderedMs: number | null = null;
  let pickedUpMs: number | null = null;
  let arrivingMs: number | null = null;
  let firstEtaMs: number | null = null;
  let lastEtaMs: number | null = null;
  let previous: string | null = null;
  for (const snap of [...snapshots].sort((a, b) => a.ts - b.ts)) {
    if (snap.ts > deliveredMs + MIN_MS) break;
    const order = snap.deliveries.find(d => d.source === 'wolt' && d.title === title);
    if (!order) continue;
    if (orderedMs == null) orderedMs = snap.ts;
    const stage = order.stage ?? null;
    const moving = stage === 'on_the_way' || stage === 'arriving';
    if (moving && previous !== 'on_the_way' && previous !== 'arriving') {
      pickedUpMs = snap.ts;
      arrivingMs = null;
    }
    if (stage === 'arriving' && arrivingMs == null) arrivingMs = snap.ts;
    if (stage === 'preparing') {
      pickedUpMs = null;
      arrivingMs = null;
    }
    const eta = order.eta ? new Date(order.eta).getTime() : NaN;
    if (Number.isFinite(eta)) {
      if (firstEtaMs == null) firstEtaMs = eta;
      lastEtaMs = eta;
    }
    if (stage) previous = stage;
  }
  return { orderedMs, pickedUpMs, arrivingMs, deliveredMs, firstEtaMs, lastEtaMs };
}

/** The door rows around a delivery: rings and apartment-door unlocks from when the courier set off to ten minutes after. */
export function doorRowsNear(events: readonly HouseEvent[], fromMs: number, toMs: number): HouseEvent[] {
  return events
    .filter(e => e.tsMs >= fromMs && e.tsMs <= toMs && /^mdi:(bell|door|lock-open)/.test(e.icon))
    .sort((a, b) => a.tsMs - b.tsMs);
}

export interface NightSummary {
  endMs: number | null;
  feel: { ts: number; value: number }[];
  co2: { ts: number; value: number }[];
  /** The stretches the bedroom called for heat. */
  heat: { startMs: number; endMs: number }[];
  heatMinutes: number;
  feelLow: number | null;
  feelHigh: number | null;
  co2High: number | null;
}

/** The night from its "Night mode on" row to the house night mode going off: the bedroom's feel temperature and CO2,
 * and when it called for heat. */
export function nightSummary(history: Readonly<Record<string, readonly HistoryPoint[]>>, rowMs: number, nowMs: number): NightSummary {
  const night = history[NIGHT_ENTITIES.night] ?? [];
  const endMs = night.find(p => p.ts > rowMs && p.state === 'off')?.ts ?? null;
  const toMs = endMs ?? Math.min(nowMs, rowMs + NIGHT_MAX_MS);
  const inNight = (points: { ts: number; value: number }[]) => points.filter(p => p.ts >= rowMs && p.ts <= toMs);
  const feel = numeric(history[NIGHT_ENTITIES.feel] ?? []);
  const co2 = numeric(history[NIGHT_ENTITIES.co2] ?? []);
  const heat: { startMs: number; endMs: number }[] = [];
  let open: number | null = null;
  for (const p of history[NIGHT_ENTITIES.heating] ?? []) {
    const ts = Math.min(Math.max(p.ts, rowMs), toMs);
    if (p.state === 'on' && open == null) open = ts;
    else if (p.state !== 'on' && open != null) {
      if (ts > open) heat.push({ startMs: open, endMs: ts });
      open = null;
    }
  }
  if (open != null && toMs > open) heat.push({ startMs: open, endMs: toMs });
  const feelIn = inNight(feel).map(p => p.value);
  const startFeel = valueAt(feel, rowMs);
  if (startFeel != null) feelIn.push(startFeel);
  const co2In = inNight(co2).map(p => p.value);
  return {
    endMs,
    feel,
    co2,
    heat,
    heatMinutes: Math.round(heat.reduce((sum, h) => sum + (h.endMs - h.startMs), 0) / MIN_MS),
    feelLow: feelIn.length > 0 ? Math.min(...feelIn) : null,
    feelHigh: feelIn.length > 0 ? Math.max(...feelIn) : null,
    co2High: co2In.length > 0 ? Math.max(...co2In) : null,
  };
}

/** The bedtime rows inside a night, oldest first. */
export function bedtimesIn(events: readonly HouseEvent[], fromMs: number, toMs: number): HouseEvent[] {
  return events.filter(e => e.text === 'Went to bed' && e.tsMs >= fromMs - 30 * MIN_MS && e.tsMs <= toMs).sort((a, b) => a.tsMs - b.tsMs);
}
