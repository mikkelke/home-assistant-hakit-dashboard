import { describe, expect, it } from 'vitest';
import {
  ALL_APS,
  BUCKET_LABEL,
  DBM_BUCKETS,
  apChoices,
  coveragePoints,
  dbmBucket,
  matchesAp,
  roomCoverage,
  shortBssid,
  type CoveragePoint,
} from '../coverage';
import { noWifi, type Fingerprint, type FingerprintWifi } from '../mapDoc';
import { T0, makeDoc, makeFingerprint } from './docFixtures';

const BSSID_A = '02:00:5e:10:00:0a';
const BSSID_B = '02:00:5e:10:00:0b';
const BSSID_C = '02:00:5e:10:00:0c';

const wifi = (dbm: number, bssid: string | null = BSSID_A): FingerprintWifi => ({
  dbm,
  readings: [{ dbm, at: T0 }],
  bssid,
  freq_mhz: 5180,
  band: '5',
  at: T0,
  miss: {},
});
const at = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString();
const print = (id: string, x: number, y: number, dbm: number | null, partial: Partial<Fingerprint> = {}) =>
  makeFingerprint(id, { pos: { x, y, h: 1 }, wifi: dbm === null ? noWifi('stale') : wifi(dbm), ...partial });

describe('the colour of a reading', () => {
  it('changes at -55, -65 and -72, the boundary belonging to the stronger side', () => {
    const cases: [number, string][] = [
      [-30, 'strong'],
      [-55, 'strong'],
      [-55.5, 'good'],
      [-65, 'good'],
      [-65.5, 'fair'],
      [-72, 'fair'],
      [-72.5, 'weak'],
      [-90, 'weak'],
    ];
    expect(cases.map(([dbm]) => dbmBucket(dbm))).toEqual(cases.map(([, bucket]) => bucket));
  });

  it('has a label for every bucket, strongest first', () => {
    expect(DBM_BUCKETS).toEqual(['strong', 'good', 'fair', 'weak']);
    expect(DBM_BUCKETS.map(bucket => BUCKET_LABEL[bucket])).toEqual(['-55 or better', '-55 to -65', '-65 to -72', 'weaker than -72']);
  });
});

describe('the points of the coverage layer', () => {
  it('holds the captures that have a reading, with the access point the table gives for the BSSID', () => {
    const points = coveragePoints(
      [
        print('a', 1, 1, -60),
        print('b', 2, 2, null),
        print('c', 3, 3, -70, { wifi: wifi(-70, BSSID_C) }),
        print('d', 4, 4, -50, { wifi: wifi(-50, null) }),
      ],
      { [BSSID_A]: 'ap_one' }
    );
    expect(points.map(point => [point.id, point.dbm, point.bssid, point.ap])).toEqual([
      ['a', -60, BSSID_A, 'ap_one'],
      ['c', -70, BSSID_C, null],
      ['d', -50, null, null],
    ]);
    expect(points[0]).toMatchObject({ x: 1, y: 1, band: '5' });
  });

  it('counts a survey point once, by its newest capture, and keeps the captures that belong to no point', () => {
    const points = coveragePoints(
      [
        print('old', 1, 1, -60, { survey_id: 's1', at: at(1) }),
        print('new', 1.2, 1, -64, { survey_id: 's1', at: at(9) }),
        print('loose-1', 5, 5, -80, { at: at(2) }),
        print('loose-2', 5, 5, -81, { at: at(3) }),
      ],
      {}
    );
    expect(points.map(point => point.id)).toEqual(['loose-1', 'loose-2', 'new']);
  });
});

describe('the access point filter', () => {
  const points: CoveragePoint[] = [
    { id: '1', x: 1, y: 1, dbm: -60, bssid: BSSID_A, ap: 'ap_one', band: '5' },
    { id: '2', x: 2, y: 1, dbm: -61, bssid: BSSID_B, ap: 'ap_one', band: '2.4' },
    { id: '3', x: 3, y: 1, dbm: -70, bssid: BSSID_C, ap: null, band: '5' },
    { id: '4', x: 4, y: 1, dbm: -50, bssid: null, ap: null, band: null },
  ];

  it('offers all, then each access point by name and each BSSID the table lacks, with the points behind each', () => {
    const choices = apChoices(points, key => (key === 'ap_one' ? 'AP One' : undefined));
    expect(choices).toEqual([
      { id: ALL_APS, label: 'All APs', count: 4 },
      { id: 'ap:ap_one', label: 'AP One', count: 2 },
      { id: `bssid:${BSSID_C}`, label: 'Unlisted 10:00:0c', count: 1 },
    ]);
  });

  it('falls back to a short form of the key for an access point the map does not list', () => {
    expect(apChoices(points, () => undefined)[1].label).toBe('AP ap_o');
    expect(shortBssid(BSSID_A)).toBe('10:00:0a');
  });

  it('shows the points of one access point, both of its radios, or all of them', () => {
    expect(points.filter(point => matchesAp(point, ALL_APS))).toHaveLength(4);
    expect(points.filter(point => matchesAp(point, 'ap:ap_one')).map(point => point.id)).toEqual(['1', '2']);
    expect(points.filter(point => matchesAp(point, `bssid:${BSSID_C}`)).map(point => point.id)).toEqual(['3']);
    expect(points.filter(point => matchesAp(point, 'ap:nobody'))).toEqual([]);
  });
});

describe('the fill of a room', () => {
  const zones = makeDoc().plan.zones;
  const point = (id: string, x: number, y: number, dbm: number): CoveragePoint => ({ id, x, y, dbm, bssid: null, ap: null, band: null });

  it('is the median of the points inside the zone, with their number and colour', () => {
    const rooms = roomCoverage([point('1', 1, 1, -50), point('2', 2, 2, -60), point('3', 3, 3, -80), point('4', 6, 2, -70)], zones);
    expect(rooms).toEqual([
      { zone_id: 'alpha', dbm: -60, bucket: 'good', count: 3 },
      { zone_id: 'beta', dbm: -70, bucket: 'fair', count: 1 },
    ]);
  });

  it('takes the mean of the middle two when the count is even', () => {
    expect(roomCoverage([point('1', 1, 1, -60), point('2', 2, 2, -70)], zones)[0]).toMatchObject({ dbm: -65, bucket: 'good', count: 2 });
  });

  it('leaves out a point on a boundary or outside every zone, and gives nothing for a zone without points', () => {
    expect(roomCoverage([point('1', 4, 2, -60), point('2', -3, -3, -60)], zones)).toEqual([]);
    expect(roomCoverage([], zones)).toEqual([]);
  });

  it('counts a point just outside the edge of a zone for that zone, but not one on an edge two zones share', () => {
    expect(roomCoverage([point('1', -0.03, 2, -60), point('2', 4, 2, -90)], zones)).toEqual([
      { zone_id: 'alpha', dbm: -60, bucket: 'good', count: 1 },
    ]);
  });

  it('counts only the points it is given, so an access point filter changes the medians', () => {
    const all = [point('1', 1, 1, -50), point('2', 2, 2, -80)];
    expect(roomCoverage(all, zones)[0].dbm).toBe(-65);
    expect(roomCoverage(all.slice(1), zones)[0]).toMatchObject({ dbm: -80, bucket: 'weak', count: 1 });
  });
});
