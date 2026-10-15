/**
 * The three documents of the sensor map, kept as plain JSON in Home Assistant's frontend system store:
 *
 *   sensor_map              written by the map page: plan, devices, placements, answers
 *   sensor_map_suggest      written by the CLI: proposed placements and answers
 *   sensor_map_fingerprints written by the map page: a bounded set of BLE fingerprints
 *
 * Every write, by the page or by the command line, carries a random `write_id` and the id of its `writer`, and
 * the page reads a key before writing it, so a document another writer changed is never overwritten unseen.
 */

export const SCHEMA_VERSION = 1;
/** The fingerprint document moved on to version 2 when a capture began to carry Wi-Fi; version 1 is read and migrated. */
export const FINGERPRINT_SCHEMA_VERSION = 2;

export const MAP_KEY = 'sensor_map';
export const SUGGEST_KEY = 'sensor_map_suggest';
export const FINGERPRINTS_KEY = 'sensor_map_fingerprints';
export type SystemKey = typeof MAP_KEY | typeof SUGGEST_KEY | typeof FINGERPRINTS_KEY;

export const HISTORY_LIMIT = 5;
export const SUGGEST_LOG_LIMIT = 50;
export const FINGERPRINT_LIMIT_BYTES = 600_000;
export const FACING_STEP_DEG = 15;

export type Cert = 'confirmed' | 'room' | 'guess';
export type Facing = { state: 'known'; deg: number } | { state: 'unknown' } | { state: 'omni' };
export type Point = [number, number];

export interface Pos {
  x: number;
  y: number;
  h: number | null;
}

export interface Placement {
  pos: Pos | null;
  facing: Facing;
  fov_deg: number | null;
  cert: Cert;
  confirmed_at: string | null;
}

export interface HistoryEntry {
  at: string;
  placement: Placement;
}

export interface DeviceHa {
  device_ids: string[];
  bindings: Record<string, string>;
  scanner_source: string | null;
}

export interface MapDevice {
  name: string;
  type: string;
  roles: string[];
  model: string;
  ha: DeviceHa;
  zone_id: string | null;
  clip_region_id: string | null;
  placement: Placement;
  history: HistoryEntry[];
  basis: string;
  notes: string;
  measure_ids: string[];
}

export interface Wall {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Door {
  name: string;
  hinge: Point;
  closed: Point;
  open: Point;
}

export interface Glazing {
  name: string;
  box: [number, number, number, number];
  door: boolean;
}

export interface Zone {
  zone_id: string;
  name: string;
  poly: Point[];
  ha_area_id: string | null;
  active_entity: string | null;
  label: Point;
  ceiling_m: number | null;
}

export interface ClipRegion {
  clip_region_id: string;
  poly: Point[];
}

export interface ZoneLine {
  x: number;
  y1: number;
}

export interface Annotation {
  id: string;
  kind: 'zone_label' | 'room_label' | 'note';
  at: Point;
  lines: string[];
  rot: number;
  small: boolean;
  outside: boolean;
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Plan {
  units: string;
  origin: string;
  bounds: Rect;
  fit: Rect;
  scale_rms_cm: number | null;
  walls: Wall[];
  doors: Door[];
  windows: Glazing[];
  zones: Zone[];
  clip_regions: ClipRegion[];
  zone_lines: ZoneLine[];
  annotations: Annotation[];
  compass: { x: number; y: number; rot: number };
}

export interface TypeDef {
  key: string;
  label: string;
}

export interface Phone {
  name: string;
  bermuda_address: string;
  person: string | null;
}

export interface Question {
  id: string;
  text: string;
  refs: string[];
  answer: string | null;
  answered_at: string | null;
}

export interface Measurement extends Question {
  prio: string;
  applied: boolean;
}

export interface SuggestLogEntry {
  id: string;
  accepted_at?: string;
  rejected_at?: string;
}

/** The phone whose Wi-Fi a capture records: the service that tells its Companion app to update its sensors, and the
 * entities that app fills. */
export interface WifiSource {
  name: string;
  /** `domain.service`, for example `notify.mobile_app_<device>`. */
  notify: string;
  signal: string;
  bssid: string;
  frequency: string;
}

export interface WifiConfig {
  source: WifiSource | null;
  /** BSSID, lower case with colons, to the key of the access point device that owns it. */
  aps: Record<string, string>;
}

/** What a writer adds to a document when it writes it. */
export interface WriteStamp {
  write_id?: string;
  writer?: string;
}

export interface MapDoc extends WriteStamp {
  schema_version: number;
  layout_version: number;
  updated_at: string;
  plan: Plan;
  types: TypeDef[];
  devices: Record<string, MapDevice>;
  ignored_device_ids: string[];
  phones: Phone[];
  questions: Question[];
  measurements: Measurement[];
  observations: string[];
  not_drawn: string[];
  layer_notes: string[];
  suggest_log: SuggestLogEntry[];
  wifi: WifiConfig;
}

export type NewDevice = Omit<MapDevice, 'history'>;

export type SuggestItem =
  | { id: string; kind: 'placement'; device_key: string; placement: Placement; reason: string }
  | { id: string; kind: 'answer'; target: string; answer: string; reason: string }
  | { id: string; kind: 'new_device'; device: NewDevice; reason: string }
  | { id: string; kind: 'wifi'; source?: WifiSource; aps?: Record<string, string>; reason: string }
  | { id: string; kind: 'rename'; device_key: string; name: string; reason: string }
  | { id: string; kind: 'phone'; phone: Phone; reason: string };

export interface SuggestDoc {
  schema_version: number;
  updated_at: string;
  based_on_layout_version: number;
  items: SuggestItem[];
}

export interface FingerprintScanner {
  device_key: string | null;
  samples: number;
  rssi: number[];
  dist: (number | null)[];
}

export type WifiBand = '2.4' | '5' | '6';
export const WIFI_BANDS: readonly WifiBand[] = ['2.4', '5', '6'];

/** Why a Wi-Fi field is null. */
export type WifiMiss = 'not_captured' | 'no_entity' | 'unavailable' | 'invalid' | 'roamed' | 'command_failed' | 'stale';
export const WIFI_MISSES: readonly WifiMiss[] = [
  'not_captured',
  'no_entity',
  'unavailable',
  'invalid',
  'roamed',
  'command_failed',
  'stale',
];

export interface WifiReading {
  dbm: number;
  /** When Home Assistant stored the reading, on its own clock. */
  at: string;
}

export interface FingerprintWifi {
  /** The median of `readings`; null, with a reason in `miss`, when none arrived inside the window. */
  dbm: number | null;
  readings: WifiReading[];
  /** Lower case with colons. */
  bssid: string | null;
  freq_mhz: number | null;
  band: WifiBand | null;
  /** When the newest reading was stored; null without one. */
  at: string | null;
  miss: Partial<Record<'dbm' | 'bssid' | 'freq', WifiMiss>>;
}

export interface Fingerprint {
  id: string;
  at: string;
  phone: string;
  /** Empty for a capture made with no tracked phone, which holds Wi-Fi only. */
  bermuda_address: string;
  pos: { x: number; y: number; h: number };
  zone_id: string | null;
  layout_version: number;
  window_s: number;
  polls: number;
  room_active: Record<string, string>;
  bermuda_area: string | null;
  scanners: Record<string, FingerprintScanner>;
  weak: boolean;
  note: string;
  wifi: FingerprintWifi;
  /** The survey point the capture was made for. */
  survey_id: string | null;
}

export interface FingerprintDoc extends WriteStamp {
  schema_version: number;
  updated_at: string;
  limit_bytes: number;
  items: Fingerprint[];
}

export class DocError extends Error {
  readonly problems: string[];

