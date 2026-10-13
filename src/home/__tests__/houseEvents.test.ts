import { describe, expect, it } from 'vitest';
import {
  canViewerSee,
  canViewerSeeKind,
  EPISODE_MERGE_MS,
  houseEpisodes,
  houseEventKind,
  houseEventLabel,
  newestEventMs,
  parseHouseEvents,
  visibleHouseEvents,
  type HouseEvent,
  type HouseEventViewer,
} from '../houseEvents';
import feed from './fixtures/house-events-2026-10-13.json';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const KRISTINE: HouseEventViewer = { isAdmin: false, name: 'Kristine' };
const CLAUDIA: HouseEventViewer = { isAdmin: false, name: 'Claudia' };
const ROOFTOP_TABLET: HouseEventViewer = { isAdmin: false, name: 'Rooftop' };
const RESOLVING: HouseEventViewer = { isAdmin: null, name: null };

const live = parseHouseEvents(feed.attributes.events);

function row(ts: string, icon: string, extra: Partial<HouseEvent> = {}): HouseEvent {
  return { tsMs: Date.parse(ts), icon, text: extra.cause && extra.effect ? `${extra.cause} -> ${extra.effect}` : icon, ...extra };
}

const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [key(item)]: (counts[key(item)] ?? 0) + 1 }), {});

describe('the live feed of 13.10.2026 (40 rows, about 3 days)', () => {
  it('parses every row, newest first', () => {
    expect(live).toHaveLength(40);
    expect(live[0].tsMs).toBe(Date.parse('2026-10-13T12:26:06.404260+02:00'));
    expect(live.every((event, i) => i === 0 || event.tsMs <= live[i - 1].tsMs)).toBe(true);
  });

  it('reads a kind from the icons only one producer writes', () => {
    expect(countBy(live, houseEventKind)).toEqual({ ring: 7, washer: 3, dryer: 1, dish: 1, wake: 2, evt: 26 });
  });

  it('never guesses an appliance from a shared icon', () => {
    const emptied = live.filter(event => event.icon === 'mdi:basket-check');
    expect(emptied.map(event => event.text)).toEqual([
      'Washer emptied',
      'Dishwasher emptied',
      'Dryer emptied',
      'Washer emptied',
      'Washer emptied',
    ]);
    expect(emptied.every(event => houseEventKind(event) === 'evt')).toBe(true);
    expect(live.filter(event => event.icon === 'mdi:door-open').every(event => houseEventKind(event) === 'evt')).toBe(true);
  });

  it('merges the 14 rows of 7 rings into 7 episodes, bell first and door 3 to 5 s later', () => {
    const rings = houseEpisodes(live).filter(episode => episode.kind === 'ring');
    expect(rings).toHaveLength(7);
    expect(rings.flatMap(episode => episode.rows)).toHaveLength(14);
    for (const episode of rings) {
      expect(episode.rows.map(r => r.icon)).toEqual(['mdi:bell-ring', 'mdi:door-open']);
      expect(episode.endMs - episode.startMs).toBeGreaterThanOrEqual(3_000);
      expect(episode.endMs - episode.startMs).toBeLessThanOrEqual(5_100);
      expect(episode.id).toBe(String(episode.startMs));
    }
  });

  it('gives Mikkel 33 episodes and the housemates 22, without admin or wake rows', () => {
    const mine = houseEpisodes(visibleHouseEvents(live, MIKKEL));
    expect(mine).toHaveLength(33);
    expect(countBy(mine, episode => episode.kind)).toEqual({ ring: 7, washer: 3, dryer: 1, dish: 1, wake: 2, evt: 19 });

    for (const viewer of [KRISTINE, CLAUDIA, ROOFTOP_TABLET, RESOLVING]) {
      const rows = visibleHouseEvents(live, viewer);
      expect(rows).toHaveLength(29);
      expect(rows.some(event => event.audience === 'admin' || houseEventKind(event) === 'wake')).toBe(false);
      const episodes = houseEpisodes(rows);
      expect(episodes).toHaveLength(22);
      expect(countBy(episodes, episode => episode.kind)).toEqual({ ring: 7, washer: 3, dryer: 1, dish: 1, evt: 10 });
    }
  });

  it('keeps the newest episode first', () => {
    const episodes = houseEpisodes(live);
    expect(episodes[0].kind).toBe('ring');
    expect(episodes[0].startMs).toBe(Date.parse('2026-10-13T12:26:01.941170+02:00'));
    expect(episodes.every((episode, i) => i === 0 || episode.startMs <= episodes[i - 1].startMs)).toBe(true);
  });
});

