import { describe, expect, it } from 'vitest';
import {
  DocError,
  FINGERPRINT_LIMIT_BYTES,
  FINGERPRINT_SCHEMA_VERSION,
  HISTORY_LIMIT,
  KNOWN_TYPES,
  SUGGEST_LOG_LIMIT,
  appendFingerprint,
  applyFingerprintOp,
  applyMapOp,
  emptyFingerprintDoc,
  emptyMapDoc,
  fingerprintBytes,
  migrateFingerprintDoc,
  newDeviceKey,
  noWifi,
  normalizeBssid,
  normalizeDeg,
  parseFingerprintDoc,
  parseMapDoc,
  parseSuggestDoc,
  samePhoneAddress,
  validateFingerprintDoc,
  validateMapDoc,
  validateSuggestDoc,
  withKnownTypes,
  writableByCommand,
  type MapDoc,
  type MapOp,
  type WifiSource,
} from '../mapDoc';
import { SCANNER_A, T0, device, makeDoc, makeFingerprint, makeFingerprintDoc, makeSuggestDoc, placement } from './docFixtures';

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
    expect(validateSuggestDoc(raw).some(p => p.includes('placement, answer, new_device, wifi, rename, phone or furniture'))).toBe(true);
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

describe('known device types', () => {
  const keys = (types: { key: string }[]) => types.map(type => type.key);
  const stored = () => JSON.parse(JSON.stringify(makeDoc())) as { types: { key: string; label: string }[] };

  it('lists a known type the stored document lacks, before "other", and keeps the entries and labels it has', () => {
    const raw = stored();
    raw.types[0].label = 'Own label';
    const parsed = parseMapDoc(raw);
    expect(keys(parsed.types)).toEqual(['ble', 'presence', 'contact', 'plug', 'bed', 'thermo', 'speaker', 'wifi', 'other']);
    expect(parsed.types[0]).toEqual({ key: 'ble', label: 'Own label' });
    expect(parsed.types.find(type => type.key === 'wifi')).toEqual({ key: 'wifi', label: 'Wi-Fi AP' });
    expect(keys(raw.types)).toEqual(['ble', 'presence', 'contact', 'plug', 'other']);
  });

  it('puts the Wi-Fi AP type between the speaker and "other" when every other type is there', () => {
    const before = KNOWN_TYPES.filter(type => type.key !== 'wifi');
    expect(withKnownTypes([...before])).toEqual(KNOWN_TYPES);
  });

  it('adds the missing types last when there is no "other", and returns a complete list as it is', () => {
    const own = [
      { key: 'ble', label: 'Mine' },
      { key: 'wifi', label: 'Access point' },
    ];
    const merged = withKnownTypes(own);
    expect(keys(merged)).toEqual(['ble', 'wifi', 'presence', 'contact', 'bed', 'thermo', 'plug', 'speaker', 'other']);
    expect(merged.slice(0, 2)).toEqual(own);
    const complete = [...KNOWN_TYPES];
    expect(withKnownTypes(complete)).toBe(complete);
  });

  it('leaves an unknown type of the document where it is', () => {
    const raw = stored();
    raw.types.splice(1, 0, { key: 'camera', label: 'Camera' });
    expect(keys(parseMapDoc(raw).types).slice(0, 3)).toEqual(['ble', 'camera', 'presence']);
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
    expect(doc.devices.door_1.history.at(-1)?.at).toBe(at(8));
  });

  it('ends a long mixed sequence of edits as the last edit left it', () => {
    const ops: MapOp[] = [
      { kind: 'move', key: 'door_1', at: at(1), x: 2, y: 3 },
      { kind: 'move', key: 'door_1', at: at(2), x: 3, y: 3 },
      { kind: 'move', key: 'door_1', at: at(3), x: 2, y: 3 },
      { kind: 'confirm', key: 'door_1', at: at(4), confirmed: true },
      { kind: 'height', key: 'door_1', at: at(5), h: 2 },
      { kind: 'move', key: 'door_1', at: at(6), x: 3, y: 3 },
    ];
    const { placement, history } = ops.reduce(applyMapOp, makeDoc()).devices.door_1;
    expect(placement).toMatchObject({ pos: { x: 3, y: 3, h: 2 }, cert: 'room', confirmed_at: null });
    expect(history).toHaveLength(HISTORY_LIMIT);
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

    doc = applyMapOp(doc, { kind: 'undo', key: 'door_1', at: at(3) });
    expect(doc.devices.door_1.placement).toEqual(confirmed);
    expect(doc.devices.door_1.history.map(entry => entry.at)).toEqual([at(1)]);
  });

  it('removes a confirmation when told to', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'confirm', key: 'door_1', at: at(1), confirmed: true });
    doc = applyMapOp(doc, { kind: 'confirm', key: 'door_1', at: at(2), confirmed: false });
    expect(doc.devices.door_1.placement.cert).toBe('room');
    expect(doc.devices.door_1.placement.confirmed_at).toBeNull();
  });

  it('does nothing for an undo with nothing to go back to', () => {
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'undo', key: 'door_1', at: at(1) })).toBe(doc);
  });

  it('bumps the layout version when undoing a scanner move back', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'move', key: 'scan_a', at: at(1), x: 3, y: 3 });
    expect(doc.layout_version).toBe(4);
    doc = applyMapOp(doc, { kind: 'undo', key: 'scan_a', at: at(2) });
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