  constructor(what: string, problems: string[]) {
    super(`${what}: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? `; and ${problems.length - 5} more` : ''}`);
    this.name = 'DocError';
    this.problems = problems;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every(isNumber);
const isPoly = (v: unknown): v is Point[] => Array.isArray(v) && v.length >= 3 && v.every(isPoint);
const isNullable =
  <T>(check: (v: unknown) => v is T) =>
  (v: unknown): v is T | null =>
    v === null || check(v);

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function normalizeDeg(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

const BSSID_PATTERN = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
/** What Android reports instead of a BSSID when it may not tell, and what it reports for no connection. */
const BSSID_PLACEHOLDERS: ReadonlySet<string> = new Set(['00:00:00:00:00:00', '02:00:00:00:00:00']);

/** A BSSID as lower case hex pairs with colons, or null for anything else, including the all-zero and the
 * 02:00:00:00:00:00 placeholders. */
export function normalizeBssid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase().replace(/-/g, ':');
  return BSSID_PATTERN.test(text) && !BSSID_PLACEHOLDERS.has(text) ? text : null;
}

/** The Wi-Fi record of a capture that holds none: every field null and the reason given. */
export function noWifi(reason: WifiMiss): FingerprintWifi {
  return { dbm: null, readings: [], bssid: null, freq_mhz: null, band: null, at: null, miss: { dbm: reason, bssid: reason, freq: reason } };
}

export const emptyWifiConfig = (): WifiConfig => ({ source: null, aps: {} });

export function emptyMapDoc(now: string): MapDoc {
  return {
    schema_version: SCHEMA_VERSION,
    layout_version: 1,
    updated_at: now,
    plan: {
      units: 'm',
      origin: '',
      bounds: { x0: 0, x1: 10, y0: 0, y1: 10 },
      fit: { x0: 0, x1: 10, y0: 0, y1: 10 },
      scale_rms_cm: null,
      walls: [],
      doors: [],
      windows: [],
      zones: [],
      clip_regions: [],
      zone_lines: [],
      annotations: [],
      compass: { x: 0, y: 0, rot: 0 },
    },
    types: [],
    devices: {},
    ignored_device_ids: [],
    phones: [],
    questions: [],
    measurements: [],
    observations: [],
    not_drawn: [],
    layer_notes: [],
    suggest_log: [],
    wifi: emptyWifiConfig(),
  };
}

export function emptySuggestDoc(now: string, layoutVersion = 1): SuggestDoc {
  return { schema_version: SCHEMA_VERSION, updated_at: now, based_on_layout_version: layoutVersion, items: [] };
}

export function emptyFingerprintDoc(now: string): FingerprintDoc {
  return { schema_version: FINGERPRINT_SCHEMA_VERSION, updated_at: now, limit_bytes: FINGERPRINT_LIMIT_BYTES, items: [] };
}

function checkFacing(value: unknown, path: string, problems: string[]) {
  if (!isObject(value)) return problems.push(`${path} is not an object`);
  if (value.state === 'known') {
    if (!isNumber(value.deg)) problems.push(`${path}.deg is not a number`);
  } else if (value.state !== 'unknown' && value.state !== 'omni') {
    problems.push(`${path}.state is not known, unknown or omni`);
  }
}

function checkPlacement(value: unknown, path: string, problems: string[]) {
  if (!isObject(value)) return problems.push(`${path} is not an object`);
  if (value.pos !== null) {
    if (!isObject(value.pos) || !isNumber(value.pos.x) || !isNumber(value.pos.y) || !isNullable(isNumber)(value.pos.h)) {
      problems.push(`${path}.pos is neither null nor {x, y, h}`);
    }
  }
  checkFacing(value.facing, `${path}.facing`, problems);
  if (!isNullable(isNumber)(value.fov_deg)) problems.push(`${path}.fov_deg is not a number or null`);
  if (value.cert !== 'confirmed' && value.cert !== 'room' && value.cert !== 'guess')
    problems.push(`${path}.cert is not confirmed, room or guess`);
  if (!isNullable(isString)(value.confirmed_at)) problems.push(`${path}.confirmed_at is not a string or null`);
}

function checkDevice(value: unknown, path: string, problems: string[], withHistory: boolean) {
  if (!isObject(value)) return problems.push(`${path} is not an object`);
  for (const field of ['name', 'type', 'model', 'basis', 'notes'] as const) {
    if (!isString(value[field])) problems.push(`${path}.${field} is not a string`);
  }
  if (!isStringArray(value.roles)) problems.push(`${path}.roles is not a string array`);
  if (!isStringArray(value.measure_ids)) problems.push(`${path}.measure_ids is not a string array`);
  if (!isNullable(isString)(value.zone_id)) problems.push(`${path}.zone_id is not a string or null`);
  if (!isNullable(isString)(value.clip_region_id)) problems.push(`${path}.clip_region_id is not a string or null`);
  const ha = value.ha;
  if (!isObject(ha) || !isStringArray(ha.device_ids) || !isObject(ha.bindings) || !Object.values(ha.bindings).every(isString)) {
    problems.push(`${path}.ha is not {device_ids, bindings, scanner_source}`);
  } else if (!isNullable(isString)(ha.scanner_source)) {
    problems.push(`${path}.ha.scanner_source is not a string or null`);
  }
  checkPlacement(value.placement, `${path}.placement`, problems);
  if (withHistory) {
    if (!Array.isArray(value.history)) problems.push(`${path}.history is not an array`);
    else
      value.history.forEach((entry, index) => {
        if (!isObject(entry) || !isString(entry.at)) return problems.push(`${path}.history[${index}] has no timestamp`);
        checkPlacement(entry.placement, `${path}.history[${index}].placement`, problems);
      });
  }
}

function checkRect(value: unknown, path: string, problems: string[]) {
  if (!isObject(value) || !['x0', 'x1', 'y0', 'y1'].every(k => isNumber(value[k]))) problems.push(`${path} is not {x0, x1, y0, y1}`);
}

function checkPlan(plan: unknown, problems: string[]) {
  if (!isObject(plan)) return problems.push('plan is not an object');
  checkRect(plan.bounds, 'plan.bounds', problems);
  checkRect(plan.fit, 'plan.fit', problems);
  const list = (name: string, each: (item: unknown, path: string) => void) => {
    const value = plan[name];
    if (!Array.isArray(value)) return problems.push(`plan.${name} is not an array`);
    value.forEach((item, index) => each(item, `plan.${name}[${index}]`));
  };
  list('walls', (w, p) => {
    if (!isObject(w) || !['x0', 'x1', 'y0', 'y1'].every(k => isNumber(w[k]))) problems.push(`${p} is not a rectangle`);
  });
  list('doors', (d, p) => {
    if (!isObject(d) || !isString(d.name) || !isPoint(d.hinge) || !isPoint(d.closed) || !isPoint(d.open))
      problems.push(`${p} is not a door`);
  });
  list('windows', (w, p) => {
    if (!isObject(w) || !isString(w.name) || !Array.isArray(w.box) || w.box.length !== 4 || !w.box.every(isNumber))
      problems.push(`${p} is not a window`);
  });
  list('zones', (z, p) => {
    if (!isObject(z) || !isString(z.zone_id) || !isString(z.name) || !isPoly(z.poly) || !isPoint(z.label))
      problems.push(`${p} is not a zone`);
    else if (!isNullable(isString)(z.ha_area_id) || !isNullable(isString)(z.active_entity) || !isNullable(isNumber)(z.ceiling_m))
      problems.push(`${p} has a bad ha_area_id, active_entity or ceiling_m`);
  });
  list('clip_regions', (c, p) => {
    if (!isObject(c) || !isString(c.clip_region_id) || !isPoly(c.poly)) problems.push(`${p} is not a clip region`);
  });
  list('zone_lines', (z, p) => {
    if (!isObject(z) || !isNumber(z.x) || !isNumber(z.y1)) problems.push(`${p} is not a zone line`);
  });
  list('annotations', (a, p) => {
    if (!isObject(a) || !isString(a.id) || !isPoint(a.at) || !isStringArray(a.lines)) problems.push(`${p} is not an annotation`);
  });
  const compass = plan.compass;
  if (!isObject(compass) || !isNumber(compass.x) || !isNumber(compass.y) || !isNumber(compass.rot))
    problems.push('plan.compass is not {x, y, rot}');
}

function checkQuestions(value: unknown, name: string, problems: string[], measurements: boolean) {
  if (!Array.isArray(value)) return problems.push(`${name} is not an array`);
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `${name}[${index}]`;
    if (!isObject(item) || !isString(item.id) || !isString(item.text) || !isStringArray(item.refs))
      return problems.push(`${path} is not a ${name} entry`);
    if (ids.has(item.id)) problems.push(`${path}.id ${item.id} is used twice`);
    ids.add(item.id);
    if (!isNullable(isString)(item.answer) || !isNullable(isString)(item.answered_at))
      problems.push(`${path} has a bad answer or answered_at`);
    if (measurements && (!isString(item.prio) || typeof item.applied !== 'boolean')) problems.push(`${path} has a bad prio or applied`);
  });
}

const WIFI_SOURCE_FIELDS = ['name', 'notify', 'signal', 'bssid', 'frequency'] as const;
const SERVICE_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;

function checkWifiSource(value: unknown, path: string, problems: string[]) {
  if (!isObject(value) || !WIFI_SOURCE_FIELDS.every(field => isString(value[field]))) {
    return problems.push(`${path} is not {name, notify, signal, bssid, frequency}`);
  }
  if (!SERVICE_PATTERN.test(value.notify as string)) problems.push(`${path}.notify is not a domain.service`);
}

function checkWifiAps(value: unknown, path: string, problems: string[]) {
  if (!isObject(value)) return problems.push(`${path} is not an object`);
  for (const [bssid, key] of Object.entries(value)) {
    if (normalizeBssid(bssid) === null) problems.push(`${path} holds ${bssid}, which is not a BSSID`);
    else if (!isString(key) || key === '') problems.push(`${path}.${bssid} is not a device key`);
  }
}

/** What is wrong with a candidate `sensor_map` document; an empty list means it can be used as it is. */
export function validateMapDoc(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(raw)) return ['the document is not an object'];
  if (raw.schema_version !== SCHEMA_VERSION) problems.push(`schema_version is ${String(raw.schema_version)}, expected ${SCHEMA_VERSION}`);
  if (!isNumber(raw.layout_version)) problems.push('layout_version is not a number');
  if (!isString(raw.updated_at)) problems.push('updated_at is not a string');
  checkPlan(raw.plan, problems);
  if (!Array.isArray(raw.types) || !raw.types.every(t => isObject(t) && isString(t.key) && isString(t.label)))
    problems.push('types is not a list of {key, label}');
  if (!isObject(raw.devices)) problems.push('devices is not an object');
  else for (const [key, device] of Object.entries(raw.devices)) checkDevice(device, `devices.${key}`, problems, true);
  checkQuestions(raw.questions, 'questions', problems, false);
  checkQuestions(raw.measurements, 'measurements', problems, true);
  for (const name of ['ignored_device_ids', 'observations', 'not_drawn', 'layer_notes'] as const) {
    if (raw[name] !== undefined && !isStringArray(raw[name])) problems.push(`${name} is not a string array`);
  }
  if (raw.phones !== undefined) {
    const phones = raw.phones;
    if (
      !Array.isArray(phones) ||
      !phones.every(p => isObject(p) && isString(p.name) && isString(p.bermuda_address) && isNullable(isString)(p.person))
    ) {
      problems.push('phones is not a list of {name, bermuda_address, person}');
    }
  }
  if (raw.suggest_log !== undefined) {
    const log = raw.suggest_log;
    if (!Array.isArray(log) || !log.every(e => isObject(e) && isString(e.id))) problems.push('suggest_log is not a list of {id, ...}');
  }
  if (raw.wifi !== undefined) {
    if (!isObject(raw.wifi)) problems.push('wifi is not an object');
    else {
      if (raw.wifi.source !== null) checkWifiSource(raw.wifi.source, 'wifi.source', problems);
      checkWifiAps(raw.wifi.aps, 'wifi.aps', problems);
    }
  }
  return problems;
}

/** The device types the page has a marker icon and a colour for, in the order the layer chips list them. */
export const KNOWN_TYPES: readonly TypeDef[] = [
  { key: 'ble', label: 'BLE scanner' },
  { key: 'presence', label: 'Presence radar' },
  { key: 'contact', label: 'Door/window contact' },
  { key: 'bed', label: 'Bed sensor' },
  { key: 'thermo', label: 'Thermostat / temperature' },
  { key: 'plug', label: 'Plug' },
  { key: 'speaker', label: 'Speaker' },
  { key: 'wifi', label: 'Wi-Fi AP' },
  { key: 'other', label: 'Other' },
];

/** `types` with every known type listed. One the document lacks goes in before "other", or last when there is no
 * "other"; the entries the document has keep their labels and their order. */
export function withKnownTypes(types: TypeDef[]): TypeDef[] {
  const missing = KNOWN_TYPES.filter(known => !types.some(type => type.key === known.key));
  if (missing.length === 0) return types;
  const other = types.findIndex(type => type.key === 'other');
  const at = other < 0 ? types.length : other;
  return [...types.slice(0, at), ...missing, ...types.slice(at)];
}

/** The document as the page works with it: validated, with the optional lists present and every known type listed.
 * Throws `DocError`. */
export function parseMapDoc(raw: unknown): MapDoc {
  const problems = validateMapDoc(raw);
  if (problems.length > 0) throw new DocError('sensor_map', problems);
  const doc = raw as MapDoc;
  return {
    ...doc,
    types: withKnownTypes(doc.types),
    ignored_device_ids: doc.ignored_device_ids ?? [],
    phones: doc.phones ?? [],
    observations: doc.observations ?? [],
    not_drawn: doc.not_drawn ?? [],
    layer_notes: doc.layer_notes ?? [],
    suggest_log: doc.suggest_log ?? [],
    wifi: doc.wifi ?? emptyWifiConfig(),
  };
}

export function validateSuggestDoc(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(raw)) return ['the document is not an object'];
  if (raw.schema_version !== SCHEMA_VERSION) problems.push(`schema_version is ${String(raw.schema_version)}, expected ${SCHEMA_VERSION}`);
  if (!isString(raw.updated_at)) problems.push('updated_at is not a string');
  if (!isNumber(raw.based_on_layout_version)) problems.push('based_on_layout_version is not a number');
  if (!Array.isArray(raw.items)) return [...problems, 'items is not an array'];
  const ids = new Set<string>();
  raw.items.forEach((item, index) => {
    const path = `items[${index}]`;
    if (!isObject(item) || !isString(item.id) || !isString(item.reason)) return problems.push(`${path} has no id or reason`);
    if (ids.has(item.id)) problems.push(`${path}.id ${item.id} is used twice`);
    ids.add(item.id);
    if (item.kind === 'placement') {
      if (!isString(item.device_key)) problems.push(`${path}.device_key is not a string`);
      checkPlacement(item.placement, `${path}.placement`, problems);
    } else if (item.kind === 'answer') {
      if (!isString(item.target) || !isString(item.answer)) problems.push(`${path} needs a string target and answer`);
    } else if (item.kind === 'new_device') {
      checkDevice(item.device, `${path}.device`, problems, false);
    } else if (item.kind === 'wifi') {
      if (item.source === undefined && item.aps === undefined) problems.push(`${path} has neither a source nor aps`);
      if (item.source !== undefined) checkWifiSource(item.source, `${path}.source`, problems);
      if (item.aps !== undefined) checkWifiAps(item.aps, `${path}.aps`, problems);
    } else if (item.kind === 'rename') {
      if (!isString(item.device_key) || !isString(item.name) || item.name.trim() === '')
        problems.push(`${path} needs a device_key and a name`);
    } else if (item.kind === 'phone') {
      const phone = item.phone;
      if (
        !isObject(phone) ||
        !isString(phone.name) ||
        phone.name.trim() === '' ||
        !isString(phone.bermuda_address) ||
        phone.bermuda_address.trim() === '' ||
        !isNullable(isString)(phone.person)
      )
        problems.push(`${path}.phone needs a name, a bermuda_address and a person that is a string or null`);
    } else {
      problems.push(`${path}.kind is not placement, answer, new_device, wifi, rename or phone`);
    }
  });
  return problems;
}