describe('parseHouseEvents', () => {
  it('drops malformed rows and fields', () => {
    const events = parseHouseEvents([
      null,
      'row',
      { ts: '2026-10-13T10:00:00+02:00' },
      { ts: 'yesterday', text: 'bad time' },
      { ts: '2026-10-13T10:00:00+02:00', text: 'only cause', cause: 'Something', effect: '  ' },
      { ts: '2026-10-13T09:00:00+02:00', text: 'x', audience: 'Admin', audience_users: ['  Claudia ', '', 7] },
      { ts: '2026-10-13T08:00:00+02:00', text: 'y', audience: 'admin', audience_users: ['Claudia'], by: ' Kristine ' },
    ]);
    expect(events).toEqual([
      { tsMs: Date.parse('2026-10-13T10:00:00+02:00'), text: 'only cause', icon: 'mdi:information-outline' },
      { tsMs: Date.parse('2026-10-13T09:00:00+02:00'), text: 'x', icon: 'mdi:information-outline', audienceUsers: ['Claudia'] },
      { tsMs: Date.parse('2026-10-13T08:00:00+02:00'), text: 'y', icon: 'mdi:information-outline', audience: 'admin', by: 'Kristine' },
    ]);
    expect(parseHouseEvents({ events: [] })).toEqual([]);
  });

  it('caps the feed at 40 rows', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 9, 13, 0, 50 - i)).toISOString(), text: `${i}` }));
    expect(parseHouseEvents(many)).toHaveLength(40);
  });
});

describe('audience rule', () => {
  const publicRow = row('2026-10-13T10:00:00Z', 'mdi:robot-vacuum');
  const adminRow = row('2026-10-13T10:01:00Z', 'mdi:television', { audience: 'admin' });
  const claudiasRow = row('2026-10-13T10:02:00Z', 'mdi:hand-back-right', { audienceUsers: ['Claudia'] });
  const wakeWithoutAudience = row('2026-10-13T06:30:00Z', 'mdi:weather-sunset-up');

  it('shows Mikkel, the admin, everything', () => {
    for (const event of [publicRow, adminRow, claudiasRow, wakeWithoutAudience]) expect(canViewerSee(event, MIKKEL)).toBe(true);
    const all = [publicRow, adminRow];
    expect(visibleHouseEvents(all, MIKKEL)).toBe(all);
  });

  it('shows a housemate public rows and the rows naming them, case-insensitively', () => {
    expect(canViewerSee(publicRow, KRISTINE)).toBe(true);
    expect(canViewerSee(adminRow, KRISTINE)).toBe(false);
    expect(canViewerSee(claudiasRow, KRISTINE)).toBe(false);
    expect(canViewerSee(claudiasRow, CLAUDIA)).toBe(true);
    expect(canViewerSee(claudiasRow, { isAdmin: false, name: ' claudia ' })).toBe(true);
  });

  it('keeps wake rows Mikkel only even without an admin audience', () => {
    for (const viewer of [KRISTINE, CLAUDIA, ROOFTOP_TABLET, RESOLVING]) {
      expect(canViewerSee(wakeWithoutAudience, viewer)).toBe(false);
      expect(canViewerSeeKind('wake', viewer)).toBe(false);
      expect(canViewerSeeKind('washer', viewer)).toBe(true);
    }
    expect(canViewerSeeKind('wake', MIKKEL)).toBe(true);
  });

  it('gives a viewer still resolving the restricted view', () => {
    expect(canViewerSee(publicRow, RESOLVING)).toBe(true);
    expect(canViewerSee(adminRow, RESOLVING)).toBe(false);
    expect(canViewerSee(claudiasRow, RESOLVING)).toBe(false);
  });
});

