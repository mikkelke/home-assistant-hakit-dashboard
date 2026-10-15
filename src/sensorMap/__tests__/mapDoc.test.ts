import { describe, expect, it } from 'vitest';
import {
  DocError,
  FINGERPRINT_LIMIT_BYTES,
  HISTORY_LIMIT,
  SUGGEST_LOG_LIMIT,
  appendFingerprint,
  applyFingerprintOp,
  applyMapOp,
  emptyFingerprintDoc,
  emptyMapDoc,
  fingerprintBytes,
  newDeviceKey,
  nextStamp,
  normalizeDeg,
  parseFingerprintDoc,
  parseMapDoc,
  parseSuggestDoc,
  undoTarget,
  validateFingerprintDoc,
  validateMapDoc,
  validateSuggestDoc,
  writableByCommand,
  type MapDoc,
  type MapOp,
} from '../mapDoc';
import { T0, device, makeDoc, makeFingerprint, makeFingerprintDoc, makeSuggestDoc, placement } from './docFixtures';

const at = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString();

describe('validation and parsing', () => {
  it('accepts the fixture and the empty document', () => {
    expect(validateMapDoc(makeDoc())).toEqual([]);
    expect(validateMapDoc(emptyMapDoc(T0))).toEqual([]);
    expect(validateSuggestDoc(makeSuggestDoc())).toEqual([]);
    expect(validateFingerprintDoc(emptyFingerprintDoc(T0))).toEqual([]);
  });

  it('names what is wrong rather than failing on the first problem', () => {
    const raw = JSON.parse(JSON.stringify(makeDoc())) as Record<string, unknown>;
    raw.schema_version = 2;
    (raw.devices as Record<string, { placement: { cert: string } }>).radar_a.placement.cert = 'sure';
    delete raw.plan;
    const problems = validateMapDoc(raw);
    expect(problems).toContain('schema_version is 2, expected 1');
    expect(problems).toContain('plan is not an object');
    expect(problems.some(p => p.startsWith('devices.radar_a.placement.cert'))).toBe(true);
  });

  it('rejects what is not an object', () => {
    expect(validateMapDoc(null)).toEqual(['the document is not an object']);
    expect(validateSuggestDoc([])).toEqual(['the document is not an object']);
    expect(validateFingerprintDoc('x')).toEqual(['the document is not an object']);
  });

  it('fills in the optional lists and throws a DocError for a bad document', () => {
    const raw = JSON.parse(JSON.stringify(makeDoc())) as Record<string, unknown>;
    delete raw.phones;
    delete raw.suggest_log;
    delete raw.ignored_device_ids;
    const parsed = parseMapDoc(raw);
    expect(parsed.phones).toEqual([]);
    expect(parsed.suggest_log).toEqual([]);
    expect(parsed.ignored_device_ids).toEqual([]);
    expect(() => parseMapDoc({ schema_version: 1 })).toThrow(DocError);
    expect(() => parseSuggestDoc({})).toThrow(DocError);
    expect(() => parseFingerprintDoc({})).toThrow(DocError);
  });

  it('rejects a suggestion with a duplicate id or an unknown kind', () => {
    const doc = makeSuggestDoc();
    doc.items.push({ ...doc.items[0] });
    expect(validateSuggestDoc(doc).some(p => p.includes('used twice'))).toBe(true);
    const raw = JSON.parse(JSON.stringify(makeSuggestDoc())) as { items: { kind: string }[] };
    raw.items[0].kind = 'teleport';
    expect(validateSuggestDoc(raw).some(p => p.includes('placement, answer or new_device'))).toBe(true);
  });

  it('only lets set-suggest write the suggestion key and seed write the map or a scratch copy', () => {
    expect(writableByCommand('set-suggest', 'sensor_map_suggest')).toBe(true);
    expect(writableByCommand('set-suggest', 'sensor_map')).toBe(false);
    expect(writableByCommand('set-suggest', 'sensor_map_fingerprints')).toBe(false);
    expect(writableByCommand('seed', 'sensor_map')).toBe(true);
    expect(writableByCommand('seed', 'sensor_map_scratch_1')).toBe(true);
    expect(writableByCommand('seed', 'sensor_map_suggest')).toBe(false);
    expect(writableByCommand('seed', 'sensor_map_fingerprints')).toBe(false);
  });
});