export function parseSuggestDoc(raw: unknown): SuggestDoc {
  const problems = validateSuggestDoc(raw);
  if (problems.length > 0) throw new DocError('sensor_map_suggest', problems);
  return raw as SuggestDoc;
}

function checkWifi(value: unknown, path: string, problems: string[]) {
  if (!isObject(value)) return problems.push(`${path} is not an object`);
  if (!isNullable(isNumber)(value.dbm)) problems.push(`${path}.dbm is not a number or null`);
  if (!Array.isArray(value.readings) || !value.readings.every(entry => isObject(entry) && isNumber(entry.dbm) && isString(entry.at)))
    problems.push(`${path}.readings is not a list of {dbm, at}`);
  if (!isNullable(isString)(value.bssid) || !isNullable(isNumber)(value.freq_mhz) || !isNullable(isString)(value.at))
    problems.push(`${path} has a bad bssid, freq_mhz or at`);
  if (value.band !== null && !WIFI_BANDS.includes(value.band as WifiBand)) problems.push(`${path}.band is not 2.4, 5, 6 or null`);
  if (!isObject(value.miss) || !Object.values(value.miss).every(reason => WIFI_MISSES.includes(reason as WifiMiss)))
    problems.push(`${path}.miss is not a map of field to reason`);
}

