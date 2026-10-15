import { normalizeMac } from './registry';

/** One scanner's latest advert of a tracked device. `stamp` is the Home Assistant host's monotonic clock: it
 * says which of two adverts is newer, never when either arrived. */
export interface Advert {
  scanner: string;
  stamp: number;
  rssi: number | null;
  /** The distance Bermuda derived from this one RSSI sample, not its smoothed value, which blends in older samples. */
  dist: number | null;
}

export interface DeviceDump {
  address: string;
  areaId: string | null;
  adverts: Advert[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numeric = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The adverts of one device, a single entry per scanner: the newest. */
function parseAdverts(raw: unknown): Advert[] {
  if (!isObject(raw)) return [];
  const newest = new Map<string, Advert>();
  for (const value of Object.values(raw)) {
    if (!isObject(value) || typeof value.scanner_address !== 'string') continue;
    const stamp = numeric(value.stamp);
    if (stamp === null) continue;
    const scanner = normalizeMac(value.scanner_address);
    const known = newest.get(scanner);
    if (known && known.stamp >= stamp) continue;
    newest.set(scanner, { scanner, stamp, rssi: numeric(value.rssi), dist: numeric(value.rssi_distance_raw) });
  }
  return [...newest.values()];
}

/** Reads the response of `bermuda.dump_devices` into one entry per device, keyed by its lowercase address. */
export function parseDump(response: unknown): Record<string, DeviceDump> {
  const dump: Record<string, DeviceDump> = {};
  if (!isObject(response)) return dump;
  for (const [address, device] of Object.entries(response)) {
    if (!isObject(device)) continue;
    dump[address.toLowerCase()] = {
      address,
      areaId: typeof device.area_id === 'string' && device.area_id !== '' ? device.area_id : null,
      adverts: parseAdverts(device.adverts),
    };
  }
  return dump;
}

export function dumpOf(dump: Record<string, DeviceDump>, address: string): DeviceDump | null {
  return dump[address.toLowerCase()] ?? null;
}

/** The service data for `bermuda.dump_devices`. An empty address list is never sent: Bermuda answers that with
 * every device it has seen. */
export function dumpRequest(addresses: readonly string[]): { addresses: string; redact: false; configured_devices: false } | null {
  const list = addresses.map(address => address.trim()).filter(address => address !== '');
  return list.length === 0 ? null : { addresses: list.join(' '), redact: false, configured_devices: false };
}

interface DumpConnection {
  sendMessagePromise<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
}

/** Asks Bermuda for the named devices through `bermuda.dump_devices`; nothing is sent for an empty list. */
export async function fetchDump(connection: DumpConnection, addresses: readonly string[]): Promise<Record<string, DeviceDump>> {
  const request = dumpRequest(addresses);
  if (!request) return {};
  const reply = await connection.sendMessagePromise<{ response?: unknown }>({
    type: 'call_service',
    domain: 'bermuda',
    service: 'dump_devices',
    service_data: request,
    return_response: true,
  });
  return parseDump(reply?.response);
}