describe('placement edits', () => {
  it('moves to two decimals, keeps the height, drops to room certainty and keeps the old placement for undo', () => {
    const doc = makeDoc();
    const before = doc.devices.radar_a.placement;
    const next = applyMapOp(doc, { kind: 'move', key: 'radar_a', at: at(1), x: 2.456, y: 3.0149 });
    const moved = next.devices.radar_a;
    expect(moved.placement.pos).toEqual({ x: 2.46, y: 3.01, h: 2.5 });
    expect(moved.placement.cert).toBe('room');
    expect(moved.placement.confirmed_at).toBeNull();
    expect(moved.history).toEqual([{ at: at(1), placement: before }]);
    expect(next.updated_at).toBe(at(1));
    expect(doc.devices.radar_a.placement).toBe(before);
  });

  it('leaves every other device object untouched', () => {
    const doc = makeDoc();
    const next = applyMapOp(doc, { kind: 'move', key: 'radar_a', at: at(1), x: 2, y: 2 });
    expect(next.devices.radar_b).toBe(doc.devices.radar_b);
    expect(next.plan).toBe(doc.plan);
  });

  it('ignores an edit of a device that is not in the document', () => {
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'move', key: 'nope', at: at(1), x: 1, y: 1 })).toBe(doc);
  });

  it('keeps at most the last five placements', () => {
    let doc = makeDoc();
    for (let i = 1; i <= 8; i += 1) doc = applyMapOp(doc, { kind: 'move', key: 'door_1', at: at(i), x: i, y: 1 });
    expect(doc.devices.door_1.history).toHaveLength(HISTORY_LIMIT);
    expect(doc.devices.door_1.history[0].at).toBe(at(4));
    expect(undoTarget(doc.devices.door_1)?.at).toBe(at(8));
  });

  it('applies each operation once, however often it is replayed', () => {
    const ops: MapOp[] = [
      { kind: 'move', key: 'scan_a', at: at(1), x: 2, y: 2 },
      { kind: 'facing', key: 'radar_b', at: at(2), facing: { state: 'known', deg: 90 } },
      { kind: 'height', key: 'door_1', at: at(3), h: 1.9 },
      { kind: 'confirm', key: 'door_1', at: at(4), confirmed: true },
      { kind: 'unplace', key: 'door_1', at: at(5) },
      { kind: 'ignore', device_id: 'dev-x', at: at(6) },
      { kind: 'answer', id: 'Q1', at: at(7), answer: 'left' },
      { kind: 'reject', id: 's-9', at: at(8) },
    ];
    for (const op of ops) {
      const once = applyMapOp(makeDoc(), op);
      expect(applyMapOp(once, op)).toEqual(once);
    }
    const sequence = ops.reduce(applyMapOp, makeDoc());
    expect(ops.reduce(applyMapOp, sequence)).toEqual(sequence);
    expect(sequence.layout_version).toBe(4);
  });

  it('bumps the layout version only when a scanner changes place or facing', () => {
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'move', key: 'scan_a', at: at(1), x: 2, y: 2 }).layout_version).toBe(4);
    expect(applyMapOp(doc, { kind: 'move', key: 'scan_b', at: at(1), x: 6, y: 2 }).layout_version).toBe(4);
    expect(applyMapOp(doc, { kind: 'facing', key: 'scan_a', at: at(1), facing: { state: 'omni' } }).layout_version).toBe(4);
    expect(applyMapOp(doc, { kind: 'height', key: 'scan_a', at: at(1), h: 2 }).layout_version).toBe(4);
    expect(applyMapOp(doc, { kind: 'move', key: 'radar_a', at: at(1), x: 2, y: 2 }).layout_version).toBe(3);
    expect(applyMapOp(doc, { kind: 'move', key: 'door_1', at: at(1), x: 2, y: 2 }).layout_version).toBe(3);
    expect(applyMapOp(doc, { kind: 'confirm', key: 'scan_a', at: at(1), confirmed: true }).layout_version).toBe(3);
  });

  it('does not bump the layout version for a placement it leaves as it was', () => {
    const doc = makeDoc();
    const same = applyMapOp(doc, { kind: 'move', key: 'scan_a', at: at(1), x: 1, y: 1 });
    expect(same).toBe(doc);
  });
});

