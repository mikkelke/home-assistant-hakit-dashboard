import { CaptureCancelled } from './fingerprint';
import { normalizeBssid, type FingerprintWifi, type WifiBand, type WifiMiss, type WifiSource } from './mapDoc';

/** The message that makes the Android Companion app update all its sensors at once. */
export const WIFI_COMMAND = 'command_update_sensors';
/** How long the Wi-Fi part of a capture waits for a reading newer than its start. The app only sends a value that changed. */
export const WIFI_WAIT_S = 60;
/** Seconds between two sends of the command while no reading has arrived. */
export const WIFI_RESEND_S = 10;
export const WIFI_TICK_MS = 500;
/** How long after the window the page still waits for a command that has not been answered. */
const SETTLE_MS = 2000;
const TAIL_MS = 500;
/** A reading this far before the newest change of BSSID or frequency belongs to the access point before it. */
export const WIFI_ROAM_TOLERANCE_MS = 2000;

const UNAVAILABLE: ReadonlySet<string> = new Set(['unavailable', 'unknown', 'none', '']);
export const isUnavailable = (state: string): boolean => UNAVAILABLE.has(state.trim().toLowerCase());

const numberOf = (state: string): number | null => {
  const text = state.trim();
  const value = Number(text);
  return text !== '' && Number.isFinite(value) ? value : null;
};

/** Signal strength in dBm; Android reports -127 when it has none. */
export function parseDbm(state: string): number | null {
  const value = numberOf(state);
  return value !== null && value > -127 && value < 0 ? value : null;
}

export function parseFrequency(state: string): number | null {
  const value = numberOf(state);
  return value !== null && value >= 2300 && value <= 7200 ? value : null;
}