const BSSID_A = '02:00:5e:10:00:0a';
const BSSID_B = '02:00:5e:10:00:0b';
const SOURCE: WifiSource = {
  name: 'Test phone',
  notify: 'notify.mobile_app_test_phone',
  signal: 'sensor.test_phone_wi_fi_signal_strength',
  bssid: 'sensor.test_phone_wi_fi_bssid',
  frequency: 'sensor.test_phone_wi_fi_frequency',
};

describe('BSSIDs', () => {
  it('are lower case with colons whatever they came as, and anything else is null', () => {
    expect(normalizeBssid('02:00:5E:10:00:0A')).toBe(BSSID_A);
    expect(normalizeBssid(' 02-00-5e-10-00-0a ')).toBe(BSSID_A);
    for (const bad of ['', '02:00:5e:10:00', '02:00:5e:10:00:0g', 'not a bssid', '<not connected>', null, 5, undefined]) {
      expect(normalizeBssid(bad)).toBeNull();
    }
  });

  it('are never the placeholders Android reports when it may not tell or has no connection', () => {
    expect(normalizeBssid('02:00:00:00:00:00')).toBeNull();
    expect(normalizeBssid('00:00:00:00:00:00')).toBeNull();
  });
});

describe('the Wi-Fi configuration of the map', () => {
  it('is empty in a new document and filled in for a stored document that has none', () => {
    expect(emptyMapDoc(T0).wifi).toEqual({ source: null, aps: {} });
    const raw = JSON.parse(JSON.stringify(makeDoc())) as Record<string, unknown>;
    delete raw.wifi;
    expect(parseMapDoc(raw).wifi).toEqual({ source: null, aps: {} });
  });

  it('is kept as stored, and checked', () => {
    const doc = { ...makeDoc(), wifi: { source: SOURCE, aps: { [BSSID_A]: 'ap_one' } } };
    expect(validateMapDoc(doc)).toEqual([]);
    expect(parseMapDoc(JSON.parse(JSON.stringify(doc))).wifi).toEqual(doc.wifi);
    const bad = (wifi: unknown) => validateMapDoc({ ...makeDoc(), wifi });
    expect(bad('x')).toContain('wifi is not an object');
    expect(bad({ source: { name: 'x' }, aps: {} }).some(p => p.startsWith('wifi.source'))).toBe(true);
    expect(bad({ source: { ...SOURCE, notify: 'mobile_app_x' }, aps: {} })).toContain('wifi.source.notify is not a domain.service');
    expect(bad({ source: null, aps: { nope: 'ap_one' } }).some(p => p.includes('is not a BSSID'))).toBe(true);
    expect(bad({ source: null, aps: { [BSSID_A]: 5 } }).some(p => p.includes('is not a device key'))).toBe(true);
    expect(bad({ source: null }).some(p => p.startsWith('wifi.aps'))).toBe(true);
  });
});