describe('facing', () => {
  it('stores a known facing as an integer in 0..359 and gives a new bearing the radar field of view', () => {
    const doc = makeDoc();
    const next = applyMapOp(doc, { kind: 'facing', key: 'radar_b', at: at(1), facing: { state: 'known', deg: -45.4 } });
    expect(next.devices.radar_b.placement.facing).toEqual({ state: 'known', deg: 315 });
    expect(next.devices.radar_b.placement.fov_deg).toBe(120);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(725)).toBe(5);
  });

  it('keeps an existing field of view, and omni and unknown leave it alone', () => {
    const doc = makeDoc();
    const omni = applyMapOp(doc, { kind: 'facing', key: 'radar_a', at: at(1), facing: { state: 'omni' } });
    expect(omni.devices.radar_a.placement.facing).toEqual({ state: 'omni' });
    expect(omni.devices.radar_a.placement.fov_deg).toBe(120);
    const unknown = applyMapOp(doc, { kind: 'facing', key: 'radar_b', at: at(1), facing: { state: 'unknown' } });
    expect(unknown).toBe(doc);
  });

  it('accepts a field of view the caller names', () => {
    const next = applyMapOp(makeDoc(), { kind: 'facing', key: 'radar_b', at: at(1), facing: { state: 'known', deg: 10 }, fov_deg: 90 });
    expect(next.devices.radar_b.placement.fov_deg).toBe(90);
  });
});

describe('height, confirmation and undo', () => {
  it('stores a height in metres and refuses one for an unplaced device', () => {
    const doc = makeDoc();
    const next = applyMapOp(doc, { kind: 'height', key: 'door_1', at: at(1), h: 2.6 });
    expect(next.devices.door_1.placement.pos?.h).toBe(2.6);
    expect(applyMapOp(doc, { kind: 'height', key: 'spare', at: at(1), h: 2 })).toBe(doc);
    expect(applyMapOp(doc, { kind: 'height', key: 'door_1', at: at(1), h: null }).devices.door_1.placement.pos?.h).toBeNull();
  });

  it('confirms with a timestamp, falls back to room when moved, and undo restores all of it together', () => {
    let doc = makeDoc();
    doc = applyMapOp(doc, { kind: 'confirm', key: 'door_1', at: at(1), confirmed: true });
    const confirmed = doc.devices.door_1.placement;
    expect(confirmed.cert).toBe('confirmed');
    expect(confirmed.confirmed_at).toBe(at(1));

    doc = applyMapOp(doc, { kind: 'move', key: 'door_1', at: at(2), x: 5, y: 2 });
    expect(doc.devices.door_1.placement.cert).toBe('room');
    expect(doc.devices.door_1.placement.confirmed_at).toBeNull();

    const target = undoTarget(doc.devices.door_1);
    expect(target?.placement).toEqual(confirmed);
    doc = applyMapOp(doc, { kind: 'undo', key: 'door_1', at: at(3), history_at: target?.at ?? '' });
    expect(doc.devices.door_1.placement).toEqual(confirmed);
    expect(doc.devices.door_1.history.map(entry => entry.at)).toEqual([at(1)]);
  });

  it('removes a confirmation when told to', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'confirm', key: 'door_1', at: at(1), confirmed: true });
    doc = applyMapOp(doc, { kind: 'confirm', key: 'door_1', at: at(2), confirmed: false });
    expect(doc.devices.door_1.placement.cert).toBe('room');
    expect(doc.devices.door_1.placement.confirmed_at).toBeNull();
  });

  it('does nothing for an undo whose entry is already gone', () => {
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'undo', key: 'door_1', at: at(1), history_at: at(99) })).toBe(doc);
  });

  it('bumps the layout version when undoing a scanner move back', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'move', key: 'scan_a', at: at(1), x: 3, y: 3 });
    expect(doc.layout_version).toBe(4);
    doc = applyMapOp(doc, { kind: 'undo', key: 'scan_a', at: at(2), history_at: at(1) });
    expect(doc.layout_version).toBe(5);
    expect(doc.devices.scan_a.placement.pos).toEqual({ x: 1, y: 1, h: 1 });
  });
});

describe('placing and unplacing', () => {
  it('puts a device on the plan at certainty room and back in the tray', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'unplace', key: 'door_1', at: at(1) });
    expect(doc.devices.door_1.placement.pos).toBeNull();
    expect(doc.devices.door_1.placement.cert).toBe('guess');
    doc = applyMapOp(doc, { kind: 'place', key: 'door_1', at: at(2), x: 4.5, y: 1.234, device: device('unused') });
    expect(doc.devices.door_1.placement.pos).toEqual({ x: 4.5, y: 1.23, h: null });
    expect(doc.devices.door_1.placement.cert).toBe('room');
  });

  it('adds a registry device that the document does not list yet', () => {
    const fresh = device('New node', {
      type: 'other',
      ha: { device_ids: ['dev-new'], bindings: {}, scanner_source: null },
      placement: placement({ pos: null, cert: 'guess' }),
    });
    const doc = applyMapOp(makeDoc(), { kind: 'place', key: 'dev-new', at: at(1), x: 6, y: 6, device: fresh });
    expect(doc.devices['dev-new'].placement.pos).toEqual({ x: 6, y: 6, h: null });
    expect(doc.devices['dev-new'].history).toHaveLength(1);
    expect(applyMapOp(doc, { kind: 'place', key: 'dev-new', at: at(1), x: 6, y: 6, device: fresh })).toEqual(doc);
  });

  it('changes the type of a device', () => {
    const doc = applyMapOp(makeDoc(), { kind: 'type', key: 'spare', at: at(1), type: 'plug' });
    expect(doc.devices.spare.type).toBe('plug');
    expect(applyMapOp(doc, { kind: 'type', key: 'spare', at: at(2), type: 'plug' })).toBe(doc);
  });

  it('ignores a registry device once', () => {
    const once = applyMapOp(makeDoc(), { kind: 'ignore', device_id: 'dev-x', at: at(1) });
    expect(once.ignored_device_ids).toEqual(['dev-x']);
    expect(applyMapOp(once, { kind: 'ignore', device_id: 'dev-x', at: at(2) })).toBe(once);
  });
});

