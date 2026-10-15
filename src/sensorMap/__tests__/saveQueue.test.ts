import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINGERPRINTS_KEY, MAP_KEY, applyMapOp, type FingerprintDoc, type MapDoc, type MapOp, type SystemKey } from '../mapDoc';
import { QUIET_MS, SaveQueue, WRITE_TIMEOUT_MS, type QueueDocs, type QueueSnapshot } from '../saveQueue';
import { makeDoc, makeFingerprint, makeFingerprintDoc, T0 } from './docFixtures';

const at = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString();

type Call = { key: SystemKey; value: MapDoc | FingerprintDoc; resolve: () => void; reject: (error: Error) => void };

function setup(docs: QueueDocs = { map: makeDoc(), fingerprints: makeFingerprintDoc() }) {
  const calls: Call[] = [];
  const queue = new SaveQueue(
    {
      write: (key, value) =>
        new Promise<void>((resolve, reject) => {
          calls.push({ key, value: value as MapDoc | FingerprintDoc, resolve, reject });
        }),
    },
    docs
  );
  const snapshots: QueueSnapshot[] = [];
  queue.subscribe(() => snapshots.push(queue.getSnapshot()));
  return { queue, calls, snapshots };
}

const move = (n: number, x = n): { target: 'map'; op: MapOp } => ({
  target: 'map',
  op: { kind: 'move', key: 'door_1', at: at(n), x, y: 2 },
});

describe('saving', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts saved, goes pending with an edit, saving a second later, and saved only after the acknowledgement', async () => {
    const { queue, calls } = setup();
    expect(queue.getSnapshot().state).toBe('saved');
    queue.apply(move(1));
    expect(queue.getSnapshot()).toMatchObject({ state: 'pending', pending: 1 });
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(queue.getSnapshot().state).toBe('saving');

    await vi.advanceTimersByTimeAsync(5000);
    expect(queue.getSnapshot().state).toBe('saving');

    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()).toMatchObject({ state: 'saved', pending: 0, error: null });
  });

  it('applies an edit to the document at once and writes the whole document under its key', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1, 5));
    expect(queue.getSnapshot().docs.map.devices.door_1.placement.pos?.x).toBe(5);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls[0].key).toBe(MAP_KEY);
    expect((calls[0].value as MapDoc).devices.door_1.placement.pos?.x).toBe(5);
  });

  it('writes once for several edits within the quiet period', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    await vi.advanceTimersByTimeAsync(600);
    queue.apply(move(2));
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toHaveLength(1);
    expect((calls[0].value as MapDoc).devices.door_1.history).toHaveLength(2);
  });

  it('writes each document under its own key', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    queue.apply({ target: 'fingerprints', op: { kind: 'fingerprint', item: makeFingerprint('fp-1'), at: at(2) } });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls.map(call => call.key).sort()).toEqual([FINGERPRINTS_KEY, MAP_KEY].sort());
    calls.forEach(call => call.resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot().state).toBe('saved');
  });

  it('writes only the document that changed', async () => {
    const { queue, calls } = setup();
    queue.apply({ target: 'fingerprints', op: { kind: 'fingerprint', item: makeFingerprint('fp-1'), at: at(1) } });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls.map(call => call.key)).toEqual([FINGERPRINTS_KEY]);
  });

  it('keeps an edit made during a write and writes it afterwards', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    queue.apply(move(2));
    expect(queue.getSnapshot()).toMatchObject({ state: 'saving', pending: 2 });
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()).toMatchObject({ state: 'pending', pending: 1 });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls).toHaveLength(2);
    expect((calls[1].value as MapDoc).devices.door_1.history).toHaveLength(2);
    calls[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot().state).toBe('saved');
  });
});

describe('failing and retrying', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows failed with the reason when Home Assistant refuses, and keeps the edit', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1, 5));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    calls[0].reject(new Error('connection lost'));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()).toMatchObject({ state: 'failed', pending: 1, error: 'connection lost' });
    expect(queue.getSnapshot().docs.map.devices.door_1.placement.pos?.x).toBe(5);
  });

  it('shows failed when no answer comes within ten seconds, and ignores a late acknowledgement', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    expect(queue.getSnapshot().state).toBe('failed');
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()).toMatchObject({ state: 'failed', pending: 1 });
  });

  it('retries with the kept edit and reaches saved', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1, 5));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    calls[0].reject(new Error('down'));
    await vi.advanceTimersByTimeAsync(0);

    const retried = queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot().state).toBe('saving');
    expect(calls).toHaveLength(2);
    expect((calls[1].value as MapDoc).devices.door_1.placement.pos?.x).toBe(5);
    calls[1].resolve();
    expect(await retried).toBe(true);
    expect(queue.getSnapshot()).toMatchObject({ state: 'saved', pending: 0 });
  });

  it('retries by itself when another edit comes in after a failure', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    calls[0].reject(new Error('down'));
    await vi.advanceTimersByTimeAsync(0);
    queue.apply(move(2));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls).toHaveLength(2);
    expect((calls[1].value as MapDoc).devices.door_1.history).toHaveLength(2);
  });

  it('counts a failure of either document as a failure of the save', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    queue.apply({ target: 'fingerprints', op: { kind: 'fingerprint', item: makeFingerprint('fp-1'), at: at(2) } });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    calls.find(call => call.key === MAP_KEY)?.resolve();
    calls.find(call => call.key === FINGERPRINTS_KEY)?.reject(new Error('too large'));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()).toMatchObject({ state: 'failed', pending: 2 });
  });
});