describe('a suggested Wi-Fi setup', () => {
  const item = (extra: Record<string, unknown>) => ({ id: 's-wifi', kind: 'wifi' as const, reason: 'from the controller', ...extra });
  const suggestWith = (extra: Record<string, unknown>) => ({ ...makeSuggestDoc(), items: [item(extra)] });

  it('may carry a source, the BSSID table, or both, and must carry one', () => {
    expect(validateSuggestDoc(suggestWith({ source: SOURCE }))).toEqual([]);
    expect(validateSuggestDoc(suggestWith({ aps: { [BSSID_A]: 'ap_one' } }))).toEqual([]);
    expect(validateSuggestDoc(suggestWith({ source: SOURCE, aps: { [BSSID_A]: 'ap_one' } }))).toEqual([]);
    expect(validateSuggestDoc(suggestWith({})).some(p => p.includes('neither a source nor aps'))).toBe(true);
    expect(validateSuggestDoc(suggestWith({ aps: { 'no-bssid': 'ap_one' } })).some(p => p.includes('is not a BSSID'))).toBe(true);
    expect(validateSuggestDoc(suggestWith({ source: { ...SOURCE, notify: 'nope' } })).some(p => p.includes('domain.service'))).toBe(true);
  });

  it('is accepted into the map as an ordinary edit, normalizing the BSSIDs, and logged', () => {
    const accepted = applyMapOp(makeDoc(), {
      kind: 'accept',
      item: item({ source: SOURCE, aps: { '02:00:5E:10:00:0A': 'ap_one', [BSSID_B]: 'ap_two' } }),
      at: at(1),
    });
    expect(accepted.wifi).toEqual({ source: SOURCE, aps: { [BSSID_A]: 'ap_one', [BSSID_B]: 'ap_two' } });
    expect(accepted.suggest_log).toEqual([{ id: 's-wifi', accepted_at: at(1) }]);
    expect(accepted.updated_at).toBe(at(1));
  });

  it('adds to the table and keeps the source when the suggestion has none, and replaces a BSSID it lists again', () => {
    let doc = applyMapOp(makeDoc(), { kind: 'accept', item: item({ source: SOURCE, aps: { [BSSID_A]: 'ap_one' } }), at: at(1) });
    doc = applyMapOp(doc, {
      kind: 'accept',
      item: { ...item({ aps: { [BSSID_A]: 'ap_moved', [BSSID_B]: 'ap_two' } }), id: 's-wifi-2' },
      at: at(2),
    });
    expect(doc.wifi).toEqual({ source: SOURCE, aps: { [BSSID_A]: 'ap_moved', [BSSID_B]: 'ap_two' } });
  });

  it('is accepted once, and a rejection only logs', () => {
    const wifi = item({ aps: { [BSSID_A]: 'ap_one' } });
    const once = applyMapOp(makeDoc(), { kind: 'accept', item: wifi, at: at(1) });
    expect(applyMapOp(once, { kind: 'accept', item: wifi, at: at(2) })).toBe(once);
    const rejected = applyMapOp(makeDoc(), { kind: 'reject', id: 's-wifi', at: at(1) });
    expect(rejected.wifi).toEqual({ source: null, aps: {} });
    expect(rejected.suggest_log).toEqual([{ id: 's-wifi', rejected_at: at(1) }]);
  });
});

describe('fingerprints of the first schema version', () => {
  const v1 = () => {
    const { wifi: _wifi, survey_id: _survey, ...rest } = makeFingerprint('fp-old', { note: 'kept' });
    void _wifi;
    void _survey;
    return { schema_version: 1, updated_at: T0, limit_bytes: 600_000, write_id: 'w-1', writer: 'page', items: [rest] };
  };

  it('are migrated: every capture says its Wi-Fi was not captured and belongs to no survey point', () => {
    const migrated = migrateFingerprintDoc(v1()) as { schema_version: number; items: Record<string, unknown>[] };
    expect(migrated.schema_version).toBe(FINGERPRINT_SCHEMA_VERSION);
    expect(migrated.items[0]).toMatchObject({ id: 'fp-old', note: 'kept', survey_id: null, wifi: noWifi('not_captured') });
    expect(migrated.items[0].wifi).not.toBe((migrateFingerprintDoc(v1()) as { items: { wifi: unknown }[] }).items[0].wifi);
  });

  it('are read as the current version with everything else kept, the write stamp included', () => {
    const parsed = parseFingerprintDoc(v1());
    expect(parsed).toMatchObject({ schema_version: 2, write_id: 'w-1', writer: 'page', limit_bytes: 600_000 });
    expect(parsed.items[0].wifi.miss).toEqual({ dbm: 'not_captured', bssid: 'not_captured', freq: 'not_captured' });
    expect(validateFingerprintDoc(parsed)).toEqual([]);
  });

  it('are not valid as they are, so a page of the current version does not take one for its own', () => {
    expect(validateFingerprintDoc(v1())).toContain('schema_version is 1, expected 2');
  });

  it('are left alone by the migration when there is nothing to migrate', () => {
    const current = makeFingerprintDoc();
    expect(migrateFingerprintDoc(current)).toBe(current);
    expect(migrateFingerprintDoc(null)).toBeNull();
    expect(migrateFingerprintDoc({ schema_version: 3, items: [] })).toEqual({ schema_version: 3, items: [] });
    expect(() => parseFingerprintDoc({ ...makeFingerprintDoc(), schema_version: 3 })).toThrow(DocError);
  });

  it('keep going through the byte bound after a migration, with the new fields counted', () => {
    const parsed = parseFingerprintDoc(v1());
    const next = appendFingerprint(parsed, makeFingerprint('fp-new'), at(1)).doc;
    expect(next.items.map(item => item.id)).toEqual(['fp-old', 'fp-new']);
  });
});

