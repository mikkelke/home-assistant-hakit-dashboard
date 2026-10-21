/**
 * Reads and writes the sensor map documents kept in Home Assistant's frontend system store.
 *
 *   npx tsx scripts/sensor-map.ts get [key] [--summary]
 *   npx tsx scripts/sensor-map.ts set-suggest <file|-> [--prune]
 *   npx tsx scripts/sensor-map.ts export-fingerprints <dir>
 *   npx tsx scripts/sensor-map.ts seed <file> [--force] [--key sensor_map_scratch...]
 *
 * `get` prints a document (default `sensor_map`). `set-suggest` is the only command that writes the suggestion
 * document, and the page reads it live; `--prune` first drops the items the map has already accepted or
 * rejected. `export-fingerprints` merges the current fingerprint set into `<dir>/<date>.json`, so nothing the
 * page later drops is lost. `seed` writes the map once and refuses when the key already holds a document unless
 * `--force`; the key can be a scratch copy, for a trial run. Every document written carries a fresh `write_id`
 * and `writer`, so a page that has the map open notices the change instead of writing over it.
 *
 * `set-suggest` takes `{ "items": [...] }`, each item one of
 *
 *   { id, kind: 'placement', device_key, placement, reason }
 *   { id, kind: 'answer', target, answer, reason }
 *   { id, kind: 'new_device', device, reason }
 *   { id, kind: 'rename', device_key, name, reason }
 *   { id, kind: 'wifi', source?, aps?, reason }
 *   { id, kind: 'phone', phone: { name, bermuda_address, person }, reason }
 *   { id, kind: 'furniture', furniture: { id, name, box: [x0, y0, x1, y1] }, reason }
 *
 * and replaces the whole document, so a file holds every item that should stay. The page writes an accepted item
 * into `sensor_map`; no command does. A `wifi` item names the phone a survey capture reads, as `source`
 * ({ name, notify: 'notify.mobile_app_<device>', signal, bssid, frequency }, the last three being entity ids), and
 * the BSSID table, as `aps`: the BSSID of each virtual access point, from the controller's `stat/device`
 * `vap_table`, to the map device key of the access point that owns it.
 * A `phone` item adds a tracked phone, or replaces the one with the same `bermuda_address`: the address Bermuda
 * names the device by, which `bermuda.dump_devices` takes in either case.
 * A `furniture` item draws a dashed outline on the plan; accepted, it joins `plan.furniture`, replacing the entry with
 * the same `furniture.id`. The `box` is in metres with x0 < x1 and y0 < y1, y up, like the box of a window in the plan.
 *
 * VITE_HA_URL and VITE_HA_TOKEN come from the environment, then `.env.development.local`, then `.env`. The
 * token must belong to an administrator: only administrators may write the system store.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import {
  DocError,
  FINGERPRINTS_KEY,
  MAP_KEY,
  SUGGEST_KEY,
  parseFingerprintDoc,
  parseMapDoc,
  parseSuggestDoc,
  writableByCommand,
  type SuggestDoc,
  type WriteStamp,
} from '../src/sensorMap/mapDoc.ts';

dotenv.config({ path: ['.env.development.local', '.env'], quiet: true });

const TIMEOUT_MS = 15_000;

class Failure extends Error {}

class HaClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as {
        id?: number;
        type: string;
        success?: boolean;
        result?: unknown;
        error?: { message?: string };
      };
      const pending = message.id === undefined ? undefined : this.waiting.get(message.id);
      if (!pending || message.id === undefined) return;
      this.waiting.delete(message.id);
      if (message.success === false) pending.reject(new Failure(message.error?.message ?? 'Home Assistant refused the command'));
      else pending.resolve(message.result);
    });
    socket.on('close', () => {
      for (const pending of this.waiting.values()) pending.reject(new Failure('The connection closed'));
      this.waiting.clear();
    });
  }

  static connect(baseUrl: string, token: string): Promise<HaClient> {
    const url = `${baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/websocket`;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Failure('Timed out connecting to Home Assistant'));
      }, TIMEOUT_MS);
      socket.on('error', error => {
        clearTimeout(timer);
        reject(new Failure(`Could not connect to Home Assistant: ${error.message}`));
      });
      const handshake = (raw: WebSocket.RawData) => {
        const message = JSON.parse(raw.toString()) as { type: string };
        if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
        else if (message.type === 'auth_ok') {
          clearTimeout(timer);
          socket.off('message', handshake);
          resolve(new HaClient(socket));
        } else if (message.type === 'auth_invalid') {
          clearTimeout(timer);
          reject(new Failure('Home Assistant rejected the access token'));
        }
      };
      socket.on('message', handshake);
    });
  }

  send<T>(message: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Failure('Home Assistant did not answer in time'));
      }, TIMEOUT_MS);
      this.waiting.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ ...message, id }));
    });
  }

  async get(key: string): Promise<unknown> {
    return (await this.send<{ value: unknown }>({ type: 'frontend/get_system_data', key })).value ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.send({ type: 'frontend/set_system_data', key, value });
  }

  close() {
    this.socket.close();
  }
}

/** The same document with every object's keys in order, so two reads compare equal whatever the key order. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, item]) => [k, sort(item)])
          )
        : v;
  return JSON.stringify(sort(value));
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      if (args[i] === '--key') i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function readJson(source: string): unknown {
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Failure(`${source} is not JSON: ${(error as Error).message}`);
  }
}

const stamped = <T extends object>(doc: T): T & WriteStamp => ({ ...doc, write_id: randomUUID(), writer: 'cli' });
const isScratch = (key: string) => key.startsWith(`${MAP_KEY}_scratch`);
const readableKeys = [MAP_KEY, SUGGEST_KEY, FINGERPRINTS_KEY];

function summary(key: string, doc: unknown): string {
  if (doc === null) return `${key}: no document`;
  const record = doc as Record<string, unknown>;
  if (key === SUGGEST_KEY)
    return `${key}: ${(record.items as unknown[]).length} items, based on layout ${String(record.based_on_layout_version)}, updated ${String(record.updated_at)}`;
  if (key === FINGERPRINTS_KEY) {
    const items = record.items as unknown[];
    return `${key}: ${items.length} items, ${Buffer.byteLength(JSON.stringify(items))} of ${String(record.limit_bytes)} bytes, updated ${String(record.updated_at)}`;
  }
  const map = parseMapDoc(doc);
  const devices = Object.values(map.devices);
  const answered = (list: { answer: string | null }[]) => list.filter(item => item.answer !== null).length;
  return [
    `${key}: layout ${map.layout_version}, updated ${map.updated_at}`,
    `  ${devices.length} devices (${devices.filter(d => d.placement.pos).length} placed), ${map.ignored_device_ids.length} ignored`,
    `  ${map.questions.length} questions (${answered(map.questions)} answered), ${map.measurements.length} measurements (${answered(map.measurements)} answered)`,
    `  ${map.suggest_log.length} suggestions decided`,
    `  wifi: ${map.wifi.source ? 'a source is set' : 'no source'}, ${Object.keys(map.wifi.aps).length} BSSIDs in the table`,
  ].join('\n');
}

export async function run(command: string, args: string[], client: Pick<HaClient, 'get' | 'set'>) {
  const free = positional(args);
  if (command === 'get') {
    const key = free[0] ?? MAP_KEY;
    if (!readableKeys.includes(key) && !isScratch(key)) throw new Failure(`unknown key ${key}`);
    const doc = await client.get(key);
    console.log(flag(args, 'summary') ? summary(key, doc) : JSON.stringify(doc, null, 2));
    return;
  }

  if (command === 'set-suggest') {
    if (!free[0]) throw new Failure('set-suggest needs a file, or - for standard input');
    if (!writableByCommand('set-suggest', SUGGEST_KEY)) throw new Failure('set-suggest may not write this key');
    const raw = readJson(free[0]) as Record<string, unknown>;
    const mapDoc = await client.get(MAP_KEY);
    const layout = mapDoc ? parseMapDoc(mapDoc).layout_version : 1;
    const full: SuggestDoc = parseSuggestDoc({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      based_on_layout_version: layout,
      ...raw,
    });
    let items = full.items;
    if (flag(args, 'prune') && mapDoc) {
      const decided = new Set(parseMapDoc(mapDoc).suggest_log.map(entry => entry.id));
      items = items.filter(item => !decided.has(item.id));
    }
    const doc = stamped({ ...full, items });
    await client.set(SUGGEST_KEY, doc);
    const back = await client.get(SUGGEST_KEY);
    if (canonical(back) !== canonical(doc)) throw new Failure('The suggestion document read back differs from what was written');
    console.log(`${SUGGEST_KEY}: wrote ${items.length} items based on layout ${doc.based_on_layout_version}`);
    return;
  }

  if (command === 'export-fingerprints') {
    const dir = free[0] ?? process.env.SENSOR_MAP_EXPORT_DIR;
    if (!dir) throw new Failure('export-fingerprints needs a directory, or SENSOR_MAP_EXPORT_DIR');
    const current = await client.get(FINGERPRINTS_KEY);
    if (current === null) throw new Failure('There is no fingerprint document to export');
    const doc = parseFingerprintDoc(current);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().slice(0, 10)}.json`);
    const before = existsSync(file) ? parseFingerprintDoc(JSON.parse(readFileSync(file, 'utf8'))).items : [];
    const byId = new Map([...before, ...doc.items].map(item => [item.id, item]));
    const items = [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
    writeFileSync(file, `${JSON.stringify({ ...doc, items }, null, 1)}\n`);
    console.log(`${file}: ${items.length} fingerprints (${doc.items.length} in the store)`);
    return;
  }

  if (command === 'seed') {
    if (!free[0]) throw new Failure('seed needs a file');
    const key = option(args, 'key') ?? MAP_KEY;
    if (!writableByCommand('seed', key)) throw new Failure(`seed may write ${MAP_KEY} or a ${MAP_KEY}_scratch key, not ${key}`);
    const doc = stamped(parseMapDoc(readJson(free[0])));
    const existing = await client.get(key);
    if (existing !== null && !flag(args, 'force')) {
      throw new Failure(`${key} already holds a document; seed refuses to replace it without --force`);
    }
    await client.set(key, doc);
    const back = await client.get(key);
    if (canonical(back) !== canonical(doc)) throw new Failure(`${key} read back differs from what was written`);
    console.log(`seeded ${summary(key, back)}`);
    return;
  }

  throw new Failure(`unknown command ${command}. Commands: get, set-suggest, export-fingerprints, seed`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log('Usage: sensor-map.ts <get|set-suggest|export-fingerprints|seed> ... (see the header of this file)');
    return;
  }
  const url = process.env.VITE_HA_URL;
  const token = process.env.VITE_HA_TOKEN;
  if (!url || !token) throw new Failure('VITE_HA_URL and VITE_HA_TOKEN must be set in the environment or in .env.development.local');
  const client = await HaClient.connect(url, token);
  try {
    await run(command, args, client);
  } finally {
    client.close();
  }
}

const fail = (error: unknown) => {
  if (error instanceof DocError) {
    console.error(`${error.message.split(':')[0]} is not a valid document:`);
    for (const problem of error.problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.error(error instanceof Failure ? error.message : error);
  process.exit(error instanceof Failure ? 1 : 2);
};

// A test imports this file for `run` and must not start the command line.
if (!process.env.VITEST) main().catch(fail);
