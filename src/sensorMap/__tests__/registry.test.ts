import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ALLOWLIST,
  buildCandidates,
  deviceFromCandidate,
  normalizeMac,
  placedIdentities,
  trayItems,
  type RegistryDevice,
  type RegistryInput,
} from '../registry';
import { SCANNER_A, SCANNER_B, SCANNER_C, device, makeDoc, placement } from './docFixtures';

const entryDomains: Record<string, string> = {
  'e-mqtt': 'mqtt',
  'e-shelly': 'shelly',
  'e-bt-1': 'bluetooth',
  'e-bt-2': 'bluetooth',
  'e-esphome': 'esphome',
  'e-sonos': 'sonos',
  'e-ma': 'music_assistant',
  'e-unifi': 'unifi',
  'e-zwave': 'zwave_js',
};

function reg(id: string, entry: string, partial: Partial<RegistryDevice> = {}): RegistryDevice {
  return {
    id,
    name: id,
    name_by_user: null,
    manufacturer: null,
    model: null,
    area_id: null,
    config_entries: [entry],
    disabled_by: null,
    entry_type: null,
    via_device_id: null,
    connections: [],
    ...partial,
  };
}

function input(devices: RegistryDevice[], partial: Partial<RegistryInput> = {}): RegistryInput {
  return {
    devices: Object.fromEntries(devices.map(d => [d.id, d])),
    entryDomains,
    scanners: [],
    placedDeviceIds: new Set(),
    placedScanners: new Set(),
    ignored: [],
    ...partial,
  };
}

const ids = (candidates: { id: string }[]) => candidates.map(c => c.id);

describe('the platform allowlist', () => {
  it('lists the integrations the map covers', () => {
    expect([...PLATFORM_ALLOWLIST].sort()).toEqual(
      ['abb_welcome', 'bluetooth', 'ecowitt_local', 'esphome', 'mqtt', 'salus', 'shelly', 'sonos', 'withings', 'yalexs_ble'].sort()
    );
  });

  it('offers devices of allowlisted integrations and nothing else', () => {
    const candidates = buildCandidates(
      input([reg('z1', 'e-mqtt'), reg('s1', 'e-shelly'), reg('u1', 'e-unifi'), reg('w1', 'e-zwave'), reg('m1', 'e-ma')])
    );
    expect(ids(candidates).sort()).toEqual(['s1', 'z1']);
  });

  it('skips disabled devices and service entries', () => {
    const candidates = buildCandidates(
      input([reg('z1', 'e-mqtt', { disabled_by: 'user' }), reg('z2', 'e-mqtt', { entry_type: 'service' }), reg('z3', 'e-mqtt')])
    );
    expect(ids(candidates)).toEqual(['z3']);
  });
});

describe('placed, aliased and ignored devices', () => {
  it('leaves out a device the map lists, and any alias recorded in device_ids', () => {
    const candidates = buildCandidates(
      input([reg('z1', 'e-mqtt'), reg('z2', 'e-mqtt'), reg('z3', 'e-mqtt')], { placedDeviceIds: new Set(['z1', 'z2']) })
    );
    expect(ids(candidates)).toEqual(['z3']);
  });

  it('leaves out ignored devices', () => {
    const candidates = buildCandidates(input([reg('z1', 'e-mqtt'), reg('z2', 'e-mqtt')], { ignored: ['z2'] }));
    expect(ids(candidates)).toEqual(['z1']);
  });

  it('collects the placed identities of a document, device ids and scanner sources alike', () => {
    const { deviceIds, scanners } = placedIdentities(makeDoc());
    expect(deviceIds.has('dev-scan-a-bt')).toBe(true);
    expect(deviceIds.has('radar_a')).toBe(true);
    expect([...scanners].sort()).toEqual([SCANNER_A, SCANNER_B, SCANNER_C]);
  });
});