describe('fingerprints of the current schema version', () => {
  const docWith = (patch: Record<string, unknown>) => ({ ...makeFingerprintDoc(), items: [{ ...makeFingerprint('fp-1'), ...patch }] });

  it('hold a Wi-Fi record and a survey point, and are checked for both', () => {
    expect(emptyFingerprintDoc(T0).schema_version).toBe(2);
    expect(validateFingerprintDoc(docWith({}))).toEqual([]);
    expect(validateFingerprintDoc(docWith({ survey_id: 'alpha-1' }))).toEqual([]);
    expect(validateFingerprintDoc(docWith({ survey_id: 5 }))).toContain('items[0].survey_id is not a string or null');
    expect(validateFingerprintDoc(docWith({ wifi: undefined }))).toContain('items[0].wifi is not an object');
    expect(validateFingerprintDoc(docWith({ wifi: { ...noWifi('stale'), dbm: 'loud' } }))).toContain(
      'items[0].wifi.dbm is not a number or null'
    );
    expect(validateFingerprintDoc(docWith({ wifi: { ...noWifi('stale'), band: '4' } }))).toContain(
      'items[0].wifi.band is not 2.4, 5, 6 or null'
    );
    expect(validateFingerprintDoc(docWith({ wifi: { ...noWifi('stale'), miss: { dbm: 'because' } } }))).toContain(
      'items[0].wifi.miss is not a map of field to reason'
    );
    expect(validateFingerprintDoc(docWith({ wifi: { ...noWifi('stale'), readings: [{ dbm: -60 }] } }))).toContain(
      'items[0].wifi.readings is not a list of {dbm, at}'
    );
  });

  it('accept every reason a field can be missing for, and every band', () => {
    for (const reason of ['not_captured', 'no_entity', 'unavailable', 'invalid', 'roamed', 'command_failed', 'stale'] as const) {
      expect(validateFingerprintDoc(docWith({ wifi: noWifi(reason) }))).toEqual([]);
    }
    for (const band of ['2.4', '5', '6']) expect(validateFingerprintDoc(docWith({ wifi: { ...noWifi('stale'), band } }))).toEqual([]);
  });
});