/** What is wrong with a candidate `sensor_map_fingerprints` document of the current version. */
export function validateFingerprintDoc(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(raw)) return ['the document is not an object'];
  if (raw.schema_version !== FINGERPRINT_SCHEMA_VERSION)
    problems.push(`schema_version is ${String(raw.schema_version)}, expected ${FINGERPRINT_SCHEMA_VERSION}`);
  if (!isString(raw.updated_at)) problems.push('updated_at is not a string');
  if (!isNumber(raw.limit_bytes) || raw.limit_bytes <= 0) problems.push('limit_bytes is not a positive number');
  if (!Array.isArray(raw.items)) return [...problems, 'items is not an array'];
  raw.items.forEach((item, index) => {
    const path = `items[${index}]`;
    if (
      !isObject(item) ||
      !isString(item.id) ||
      !isString(item.at) ||
      !isObject(item.pos) ||
      !isNumber(item.pos.x) ||
      !isNumber(item.pos.y)
    ) {
      return problems.push(`${path} has no id, at or pos`);
    }
    if (!isObject(item.scanners) || typeof item.weak !== 'boolean') problems.push(`${path} has no scanners or weak flag`);
    checkWifi(item.wifi, `${path}.wifi`, problems);
    if (!isNullable(isString)(item.survey_id)) problems.push(`${path}.survey_id is not a string or null`);
  });
  return problems;
}

