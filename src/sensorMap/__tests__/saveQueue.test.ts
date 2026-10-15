import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINGERPRINTS_KEY, MAP_KEY, type FingerprintDoc, type MapDoc, type MapOp } from '../mapDoc';
import { QUIET_MS, SaveQueue, WRITE_TIMEOUT_MS, loadDocs, type QueuedOp } from '../saveQueue';
import { T0, makeDoc, makeFingerprint, makeFingerprintDoc } from './docFixtures';

const at = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString();
const move = (n: number, x = n): QueuedOp => ({ target: 'map', op: { kind: 'move', key: 'door_1', at: at(n), x, y: 2 } });
const print = (id: string): QueuedOp => ({ target: 'fingerprints', op: { kind: 'fingerprint', item: makeFingerprint(id), at: at(1) } });
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/** Home Assistant's system store, with writes that can be held back, refused, or lost after they landed. */
function store(initial: Record<string, unknown> = { [MAP_KEY]: makeDoc(), [FINGERPRINTS_KEY]: makeFingerprintDoc() }) {
  const data = new Map(Object.entries(initial));
  const held: (() => void)[] = [];
  const ha = {
    data,
    writes: [] as { key: string; value: Record<string, unknown> }[],
    mode: 'land' as 'land' | 'hold' | 'refuse' | 'lose',
    read: async (key: string) => data.get(key) ?? null,
    write: (key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        ha.writes.push({ key, value: value as Record<string, unknown> });
        if (ha.mode === 'refuse') return reject(new Error('connection lost'));
        const land = () => (data.set(key, value), resolve());
        if (ha.mode === 'hold') held.push(land);
        else if (ha.mode === 'lose') data.set(key, value);
        else land();
      }),
    release: () => held.splice(0).forEach(land => land()),
    stored: (key = MAP_KEY) => data.get(key) as MapDoc & FingerprintDoc,
    x: () => ha.stored().devices.door_1.placement.pos?.x,
  };
  return ha;
}

