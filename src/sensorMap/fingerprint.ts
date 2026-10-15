import type { Advert, DeviceDump } from './bermuda';
import { zoneAt } from './geometry';
import type { Fingerprint, FingerprintScanner, FingerprintWifi, MapDevice, Zone } from './mapDoc';
import { normalizeMac } from './registry';

export const CAPTURE_WINDOW_S = 10;
export const CAPTURE_POLL_S = 2;
export const WEAK_BELOW_SCANNERS = 3;

export interface CaptureConfig {
  /** An empty `bermuda_address` means no Bluetooth is captured. */
  phone: { name: string; bermuda_address: string };
  pos: { x: number; y: number; h: number };
  layoutVersion: number;
  windowS: number;
}

interface ScannerSamples {
  rssi: number[];
  dist: (number | null)[];
}

/** A capture in progress. The first dump only sets the stamps to compare against: a sample is kept when a
 * scanner's stamp has moved since the dump before, so nothing from before the window, such as the walk to the
 * spot, can end up in it. */
export interface CaptureState {
  config: CaptureConfig;
  polls: number;
  stamps: Record<string, number>;
  samples: Record<string, ScannerSamples>;
  area: string | null;
}

export function startCapture(config: CaptureConfig, baseline: DeviceDump | null): CaptureState {
  const stamps: Record<string, number> = {};
  for (const advert of baseline?.adverts ?? []) stamps[advert.scanner] = advert.stamp;
  return { config, polls: 0, stamps, samples: {}, area: baseline?.areaId ?? null };
}

export function capturePoll(state: CaptureState, dump: DeviceDump | null): CaptureState {
  const stamps = { ...state.stamps };
  const samples: Record<string, ScannerSamples> = { ...state.samples };
  for (const advert of dump?.adverts ?? ([] as Advert[])) {
    const before = stamps[advert.scanner];
    stamps[advert.scanner] = Math.max(before ?? advert.stamp, advert.stamp);
    if (before === undefined || advert.stamp <= before || advert.rssi === null) continue;
    const kept = samples[advert.scanner] ?? { rssi: [], dist: [] };
    samples[advert.scanner] = { rssi: [...kept.rssi, advert.rssi], dist: [...kept.dist, advert.dist] };
  }
  return { ...state, polls: state.polls + 1, stamps, samples, area: dump ? dump.areaId : state.area };
}

export interface CaptureContext {
  at: string;
  note: string;
  zones: readonly Zone[];
  /** Device key by scanner address, for the scanners the map lists. */
  devices: Readonly<Record<string, MapDevice>>;
  roomActive: Record<string, string>;
  wifi: FingerprintWifi;
  surveyId: string | null;
}

export function fingerprintId(at: string): string {
  return `fp-${at
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('Z', '')}`;
}

export function finishCapture(state: CaptureState, context: CaptureContext): Fingerprint {
  const keyBySource = new Map<string, string>();
  for (const [key, device] of Object.entries(context.devices)) {
    if (device.ha.scanner_source) keyBySource.set(normalizeMac(device.ha.scanner_source), key);
  }
  const scanners: Record<string, FingerprintScanner> = {};
  for (const [scanner, kept] of Object.entries(state.samples)) {
    if (kept.rssi.length === 0) continue;
    scanners[scanner] = { device_key: keyBySource.get(scanner) ?? null, samples: kept.rssi.length, rssi: kept.rssi, dist: kept.dist };
  }
  const { pos } = state.config;
  return {
    id: fingerprintId(context.at),
    at: context.at,
    phone: state.config.phone.name,
    bermuda_address: state.config.phone.bermuda_address,
    pos: { x: pos.x, y: pos.y, h: pos.h },
    zone_id: zoneAt(context.zones, pos.x, pos.y)?.zone_id ?? null,
    layout_version: state.config.layoutVersion,
    window_s: state.config.windowS,
    polls: state.polls,
    room_active: context.roomActive,
    bermuda_area: state.area,
    scanners,
    weak: Object.keys(scanners).length < WEAK_BELOW_SCANNERS,
    note: context.note,
    wifi: context.wifi,
    survey_id: context.surveyId,
  };
}

export class CaptureCancelled extends Error {
  constructor() {
    super('capture cancelled');
    this.name = 'CaptureCancelled';
  }
}

export interface RunCapture {
  config: CaptureConfig;
  poll: () => Promise<DeviceDump | null>;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  onProgress?: (elapsedS: number) => void;
  pollS?: number;
}

/** Runs one capture window: a baseline dump, then a dump every `pollS` seconds until `windowS` have passed.
 * Aborting the signal ends it with `CaptureCancelled` and nothing is kept. */
export async function runCapture(run: RunCapture): Promise<CaptureState> {
  const pollS = run.pollS ?? CAPTURE_POLL_S;
  const guard = () => {
    if (run.signal.aborted) throw new CaptureCancelled();
  };
  let state = startCapture(run.config, await run.poll());
  guard();
  for (let elapsed = pollS; elapsed <= run.config.windowS + 1e-9; elapsed += pollS) {
    await run.wait(pollS * 1000, run.signal);
    guard();
    state = capturePoll(state, await run.poll());
    guard();
    run.onProgress?.(elapsed);
  }
  return state;
}

/** A wait that ends early, with `CaptureCancelled`, when the signal aborts. */
export function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CaptureCancelled());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CaptureCancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
