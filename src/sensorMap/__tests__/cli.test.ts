import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAP_KEY, SUGGEST_KEY, type MapDoc } from '../mapDoc';
import { SaveQueue } from '../saveQueue';
import { T0, makeDoc, makeFingerprintDoc, makeSuggestDoc } from './docFixtures';

vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));
const { run } = await import('../../../scripts/sensor-map.ts');

const data = new Map<string, unknown>();
const client = { get: async (key: string) => data.get(key) ?? null, set: async (key: string, value: unknown) => void data.set(key, value) };
let dir = '';
const file = (doc: unknown) => (writeFileSync(join(dir, 'in.json'), JSON.stringify(doc)), join(dir, 'in.json'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sensor-map-'));
  data.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

it('stamps a seed, so a page holding the old map conflicts instead of writing over the replacement', async () => {
  const old = makeDoc();
  data.set(MAP_KEY, old);
  const queue = new SaveQueue({ read: client.get, write: client.set }, { map: old, fingerprints: makeFingerprintDoc() });
  const renamed = { ...old, devices: { ...old.devices, door_1: { ...old.devices.door_1, name: 'Renamed by the command' } } };
  await run('seed', [file(renamed), '--force'], client);
  queue.apply({ target: 'map', op: { kind: 'move', key: 'door_1', at: T0, x: 9, y: 2 } });
  expect(await queue.flush()).toBe(false);
  expect(queue.getSnapshot().state).toBe('conflict');
  expect((data.get(MAP_KEY) as MapDoc).devices.door_1.name).toBe('Renamed by the command');
  queue.dispose();
});

it('gives every document it writes a fresh write_id and a writer, replacing any stamp the file carries', async () => {
  await run('seed', [file({ ...makeDoc(), write_id: 'from-file', writer: 'from-file' })], client);
  await run('set-suggest', [file(makeSuggestDoc())], client);
  const stamps = [MAP_KEY, SUGGEST_KEY].map(key => data.get(key) as { write_id?: string; writer?: string });
  expect(stamps.map(stamp => [typeof stamp.write_id, stamp.write_id === 'from-file', stamp.writer])).toEqual([
    ['string', false, 'cli'],
    ['string', false, 'cli'],
  ]);
});

it('writes a suggestion document that holds a Wi-Fi setup, a rename and a phone, and reads back what it wrote', async () => {
  const items = [
    ...makeSuggestDoc().items,
    {
      id: 's-wifi',
      kind: 'wifi',
      source: {
        name: 'Test phone',
        notify: 'notify.mobile_app_test_phone',
        signal: 'sensor.test_phone_wi_fi_signal_strength',
        bssid: 'sensor.test_phone_wi_fi_bssid',
        frequency: 'sensor.test_phone_wi_fi_frequency',
      },
      aps: { '02:00:5e:10:00:0a': 'ap_one' },
      reason: 'from the controller',
    },
    { id: 's-rename', kind: 'rename', device_key: 'door_1', name: 'Front door contact', reason: 'it is the front door' },
    {
      id: 's-phone',
      kind: 'phone',
      phone: { name: 'Test owner', bermuda_address: 'test-beacon-address-2', person: 'person.test_owner' },
      reason: 'Bermuda tracks it now',
    },
  ];
  await run('set-suggest', [file({ items })], client);
  expect((data.get(SUGGEST_KEY) as { items: { id: string }[] }).items.map(item => item.id)).toEqual([
    's-1',
    's-2',
    's-wifi',
    's-rename',
    's-phone',
  ]);
  await expect(run('set-suggest', [file({ items: [{ id: 's-bad', kind: 'wifi', reason: 'nothing in it' }] })], client)).rejects.toThrow();
  await expect(
    run(
      'set-suggest',
      [file({ items: [{ id: 's-bad', kind: 'phone', phone: { name: 'x', bermuda_address: '', person: null }, reason: 'no address' }] })],
      client
    )
  ).rejects.toThrow();
});

it('summarizes the Wi-Fi of the map', async () => {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
  data.set(MAP_KEY, { ...makeDoc(), wifi: { source: null, aps: { '02:00:5e:10:00:0a': 'ap_one' } } });
  await run('get', [MAP_KEY, '--summary'], client);
  expect(lines.join('\n')).toContain('wifi: no source, 1 BSSIDs in the table');
});
