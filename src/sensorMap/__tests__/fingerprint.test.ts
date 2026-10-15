import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceDump } from '../bermuda';
import {
  CAPTURE_POLL_S,
  CAPTURE_WINDOW_S,
  CaptureCancelled,
  abortableWait,
  capturePoll,
  finishCapture,
  fingerprintId,
  runCapture,
  startCapture,
  type CaptureConfig,
  type CaptureContext,
} from '../fingerprint';
import { noWifi, type FingerprintWifi } from '../mapDoc';
import { SCANNER_A, SCANNER_B, SCANNER_C, SCANNER_D, T0, makeDoc } from './docFixtures';

const config = (x = 2, y = 2): CaptureConfig => ({
  phone: { name: 'Tester', bermuda_address: 'test-beacon-address' },
  pos: { x, y, h: 1 },
  layoutVersion: 3,
  windowS: CAPTURE_WINDOW_S,
});

const dump = (area: string | null, adverts: Record<string, [number, number | null, number | null]>): DeviceDump => ({
  address: 'test-beacon-address',
  areaId: area,
  adverts: Object.entries(adverts).map(([scanner, [stamp, rssi, dist]]) => ({ scanner, stamp, rssi, dist })),
});

const doc = makeDoc();
const context = (): CaptureContext => ({
  at: '2030-01-01T10:42:33.000Z',
  note: '',
  zones: doc.plan.zones,
  devices: doc.devices,
  roomActive: { alpha: 'on', beta: 'off' },
  wifi: noWifi('not_captured'),
  surveyId: null,
});

describe('what a capture keeps', () => {
  it('keeps a sample only where the stamp moved since the dump before', () => {
    let state = startCapture(config(), dump('alpha_area', { [SCANNER_A]: [100, -60, 2], [SCANNER_B]: [100, -70, 5] }));
    state = capturePoll(state, dump('alpha_area', { [SCANNER_A]: [102, -61, 2.1], [SCANNER_B]: [100, -70, 5] }));
    state = capturePoll(state, dump('alpha_area', { [SCANNER_A]: [104, -63, 2.4], [SCANNER_B]: [100, -70, 5] }));
    expect(state.samples[SCANNER_A]).toEqual({ rssi: [-61, -63], dist: [2.1, 2.4] });
    expect(state.samples[SCANNER_B]).toBeUndefined();
    expect(state.polls).toBe(2);
  });

  it('ignores what was in the baseline dump itself, however fresh it looked then', () => {
    const state = startCapture(config(), dump(null, { [SCANNER_A]: [100, -60, 2] }));
    expect(state.samples).toEqual({});
  });

  it('does not count the first sighting of a scanner as a sample', () => {
    let state = startCapture(config(), dump(null, { [SCANNER_A]: [100, -60, 2] }));
    state = capturePoll(state, dump(null, { [SCANNER_A]: [100, -60, 2], [SCANNER_B]: [50, -70, 5] }));
    expect(state.samples[SCANNER_B]).toBeUndefined();
    state = capturePoll(state, dump(null, { [SCANNER_B]: [52, -71, 5.5] }));
    expect(state.samples[SCANNER_B]).toEqual({ rssi: [-71], dist: [5.5] });
  });

  it('stores a missing distance as null and skips a sample with no RSSI', () => {
    let state = startCapture(config(), dump(null, { [SCANNER_A]: [100, -60, 2] }));
    state = capturePoll(state, dump(null, { [SCANNER_A]: [101, -61, null] }));
    state = capturePoll(state, dump(null, { [SCANNER_A]: [102, null, 2] }));
    expect(state.samples[SCANNER_A]).toEqual({ rssi: [-61], dist: [null] });
  });

  it('keeps going when the phone is missing from a dump, and remembers its last area', () => {
    let state = startCapture(config(), dump('alpha_area', { [SCANNER_A]: [100, -60, 2] }));
    state = capturePoll(state, null);
    expect(state.polls).toBe(1);
    expect(state.area).toBe('alpha_area');
    state = capturePoll(state, dump('beta_area', { [SCANNER_A]: [102, -60, 2] }));
    expect(state.area).toBe('beta_area');
  });
});

