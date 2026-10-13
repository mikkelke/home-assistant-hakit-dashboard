import { describe, expect, it } from 'vitest';
import { nowFocusAt, type NowFocus } from '../../utils/navigation';
import { episodeCandidates, houseEpisodes, parseHouseEvents, visibleHouseEvents, type HouseEventViewer } from '../houseEvents';
import { focusWindowMs, resolveNowFocus, type NowCandidate } from '../nowResolve';
import feed from './fixtures/house-events-2026-10-13.json';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const KRISTINE: HouseEventViewer = { isAdmin: false, name: 'Kristine' };

const events = parseHouseEvents(feed.attributes.events);
const candidatesFor = (viewer: HouseEventViewer) => episodeCandidates(houseEpisodes(visibleHouseEvents(events, viewer)));

/** Washer finished 13.10 10:55:30.468, the cycle record's `ts` a push links to. */
const WASHER_FINISHED_MS = Date.parse('2026-10-13T10:55:30.468247+02:00');
/** The ring at 12:26:01.94 and its door row at 12:26:06.40. */
const RING_MS = Date.parse('2026-10-13T12:26:01.941170+02:00');
const DOOR_MS = Date.parse('2026-10-13T12:26:06.404260+02:00');
/** Wake-up alarm row, 12.10 08:45:00.109 (admin). */
const WAKE_MS = Date.parse('2026-10-12T08:45:00.109202+02:00');

const at = (kind: NowFocus['kind'], ms: number): NowFocus => nowFocusAt(kind, ms);

describe('resolveNowFocus', () => {
  const mine = candidatesFor(MIKKEL);

  it('opens at NOW without a focus', () => {
    expect(resolveNowFocus(null, mine, false)).toEqual({ status: 'none' });
  });

  it('finds the washer row a finished push names, not the emptied row beside it', () => {
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS), mine, true)).toEqual({ status: 'found', id: String(WASHER_FINISHED_MS) });
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS + 119_000), mine, true)).toEqual({
      status: 'found',
      id: String(WASHER_FINISHED_MS),
    });
  });

  it('gives up outside the window instead of taking the nearest washer of the day', () => {
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS + 121_000), mine, true)).toEqual({ status: 'unavailable' });
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS - 3_600_000), mine, true)).toEqual({ status: 'unavailable' });
  });

  it('matches the kind as well as the time', () => {
    expect(resolveNowFocus(at('dryer', WASHER_FINISHED_MS), mine, true)).toEqual({ status: 'unavailable' });
    expect(resolveNowFocus(at('dish', RING_MS), mine, true)).toEqual({ status: 'unavailable' });
  });

  it('finds a ring episode from its bell row', () => {
    const ring = { status: 'found', id: String(RING_MS) };
    expect(resolveNowFocus(at('ring', RING_MS), mine, true)).toEqual(ring);
    expect(resolveNowFocus(at('ring', RING_MS + 100_000), mine, true)).toEqual(ring);
  });

  it('finds any row from an in-app tap within 2 s, and nothing further', () => {
    expect(focusWindowMs('evt')).toBe(2_000);
    expect(resolveNowFocus(at('evt', DOOR_MS), mine, true)).toEqual({ status: 'found', id: String(RING_MS) });
    expect(resolveNowFocus(at('evt', DOOR_MS + 3_500), mine, true)).toEqual({ status: 'unavailable' });
  });

  it('waits while unsettled, then says unavailable', () => {
    const later = at('washer', WASHER_FINISHED_MS + 86_400_000);
    expect(resolveNowFocus(later, mine, false)).toEqual({ status: 'pending' });
    expect(resolveNowFocus(later, mine, true)).toEqual({ status: 'unavailable' });
  });

  it('opens a wake link at NOW for a housemate, who has no wake rows', () => {
    expect(resolveNowFocus(at('wake', WAKE_MS), mine, true)).toEqual({ status: 'found', id: String(WAKE_MS) });
    expect(resolveNowFocus(at('wake', WAKE_MS), candidatesFor(KRISTINE), true)).toEqual({ status: 'unavailable' });
  });

  it('takes a live item only when its own time matches, before the feed row', () => {
    const runningWasher: NowCandidate = { id: 'washer', kind: 'washer', atMs: Date.parse('2026-10-13T14:02:00+02:00'), live: true };
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS), [runningWasher, ...mine], true)).toEqual({
      status: 'found',
      id: String(WASHER_FINISHED_MS),
    });
    expect(resolveNowFocus(at('washer', runningWasher.atMs), [...mine, runningWasher], true)).toEqual({ status: 'found', id: 'washer' });

    const finishedWasher: NowCandidate = { id: 'washer-live', kind: 'washer', atMs: WASHER_FINISHED_MS + 30_000, live: true };
    expect(resolveNowFocus(at('evt', finishedWasher.atMs), [finishedWasher], true)).toEqual({ status: 'unavailable' });
  });

  it('keeps an old washer push on its own row when the next cycle starts a minute later', () => {
    const nextCycle: NowCandidate = { id: 'washer', kind: 'washer', atMs: WASHER_FINISHED_MS + 60_000, live: true };
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS), [nextCycle, ...mine], true)).toEqual({
      status: 'found',
      id: String(WASHER_FINISHED_MS),
    });
    expect(resolveNowFocus(at('washer', WASHER_FINISHED_MS + 30_000), [nextCycle], true)).toEqual({ status: 'unavailable' });
    expect(resolveNowFocus(at('washer', nextCycle.atMs), [nextCycle, ...mine], true)).toEqual({ status: 'found', id: 'washer' });
  });

  it('takes the nearest of several matches', () => {
    const rows: NowCandidate[] = [
      { id: 'a', kind: 'ring', atMs: 1_000_000, live: false },
      { id: 'b', kind: 'ring', atMs: 1_090_000, live: false },
    ];
    expect(resolveNowFocus({ kind: 'ring', epochS: 1_080 }, rows, true)).toEqual({ status: 'found', id: 'b' });
    expect(resolveNowFocus({ kind: 'ring', epochS: 1_010 }, rows, true)).toEqual({ status: 'found', id: 'a' });
  });
});