describe('a suggested rename', () => {
  const rename = (extra: Record<string, unknown> = {}) => ({
    id: 's-rename',
    kind: 'rename' as const,
    device_key: 'door_1',
    name: 'Front door contact',
    reason: 'It is the front door',
    ...extra,
  });

  it('is a valid suggestion when it names a device and a name, and not otherwise', () => {
    expect(validateSuggestDoc({ ...makeSuggestDoc(), items: [rename()] })).toEqual([]);
    expect(
      validateSuggestDoc({ ...makeSuggestDoc(), items: [rename({ name: '  ' })] }).some(p => p.includes('device_key and a name'))
    ).toBe(true);
    expect(
      validateSuggestDoc({ ...makeSuggestDoc(), items: [rename({ device_key: undefined })] }).some(p => p.includes('device_key and a name'))
    ).toBe(true);
  });

  it('sets the name of the device when accepted, trimmed, changes nothing else and logs the acceptance', () => {
    const before = makeDoc();
    const doc = applyMapOp(before, { kind: 'accept', item: rename({ name: '  Front door contact  ' }), at: at(1) });
    expect(doc.devices.door_1.name).toBe('Front door contact');
    expect(doc.devices.door_1).toEqual({ ...before.devices.door_1, name: 'Front door contact' });
    expect(doc.devices.radar_a).toBe(before.devices.radar_a);
    expect(doc.layout_version).toBe(before.layout_version);
    expect(doc.updated_at).toBe(at(1));
    expect(doc.suggest_log).toEqual([{ id: 's-rename', accepted_at: at(1) }]);
  });

  it('is accepted once, and a rejection leaves the name alone and only logs', () => {
    const once = applyMapOp(makeDoc(), { kind: 'accept', item: rename(), at: at(1) });
    expect(applyMapOp(once, { kind: 'accept', item: rename({ name: 'Other' }), at: at(2) })).toBe(once);
    const rejected = applyMapOp(makeDoc(), { kind: 'reject', id: 's-rename', at: at(1) });
    expect(rejected.devices.door_1.name).toBe('Test door contact');
    expect(rejected.suggest_log).toEqual([{ id: 's-rename', rejected_at: at(1) }]);
  });

  it('does not rename a device the map does not have, and does not log it', () => {
    const doc = makeDoc();
    expect(applyMapOp(doc, { kind: 'accept', item: rename({ device_key: 'nope' }), at: at(1) })).toBe(doc);
  });
});

describe('a suggestion dropped at a spot', () => {
  const proposed = placement({
    pos: { x: 5, y: 5, h: 2.2 },
    facing: { state: 'known', deg: 90 },
    fov_deg: 100,
    cert: 'confirmed',
    confirmed_at: T0,
  });
  const drop = (key: string, item = { id: 's-drop', kind: 'placement' as const, device_key: key, placement: proposed, reason: 'x' }) =>
    applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1), place: [2.341, 3.1] });

  it('puts the device at the spot at room certainty, keeping the rest of what the suggestion proposes', () => {
    const doc = drop('radar_a');
    expect(doc.devices.radar_a.placement).toEqual({
      pos: { x: 2.34, y: 3.1, h: 2.2 },
      facing: { state: 'known', deg: 90 },
      fov_deg: 100,
      cert: 'room',
      confirmed_at: null,
    });
    expect(doc.suggest_log).toEqual([{ id: 's-drop', accepted_at: at(1) }]);
  });

  it('keeps the height of the device when the suggestion gives none', () => {
    const doc = drop('radar_a', {
      id: 's-drop',
      kind: 'placement',
      device_key: 'radar_a',
      placement: placement({ pos: { x: 5, y: 5, h: null } }),
      reason: 'x',
    });
    expect(doc.devices.radar_a.placement.pos).toEqual({ x: 2.34, y: 3.1, h: 2.5 });
  });

  it('is one edit that Undo takes back, the placement before it returning together with its certainty', () => {
    const before = makeDoc();
    const dropped = drop('radar_a');
    expect(dropped.devices.radar_a.history).toHaveLength(before.devices.radar_a.history.length + 1);
    const undone = applyMapOp(dropped, { kind: 'undo', key: 'radar_a', at: at(2) });
    expect(undone.devices.radar_a.placement).toEqual(before.devices.radar_a.placement);
    expect(undone.devices.radar_a.history).toEqual(before.devices.radar_a.history);
  });

  it('bumps the layout version for a scanner, and Undo bumps it back', () => {
    const dropped = drop('scan_a');
    expect(dropped.layout_version).toBe(4);
    expect(applyMapOp(dropped, { kind: 'undo', key: 'scan_a', at: at(2) }).layout_version).toBe(5);
  });

  it('adds a new device at the spot at room certainty, and Undo puts it back in the tray', () => {
    const { history: _history, ...rest } = device('New thing', {
      ha: { device_ids: ['dev-new'], bindings: {}, scanner_source: null },
      placement: placement({ pos: { x: 9, y: 9, h: 1.2 }, cert: 'guess' }),
    });
    void _history;
    const item = { id: 's-new', kind: 'new_device' as const, device: rest, reason: 'new in the registry' };
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1), place: [3.1, 2.2] });
    expect(doc.devices['dev-new'].placement).toMatchObject({ pos: { x: 3.1, y: 2.2, h: 1.2 }, cert: 'room', confirmed_at: null });
    expect(doc.devices['dev-new'].history).toHaveLength(1);
    expect(doc.suggest_log).toEqual([{ id: 's-new', accepted_at: at(1) }]);
    const undone = applyMapOp(doc, { kind: 'undo', key: 'dev-new', at: at(2) });
    expect(undone.devices['dev-new'].placement.pos).toBeNull();
    expect(undone.devices['dev-new'].history).toEqual([]);
  });

  it('bumps the layout version for a new scanner placed by a drop', () => {
    const { history: _history, ...rest } = device('New scanner', {
      type: 'ble',
      ha: { device_ids: ['dev-new-scan'], bindings: {}, scanner_source: SCANNER_A.replace(':01', ':09') },
      placement: placement({ pos: { x: 9, y: 9, h: 1 } }),
    });
    void _history;
    const item = { id: 's-scan', kind: 'new_device' as const, device: rest, reason: 'new scanner' };
    expect(applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1), place: [3, 2] }).layout_version).toBe(4);
    expect(applyMapOp(makeDoc(), { kind: 'accept', item, at: at(1) }).layout_version).toBe(3);
  });

  it('is accepted once, and the position only matters to a placement or a new device', () => {
    const doc = drop('radar_a');
    expect(
      applyMapOp(doc, {
        kind: 'accept',
        item: { id: 's-drop', kind: 'placement', device_key: 'radar_a', placement: proposed, reason: 'x' },
        at: at(3),
        place: [1, 1],
      })
    ).toBe(doc);
    const answer = makeSuggestDoc().items[1];
    const plain = applyMapOp(makeDoc(), { kind: 'accept', item: answer, at: at(1) });
    expect(applyMapOp(makeDoc(), { kind: 'accept', item: answer, at: at(1), place: [1, 1] })).toEqual(plain);
  });

  it('still takes a plain accept as it was, at the suggested spot and certainty', () => {
    const doc = applyMapOp(makeDoc(), {
      kind: 'accept',
      item: { id: 's-plain', kind: 'placement', device_key: 'radar_a', placement: proposed, reason: 'x' },
      at: at(1),
    });
    expect(doc.devices.radar_a.placement).toEqual(proposed);
  });
});