describe('answers', () => {
  it('stores and trims an answer with its time, and clears it again', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'answer', id: 'Q1', at: at(1), answer: '  left side  ' });
    expect(doc.questions[0]).toMatchObject({ answer: 'left side', answered_at: at(1) });
    doc = applyMapOp(doc, { kind: 'answer', id: 'Q1', at: at(2), answer: '   ' });
    expect(doc.questions[0]).toMatchObject({ answer: null, answered_at: null });
  });

  it('answers a measurement by its id', () => {
    const doc = applyMapOp(makeDoc(), { kind: 'answer', id: 'M1', at: at(1), answer: '250' });
    expect(doc.measurements[0]).toMatchObject({ answer: '250', answered_at: at(1) });
  });

  it('keeps the answer time when the same answer arrives again', () => {
    const once = applyMapOp(makeDoc(), { kind: 'answer', id: 'Q1', at: at(1), answer: 'left' });
    expect(applyMapOp(once, { kind: 'answer', id: 'Q1', at: at(5), answer: 'left' })).toBe(once);
  });

  it('ignores an unknown id', () => {
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'answer', id: 'Q99', at: at(1), answer: 'x' })).toBe(doc);
  });
});

describe('suggestions', () => {
  it('accepts a placement as an ordinary edit and records it in the log', () => {
    const suggest = makeSuggestDoc();
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item: suggest.items[0], at: at(1) });
    expect(doc.devices.door_1.placement.pos).toEqual({ x: 4, y: 2.5, h: 1.9 });
    expect(doc.devices.door_1.history).toHaveLength(1);
    expect(doc.suggest_log).toEqual([{ id: 's-1', accepted_at: at(1) }]);
    expect(applyMapOp(doc, { kind: 'accept', item: suggest.items[0], at: at(2) })).toEqual(doc);
  });

  it('stamps an accepted confirmed placement that carries no time', () => {
    const item = { id: 's-5', kind: 'placement' as const, device_key: 'door_1', placement: placement({ cert: 'confirmed' }), reason: 'x' };
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1) });
    expect(doc.devices.door_1.placement.confirmed_at).toBe(at(1));
  });

  it('accepts a proposed answer', () => {
    const suggest = makeSuggestDoc();
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item: suggest.items[1], at: at(1) });
    expect(doc.questions[0]).toMatchObject({ answer: 'The left side', answered_at: at(1) });
    expect(doc.suggest_log).toEqual([{ id: 's-2', accepted_at: at(1) }]);
  });

  it('adds a suggested new device under its first Home Assistant id', () => {
    const { history: _history, ...rest } = device('Suggested', {
      ha: { device_ids: ['dev-s', 'dev-s2'], bindings: {}, scanner_source: null },
    });
    void _history;
    const item = { id: 's-7', kind: 'new_device' as const, device: rest, reason: 'new in the registry' };
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1) });
    expect(doc.devices['dev-s'].name).toBe('Suggested');
    expect(doc.devices['dev-s'].history).toEqual([]);
    expect(newDeviceKey(rest, 'fallback')).toBe('dev-s');
    expect(newDeviceKey({ ha: { device_ids: [], bindings: {}, scanner_source: null } }, 'fallback')).toBe('fallback');
  });

  it('does not accept a placement for a device the map does not have, and does not log it', () => {
    const item = { id: 's-8', kind: 'placement' as const, device_key: 'nope', placement: placement(), reason: 'x' };
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'accept', item, at: at(1) })).toBe(doc);
  });

  it('logs a rejection once and never loses the newest entries beyond the cap', () => {
    let doc: MapDoc = makeDoc();
    for (let i = 0; i < SUGGEST_LOG_LIMIT + 10; i += 1) doc = applyMapOp(doc, { kind: 'reject', id: `s-${i}`, at: at(i) });
    expect(doc.suggest_log).toHaveLength(SUGGEST_LOG_LIMIT);
    expect(doc.suggest_log[0].id).toBe('s-10');
    expect(doc.suggest_log[SUGGEST_LOG_LIMIT - 1]).toEqual({ id: `s-${SUGGEST_LOG_LIMIT + 9}`, rejected_at: at(SUGGEST_LOG_LIMIT + 9) });
    expect(applyMapOp(doc, { kind: 'reject', id: 's-20', at: at(500) })).toBe(doc);
  });

  it('bumps the layout version when an accepted placement moves a scanner', () => {
    const item = {
      id: 's-9',
      kind: 'placement' as const,
      device_key: 'scan_a',
      placement: placement({ pos: { x: 3, y: 3, h: 1 } }),
      reason: 'x',
    };
    expect(applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1) }).layout_version).toBe(4);
  });
});