export function bandOf(mhz: number | null): WifiBand | null {
  if (mhz === null) return null;
  if (mhz >= 2400 && mhz < 2500) return '2.4';
  if (mhz >= 5000 && mhz <= 5900) return '5';
  if (mhz >= 5925 && mhz <= 7125) return '6';
  return null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The time in milliseconds a ULID was made at, which is how Home Assistant ids a context. */
export function ulidTimeMs(id: unknown): number | null {
  if (typeof id !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) return null;
  let ms = 0;
  for (const char of id.slice(0, 10).toUpperCase()) ms = ms * 32 + CROCKFORD.indexOf(char);
  return ms;
}

/** What the page reads of one entity. */
export interface WifiEntityState {
  state: string;
  last_updated: string;
}

export interface WifiRead {
  signal?: WifiEntityState;
  bssid?: WifiEntityState;
  frequency?: WifiEntityState;
}

type Field = keyof WifiRead;
const FIELDS: readonly Field[] = ['signal', 'bssid', 'frequency'];

/** Every distinct state an entity showed, with the time Home Assistant stored it. */
interface Seen {
  state: string;
  at: number;
}

export type WifiObserved = Record<Field, Seen[]>;

export const emptyObserved = (): WifiObserved => ({ signal: [], bssid: [], frequency: [] });

export function observeWifi(observed: WifiObserved, read: WifiRead): WifiObserved {
  let next = observed;
  for (const field of FIELDS) {
    const entity = read[field];
    const at = entity ? Date.parse(entity.last_updated) : Number.NaN;
    if (!entity || Number.isNaN(at)) continue;
    const list = next[field];
    const newest = list[list.length - 1];
    if (newest && newest.at === at && newest.state === entity.state) continue;
    next = { ...next, [field]: [...list, { state: entity.state, at }] };
  }
  return next;
}

export function readWifi(
  entities: Readonly<Record<string, WifiEntityState | undefined>>,
  source: Pick<WifiSource, 'signal' | 'bssid' | 'frequency'>
): WifiRead {
  const pick = (id: string): WifiEntityState | undefined => {
    const entity = entities[id];
    return entity ? { state: entity.state, last_updated: entity.last_updated } : undefined;
  };
  return { signal: pick(source.signal), bssid: pick(source.bssid), frequency: pick(source.frequency) };
}

export type WifiReady = 'none' | 'missing' | 'offline' | 'ready';

/** Whether a capture can expect Wi-Fi: a source is set, the signal entity exists, and it reports. */
export function wifiStatus(source: WifiSource | null, read: WifiRead): WifiReady {
  if (!source) return 'none';
  if (!read.signal) return 'missing';
  return isUnavailable(read.signal.state) ? 'offline' : 'ready';
}

/** The window readings count in, on Home Assistant's clock, in milliseconds. */
export interface WifiWindow {
  from: number;
  to: number;
}

const stateOf = (read: WifiRead, observed: WifiObserved, field: Field): string | null =>
  read[field]?.state ?? observed[field][observed[field].length - 1]?.state ?? null;

/**
 * The Wi-Fi record of a capture. A signal reading counts when Home Assistant stored it inside the window. The
 * Companion app only sends a sensor whose value changed, so a BSSID or a frequency that did not change says nothing
 * of its own: it is kept when a reading arrived in the window, which proves the sensors were read, or when it changed
 * in the window itself. A change of either inside the window means the phone moved to another access point, and
 * readings from before it are dropped.
 */
export function foldWifi(observed: WifiObserved, last: WifiRead, window: WifiWindow, commandFailed: boolean): FingerprintWifi {
  const inWindow = (seen: Seen) => seen.at >= window.from && seen.at <= window.to;
  const changes = [...observed.bssid, ...observed.frequency].filter(inWindow).map(seen => seen.at);
  const cut = changes.length > 0 ? Math.max(...changes) - WIFI_ROAM_TOLERANCE_MS : Number.NEGATIVE_INFINITY;

  const inside = observed.signal.filter(inWindow);
  const valid = inside.flatMap(seen => {
    const dbm = parseDbm(seen.state);
    return dbm === null ? [] : [{ dbm, at: seen.at }];
  });
  const kept = valid.filter(reading => reading.at >= cut);
  const miss: FingerprintWifi['miss'] = {};

  const missing = (field: Field): WifiMiss | null => {
    if (!last[field] && observed[field].length === 0) return 'no_entity';
    return isUnavailable(stateOf(last, observed, field) ?? '') ? 'unavailable' : null;
  };

  if (kept.length === 0) {
    miss.dbm =
      missing('signal') ?? (valid.length > 0 ? 'roamed' : inside.length > 0 ? 'invalid' : commandFailed ? 'command_failed' : 'stale');
  }

  const context = <T>(field: 'bssid' | 'frequency', key: 'bssid' | 'freq', parse: (state: string) => T | null): T | null => {
    const absent = missing(field);
    if (absent) {
      miss[key] = absent;
      return null;
    }
    const value = parse(stateOf(last, observed, field) ?? '');
    if (value === null) {
      miss[key] = 'invalid';
      return null;
    }
    if (kept.length === 0 && !observed[field].some(inWindow)) {
      miss[key] = 'stale';
      return null;
    }
    return value;
  };
  const bssid = context('bssid', 'bssid', normalizeBssid);
  const freq = context('frequency', 'freq', parseFrequency);

  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    dbm: median(kept.map(reading => reading.dbm)),
    readings: kept.map(reading => ({ dbm: reading.dbm, at: iso(reading.at) })),
    bssid,
    freq_mhz: freq,
    band: bandOf(freq),
    at: kept.length > 0 ? iso(kept[kept.length - 1].at) : null,
    miss,
  };
}

interface CommandConnection {
  sendMessagePromise<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
}

/** Tells the phone's Companion app to update its sensors now. Resolves with the id of the context Home Assistant made
 * for the call, which carries the time it was made at. */
export async function sendUpdateCommand(connection: CommandConnection, notify: string): Promise<string | null> {
  const [domain, service] = notify.split('.');
  const reply = await connection.sendMessagePromise<{ context?: { id?: unknown } } | null>({
    type: 'call_service',
    domain,
    service,
    service_data: { message: WIFI_COMMAND },
  });
  const id = reply?.context?.id;
  return typeof id === 'string' ? id : null;
}