describe('a suggested phone', () => {
  const ADDRESS = 'a1b2c3d4e5f60718293a4b5c6d7e8f90_1_2';
  const phone = (extra: Record<string, unknown> = {}) => ({
    name: 'Test owner',
    bermuda_address: ADDRESS,
    person: 'person.test_owner',
    ...extra,
  });
  const item = (extra: Record<string, unknown> = {}, id = 's-phone') => ({
    id,
    kind: 'phone' as const,
    phone: phone(extra),
    reason: 'Bermuda tracks it now',
  });
  const suggestWith = (entry: unknown) => ({ ...makeSuggestDoc(), items: [entry] });

  it('is a valid suggestion with a name, an address and a person or none, and not otherwise', () => {
    expect(validateSuggestDoc(suggestWith(item()))).toEqual([]);
    expect(validateSuggestDoc(suggestWith(item({ person: null })))).toEqual([]);
    for (const bad of [
      { name: '' },
      { name: '  ' },
      { name: 5 },
      { bermuda_address: '' },
      { bermuda_address: ' ' },
      { person: 5 },
      { person: undefined },
    ]) {
      expect(validateSuggestDoc(suggestWith(item(bad))).some(p => p.includes('needs a name, a bermuda_address and a person'))).toBe(true);
    }
    expect(validateSuggestDoc(suggestWith({ id: 's-phone', kind: 'phone', reason: 'x' })).some(p => p.includes('items[0].phone'))).toBe(
      true
    );
    expect(validateSuggestDoc(suggestWith({ ...item(), phone: 'Test owner' })).some(p => p.includes('items[0].phone'))).toBe(true);
  });

  it('is added to the tracked phones when accepted, after the ones already there, and logged', () => {
    const before = makeDoc();
    const doc = applyMapOp(before, { kind: 'accept', item: item(), at: at(1) });
    expect(doc.phones).toEqual([...before.phones, { name: 'Test owner', bermuda_address: ADDRESS, person: 'person.test_owner' }]);
    expect(doc.suggest_log).toEqual([{ id: 's-phone', accepted_at: at(1) }]);
    expect(doc.updated_at).toBe(at(1));
    expect(doc.devices).toBe(before.devices);
    expect(doc.wifi).toBe(before.wifi);
  });

  it('fills an empty list, with the name and address trimmed', () => {
    const empty = { ...makeDoc(), phones: [] };
    const doc = applyMapOp(empty, { kind: 'accept', item: item({ name: '  Test owner ', bermuda_address: ` ${ADDRESS} ` }), at: at(1) });
    expect(doc.phones).toEqual([{ name: 'Test owner', bermuda_address: ADDRESS, person: 'person.test_owner' }]);
  });

  it('replaces the phone that has the same address, in its place and whatever the case of the address', () => {
    const two = { ...makeDoc(), phones: [{ name: 'Old', bermuda_address: ADDRESS.toUpperCase(), person: null }, ...makeDoc().phones] };
    const doc = applyMapOp(two, { kind: 'accept', item: item({ name: 'New name' }), at: at(1) });
    expect(doc.phones).toEqual([{ name: 'New name', bermuda_address: ADDRESS, person: 'person.test_owner' }, ...makeDoc().phones]);
    expect(doc.phones).toHaveLength(2);
  });

  it('is accepted once, and a rejection leaves the phones alone and only logs', () => {
    const once = applyMapOp(makeDoc(), { kind: 'accept', item: item(), at: at(1) });
    expect(applyMapOp(once, { kind: 'accept', item: item({ name: 'Other' }), at: at(2) })).toBe(once);
    const rejected = applyMapOp(makeDoc(), { kind: 'reject', id: 's-phone', at: at(1) });
    expect(rejected.phones).toEqual(makeDoc().phones);
    expect(rejected.suggest_log).toEqual([{ id: 's-phone', rejected_at: at(1) }]);
  });

  it('is read back as a valid map after it was accepted, so it survives the next load', () => {
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item: item(), at: at(1) });
    expect(validateMapDoc(JSON.parse(JSON.stringify(doc)))).toEqual([]);
    expect(parseMapDoc(JSON.parse(JSON.stringify(doc))).phones).toHaveLength(2);
  });

  it('compares addresses without regard to case or surrounding space', () => {
    expect(samePhoneAddress(ADDRESS, ADDRESS.toUpperCase())).toBe(true);
    expect(samePhoneAddress(` ${ADDRESS}`, ADDRESS)).toBe(true);
    expect(samePhoneAddress(ADDRESS, `${ADDRESS}x`)).toBe(false);
  });
});