describe('the saved fingerprint', () => {
  function captureWith(scanners: string[], x = 2, y = 2) {
    let state = startCapture(
      config(x, y),
      dump('alpha_area', Object.fromEntries(scanners.map(s => [s, [100, -60, 2] as [number, number, number]])))
    );
    for (const stamp of [102, 104, 106]) {
      state = capturePoll(
        state,
        dump('alpha_area', Object.fromEntries(scanners.map(s => [s, [stamp, -60 - stamp / 100, 2] as [number, number, number]])))
      );
    }
    return state;
  }

  it('carries the window, the polls, the layout, the zone and the room snapshot', () => {
    const item = finishCapture(captureWith([SCANNER_A, SCANNER_B, SCANNER_C]), context());
    expect(item).toMatchObject({
      id: 'fp-20300101-104233',
      at: '2030-01-01T10:42:33.000Z',
      phone: 'Tester',
      bermuda_address: 'test-beacon-address',
      pos: { x: 2, y: 2, h: 1 },
      zone_id: 'alpha',
      layout_version: 3,
      window_s: 10,
      polls: 3,
      room_active: { alpha: 'on', beta: 'off' },
      bermuda_area: 'alpha_area',
      weak: false,
    });
  });

  it('keys scanners by their address and names the map device beside each, or null for one the map does not list', () => {
    const item = finishCapture(captureWith([SCANNER_A, SCANNER_D, SCANNER_C]), context());
    expect(Object.keys(item.scanners).sort()).toEqual([SCANNER_A, SCANNER_C, SCANNER_D]);
    expect(item.scanners[SCANNER_A]).toMatchObject({ device_key: 'scan_a', samples: 3 });
    expect(item.scanners[SCANNER_C].device_key).toBe('scan_c');
    expect(item.scanners[SCANNER_D].device_key).toBeNull();
    expect(item.scanners[SCANNER_A].rssi).toHaveLength(3);
    expect(item.scanners[SCANNER_A].dist).toHaveLength(3);
  });

  it('is weak when fewer than three scanners gave a fresh sample', () => {
    expect(finishCapture(captureWith([SCANNER_A, SCANNER_B]), context()).weak).toBe(true);
    expect(finishCapture(captureWith([]), context()).weak).toBe(true);
    expect(finishCapture(captureWith([SCANNER_A, SCANNER_B, SCANNER_C]), context()).weak).toBe(false);
  });

  it('leaves a scanner with no fresh sample out', () => {
    let state = startCapture(config(), dump(null, { [SCANNER_A]: [100, -60, 2], [SCANNER_B]: [100, -60, 2] }));
    state = capturePoll(state, dump(null, { [SCANNER_A]: [102, -60, 2], [SCANNER_B]: [100, -60, 2] }));
    expect(Object.keys(finishCapture(state, context()).scanners)).toEqual([SCANNER_A]);
  });

  it('gives no zone on a boundary, outside every zone, or inside a region that is not a zone', () => {
    expect(finishCapture(captureWith([SCANNER_A], 4, 2), context()).zone_id).toBeNull();
    expect(finishCapture(captureWith([SCANNER_A], 9, 5), context()).zone_id).toBeNull();
    expect(finishCapture(captureWith([SCANNER_A], -2, -2), context()).zone_id).toBeNull();
    expect(finishCapture(captureWith([SCANNER_A], 11, 5), context()).zone_id).toBe('gamma');
    expect(finishCapture(captureWith([SCANNER_A], 6, 2), context()).zone_id).toBe('beta');
  });

  it('carries the Wi-Fi record and the survey point it was made for', () => {
    const wifi: FingerprintWifi = {
      dbm: -62,
      readings: [{ dbm: -62, at: '2030-01-01T10:42:30.000Z' }],
      bssid: '02:00:5e:10:00:0a',
      freq_mhz: 5180,
      band: '5',
      at: '2030-01-01T10:42:30.000Z',
      miss: {},
    };
    const item = finishCapture(captureWith([SCANNER_A, SCANNER_B, SCANNER_C]), { ...context(), wifi, surveyId: 'alpha-2' });
    expect(item.wifi).toEqual(wifi);
    expect(item.survey_id).toBe('alpha-2');
    expect(finishCapture(captureWith([SCANNER_A]), context())).toMatchObject({
      survey_id: null,
      wifi: { dbm: null, miss: { dbm: 'not_captured' } },
    });
  });

  it('holds Wi-Fi only for a phone that Bluetooth does not track', () => {
    const state = startCapture({ ...config(), phone: { name: 'Wi-Fi phone', bermuda_address: '' } }, null);
    const item = finishCapture(state, context());
    expect(item).toMatchObject({ phone: 'Wi-Fi phone', bermuda_address: '', scanners: {}, polls: 0, bermuda_area: null });
  });

  it('builds the id from the time', () => {
    expect(fingerprintId(T0)).toBe('fp-20300101-100000');
    expect(fingerprintId('2030-12-31T23:59:59.999Z')).toBe('fp-20301231-235959');
  });
});

describe('running a capture window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness() {
    const controller = new AbortController();
    let calls = 0;
    const poll = vi.fn(async () => {
      calls += 1;
      return dump('alpha_area', { [SCANNER_A]: [100 + calls * 2, -60, 2] });
    });
    const progress: number[] = [];
    const promise = runCapture({
      config: config(),
      poll,
      wait: abortableWait,
      signal: controller.signal,
      onProgress: s => progress.push(s),
    });
    return { controller, poll, progress, promise };
  }

  it('polls once for the baseline and then every two seconds for ten, which is five polls', async () => {
    const { poll, progress, promise } = harness();
    await vi.advanceTimersByTimeAsync(CAPTURE_WINDOW_S * 1000 + 100);
    const state = await promise;
    expect(poll).toHaveBeenCalledTimes(6);
    expect(state.polls).toBe(5);
    expect(state.samples[SCANNER_A].rssi).toHaveLength(5);
    expect(progress).toEqual([2, 4, 6, 8, 10]);
    expect(CAPTURE_POLL_S).toBe(2);
  });

  it('is cancelled by aborting, keeps nothing and stops polling', async () => {
    const { controller, poll, promise } = harness();
    const settled = promise.then(
      () => 'done',
      error => error
    );
    await vi.advanceTimersByTimeAsync(4100);
    const callsSoFar = poll.mock.calls.length;
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled).toBeInstanceOf(CaptureCancelled);
    expect(poll.mock.calls.length).toBe(callsSoFar);
  });

  it('refuses a wait on a signal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableWait(1000, controller.signal)).rejects.toBeInstanceOf(CaptureCancelled);
  });
});
