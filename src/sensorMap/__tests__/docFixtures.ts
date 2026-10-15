import type { Fingerprint, FingerprintDoc, MapDevice, MapDoc, Placement, SuggestDoc } from '../mapDoc';
import { emptyFingerprintDoc, emptyMapDoc, emptySuggestDoc, noWifi } from '../mapDoc';

export const T0 = '2030-01-01T10:00:00.000Z';

export const SCANNER_A = '00:00:5E:00:53:01';
export const SCANNER_B = '00:00:5E:00:53:02';
export const SCANNER_C = '00:00:5E:00:53:03';
export const SCANNER_D = '00:00:5E:00:53:04';

export function placement(partial: Partial<Placement> = {}): Placement {
  return { pos: { x: 1, y: 1, h: null }, facing: { state: 'unknown' }, fov_deg: null, cert: 'room', confirmed_at: null, ...partial };
}

export function device(name: string, partial: Partial<MapDevice> = {}): MapDevice {
  return {
    name,
    type: 'contact',
    roles: [],
    model: 'Test model',
    ha: { device_ids: [], bindings: {}, scanner_source: null },
    zone_id: null,
    clip_region_id: null,
    placement: placement(),
    history: [],
    basis: '',
    notes: '',
    measure_ids: [],
    ...partial,
  };
}

/** Two rooms side by side, an L-shaped room beside them, a hall, and an open region over the first two. */
export function makeDoc(): MapDoc {
  const doc = emptyMapDoc(T0);
  doc.layout_version = 3;
  doc.plan = {
    units: 'm',
    origin: 'test corner',
    bounds: { x0: -1, x1: 13, y0: -1, y1: 9 },
    fit: { x0: -0.5, x1: 12.5, y0: -0.5, y1: 8.5 },
    scale_rms_cm: null,
    walls: [
      { x0: 0, x1: 12, y0: 0, y1: 0.1 },
      { x0: 0, x1: 0.1, y0: 0, y1: 8 },
      { x0: 3.95, x1: 4.05, y0: 0, y1: 4 },
    ],
    doors: [{ name: 'Test door', hinge: [4, 2], closed: [4, 3], open: [5, 2] }],
    windows: [{ name: 'Test window', box: [1, -0.05, 2, 0.05], door: false }],
    zones: [
      {
        zone_id: 'alpha',
        name: 'Alpha',
        poly: rect(0, 0, 4, 4),
        ha_area_id: 'alpha_area',
        active_entity: 'binary_sensor.alpha_active',
        label: [2, 2],
        ceiling_m: null,
      },
      {
        zone_id: 'beta',
        name: 'Beta',
        poly: rect(4, 0, 8, 4),
        ha_area_id: 'beta_area',
        active_entity: 'binary_sensor.beta_active',
        label: [6, 2],
        ceiling_m: null,
      },
      {
        zone_id: 'gamma',
        name: 'Gamma',
        poly: [
          [8, 0],
          [12, 0],
          [12, 6],
          [10, 6],
          [10, 4],
          [8, 4],
        ],
        ha_area_id: 'gamma_area',
        active_entity: null,
        label: [11, 2],
        ceiling_m: 2.4,
      },
      { zone_id: 'delta', name: 'Delta', poly: rect(0, 4, 4, 8), ha_area_id: null, active_entity: null, label: [2, 6], ceiling_m: null },
    ],
    clip_regions: [{ clip_region_id: 'open', poly: rect(0, 0, 8, 4) }],
    zone_lines: [{ x: 4, y1: 4 }],
    annotations: [{ id: 'a1', kind: 'room_label', at: [2, 6], lines: ['Delta'], rot: 0, small: false, outside: false }],
    compass: { x: 6, y: 6, rot: 0 },
  };
  doc.types = [
    { key: 'ble', label: 'BLE scanner' },
    { key: 'presence', label: 'Presence radar' },
    { key: 'contact', label: 'Contact' },
    { key: 'plug', label: 'Plug' },
    { key: 'other', label: 'Other' },
  ];
  doc.devices = {
    radar_a: device('Alpha radar', {
      type: 'presence',
      model: 'Radar FP-test',
      zone_id: 'alpha',
      clip_region_id: 'open',
      ha: {
        device_ids: ['dev-radar-a'],
        bindings: { presence: 'binary_sensor.alpha_radar_presence', range: 'number.alpha_radar_range' },
        scanner_source: null,
      },
      placement: placement({
        pos: { x: 1, y: 3, h: 2.5 },
        facing: { state: 'known', deg: 315 },
        fov_deg: 120,
        cert: 'confirmed',
        confirmed_at: T0,
      }),
    }),
    radar_b: device('Beta radar', {
      type: 'presence',
      zone_id: 'beta',
      ha: { device_ids: ['dev-radar-b'], bindings: { presence: 'binary_sensor.beta_radar_presence' }, scanner_source: null },
      placement: placement({ pos: { x: 6, y: 1, h: null }, facing: { state: 'unknown' }, fov_deg: null }),
    }),
    scan_a: device('Scanner A', {
      type: 'ble',
      zone_id: 'alpha',
      ha: { device_ids: ['dev-scan-a', 'dev-scan-a-bt'], bindings: {}, scanner_source: SCANNER_A },
      placement: placement({ pos: { x: 1, y: 1, h: 1 } }),
    }),
    scan_b: device('Scanner B', {
      type: 'ble',
      roles: ['plug'],
      zone_id: 'beta',
      ha: { device_ids: ['dev-scan-b'], bindings: { power: 'sensor.scanner_b_power' }, scanner_source: SCANNER_B },
      placement: placement({ pos: { x: 7, y: 3, h: 1 } }),
    }),
    scan_c: device('Scanner C', {
      type: 'ble',
      zone_id: 'gamma',
      ha: { device_ids: ['dev-scan-c'], bindings: {}, scanner_source: SCANNER_C },
      placement: placement({ pos: { x: 11, y: 1, h: 1 } }),
    }),
    door_1: device('Test door contact', {
      type: 'contact',
      zone_id: 'alpha',
      ha: { device_ids: ['dev-door-1'], bindings: { contact: 'binary_sensor.door_1_contact' }, scanner_source: null },
      placement: placement({ pos: { x: 4, y: 3, h: 1 } }),
    }),
    spare: device('Spare sensor', { type: 'other', placement: placement({ pos: null, cert: 'guess' }) }),
  };
  doc.questions = [
    { id: 'Q1', text: 'Which side is alpha?', refs: ['radar_a'], answer: null, answered_at: null },
    { id: 'Q2', text: 'Is the spare used?', refs: ['spare'], answer: 'no', answered_at: T0 },
  ];
  doc.measurements = [
    { id: 'M1', prio: 'A', text: 'Height of the alpha radar, in cm.', refs: ['radar_a'], answer: null, answered_at: null, applied: false },
  ];
  doc.phones = [{ name: 'Tester', bermuda_address: 'test-beacon-address', person: 'person.tester' }];
  return doc;
}

