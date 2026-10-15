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