export interface WifiRun {
  /** The capture window in seconds; readings are watched for at least this long. */
  windowS: number;
  /** The longest the run waits for a reading newer than its start, in seconds. Never less than the window. */
  waitS?: number;
  send: () => Promise<string | null>;
  read: () => WifiRead;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The page's clock in milliseconds. */
  now: () => number;
  signal: AbortSignal;
  /** Ends the wait for a reading when it aborts, and keeps what has come. Only the time after the window can be skipped. */
  skip?: AbortSignal;
  /** The seconds since the start, up to the window. */
  onProgress?: (elapsedS: number) => void;
  /** The seconds since the start, on every tick after the window while no reading newer than the start has come. */
  onWait?: (waitedS: number) => void;
  tickMs?: number;
  resendS?: number;
}

export interface WifiResult {
  wifi: FingerprintWifi;
  /** Why the command failed, when no command went through. */
  error: string | null;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs the Wi-Fi side of a capture: sends the update command, then watches the three entities. The Companion app only
 * sends a sensor whose value changed, so the run goes on after the window until a signal reading stored after the start
 * has come, up to `waitS`, and sends the command again every `resendS` seconds while none has. It ends at the window
 * when the signal entity does not exist, since nothing can come, and when `skip` aborts. The window is placed on Home
 * Assistant's clock by the time of the first command that went through, so a phone clock that is off does not matter,
 * and a reading from before the start is never used. Aborting `signal` ends it with `CaptureCancelled`.
 */
export async function runWifi(run: WifiRun): Promise<WifiResult> {
  const tick = run.tickMs ?? WIFI_TICK_MS;
  const resendMs = (run.resendS ?? WIFI_RESEND_S) * 1000;
  const windowMs = run.windowS * 1000;
  const waitMs = Math.max(windowMs, (run.waitS ?? WIFI_WAIT_S) * 1000);
  const guard = () => {
    if (run.signal.aborted) throw new CaptureCancelled();
  };
  const started = run.now();
  let observed = observeWifi(emptyObserved(), run.read());
  const before = observed.signal.length;
  let offset: number | null = null;
  let succeeded = 0;
  let failure: string | null = null;
  const flights: Promise<void>[] = [];

  const dispatch = () => {
    const sentAt = run.now();
    flights.push(
      new Promise<string | null>(resolve => resolve(run.send())).then(
        id => {
          succeeded += 1;
          const made = ulidTimeMs(id);
          if (offset === null && made !== null) offset = made - sentAt;
        },
        error => {
          failure ??= messageOf(error);
        }
      )
    );
  };

  /** Whether a reading stored after the start has come. It can only be told once a command was answered, which places the start. */
  const arrived = () =>
    (succeeded > 0 || failure !== null) && observed.signal.slice(before).some(seen => seen.at >= started + (offset ?? 0));

  dispatch();
  let nextSend = resendMs;
  let elapsed = 0;
  for (;;) {
    elapsed = run.now() - started;
    run.onProgress?.(Math.min(elapsed, windowMs) / 1000);
    const waiting = elapsed >= windowMs;
    const fresh = arrived();
    if (waiting && (fresh || elapsed >= waitMs || run.skip?.aborted || run.read().signal === undefined)) break;
    if (waiting) run.onWait?.(elapsed / 1000);
    if (elapsed >= nextSend) {
      nextSend += resendMs;
      if (!fresh && run.read().signal !== undefined) dispatch();
    }
    await run.wait(Math.min(tick, (waiting ? waitMs : windowMs) - elapsed), run.signal);
    guard();
    observed = observeWifi(observed, run.read());
  }
  await Promise.race([Promise.all(flights), run.wait(SETTLE_MS, run.signal)]);
  guard();
  observed = observeWifi(observed, run.read());

  const from = started + (offset ?? 0);
  const wifi = foldWifi(observed, run.read(), { from, to: from + elapsed + TAIL_MS }, succeeded === 0);
  return { wifi, error: succeeded > 0 ? null : failure };
}