/** A version 1 fingerprint document as version 2: every capture gets a Wi-Fi record that says it was not captured, and
 * no survey point. Anything else is returned as it is. */
export function migrateFingerprintDoc(raw: unknown): unknown {
  if (!isObject(raw) || raw.schema_version !== 1 || !Array.isArray(raw.items)) return raw;
  const items = raw.items.map(item => (isObject(item) ? { wifi: noWifi('not_captured'), survey_id: null, ...item } : item));
  return { ...raw, schema_version: FINGERPRINT_SCHEMA_VERSION, items };
}

export function parseFingerprintDoc(raw: unknown): FingerprintDoc {
  const migrated = migrateFingerprintDoc(raw);
  const problems = validateFingerprintDoc(migrated);
  if (problems.length > 0) throw new DocError('sensor_map_fingerprints', problems);
  return migrated as FingerprintDoc;
}

/** The commands that may write a key: only the suggestion document is open to `set`; `seed` writes the map
 * once, or a scratch copy of it for a trial run. */
export function writableByCommand(command: 'set-suggest' | 'seed', key: string): boolean {
  if (command === 'set-suggest') return key === SUGGEST_KEY;
  return key === MAP_KEY || key.startsWith(`${MAP_KEY}_scratch`);
}

export function isScanner(device: Pick<MapDevice, 'type' | 'roles' | 'ha'>): boolean {
  return device.type === 'ble' || device.roles.includes('ble') || device.ha.scanner_source !== null;
}