function open(ha: ReturnType<typeof store>, writer = 'a') {
  let n = 0;
  const drafts = { save: vi.fn(), clear: vi.fn() };
  const docs = { map: ha.stored(MAP_KEY), fingerprints: ha.stored(FINGERPRINTS_KEY) ?? makeFingerprintDoc() };
  const queue = new SaveQueue({ read: ha.read, write: ha.write, drafts, newId: () => `${writer}-${++n}` }, docs);
  return { queue, drafts, state: () => queue.getSnapshot().state, doc: () => queue.getSnapshot().docs.map };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('saving whole documents', () => {
  it('is saved only after the acknowledgement of the whole stamped document, written after a read', async () => {
    const ha = store();
    const { queue, state } = open(ha);
    expect(state()).toBe('saved');
    queue.apply(move(1, 5));
    expect(state()).toBe('pending');
    ha.mode = 'hold';
    await tick(QUIET_MS - 1);
    expect(ha.writes).toHaveLength(0);
    await tick(1);
    await tick(5000);
    expect(state()).toBe('saving');
    ha.release();
    await tick();
    expect(state()).toBe('saved');
    expect(ha.writes).toHaveLength(1);
    expect(ha.writes[0]).toMatchObject({ key: MAP_KEY, value: { write_id: 'a-2', writer: 'a-1', layout_version: 3 } });
    expect(ha.x()).toBe(5);
  });

  it('writes once for several edits in the quiet period, and again, right behind it, for an edit made during a write', async () => {
    const ha = store();
    const { queue, state } = open(ha);
    queue.apply(move(1));
    await tick(600);
    queue.apply(move(2));
    await tick(600);
    expect(ha.writes).toHaveLength(0);
    ha.mode = 'hold';
    await tick(400);
    queue.apply(move(3));
    ha.release();
    await tick();
    expect(state()).toBe('saving');
    ha.release();
    await tick();
    expect([ha.writes.length, ha.x(), state()]).toEqual([2, 3, 'saved']);
  });

  it('writes only the document that changed, under its own key, and may write one nobody stamped or created', async () => {
    const ha = store({ [MAP_KEY]: makeDoc() });
    const { queue, state } = open(ha);
    queue.apply(print('fp-1'));
    await tick(QUIET_MS);
    expect(ha.writes.map(write => write.key)).toEqual([FINGERPRINTS_KEY]);
    queue.apply(move(1));
    await tick(QUIET_MS);
    expect(ha.writes.map(write => write.key)).toEqual([FINGERPRINTS_KEY, MAP_KEY]);
    expect(state()).toBe('saved');
    queue.apply({ target: 'map', op: { kind: 'move', key: 'nope', at: at(1), x: 1, y: 1 } });
    expect(state()).toBe('saved');
  });
});

describe('failing', () => {
  it('shows failed with the reason, keeps the latest document, and sends it again on flush', async () => {
    const ha = store();
    const { queue, state, doc } = open(ha);
    ha.mode = 'refuse';
    queue.apply(move(1, 5));
    await tick(QUIET_MS);
    expect(state()).toBe('failed');
    expect(queue.getSnapshot().error).toBe('connection lost');
    queue.apply(move(2, 6));
    await tick(QUIET_MS);
    ha.mode = 'land';
    expect(await queue.flush()).toBe(true);
    expect(ha.x()).toBe(6);
    expect(doc().devices.door_1.placement.pos?.x).toBe(6);
  });

  it('lands the latest document after a write whose acknowledgement was lost, however many edits came before', async () => {
    const ha = store();
    const { queue, state, doc } = open(ha);
    const ops: MapOp[] = [
      { kind: 'move', key: 'door_1', at: at(1), x: 2, y: 3 },
      { kind: 'move', key: 'door_1', at: at(2), x: 3, y: 3 },
      { kind: 'move', key: 'door_1', at: at(3), x: 2, y: 3 },
      { kind: 'confirm', key: 'door_1', at: at(4), confirmed: true },
      { kind: 'height', key: 'door_1', at: at(5), h: 2 },
      { kind: 'move', key: 'door_1', at: at(6), x: 3, y: 3 },
    ];
    ops.forEach(op => queue.apply({ target: 'map', op }));
    ha.mode = 'lose';
    await tick(QUIET_MS + WRITE_TIMEOUT_MS);
    expect(state()).toBe('failed');
    ha.mode = 'land';
    expect(await queue.flush()).toBe(true);
    expect(ha.stored().devices).toEqual(doc().devices);
    expect(ha.stored().devices.door_1.placement).toMatchObject({ pos: { x: 3, y: 3, h: 2 }, cert: 'room', confirmed_at: null });
    expect(ha.writes).toHaveLength(2);
  });

  it('resolves a flush false when the write fails, so a close can be refused, and true when nothing is unsaved', async () => {
    const ha = store();
    const { queue } = open(ha);
    expect(await queue.flush()).toBe(true);
    ha.mode = 'refuse';
    queue.apply(move(1));
    expect(await queue.flush()).toBe(false);
  });
});

describe('a document another writer changed', () => {
  async function elsewhere() {
    const ha = store();
    const page = open(ha, 'a');
    const other = open(ha, 'b');
    other.queue.apply(move(1, 4));
    await tick(QUIET_MS);
    page.queue.apply(move(2, 9));
    await tick(QUIET_MS);
    return { ha, page };
  }

  it('is not written over: the queue says so, keeps its document as a draft with the write it was edited from, and writes no more', async () => {
    const { ha, page } = await elsewhere();
    expect(page.state()).toBe('conflict');
    expect(ha.x()).toBe(4);
    expect(page.doc().devices.door_1.placement.pos?.x).toBe(9);
    page.queue.apply(move(3, 8));
    await tick(QUIET_MS);
    expect(await page.queue.flush()).toBe(false);
    expect(ha.writes).toHaveLength(1);
    page.queue.dispose();
    expect(page.drafts.save.mock.calls[0].slice(0, 2)).toEqual(['map', null]);
    expect(page.drafts.save.mock.calls[0][2].devices.door_1.placement.pos.x).toBe(8);
  });

  it('cannot be reverted by a second page saving from an earlier snapshot: markers and fingerprints alike', async () => {
    const ha = store();
    const first = open(ha, 'a');
    const second = open(ha, 'b');
    first.queue.apply(move(1, 4));
    first.queue.apply(print('fp-first'));
    await tick(QUIET_MS);
    second.queue.apply({ target: 'map', op: { kind: 'move', key: 'scan_a', at: at(2), x: 7, y: 7 } });
    second.queue.apply(print('fp-second'));
    await tick(QUIET_MS);
    expect(second.state()).toBe('conflict');
    expect(ha.stored().devices.scan_a.placement.pos?.x).toBe(1);
    expect(ha.stored(FINGERPRINTS_KEY).items.map(item => item.id)).toEqual(['fp-first']);
  });
});

describe('drafts', () => {
  it('keeps what was never acknowledged, with the write it was edited from, and nothing when all is saved', async () => {
    const ha = store();
    const clean = open(ha);
    clean.queue.dispose();
    expect(clean.drafts.save).not.toHaveBeenCalled();

    const { queue, drafts } = open(ha, 'b');
    ha.mode = 'refuse';
    queue.apply(move(1, 5));
    queue.apply(print('fp-1'));
    await tick(QUIET_MS);
    queue.dispose();
    expect(drafts.save.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['map', null],
      ['fingerprints', null],
    ]);
    expect(drafts.save.mock.calls[0][2].devices.door_1.placement.pos.x).toBe(5);
  });

  it('is cleared by a write acknowledged after the page is gone', async () => {
    const ha = store();
    const { queue, drafts } = open(ha);
    queue.apply(move(1, 5));
    ha.mode = 'hold';
    void queue.flush();
    queue.dispose();
    await tick();
    ha.release();
    await tick();
    expect(drafts.save).toHaveBeenCalledTimes(1);
    expect(drafts.clear).toHaveBeenCalledWith('map');
    expect(ha.x()).toBe(5);
  });

  it('is made the local document by restore, and saved like an edit', async () => {
    const ha = store();
    const { queue, state, doc } = open(ha);
    const kept = { ...makeDoc(), devices: { ...makeDoc().devices, door_1: { ...makeDoc().devices.door_1, name: 'Restored' } } };
    queue.restore([{ key: 'map', base: null, savedAt: at(8), doc: kept }]);
    expect([state(), doc().devices.door_1.name]).toEqual(['pending', 'Restored']);
    await tick(QUIET_MS);
    expect([ha.stored().devices.door_1.name, state()]).toEqual(['Restored', 'saved']);
  });
});

it('loads both documents, and has none to edit without a map', async () => {
  expect((await loadDocs(store().read))?.map.devices.door_1.name).toBe('Test door contact');
  expect(await loadDocs(async () => null)).toBeNull();
  expect((await loadDocs(async key => (key === MAP_KEY ? makeDoc() : null)))?.fingerprints.items).toEqual([]);
});