describe('furniture on the plan', () => {
  const island = { id: 'island', name: 'Test island', box: [5, 1, 7, 2] as [number, number, number, number] };
  const withFurniture = (furniture: unknown) => ({ ...makeDoc(), plan: { ...makeDoc().plan, furniture } });
  const problemsOf = (furniture: unknown) => validateMapDoc(JSON.parse(JSON.stringify(withFurniture(furniture))));

  it('is optional: a plan without it is valid and stays without it', () => {
    expect(makeDoc().plan.furniture).toBeUndefined();
    expect(validateMapDoc(makeDoc())).toEqual([]);
    expect(parseMapDoc(JSON.parse(JSON.stringify(makeDoc()))).plan.furniture).toBeUndefined();
  });

  it('is valid with an id, a name and a box, and is kept by the parse', () => {
    expect(problemsOf([island, { id: 'table', name: 'Test table', box: [1.5, 5.25, 2.5, 6.5] }])).toEqual([]);
    expect(problemsOf([])).toEqual([]);
    expect(parseMapDoc(JSON.parse(JSON.stringify(withFurniture([island])))).plan.furniture).toEqual([island]);
  });

  it('names what is wrong with an entry', () => {
    const wrong = (entry: unknown) => problemsOf([entry]).some(p => p.startsWith('plan.furniture[0]'));
    expect(problemsOf({})).toContain('plan.furniture is not an array');
    for (const entry of [
      null,
      { ...island, id: '' },
      { ...island, id: 5 },
      { ...island, name: ' ' },
      { ...island, name: undefined },
      { ...island, box: undefined },
      { ...island, box: [5, 1, 7] },
      { ...island, box: [5, 1, 7, 2, 3] },
      { ...island, box: [5, 1, 7, '2'] },
      { ...island, box: [5, 1, 7, null] },
      { ...island, box: [7, 1, 5, 2] },
      { ...island, box: [5, 2, 7, 1] },
      { ...island, box: [5, 1, 5, 2] },
    ]) {
      expect(wrong(entry)).toBe(true);
    }
  });

  it('does not list one id twice, since an accepted suggestion replaces the entry with its id', () => {
    expect(problemsOf([island, { ...island, name: 'Other' }]).some(p => p.includes('plan.furniture[1].id island is used twice'))).toBe(
      true
    );
  });
});

