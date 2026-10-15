import type { MapDevice, MapDoc, NewDevice } from './mapDoc';

/** The part of a Home Assistant device registry entry the map reads. */
export interface RegistryDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  config_entries: string[];
  primary_config_entry?: string | null;
  disabled_by: string | null;
  entry_type: string | null;
  via_device_id: string | null;
  connections: [string, string][];
}

/** One Bluetooth scanner as `bluetooth/subscribe_scanner_details` reports it. */
export interface ScannerDetail {
  source: string;
  name: string;
  adapter?: string;
  scanner_type?: string;
}

/** Integrations whose devices are sensors or sensor hosts the map cares about. */
export const PLATFORM_ALLOWLIST: readonly string[] = [
  'mqtt',
  'esphome',
  'shelly',
  'salus',
  'withings',
  'yalexs_ble',
  'abb_welcome',
  'ecowitt_local',
  'sonos',
  'bluetooth',
];

export interface Candidate {
  /** The key the device gets in the map: its first registry device id. */
  id: string;
  device_ids: string[];
  name: string;
  model: string;
  platform: string;
  area_id: string | null;
  scanner_source: string | null;
  type: string;
}

export interface RegistryInput {
  devices: Record<string, RegistryDevice>;
  /** Config entry id to integration domain. */
  entryDomains: Record<string, string>;
  scanners: readonly ScannerDetail[];
  /** Every registry device id the map already lists, aliases included. */
  placedDeviceIds: ReadonlySet<string>;
  placedScanners: ReadonlySet<string>;
  ignored: readonly string[];
}

export const normalizeMac = (mac: string): string => mac.trim().toUpperCase();

const displayName = (device: RegistryDevice) => device.name_by_user || device.name || device.id;

function domainsOf(device: RegistryDevice, entryDomains: Record<string, string>): string[] {
  return device.config_entries.map(entry => entryDomains[entry]).filter((domain): domain is string => Boolean(domain));
}

/** Ubiquiti's UniFi access points, which have a UAP or U6 model name. */
const UNIFI_ACCESS_POINT = /\bubiquiti\b.*\b(UAP|U6)/i;

function guessType(model: string, platform: string, scanner: boolean): string {
  if (scanner) return 'ble';
  if (platform === 'sonos') return 'speaker';
  if (platform === 'withings') return 'bed';
  if (UNIFI_ACCESS_POINT.test(model)) return 'wifi';
  if (/presence|radar|FP300|ZG-20\d/i.test(model)) return 'presence';
  if (/contact|SNZB-04|PARASOLL/i.test(model)) return 'contact';
  if (/thermostat|SNZB-02|temperature/i.test(model)) return 'thermo';
  if (platform === 'shelly' || /plug/i.test(model)) return 'plug';
  return 'other';
}

/** The registry devices that are not on the map yet, one per physical thing. A Bluetooth entry that hangs off
 * another device (a Shelly or an ESPHome node) is the same object seen through the Bluetooth integration, and
 * a device named as an extension of the one it hangs off ("Meter Phase A" under "Meter") is a part of it, so
 * both join that device rather than standing on their own. A node behind a bridge is a thing of its own. */
