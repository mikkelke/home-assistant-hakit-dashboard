import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureCancelled, abortableWait } from '../fingerprint';
import { ulidAt } from './docFixtures';
import {
  WIFI_COMMAND,
  WIFI_ROAM_TOLERANCE_MS,
  bandOf,
  emptyObserved,
  foldWifi,
  isUnavailable,
  median,
  observeWifi,
  parseDbm,
  parseFrequency,
  readWifi,
  runWifi,
  sendUpdateCommand,
  ulidTimeMs,
  wifiStatus,
  type WifiObserved,
  type WifiRead,
  type WifiRun,
} from '../wifi';

const T = Date.parse('2030-01-01T10:00:00.000Z');
const BSSID_A = '02:00:5e:10:00:0a';
const BSSID_B = '02:00:5e:10:00:0b';
const iso = (ms: number) => new Date(ms).toISOString();

const state = (value: string, at: number) => ({ state: value, last_updated: iso(at) });
const span = { from: T, to: T + 10_000 };

function observe(read: WifiRead[]): WifiObserved {
  return read.reduce(observeWifi, emptyObserved());
}

describe('reading the sensors', () => {
  it('takes a dBm that Android could have reported, and nothing else', () => {
    expect([parseDbm('-62'), parseDbm(' -71.5 '), parseDbm('-30')]).toEqual([-62, -71.5, -30]);
    expect([parseDbm('-127'), parseDbm('0'), parseDbm('12'), parseDbm(''), parseDbm('unknown'), parseDbm('-200')]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('takes a frequency in MHz and names its band', () => {
    expect(parseFrequency('5180')).toBe(5180);
    expect(parseFrequency('0')).toBeNull();
    expect(parseFrequency('abc')).toBeNull();
    expect([2412, 2484, 5180, 5825, 5955, 7115].map(bandOf)).toEqual(['2.4', '2.4', '5', '5', '6', '6']);
    expect([null, 2399, 2500, 5910, 7200].map(value => bandOf(value))).toEqual([null, null, null, null, null]);
  });

  it('takes the median of a list, and of an even list as the mean of the middle two', () => {
    expect([median([]), median([-60]), median([-70, -60, -65]), median([-70, -60, -64, -66])]).toEqual([null, -60, -65, -65]);
  });

  it('decodes the time a ULID was made at, and nothing from anything else', () => {
    expect(ulidTimeMs(ulidAt(T))).toBe(T);
    expect(ulidTimeMs(ulidAt(T).toLowerCase())).toBe(T);
    expect([ulidTimeMs('0123456789abcdef0123456789abcdef'), ulidTimeMs('short'), ulidTimeMs(null), ulidTimeMs(42)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('treats unavailable, unknown and empty as no reading', () => {
    expect(['unavailable', 'Unknown', '', ' none '].every(isUnavailable)).toBe(true);
    expect(isUnavailable('-60')).toBe(false);
  });

  it('keeps each distinct state of an entity once, in the order it was seen', () => {
    const observed = observe([
      { signal: state('-60', T) },
      { signal: state('-60', T) },
      { signal: state('-62', T + 2000), bssid: state(BSSID_A, T - 5000) },
      { signal: { state: '-62', last_updated: 'not a time' } },
      {},
    ]);
    expect(observed.signal).toEqual([
      { state: '-60', at: T },
      { state: '-62', at: T + 2000 },
    ]);
    expect(observed.bssid).toEqual([{ state: BSSID_A, at: T - 5000 }]);
    expect(observed.frequency).toEqual([]);
  });

  it('reads the three entities of a source from the store', () => {
    const entities = { 'sensor.s': state('-60', T), 'sensor.b': state(BSSID_A, T), 'sensor.f': { ...state('5180', T), extra: 1 } };
    const source = { signal: 'sensor.s', bssid: 'sensor.b', frequency: 'sensor.f' };
    expect(readWifi(entities, source)).toEqual({ signal: state('-60', T), bssid: state(BSSID_A, T), frequency: state('5180', T) });
    expect(readWifi({}, source)).toEqual({ signal: undefined, bssid: undefined, frequency: undefined });
  });

  it('says whether a capture can expect Wi-Fi', () => {
    const source = { name: 'P', notify: 'notify.x', signal: 'sensor.s', bssid: 'sensor.b', frequency: 'sensor.f' };
    expect(wifiStatus(null, {})).toBe('none');
    expect(wifiStatus(source, {})).toBe('missing');
    expect(wifiStatus(source, { signal: state('unavailable', T) })).toBe('offline');
    expect(wifiStatus(source, { signal: state('-60', T) })).toBe('ready');
  });
});

describe('the Wi-Fi record of a window', () => {
  const last = (signal: string, bssid = BSSID_A, frequency = '5180'): WifiRead => ({
    signal: state(signal, T + 1000),
    bssid: state(bssid, T - 3_600_000),
    frequency: state(frequency, T - 3_600_000),
  });

  it('keeps every reading stored inside the window, with their median, and the BSSID and band that held while they came', () => {
    const observed = observe([
      { signal: state('-70', T - 4000), bssid: state(BSSID_A, T - 3_600_000), frequency: state('5180', T - 3_600_000) },
      { signal: state('-62', T + 1000) },
      { signal: state('-64', T + 4000) },
      { signal: state('-90', T + 11_000) },
    ]);
    const wifi = foldWifi(observed, last('-90'), span, false);
    expect(wifi).toEqual({
      dbm: -63,
      readings: [
        { dbm: -62, at: iso(T + 1000) },
        { dbm: -64, at: iso(T + 4000) },
      ],
      bssid: BSSID_A,
      freq_mhz: 5180,
      band: '5',
      at: iso(T + 4000),
      miss: {},
    });
  });

  it('stores the BSSID in lower case with colons whatever the app sent', () => {
    const observed = observe([
      { signal: state('-62', T + 1000), bssid: state('02-00-5E-10-00-0A', T - 9000), frequency: state('2437', T - 9000) },
    ]);
    const wifi = foldWifi(observed, last('-62', '02-00-5E-10-00-0A', '2437'), span, false);
    expect([wifi.bssid, wifi.band]).toEqual([BSSID_A, '2.4']);
  });

  it('stores nothing, with the reason stale, when the only reading is from before the window', () => {
    const observed = observe([last('-62')].map(read => ({ ...read, signal: state('-62', T - 2000) })));
    const wifi = foldWifi(observed, { ...last('-62'), signal: state('-62', T - 2000) }, span, false);
    expect(wifi).toMatchObject({ dbm: null, readings: [], bssid: null, freq_mhz: null, band: null, at: null });
    expect(wifi.miss).toEqual({ dbm: 'stale', bssid: 'stale', freq: 'stale' });
  });

  it('blames the command when it failed and no reading came', () => {
    const observed = observe([{ signal: state('-62', T - 2000), bssid: state(BSSID_A, T - 2000), frequency: state('5180', T - 2000) }]);
    expect(foldWifi(observed, last('-62'), span, true).miss.dbm).toBe('command_failed');
    expect(foldWifi(observed, last('-62'), span, false).miss.dbm).toBe('stale');
  });

  it('keeps a reading that arrived even when the command failed, since something else caused it', () => {
    const observed = observe([{ signal: state('-62', T + 3000), bssid: state(BSSID_A, T - 2000), frequency: state('5180', T - 2000) }]);
    expect(foldWifi(observed, last('-62'), span, true).dbm).toBe(-62);
  });

  it('says a sensor is missing when its entity never showed up, and unavailable when it reports no value', () => {
    expect(foldWifi(emptyObserved(), {}, span, false).miss).toEqual({ dbm: 'no_entity', bssid: 'no_entity', freq: 'no_entity' });
    const observed = observe([
      { signal: state('unavailable', T + 1000), bssid: state('unknown', T + 1000), frequency: state('unavailable', T + 1000) },
    ]);
    const wifi = foldWifi(
      observed,
      { signal: state('unavailable', T + 1000), bssid: state('unknown', T + 1000), frequency: state('unavailable', T + 1000) },
      span,
      false
    );
    expect(wifi.miss).toEqual({ dbm: 'unavailable', bssid: 'unavailable', freq: 'unavailable' });
  });

  it('calls a value that is no dBm, BSSID or frequency invalid', () => {
    const read: WifiRead = {
      signal: state('-127', T + 1000),
      bssid: state('02:00:00:00:00:00', T + 1000),
      frequency: state('0', T + 1000),
    };
    const wifi = foldWifi(observe([read]), read, span, false);
    expect(wifi.miss).toEqual({ dbm: 'invalid', bssid: 'invalid', freq: 'invalid' });
    const notConnected: WifiRead = { ...read, bssid: state('<not connected>', T + 1000) };
    expect(foldWifi(observe([notConnected]), notConnected, span, false).miss.bssid).toBe('invalid');
  });

  it('keeps a BSSID that changed inside the window even when no signal reading came with it', () => {
    const observed = observe([
      { signal: state('-62', T - 2000), bssid: state(BSSID_A, T - 2000), frequency: state('5180', T - 2000) },
      { bssid: state(BSSID_B, T + 2000), frequency: state('5180', T - 2000) },
    ]);
    const wifi = foldWifi(
      observed,
      { signal: state('-62', T - 2000), bssid: state(BSSID_B, T + 2000), frequency: state('5180', T - 2000) },
      span,
      false
    );
    expect(wifi).toMatchObject({ dbm: null, bssid: BSSID_B, freq_mhz: null });
    expect(wifi.miss).toEqual({ dbm: 'stale', freq: 'stale' });
  });

  it('drops readings from before a move to another access point, and keeps the ones after', () => {
    const observed = observe([
      { signal: state('-58', T + 500), bssid: state(BSSID_A, T - 9000), frequency: state('5180', T - 9000) },
      { signal: state('-71', T + 6000), bssid: state(BSSID_B, T + 6000), frequency: state('5180', T - 9000) },
    ]);
    const wifi = foldWifi(
      observed,
      { signal: state('-71', T + 6000), bssid: state(BSSID_B, T + 6000), frequency: state('5180', T - 9000) },
      span,
      false
    );
    expect(wifi).toMatchObject({ dbm: -71, bssid: BSSID_B, readings: [{ dbm: -71, at: iso(T + 6000) }] });
    expect(wifi.miss).toEqual({});
  });

  it('allows the few milliseconds the app takes to store a BSSID and a signal that changed together', () => {
    const observed = observe([
      { signal: state('-71', T + 2000), bssid: state(BSSID_B, T + 2000 + WIFI_ROAM_TOLERANCE_MS - 1), frequency: state('5180', T - 9000) },
    ]);
    const wifi = foldWifi(
      observed,
      { signal: state('-71', T + 2000), bssid: state(BSSID_B, T + 2000 + WIFI_ROAM_TOLERANCE_MS - 1), frequency: state('5180', T - 9000) },
      span,
      false
    );
    expect(wifi.dbm).toBe(-71);
  });

  it('says roamed when every reading came before the move', () => {
    const observed = observe([
      { signal: state('-58', T + 500), bssid: state(BSSID_A, T - 9000), frequency: state('5180', T - 9000) },
      { bssid: state(BSSID_B, T + 8000) },
    ]);
    const wifi = foldWifi(
      observed,
      { signal: state('-58', T + 500), bssid: state(BSSID_B, T + 8000), frequency: state('5180', T - 9000) },
      span,
      false
    );
    expect(wifi.dbm).toBeNull();
    expect(wifi.miss.dbm).toBe('roamed');
  });

  it('counts the ends of the window as inside it', () => {
    const observed = observe([
      { signal: state('-60', T), bssid: state(BSSID_A, T - 9000), frequency: state('5180', T - 9000) },
      { signal: state('-61', T + 10_000) },
    ]);
    expect(foldWifi(observed, last('-61'), span, false).readings.map(reading => reading.dbm)).toEqual([-60, -61]);
  });
});

describe('the update command', () => {
  it('calls the notify service with the command and gives back the context id', async () => {
    const sendMessagePromise = vi.fn(async () => ({ context: { id: 'CTX' } }));
    expect(await sendUpdateCommand({ sendMessagePromise: sendMessagePromise as never }, 'notify.mobile_app_test_phone')).toBe('CTX');
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'call_service',
      domain: 'notify',
      service: 'mobile_app_test_phone',
      service_data: { message: WIFI_COMMAND },
    });
    expect(WIFI_COMMAND).toBe('command_update_sensors');
  });

  it('gives null when the answer carries no context id', async () => {
    expect(await sendUpdateCommand({ sendMessagePromise: (async () => null) as never }, 'notify.x')).toBeNull();
    expect(await sendUpdateCommand({ sendMessagePromise: (async () => ({ context: {} })) as never }, 'notify.x')).toBeNull();
  });
});

describe('running the Wi-Fi side of a capture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
  });
  afterEach(() => vi.useRealTimers());

  /** The page's clock is `skew` ms ahead of Home Assistant's. Entities change when `change` is called, stamped with HA's clock. */
  function harness(options: { skew?: number; fail?: boolean } = {}) {
    const skew = options.skew ?? 0;
    const haNow = () => Date.now() - skew;
    const entities: WifiRead = {
      signal: state('-70', T - skew - 600_000),
      bssid: state(BSSID_A, T - skew - 3_600_000),
      frequency: state('5180', T - skew - 3_600_000),
    };
    const controller = new AbortController();
    const send = vi.fn(async () => {
      if (options.fail) throw new Error('no such service');
      return ulidAt(haNow());
    });
    const progress: number[] = [];
    const run: WifiRun = {
      windowS: 10,
      send,
      read: () => entities,
      wait: abortableWait,
      now: Date.now,
      signal: controller.signal,
      onProgress: elapsed => progress.push(elapsed),
    };
    return {
      controller,
      send,
      progress,
      run,
      change: (value: string, field: keyof WifiRead = 'signal') => {
        entities[field] = { state: value, last_updated: iso(haNow()) };
      },
      start: () => runWifi(run),
    };
  }

  it('sends the command at the start and keeps the reading that follows it, with the BSSID that did not change', async () => {
    const h = harness();
    const result = h.start();
    expect(h.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1200);
    h.change('-61');
    await vi.advanceTimersByTimeAsync(9500);
    const { wifi, error } = await result;
    expect(error).toBeNull();
    expect(wifi).toMatchObject({ dbm: -61, bssid: BSSID_A, freq_mhz: 5180, band: '5', miss: {} });
    expect(wifi.readings).toHaveLength(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.progress[0]).toBe(0);
    expect(h.progress.at(-1)).toBe(10);
  });

  it('sends the command again at three and six seconds while nothing has changed, and then says stale', async () => {
    const h = harness();
    const result = h.start();
    await vi.advanceTimersByTimeAsync(2900);
    expect(h.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);
    const { wifi } = await result;
    expect(h.send).toHaveBeenCalledTimes(3);
    expect(wifi.dbm).toBeNull();
    expect(wifi.miss).toEqual({ dbm: 'stale', bssid: 'stale', freq: 'stale' });
  });

  it('does not send again when the signal entity does not exist, since the sensors are off', async () => {
    const h = harness();
    h.run.read = () => ({});
    const result = runWifi(h.run);
    await vi.advanceTimersByTimeAsync(12_000);
    const { wifi } = await result;
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(wifi.miss.dbm).toBe('no_entity');
  });

  it('does not send again once the signal has changed', async () => {
    const h = harness();
    const result = h.start();
    await vi.advanceTimersByTimeAsync(2000);
    h.change('-65');
    await vi.advanceTimersByTimeAsync(9000);
    await result;
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('places the window by the clock of Home Assistant, so a phone clock that runs ahead loses no reading', async () => {
    const h = harness({ skew: 4000 });
    const result = h.start();
    await vi.advanceTimersByTimeAsync(1500);
    h.change('-61');
    await vi.advanceTimersByTimeAsync(9500);
    expect((await result).wifi.dbm).toBe(-61);
  });

  it('places the window by the clock of Home Assistant when the phone clock runs behind, too', async () => {
    const h = harness({ skew: -4000 });
    const result = h.start();
    await vi.advanceTimersByTimeAsync(1500);
    h.change('-61');
    await vi.advanceTimersByTimeAsync(9500);
    expect((await result).wifi.dbm).toBe(-61);
  });

  it('does not take the reading from before the command for one in the window', async () => {
    const h = harness();
    vi.setSystemTime(T - 1000);
    h.change('-55');
    vi.setSystemTime(T);
    const result = h.start();
    await vi.advanceTimersByTimeAsync(11_000);
    const { wifi } = await result;
    expect(wifi.dbm).toBeNull();
  });

  it('keeps going without a window anchor when every command fails, and names the failure', async () => {
    const h = harness({ fail: true });
    const result = h.start();
    await vi.advanceTimersByTimeAsync(11_000);
    const { wifi, error } = await result;
    expect(error).toBe('no such service');
    expect(wifi.miss.dbm).toBe('command_failed');
    expect(h.send).toHaveBeenCalledTimes(3);
  });

  it('keeps the readings of the window even when the command failed, and reports no failure', async () => {
    const h = harness({ fail: true });
    const result = h.start();
    await vi.advanceTimersByTimeAsync(1000);
    h.change('-66');
    await vi.advanceTimersByTimeAsync(10_000);
    const { wifi, error } = await result;
    expect(wifi.dbm).toBe(-66);
    expect(error).toBe('no such service');
  });

  it('ends with CaptureCancelled when aborted and sends nothing more', async () => {
    const h = harness();
    const settled = h.start().then(
      () => 'done',
      failure => failure
    );
    await vi.advanceTimersByTimeAsync(1000);
    h.controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled).toBeInstanceOf(CaptureCancelled);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('is cancelled while it waits for a command that has not been answered', async () => {
    const h = harness();
    h.send.mockImplementation(() => new Promise<string>(() => {}));
    const settled = h.start().then(
      () => 'done',
      failure => failure
    );
    await vi.advanceTimersByTimeAsync(10_500);
    h.controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(await settled).toBeInstanceOf(CaptureCancelled);
  });

  it('stops waiting for a command nobody answers after two more seconds', async () => {
    const h = harness();
    h.send.mockImplementation(() => new Promise<string>(() => {}));
    const result = h.start();
    await vi.advanceTimersByTimeAsync(12_100);
    const { wifi } = await result;
    expect(wifi.miss.dbm).toBe('command_failed');
  });
});