describe('flushing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes at once without waiting for the quiet period and resolves true after the acknowledgement', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    const flushed = queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    let settled = false;
    void flushed.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    calls[0].resolve();
    expect(await flushed).toBe(true);
    await vi.advanceTimersByTimeAsync(QUIET_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it('resolves true at once when nothing is pending', async () => {
    const { queue, calls } = setup();
    expect(await queue.flush()).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('resolves false when the write fails, so a close can be refused', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    const flushed = queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    calls[0].reject(new Error('down'));
    expect(await flushed).toBe(false);
    expect(queue.getSnapshot().state).toBe('failed');
  });

  it('waits for a write already under way and then writes what came after it', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    queue.apply(move(2));
    const flushed = queue.flush();
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    calls[1].resolve();
    expect(await flushed).toBe(true);
  });
});

describe('after a reconnect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('puts the edits that were never acknowledged on top of the fresh document and writes once', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1, 5));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    calls[0].reject(new Error('connection lost'));
    await vi.advanceTimersByTimeAsync(0);

    const fresh: QueueDocs = { map: makeDoc(), fingerprints: makeFingerprintDoc() };
    const done = queue.reconnect(fresh);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect((calls[1].value as MapDoc).devices.door_1.placement.pos?.x).toBe(5);
    expect((calls[1].value as MapDoc).devices.door_1.history).toHaveLength(1);
    calls[1].resolve();
    expect(await done).toBe(true);
    expect(queue.getSnapshot()).toMatchObject({ state: 'saved', pending: 0 });
    expect(calls).toHaveLength(2);
  });

  it('lands an edit once when the first write did reach Home Assistant but its acknowledgement was lost', async () => {
    const { queue, calls } = setup();
    const operations: MapOp[] = [
      { kind: 'move', key: 'scan_a', at: at(1), x: 2, y: 2 },
      { kind: 'confirm', key: 'door_1', at: at(2), confirmed: true },
      { kind: 'answer', id: 'Q1', at: at(3), answer: 'left' },
    ];
    for (const op of operations) queue.apply({ target: 'map', op });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    const landed = calls[0].value as MapDoc;
    expect(landed.layout_version).toBe(4);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    expect(queue.getSnapshot().state).toBe('failed');

    const done = queue.reconnect({ map: landed, fingerprints: makeFingerprintDoc() });
    await vi.advanceTimersByTimeAsync(0);
    const rewritten = calls[1].value as MapDoc;
    expect(rewritten).toEqual(landed);
    expect(rewritten.devices.scan_a.history).toHaveLength(1);
    expect(rewritten.layout_version).toBe(4);
    calls[1].resolve();
    await done;
  });

  it('adopts the fresh documents when nothing is pending', async () => {
    const { queue, calls } = setup();
    const changed = applyMapOp(makeDoc(), { kind: 'answer', id: 'Q1', at: at(9), answer: 'elsewhere' });
    expect(await queue.reconnect({ map: changed, fingerprints: makeFingerprintDoc() })).toBe(true);
    expect(queue.getSnapshot().docs.map.questions[0].answer).toBe('elsewhere');
    expect(calls).toHaveLength(0);
  });

  it('ignores the acknowledgement of a write that began before the reconnect', async () => {
    const { queue, calls } = setup();
    queue.apply(move(1));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    const done = queue.reconnect({ map: makeDoc(), fingerprints: makeFingerprintDoc() });
    await vi.advanceTimersByTimeAsync(0);
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot().state).toBe('saving');
    calls[1].resolve();
    await done;
    expect(queue.getSnapshot().state).toBe('saved');
  });
});

describe('disposing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops writing and stops notifying', async () => {
    const { queue, calls, snapshots } = setup();
    queue.apply(move(1));
    const seen = snapshots.length;
    queue.dispose();
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(calls).toHaveLength(0);
    queue.apply(move(2));
    expect(snapshots).toHaveLength(seen);
  });
});