describe('houseEpisodes', () => {
  const rang = 'Someone rang the front door';

  it('merges a missed ring and an auto-open failure into the ring that caused them', () => {
    const missed = [
      row('2026-10-13T18:00:41Z', 'mdi:bell-off', { cause: rang, effect: 'Nobody answered - sent a snapshot to everyone home' }),
      row('2026-10-13T18:00:00Z', 'mdi:bell-ring', { cause: rang, effect: 'Announcing on the speakers' }),
    ];
    const failed = [
      row('2026-10-13T17:00:30Z', 'mdi:alert-circle', { cause: rang, effect: 'Auto-open FAILED - 3 unlock attempts got no response' }),
      row('2026-10-13T17:00:00Z', 'mdi:bell-ring', { cause: rang, effect: 'Announcing on the speakers and opening the door' }),
    ];
    const episodes = houseEpisodes([...missed, ...failed]);
    expect(episodes.map(e => [e.kind, e.rows.map(r => r.icon)])).toEqual([
      ['ring', ['mdi:bell-ring', 'mdi:bell-off']],
      ['ring', ['mdi:bell-ring', 'mdi:alert-circle']],
    ]);
  });

  it('keeps a door opened with nobody ringing a generic event', () => {
    const [episode] = houseEpisodes([
      row('2026-10-13T18:00:00Z', 'mdi:door-open', {
        cause: 'The front door was opened with nobody ringing',
        effect: 'Possibly a buzz-in for someone who called ahead, or a test',
      }),
    ]);
    expect(episode.kind).toBe('evt');
  });

  it('merges only within the window after the first row, across rows in between', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 18, 0, 0) + s * 1000).toISOString();
    const events = [
      row(at(EPISODE_MERGE_MS / 1000 + 1), 'mdi:door-open', { cause: rang, effect: 'The door was opened for them' }),
      row(at(EPISODE_MERGE_MS / 1000), 'mdi:door-open', { cause: rang, effect: 'The door was opened for them' }),
      row(at(2), 'mdi:speaker-multiple', { cause: 'Speakers idle', effect: 'Back to default volume' }),
      row(at(0), 'mdi:bell-ring', { cause: rang, effect: 'Announcing on the speakers' }),
    ];
    expect(houseEpisodes(events).map(e => e.rows.length)).toEqual([1, 1, 2]);
  });

  it('never merges rows without a cause, and tolerates an unsorted feed', () => {
    const finished = row('2026-10-13T08:55:30.468Z', 'mdi:washing-machine');
    const emptied = row('2026-10-13T08:55:30.638Z', 'mdi:basket-check');
    expect(houseEpisodes([finished, emptied]).map(e => e.kind)).toEqual(['evt', 'washer']);
  });

  it('keeps ids unique when two episodes start in the same millisecond', () => {
    const ts = '2026-10-13T08:55:30.468Z';
    expect(houseEpisodes([row(ts, 'mdi:washing-machine'), row(ts, 'mdi:basket-check')]).map(e => e.id)).toEqual([
      `${Date.parse(ts)}-2`,
      String(Date.parse(ts)),
    ]);
  });
});

describe('labels and the newest row of a kind', () => {
  it('names a row in one word only where its icon is unambiguous', () => {
    expect(houseEventLabel({ icon: 'mdi:door-open' })).toBe('Opened');
    expect(houseEventLabel({ icon: 'mdi:basket-check' })).toBe('Emptied');
    expect(houseEventLabel({ icon: 'mdi:washing-machine' })).toBe('Done');
    expect(houseEventLabel({ icon: 'mdi:television' })).toBeNull();
    expect(houseEventLabel({ icon: 'mdi:speaker-multiple' })).toBeNull();
  });

  it('finds the newest ring and the newest washer finish in the live feed', () => {
    expect(newestEventMs(feed.attributes.events, 'ring')).toBe(Date.parse('2026-10-13T12:26:01.941170+02:00'));
    expect(newestEventMs(feed.attributes.events, 'washer')).toBe(Date.parse('2026-10-13T10:55:30.468247+02:00'));
    expect(newestEventMs([], 'ring')).toBeNull();
    expect(newestEventMs(undefined, 'ring')).toBeNull();
  });
});