export function isRadar(device: Pick<MapDevice, 'type'>): boolean {
  return device.type === 'presence';
}

export function samePlacementGeometry(a: Placement, b: Placement): boolean {
  const pa = a.pos;
  const pb = b.pos;
  if ((pa === null) !== (pb === null)) return false;
  if (pa && pb && (pa.x !== pb.x || pa.y !== pb.y || pa.h !== pb.h)) return false;
  if (a.fov_deg !== b.fov_deg) return false;
  const fa = a.facing;
  const fb = b.facing;
  if (fa.state !== fb.state) return false;
  return fa.state !== 'known' || (fb.state === 'known' && fa.deg === fb.deg);
}

export type MapOp =
  | { kind: 'move'; key: string; at: string; x: number; y: number }
  | { kind: 'facing'; key: string; at: string; facing: Facing; fov_deg?: number | null }
  | { kind: 'height'; key: string; at: string; h: number | null }
  | { kind: 'confirm'; key: string; at: string; confirmed: boolean }
  | { kind: 'undo'; key: string; at: string }
  | { kind: 'unplace'; key: string; at: string }
  | { kind: 'place'; key: string; at: string; x: number; y: number; device: NewDevice }
  | { kind: 'type'; key: string; at: string; type: string }
  | { kind: 'ignore'; device_id: string; at: string }
  | { kind: 'answer'; id: string; at: string; answer: string | null }
  /** `place` accepts a placement or a new device at that spot instead of the one the suggestion proposes. */
  | { kind: 'accept'; item: SuggestItem; at: string; place?: Point }
  | { kind: 'reject'; id: string; at: string };

export type FingerprintOp = { kind: 'fingerprint'; item: Fingerprint; at: string } | { kind: 'remove_fingerprint'; id: string; at: string };

const DEFAULT_FOV_DEG = 120;

function pushHistory(history: HistoryEntry[], at: string, before: Placement): HistoryEntry[] {
  return [...history, { at, placement: before }].slice(-HISTORY_LIMIT);
}