describe('one chip per physical thing', () => {
  const shelly = reg('plug', 'e-shelly', { name: 'Test plug', manufacturer: 'Vendor', model: 'Plug S', area_id: 'kitchen' });
  const bluetooth = reg('plug-bt', 'e-bt-1', {
    name: 'Test plug (00:00:5E:00:53:0a)',
    via_device_id: 'plug',
    connections: [['bluetooth', '00:00:5e:00:53:0a']],
  });
  const scanners = [{ source: '00:00:5E:00:53:0A', name: 'Test plug (00:00:5E:00:53:0A)', adapter: 'Test plug', scanner_type: 'remote' }];

  it('folds a Bluetooth entry into the device it hangs off and carries its scanner source', () => {
    const [only, ...rest] = buildCandidates(input([shelly, bluetooth], { scanners }));
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      id: 'plug',
      device_ids: ['plug', 'plug-bt'],
      name: 'Test plug',
      platform: 'shelly',
      scanner_source: '00:00:5E:00:53:0A',
      type: 'ble',
      area_id: 'kitchen',
    });
  });

  it('shows nothing when the parent is already on the map, even if the Bluetooth entry is not recorded', () => {
    expect(buildCandidates(input([shelly, bluetooth], { scanners, placedDeviceIds: new Set(['plug']) }))).toEqual([]);
  });

  it('shows nothing when the scanner is already placed under another record', () => {
    expect(buildCandidates(input([shelly, bluetooth], { scanners, placedScanners: new Set(['00:00:5E:00:53:0A']) }))).toEqual([]);
  });

  it('does not fold anything else by its via device, such as a Zigbee node behind its bridge', () => {
    const bridge = reg('bridge', 'e-mqtt', { name: 'Bridge' });
    const node = reg('node', 'e-mqtt', { via_device_id: 'bridge', name: 'Node' });
    expect(ids(buildCandidates(input([bridge, node])))).toEqual(['bridge', 'node']);
  });

  it('keeps a Bluetooth entry with no eligible parent as its own chip', () => {
    const lone = reg('lone-bt', 'e-bt-2', { name: 'Lone', via_device_id: 'nope', connections: [['bluetooth', '00:00:5E:00:53:0B']] });
    const [only] = buildCandidates(input([lone], { scanners: [{ source: '00:00:5E:00:53:0B', name: 'Lone' }] }));
    expect(only).toMatchObject({ id: 'lone-bt', platform: 'bluetooth', scanner_source: '00:00:5E:00:53:0B', type: 'ble' });
  });

  it('adds a scanner with no registry device as a chip of its own, once', () => {
    const [only, ...rest] = buildCandidates(
      input([], { scanners: [{ source: '00:00:5e:00:53:0c', name: 'Orphan scanner', scanner_type: 'usb' }] })
    );
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      id: 'scanner:00:00:5E:00:53:0C',
      name: 'Orphan scanner',
      scanner_source: '00:00:5E:00:53:0C',
      type: 'ble',
    });
  });

  it('does not resurface the scanner of an ignored or placed device as a chip of its own', () => {
    const result = buildCandidates(input([shelly, bluetooth], { scanners, ignored: ['plug-bt'] }));
    expect(result).toEqual([]);
    const ignoredScanner = buildCandidates(
      input([], { scanners: [{ source: '00:00:5E:00:53:0C', name: 'x' }], ignored: ['scanner:00:00:5E:00:53:0C'] })
    );
    expect(ignoredScanner).toEqual([]);
  });

  it('prefers the name the user gave', () => {
    const [only] = buildCandidates(input([reg('z1', 'e-mqtt', { name: 'Raw name', name_by_user: 'Chosen name' })]));
    expect(only.name).toBe('Chosen name');
  });

  it('guesses a type from the model and platform', () => {
    const types = Object.fromEntries(
      buildCandidates(
        input([
          reg('a', 'e-mqtt', { model: 'Presence sensor FP300' }),
          reg('b', 'e-mqtt', { model: 'SNZB-04P' }),
          reg('c', 'e-mqtt', { model: 'SNZB-02P' }),
          reg('d', 'e-sonos', { model: 'Era 100' }),
          reg('e', 'e-shelly', { model: 'Gen3' }),
          reg('f', 'e-mqtt', { model: 'Something else' }),
        ])
      ).map(c => [c.id, c.type])
    );
    expect(types).toEqual({ a: 'presence', b: 'contact', c: 'thermo', d: 'speaker', e: 'plug', f: 'other' });
  });
});

describe('the unplaced tray', () => {
  it('lists map devices without a position first, then registry devices the map does not list', () => {
    const doc = makeDoc();
    const candidates = buildCandidates(input([reg('z9', 'e-mqtt', { name: 'Fresh node' })]));
    const items = trayItems(doc.devices, candidates);
    expect(items.map(item => [item.id, item.listed])).toEqual([
      ['spare', true],
      ['z9', false],
    ]);
  });

  it('turns a candidate into a device with no position and the guess certainty', () => {
    const [candidate] = buildCandidates(input([reg('z9', 'e-mqtt', { name: 'Fresh node', model: 'SNZB-04P' })]));
    const fresh = deviceFromCandidate(candidate);
    expect(fresh.type).toBe('contact');
    expect(fresh.ha).toEqual({ device_ids: ['z9'], bindings: {}, scanner_source: null });
    expect(fresh.placement).toEqual(placement({ pos: null, cert: 'guess' }));
    expect(device('x').history).toEqual([]);
  });

  it('normalizes a Bluetooth address', () => {
    expect(normalizeMac(' 00:00:5e:00:53:0a ')).toBe('00:00:5E:00:53:0A');
  });
});