describe('a suggested piece of furniture', () => {
  const box = (): [number, number, number, number] => [7.2, 1.1, 9, 2.05];
  const furniture = (extra: Record<string, unknown> = {}) => ({
    id: 's-island',
    kind: 'furniture' as const,
    furniture: { id: 'island', name: 'Test island', box: box(), ...extra },
    reason: 'It stands there',
  });
  const suggestWith = (entry: unknown) => ({ ...makeSuggestDoc(), items: [entry] });

  it('is a valid suggestion with an id, a name and a box, and not otherwise', () => {
    expect(validateSuggestDoc(suggestWith(furniture()))).toEqual([]);
    for (const bad of [{ id: '' }, { name: '  ' }, { box: [1, 2, 3] }, { box: [3, 1, 1, 2] }, { box: [1, 3, 2, 1] }, { box: undefined }]) {
      expect(validateSuggestDoc(suggestWith(furniture(bad))).some(p => p.startsWith('items[0].furniture'))).toBe(true);
    }
    expect(
      validateSuggestDoc(suggestWith({ id: 's-island', kind: 'furniture', reason: 'x' })).some(p => p.startsWith('items[0].furniture'))
    ).toBe(true);
  });

  it('is added to the plan when accepted, trimmed, as an ordinary edit that is logged and leaves everything else alone', () => {
    const before = makeDoc();
    const doc = applyMapOp(before, { kind: 'accept', item: furniture({ name: '  Test island ' }), at: at(1) });
    expect(doc.plan.furniture).toEqual([{ id: 'island', name: 'Test island', box: box() }]);
    expect(doc.plan.walls).toBe(before.plan.walls);
    expect(doc.plan.zones).toBe(before.plan.zones);
    expect(doc.devices).toBe(before.devices);
    expect(doc.updated_at).toBe(at(1));
    expect(doc.suggest_log).toEqual([{ id: 's-island', accepted_at: at(1) }]);
  });

  it('does not bump the layout version, which counts changes to the scanners', () => {
    const before = makeDoc();
    expect(applyMapOp(before, { kind: 'accept', item: furniture(), at: at(1) }).layout_version).toBe(before.layout_version);
  });

  it('is added after the furniture that is there, and replaces the entry with the same id in its place', () => {
    const table = { id: 'table', name: 'Test table', box: [1, 1, 2, 2] as [number, number, number, number] };
    const base = {
      ...makeDoc(),
      plan: { ...makeDoc().plan, furniture: [table, { id: 'island', name: 'Old', box: [0, 0, 1, 1] as [number, number, number, number] }] },
    };
    const added = applyMapOp(base, {
      kind: 'accept',
      item: { ...furniture(), furniture: { id: 'sofa', name: 'Sofa', box: [3, 3, 4, 4] } },
      at: at(1),
    });
    expect(added.plan.furniture?.map(piece => piece.id)).toEqual(['table', 'island', 'sofa']);
    const replaced = applyMapOp(base, { kind: 'accept', item: furniture(), at: at(1) });
    expect(replaced.plan.furniture).toEqual([table, { id: 'island', name: 'Test island', box: box() }]);
  });

  it('is accepted once, and a rejection leaves the plan alone and only logs', () => {
    const once = applyMapOp(makeDoc(), { kind: 'accept', item: furniture(), at: at(1) });
    expect(applyMapOp(once, { kind: 'accept', item: furniture({ name: 'Other' }), at: at(2) })).toBe(once);
    const rejected = applyMapOp(makeDoc(), { kind: 'reject', id: 's-island', at: at(1) });
    expect(rejected.plan.furniture).toBeUndefined();
    expect(rejected.suggest_log).toEqual([{ id: 's-island', rejected_at: at(1) }]);
  });

  it('is read back as a valid map after it was accepted, so it survives the next load', () => {
    const doc = applyMapOp(makeDoc(), { kind: 'accept', item: furniture(), at: at(1) });
    expect(validateMapDoc(JSON.parse(JSON.stringify(doc)))).toEqual([]);
    expect(parseMapDoc(JSON.parse(JSON.stringify(doc))).plan.furniture).toHaveLength(1);
  });
});