export function rect(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function makeSuggestDoc(): SuggestDoc {
  const doc = emptySuggestDoc(T0, 3);
  doc.items = [
    {
      id: 's-1',
      kind: 'placement',
      device_key: 'door_1',
      placement: placement({ pos: { x: 4, y: 2.5, h: 1.9 }, cert: 'room' }),
      reason: 'Measured answer',
    },
    { id: 's-2', kind: 'answer', target: 'Q1', answer: 'The left side', reason: 'Owner said so' },
  ];
  return doc;
}

export function makeFingerprint(id: string, partial: Partial<Fingerprint> = {}): Fingerprint {
  return {
    id,
    at: T0,
    phone: 'Tester',
    bermuda_address: 'test-beacon-address',
    pos: { x: 2, y: 2, h: 1 },
    zone_id: 'alpha',
    layout_version: 3,
    window_s: 10,
    polls: 5,
    room_active: { alpha: 'on', beta: 'off' },
    bermuda_area: 'alpha_area',
    scanners: { [SCANNER_A]: { device_key: 'scan_a', samples: 3, rssi: [-61, -63, -62], dist: [2.1, 2.4, 2.2] } },
    weak: false,
    note: '',
    wifi: noWifi('not_captured'),
    survey_id: null,
    ...partial,
  };
}

export function makeFingerprintDoc(limit?: number): FingerprintDoc {
  const doc = emptyFingerprintDoc(T0);
  if (limit !== undefined) doc.limit_bytes = limit;
  return doc;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID made at `ms`, as Home Assistant ids a context. */
export function ulidAt(ms: number): string {
  let time = '';
  let rest = ms;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  return `${time}ABCDEFGHJKMNPQRS`;
}