export function buildCandidates(input: RegistryInput): Candidate[] {
  const { devices, entryDomains, scanners, placedDeviceIds, placedScanners } = input;
  const ignored = new Set(input.ignored);
  const scannerBySource = new Map(scanners.map(scanner => [normalizeMac(scanner.source), scanner]));

  const eligible = new Map<string, { device: RegistryDevice; domains: string[] }>();
  for (const device of Object.values(devices)) {
    if (device.disabled_by || device.entry_type === 'service') continue;
    const domains = domainsOf(device, entryDomains);
    if (!domains.some(domain => PLATFORM_ALLOWLIST.includes(domain))) continue;
    eligible.set(device.id, { device, domains });
  }

  const isBluetooth = (id: string) => eligible.get(id)?.domains.every(domain => domain === 'bluetooth') ?? false;

  const foldsInto = (id: string): string | null => {
    const parent = devices[id]?.via_device_id;
    if (!parent || !eligible.has(parent)) return null;
    if (isBluetooth(id)) return isBluetooth(parent) ? null : parent;
    const parentName = displayName(devices[parent]);
    const name = displayName(devices[id]);
    return name === parentName || name.startsWith(`${parentName} `) ? parent : null;
  };

  const rootOf = (id: string): string => {
    let current = id;
    for (let hops = 0; hops < 5; hops += 1) {
      const parent = foldsInto(current);
      if (!parent) break;
      current = parent;
    }
    return current;
  };

  const groups = new Map<string, string[]>();
  for (const id of eligible.keys()) {
    const root = rootOf(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }

  const candidates: Candidate[] = [];
  const claimedSources = new Set<string>();
  for (const [root, ids] of groups) {
    const head = eligible.get(root);
    if (!head) continue;
    const deviceIds = [root, ...ids.filter(id => id !== root)];
    const connection = deviceIds
      .flatMap(id => devices[id].connections)
      .find(([type, value]) => type === 'bluetooth' && scannerBySource.has(normalizeMac(value)));
    const source = connection ? normalizeMac(connection[1]) : null;
    if (source) claimedSources.add(source);
    if (deviceIds.some(id => placedDeviceIds.has(id) || ignored.has(id))) continue;
    if (source && placedScanners.has(source)) continue;
    const platform = head.domains.find(domain => domain !== 'bluetooth') ?? 'bluetooth';
    const model = [head.device.manufacturer, head.device.model].filter(Boolean).join(' ');
    candidates.push({
      id: root,
      device_ids: deviceIds,
      name: displayName(head.device),
      model,
      platform,
      area_id: head.device.area_id,
      scanner_source: source,
      type: guessType(model, platform, source !== null),
    });
  }

  for (const [source, scanner] of scannerBySource) {
    if (claimedSources.has(source) || placedScanners.has(source)) continue;
    const id = `scanner:${source}`;
    if (placedDeviceIds.has(id) || ignored.has(id)) continue;
    candidates.push({
      id,
      device_ids: [id],
      name: scanner.name,
      model: scanner.scanner_type ?? '',
      platform: 'bluetooth',
      area_id: null,
      scanner_source: source,
      type: 'ble',
    });
  }

  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every registry device id the map lists, and every scanner it holds, for `buildCandidates`. */
export function placedIdentities(doc: Pick<MapDoc, 'devices'>): { deviceIds: Set<string>; scanners: Set<string> } {
  const deviceIds = new Set<string>();
  const scanners = new Set<string>();
  for (const [key, device] of Object.entries(doc.devices)) {
    deviceIds.add(key);
    for (const id of device.ha.device_ids) deviceIds.add(id);
    if (device.ha.scanner_source) scanners.add(normalizeMac(device.ha.scanner_source));
  }
  return { deviceIds, scanners };
}

export function deviceFromCandidate(candidate: Candidate): NewDevice {
  return {
    name: candidate.name,
    type: candidate.type,
    roles: [],
    model: candidate.model,
    ha: { device_ids: candidate.device_ids, bindings: {}, scanner_source: candidate.scanner_source },
    zone_id: null,
    clip_region_id: null,
    placement: { pos: null, facing: { state: 'unknown' }, fov_deg: null, cert: 'guess', confirmed_at: null },
    basis: 'Added from the Home Assistant registry.',
    notes: '',
    measure_ids: [],
  };
}

export interface TrayItem {
  /** The key of an unplaced map device, or the candidate's id. */
  id: string;
  name: string;
  type: string;
  listed: boolean;
  candidate: Candidate | null;
}

/** The unplaced tray: map devices that have no position, then registry devices the map does not list. */
export function trayItems(devices: Record<string, MapDevice>, candidates: readonly Candidate[]): TrayItem[] {
  const listed = Object.entries(devices)
    .filter(([, device]) => device.placement.pos === null)
    .map(([id, device]) => ({ id, name: device.name, type: device.type, listed: true, candidate: null }));
  const fresh = candidates.map(candidate => ({ id: candidate.id, name: candidate.name, type: candidate.type, listed: false, candidate }));
  return [...listed, ...fresh];
}