describe('fingerprints', () => {
  it('appends in order, and a repeated id is not added again', () => {
    const doc = makeFingerprintDoc();
    const one = appendFingerprint(doc, makeFingerprint('fp-1'), at(1));
    const two = appendFingerprint(one.doc, makeFingerprint('fp-2'), at(2));
    expect(two.doc.items.map(item => item.id)).toEqual(['fp-1', 'fp-2']);
    expect(two.doc.updated_at).toBe(at(2));
    expect(appendFingerprint(two.doc, makeFingerprint('fp-2'), at(3)).doc).toBe(two.doc);
  });

  it('drops the oldest while the serialized items exceed the limit, and stays within it', () => {
    const sample = makeFingerprint('fp-1');
    const size = new TextEncoder().encode(JSON.stringify(sample)).length;
    let doc = makeFingerprintDoc(size * 3 + 4);
    const dropped: number[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const result = appendFingerprint(doc, makeFingerprint(`fp-${i}`), at(i));
      doc = result.doc;
      dropped.push(result.dropped);
      expect(fingerprintBytes(doc)).toBeLessThanOrEqual(doc.limit_bytes);
    }
    expect(doc.items.map(item => item.id)).toEqual(['fp-4', 'fp-5', 'fp-6']);
    expect(dropped).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('counts bytes, not characters', () => {
    const wide = makeFingerprint('fp-1', { note: 'ø'.repeat(100) });
    const size = new TextEncoder().encode(JSON.stringify(wide)).length;
    expect(size).toBeGreaterThan(JSON.stringify(wide).length);
    const doc = makeFingerprintDoc(size + 2);
    const first = appendFingerprint(doc, wide, at(1)).doc;
    const second = appendFingerprint(first, makeFingerprint('fp-2', { note: 'ø'.repeat(100) }), at(2));
    expect(second.doc.items.map(item => item.id)).toEqual(['fp-2']);
    expect(fingerprintBytes(second.doc)).toBeLessThanOrEqual(size + 2);
  });

  it('refuses one fingerprint that alone exceeds the limit', () => {
    expect(() => appendFingerprint(makeFingerprintDoc(50), makeFingerprint('fp-1'), at(1))).toThrow(DocError);
  });

  it('has a default limit well under the websocket frame', () => {
    expect(emptyFingerprintDoc(T0).limit_bytes).toBe(FINGERPRINT_LIMIT_BYTES);
    expect(FINGERPRINT_LIMIT_BYTES).toBeLessThan(1_000_000);
  });

  it('removes one by id, and removing it again changes nothing', () => {
    let doc = appendFingerprint(makeFingerprintDoc(), makeFingerprint('fp-1'), at(1)).doc;
    doc = appendFingerprint(doc, makeFingerprint('fp-2'), at(2)).doc;
    const next = applyFingerprintOp(doc, { kind: 'remove_fingerprint', id: 'fp-1', at: at(3) });
    expect(next.items.map(item => item.id)).toEqual(['fp-2']);
    expect(applyFingerprintOp(next, { kind: 'remove_fingerprint', id: 'fp-1', at: at(4) })).toBe(next);
    expect(applyFingerprintOp(next, { kind: 'fingerprint', item: makeFingerprint('fp-2'), at: at(5) })).toBe(next);
  });
});

describe('edit timestamps', () => {
  it('uses the clock, and moves on by a millisecond when two edits would share one', () => {
    expect(nextStamp(1000, 0)).toEqual({ iso: new Date(1000).toISOString(), ms: 1000 });
    expect(nextStamp(1000, 1000).ms).toBe(1001);
    expect(nextStamp(900, 1000).ms).toBe(1001);
  });
});