function withPlacement(doc: MapDoc, key: string, device: MapDevice, next: Placement, at: string, history: HistoryEntry[]): MapDoc {
  const layoutChanged = isScanner(device) && !samePlacementGeometry(device.placement, next);
  return {
    ...doc,
    updated_at: at,
    layout_version: layoutChanged ? doc.layout_version + 1 : doc.layout_version,
    devices: { ...doc.devices, [key]: { ...device, placement: next, history } },
  };
}

function samePlacement(a: Placement, b: Placement): boolean {
  return samePlacementGeometry(a, b) && a.cert === b.cert && a.confirmed_at === b.confirmed_at;
}

/** Applies an edit of `key` made at `at`, keeping the placement before it for Undo. An edit that changes
 * nothing is dropped. */
function editPlacement(doc: MapDoc, key: string, at: string, edit: (placement: Placement) => Placement): MapDoc {
  const device = doc.devices[key];
  if (!device) return doc;
  const next = edit(device.placement);
  if (samePlacement(next, device.placement)) return doc;
  return withPlacement(doc, key, device, next, at, pushHistory(device.history, at, device.placement));
}

function withDefaultFov(placement: Placement, facing: Facing): number | null {
  return facing.state === 'known' ? (placement.fov_deg ?? DEFAULT_FOV_DEG) : placement.fov_deg;
}

/** Bermuda answers to an address in either case and names the device by the lower case form. */
export const samePhoneAddress = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `placement` put at `place`, which is a person's choice and so only known to the room; a height it carries stays. */
function droppedAt(placement: Placement, place: Point, height: number | null): Placement {
  return {
    ...placement,
    pos: { x: round2(place[0]), y: round2(place[1]), h: placement.pos?.h ?? height },
    cert: 'room',
    confirmed_at: null,
  };
}

function acceptItem(doc: MapDoc, item: SuggestItem, at: string, place?: Point): MapDoc {
  if (doc.suggest_log.some(entry => entry.id === item.id)) return doc;
  let next = doc;
  if (item.kind === 'placement') {
    const device = doc.devices[item.device_key];
    if (!device) return doc;
    const placement = place
      ? droppedAt(item.placement, place, device.placement.pos?.h ?? null)
      : item.placement.cert === 'confirmed' && !item.placement.confirmed_at
        ? { ...item.placement, confirmed_at: at }
        : item.placement;
    next = withPlacement(doc, item.device_key, device, placement, at, pushHistory(device.history, at, device.placement));
  } else if (item.kind === 'answer') {
    next = applyMapOp(doc, { kind: 'answer', id: item.target, at, answer: item.answer });
  } else if (item.kind === 'wifi') {
    const aps = { ...doc.wifi.aps };
    for (const [bssid, key] of Object.entries(item.aps ?? {})) {
      const normalized = normalizeBssid(bssid);
      if (normalized) aps[normalized] = key;
    }
    next = { ...doc, updated_at: at, wifi: { source: item.source ?? doc.wifi.source, aps } };
  } else if (item.kind === 'rename') {
    const device = doc.devices[item.device_key];
    if (!device) return doc;
    next = { ...doc, updated_at: at, devices: { ...doc.devices, [item.device_key]: { ...device, name: item.name.trim() } } };
  } else if (item.kind === 'phone') {
    const phone: Phone = { name: item.phone.name.trim(), bermuda_address: item.phone.bermuda_address.trim(), person: item.phone.person };
    const same = (known: Phone) => samePhoneAddress(known.bermuda_address, phone.bermuda_address);
    next = {
      ...doc,
      updated_at: at,
      phones: doc.phones.some(same) ? doc.phones.map(known => (same(known) ? phone : known)) : [...doc.phones, phone],
    };
  } else {
    const key = newDeviceKey(item.device, item.id);
    if (!doc.devices[key] && place) {
      const before: Placement = { ...item.device.placement, pos: null, cert: 'guess', confirmed_at: null };
      const dropped = droppedAt(item.device.placement, place, null);
      const added: MapDevice = { ...item.device, placement: dropped, history: [{ at, placement: before }] };
      const layoutChanged = isScanner(added) && !samePlacementGeometry(before, dropped);
      next = {
        ...doc,
        updated_at: at,
        layout_version: layoutChanged ? doc.layout_version + 1 : doc.layout_version,
        devices: { ...doc.devices, [key]: added },
      };
    } else if (!doc.devices[key]) {
      next = { ...doc, updated_at: at, devices: { ...doc.devices, [key]: { ...item.device, history: [] } } };
    }
  }
  const log = [...next.suggest_log, { id: item.id, accepted_at: at }].slice(-SUGGEST_LOG_LIMIT);
  return { ...next, updated_at: at, suggest_log: log };
}

/** The key a device gets in `devices`: its first Home Assistant device id, or the suggestion's id. */
export function newDeviceKey(device: Pick<MapDevice, 'ha'>, fallback: string): string {
  return device.ha.device_ids[0] ?? fallback;
}

