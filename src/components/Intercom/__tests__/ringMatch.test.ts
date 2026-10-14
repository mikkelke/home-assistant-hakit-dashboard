import { describe, expect, it } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events.json';
import { houseEpisodes, parseHouseEvents } from '../../../home/houseEvents';
import { RING_MATCH_WINDOW_MS, matchRingEntry, ringEntryMs } from '../ringMatch';

const FRONT = 'Someone rang the front door';
const BACK = 'Someone rang the back door';
const T = Date.parse('2026-10-13T14:51:12+02:00');

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
    const clipOnly = entry(T - 1000, 'front door', { filename: '', url: '', clip_url: '/media/local/abb_doorbell/clip.mp4' });
    expect(matchRingEntry([clipOnly], T, FRONT)).toBe(clipOnly);
  });

  it('reads datetime when ts is missing, and skips an entry with neither', () => {
    const noTime = { door: 'front door', datetime: '' };
    const filenameStamp = { door: 'front door', ts: '20261013_145112' };
    const byDatetime = { door: 'front door', datetime: '2026-10-13T14:51:11+02:00' };
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

describe('matchRingEntry on the fixture feed and a matching archive', () => {
  /** An entry for each ring of the fixture feed, plus one after the newest and one before the oldest, all front door. */
  const ARCHIVE = [1791905409, 1791895872, 1791889101, 1791738725, 1791730540, 1791710493, 1791637406, 1791620264, 1791612352].map(ts => ({
    ts,
    datetime: new Date(ts * 1000).toISOString(),
    door: 'front door',
  }));

  it('finds its own entry for each of the seven rings in the feed', () => {
    const rings = houseEpisodes(parseHouseEvents(feed.attributes.events)).filter(episode => episode.kind === 'ring');
    expect(rings).toHaveLength(7);
    const matched = rings.map(ring => matchRingEntry(ARCHIVE, ring.startMs, ring.rows[0].cause ?? ring.rows[0].text)?.ts);
    expect(matched).toEqual([1791895872, 1791889101, 1791738725, 1791730540, 1791710493, 1791637406, 1791620264]);
  });

  it('shows nothing for rings the archive has no entry for (a back door ring, an apartment door ring)', () => {
    const front0309 = { ts: 1788441761, datetime: '2026-09-03T15:22:41+02:00', door: 'front door' };
    expect(matchRingEntry([front0309], Date.parse('2026-09-03T15:22:41.402165+02:00'), FRONT)).toBe(front0309);
    expect(matchRingEntry([front0309], Date.parse('2026-09-03T15:23:04.871288+02:00'), BACK)).toBeNull();
    const front1709 = { ts: 1789630878, datetime: '2026-09-17T09:41:18+02:00', door: 'front door' };
    expect(matchRingEntry([front1709], Date.parse('2026-09-17T09:42:38.490517+02:00'), 'Someone rang the apartment door')).toBeNull();
  });
});
