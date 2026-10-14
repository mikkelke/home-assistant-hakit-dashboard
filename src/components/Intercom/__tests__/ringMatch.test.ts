import { describe, expect, it } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events-2026-10-13.json';
import { houseEpisodes, parseHouseEvents } from '../../../home/houseEvents';
import { RING_MATCH_WINDOW_MS, matchRingEntry, ringEntryMs } from '../ringMatch';

const FRONT = 'Someone rang the front door';
const BACK = 'Someone rang the back door';
const T = Date.parse('2026-10-13T12:26:01+02:00');

/** An archive entry for a ring at `atMs`, as the bridge writes it: whole epoch seconds. */
const entry = (atMs: number, door = 'front door', media: { filename?: string; url?: string; clip_url?: string } = {}) => ({
  ts: Math.floor(atMs / 1000),
  datetime: '',
  door,
  ...media,
});

describe('matchRingEntry', () => {
  it('picks the entry closest to the episode start', () => {
    const near = entry(T - 1000);
    expect(matchRingEntry([entry(T - 4000), near, entry(T + 2500)], T, FRONT)).toBe(near);
  });

  it('matches up to the window on either side and nothing beyond it', () => {
    expect(matchRingEntry([entry(T - RING_MATCH_WINDOW_MS)], T, FRONT)).not.toBeNull();
    expect(matchRingEntry([entry(T + RING_MATCH_WINDOW_MS)], T, FRONT)).not.toBeNull();
    expect(matchRingEntry([entry(T - RING_MATCH_WINDOW_MS - 1000)], T, FRONT)).toBeNull();
    expect(matchRingEntry([entry(T + RING_MATCH_WINDOW_MS + 1000)], T, FRONT)).toBeNull();
    expect(matchRingEntry([], T, FRONT)).toBeNull();
  });

  it('returns a clip-only entry as it is', () => {
    const clipOnly = entry(T - 1000, 'front door', { filename: '', url: '', clip_url: '/local/abb_doorbell/clip.mp4' });
    expect(matchRingEntry([clipOnly], T, FRONT)).toBe(clipOnly);
  });

  it('reads datetime when ts is missing, and skips an entry with neither', () => {
    const noTime = { door: 'front door', datetime: '' };
    const filenameStamp = { door: 'front door', ts: '20261013_122601' };
    const byDatetime = { door: 'front door', datetime: '2026-10-13T12:26:00+02:00' };
    expect(ringEntryMs(noTime)).toBeNull();
    expect(ringEntryMs(filenameStamp)).toBeNull();
    expect(ringEntryMs(byDatetime)).toBe(T - 1000);
    expect(matchRingEntry([noTime, filenameStamp, byDatetime], T, FRONT)).toBe(byDatetime);
    expect(matchRingEntry([noTime, filenameStamp], T, FRONT)).toBeNull();
  });

  it("never takes another door's entry, and lets an entry without a door match any", () => {
    expect(matchRingEntry([entry(T)], T, BACK)).toBeNull();
    expect(matchRingEntry([entry(T)], T, 'Someone rang the apartment door')).toBeNull();
    const doorless = entry(T, '');
    expect(matchRingEntry([doorless], T, BACK)).toBe(doorless);
  });

  it('gives two rings close together each their own entry, and none to a ring without one', () => {
    const front = entry(T);
    const back = entry(T + 6000, 'back door');
    expect(matchRingEntry([back, front], T + 900, FRONT)).toBe(front);
    expect(matchRingEntry([back, front], T + 6800, BACK)).toBe(back);
    expect(matchRingEntry([front], T + 6800, BACK)).toBeNull();
    expect(matchRingEntry([back], T + 900, FRONT)).toBeNull();
  });
});

describe('matchRingEntry on the live feed and archive', () => {
  /** index.json on the box, 13.10: every entry from 10.10 06:28 to 13.10 17:44, all front door. */
  const ARCHIVE = [1791906290, 1791887161, 1791880353, 1791745099, 1791735095, 1791718627, 1791632699, 1791625582, 1791606503].map(ts => ({
    ts,
    datetime: new Date(ts * 1000).toISOString(),
    door: 'front door',
  }));

  it('finds its own entry for each of the seven rings in the 13.10 feed', () => {
    const rings = houseEpisodes(parseHouseEvents(feed.attributes.events)).filter(episode => episode.kind === 'ring');
    expect(rings).toHaveLength(7);
    const matched = rings.map(ring => matchRingEntry(ARCHIVE, ring.startMs, ring.rows[0].cause ?? ring.rows[0].text)?.ts);
    expect(matched).toEqual([1791887161, 1791880353, 1791745099, 1791735095, 1791718627, 1791632699, 1791625582]);
  });

  it('shows nothing for rings the archive has no entry for (26.08 back door, 06.09 apartment door)', () => {
    const front2608 = { ts: 1787732284, datetime: '2026-08-26T10:18:04+02:00', door: 'front door' };
    expect(matchRingEntry([front2608], Date.parse('2026-08-26T10:18:04.401773+02:00'), FRONT)).toBe(front2608);
    expect(matchRingEntry([front2608], Date.parse('2026-08-26T10:18:27.870903+02:00'), BACK)).toBeNull();
    const front0609 = { ts: 1788689854, datetime: '2026-09-06T12:17:34+02:00', door: 'front door' };
    expect(matchRingEntry([front0609], Date.parse('2026-09-06T12:18:54.490156+02:00'), 'Someone rang the apartment door')).toBeNull();
  });
});