export function applyMapOp(doc: MapDoc, op: MapOp): MapDoc {
  switch (op.kind) {
    case 'move':
      return editPlacement(doc, op.key, op.at, placement => ({
        ...placement,
        pos: { x: round2(op.x), y: round2(op.y), h: placement.pos?.h ?? null },
        cert: 'room',
        confirmed_at: null,
      }));
    case 'facing':
      return editPlacement(doc, op.key, op.at, placement => {
        const fov = op.fov_deg !== undefined ? op.fov_deg : withDefaultFov(placement, op.facing);
        const facing: Facing = op.facing.state === 'known' ? { state: 'known', deg: normalizeDeg(op.facing.deg) } : op.facing;
        return { ...placement, facing, fov_deg: fov };
      });
    case 'height':
      return editPlacement(doc, op.key, op.at, placement =>
        placement.pos ? { ...placement, pos: { ...placement.pos, h: op.h === null ? null : round2(op.h) } } : placement
      );
    case 'confirm':
      return editPlacement(doc, op.key, op.at, placement =>
        !placement.pos
          ? placement
          : op.confirmed
            ? { ...placement, cert: 'confirmed', confirmed_at: op.at }
            : { ...placement, cert: 'room', confirmed_at: null }
      );
    case 'undo': {
      const device = doc.devices[op.key];
      const entry = device?.history[device.history.length - 1];
      return device && entry ? withPlacement(doc, op.key, device, entry.placement, op.at, device.history.slice(0, -1)) : doc;
    }
    case 'unplace':
      return editPlacement(doc, op.key, op.at, placement => ({ ...placement, pos: null, cert: 'guess', confirmed_at: null }));
    case 'place': {
      const existing = doc.devices[op.key];
      const base: MapDevice = existing ?? { ...op.device, history: [] };
      const withDevice: MapDoc = existing ? doc : { ...doc, devices: { ...doc.devices, [op.key]: base } };
      return editPlacement(withDevice, op.key, op.at, placement => ({
        ...placement,
        pos: { x: round2(op.x), y: round2(op.y), h: placement.pos?.h ?? null },
        cert: 'room',
        confirmed_at: null,
      }));
    }
    case 'type': {
      const device = doc.devices[op.key];
      if (!device || device.type === op.type) return doc;
      return { ...doc, updated_at: op.at, devices: { ...doc.devices, [op.key]: { ...device, type: op.type } } };
    }
    case 'ignore':
      return doc.ignored_device_ids.includes(op.device_id)
        ? doc
        : { ...doc, updated_at: op.at, ignored_device_ids: [...doc.ignored_device_ids, op.device_id] };
    case 'answer': {
      const answer = op.answer === null || op.answer.trim() === '' ? null : op.answer.trim();
      const answeredAt = answer === null ? null : op.at;
      const update = <T extends Question>(list: T[]): T[] | null => {
        const index = list.findIndex(item => item.id === op.id);
        if (index < 0 || list[index].answer === answer) return null;
        return list.map((item, i) => (i === index ? { ...item, answer, answered_at: answeredAt } : item));
      };
      const questions = update(doc.questions);
      if (questions) return { ...doc, updated_at: op.at, questions };
      const measurements = update(doc.measurements);
      return measurements ? { ...doc, updated_at: op.at, measurements } : doc;
    }
    case 'accept':
      return acceptItem(doc, op.item, op.at, op.place);
    case 'reject':
      return doc.suggest_log.some(entry => entry.id === op.id)
        ? doc
        : { ...doc, updated_at: op.at, suggest_log: [...doc.suggest_log, { id: op.id, rejected_at: op.at }].slice(-SUGGEST_LOG_LIMIT) };
  }
}

/** Newest items last; while the serialized items exceed the document's byte limit the oldest are dropped. */
export function appendFingerprint(doc: FingerprintDoc, item: Fingerprint, at: string): { doc: FingerprintDoc; dropped: number } {
  if (doc.items.some(existing => existing.id === item.id)) return { doc, dropped: 0 };
  const sizes = [...doc.items, item].map(entry => utf8Length(JSON.stringify(entry)));
  const newest = sizes[sizes.length - 1];
  if (newest + 2 > doc.limit_bytes)
    throw new DocError('sensor_map_fingerprints', [`one fingerprint is ${newest} bytes, over the ${doc.limit_bytes} byte limit`]);
  let total = sizes.reduce((sum, size) => sum + size + 1, 1);
  let drop = 0;
  while (total > doc.limit_bytes && drop < sizes.length - 1) {
    total -= sizes[drop] + 1;
    drop += 1;
  }
  const items = [...doc.items, item].slice(drop);
  return { doc: { ...doc, updated_at: at, items }, dropped: drop };
}

export function applyFingerprintOp(doc: FingerprintDoc, op: FingerprintOp): FingerprintDoc {
  if (op.kind === 'fingerprint') return appendFingerprint(doc, op.item, op.at).doc;
  const items = doc.items.filter(item => item.id !== op.id);
  return items.length === doc.items.length ? doc : { ...doc, updated_at: op.at, items };
}

export function fingerprintBytes(doc: FingerprintDoc): number {
  return utf8Length(JSON.stringify(doc.items));
}
