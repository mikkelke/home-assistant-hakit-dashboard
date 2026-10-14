import { describe, expect, it } from 'vitest';
import {
  isArrivalState,
  isRoomOverNow,
  leaveNowEntry,
  NOW_ENTRY_KEY,
  nowEntryBelow,
  nowEntryItem,
  pushNowEntry,
  ROOM_OVER_NOW_KEY,
  settleNowEntry,
  type RouteHistory,
} from '../nowHistory';

const GRID = '/dashboard-rooftop/home';
const WASHER_LINK = `${GRID}#now=washer-1791891464`;

/** A session history: entries are cloned like the browser's, and a fragment link pushes an entry
 * with a null state like a same-document navigation. */
class FakeHistory implements RouteHistory {
  entries: { url: string; state: unknown }[];
  index = 0;

  constructor(url: string, state: unknown = null) {
    this.entries = [{ url, state: structuredClone(state) }];
  }

  get state(): unknown {
    return structuredClone(this.entries[this.index].state);
  }

  get length(): number {
    return this.entries.length;
  }

  get location() {
    const url = new URL(this.entries[this.index].url, 'https://ha.example');
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  }

  get urls(): string[] {
    return this.entries.map(e => e.url);
  }

  pushState(data: unknown, _unused: string, url?: string | null): void {
    const next = { url: url ?? this.entries[this.index].url, state: structuredClone(data) };
    this.entries = [...this.entries.slice(0, this.index + 1), next];
    this.index += 1;
  }

  replaceState(data: unknown, _unused: string, url?: string | null): void {
    this.entries[this.index] = { url: url ?? this.entries[this.index].url, state: structuredClone(data) };
  }

  back(): void {
    this.index = Math.max(0, this.index - 1);
  }

  forward(): void {
    this.index = Math.min(this.entries.length - 1, this.index + 1);
  }

  followLink(hash: string): void {
    this.pushState(null, '', `${this.location.pathname}${this.location.search}${hash}`);
  }
}

describe('cold open of a #now link', () => {
  it('seeds the grid below it on a fresh one-entry history, keeping HA root on the grid entry', () => {
    const history = new FakeHistory(WASHER_LINK, { root: true });

    expect(settleNowEntry(history, history.location, 'load')).toBe('seeded');
    expect(history.urls).toEqual([GRID, WASHER_LINK]);
    expect(history.length).toBe(2);
    expect(history.entries[0].state).toEqual({ root: true });
    expect(history.state).toEqual({ [NOW_ENTRY_KEY]: 'grid' });

    history.back();
    expect(history.location.hash).toBe('');
    expect(history.state).toEqual({ root: true });
  });

  it('does nothing again after an iframe reload, Back or Forward', () => {
    const history = new FakeHistory(WASHER_LINK, { root: true });
    settleNowEntry(history, history.location, 'load');

    expect(settleNowEntry(history, history.location, 'load')).toBe('none');
    history.back();
    history.forward();
    expect(settleNowEntry(history, history.location, 'navigation', 'grid')).toBe('none');
    expect(history.urls).toEqual([GRID, WASHER_LINK]);
  });

  it('does nothing after a reload under an overlay, or after an overlay replaced the state', () => {
    const history = new FakeHistory(WASHER_LINK, { root: true });
    settleNowEntry(history, history.location, 'load');
    history.pushState({ modal: 'appliance' }, '', WASHER_LINK);

    expect(settleNowEntry(history, history.location, 'load')).toBe('none');
    history.back();
    history.replaceState({ timeline: null }, '', WASHER_LINK);
    expect(settleNowEntry(history, history.location, 'load')).toBe('none');
    expect(history.urls).toEqual([GRID, WASHER_LINK, WASHER_LINK]);
  });

  it('keeps the state HA stamped on an entry it navigated to from another page', () => {
    const history = new FakeHistory('/lovelace/0', { root: true });
    history.pushState({ from: '/lovelace/0' }, '', `${GRID}#now=dish-1791787500`);

    expect(settleNowEntry(history, history.location, 'load')).toBe('seeded');
    expect(history.urls).toEqual(['/lovelace/0', GRID, `${GRID}#now=dish-1791787500`]);
    expect(history.entries[1].state).toEqual({ from: '/lovelace/0' });
    history.back();
    history.back();
    expect(history.location.pathname).toBe('/lovelace/0');
  });

  it('seeds a malformed link too and keeps its hash', () => {
    const history = new FakeHistory(`${GRID}#now=bogus`);
    expect(settleNowEntry(history, history.location, 'load')).toBe('seeded');
    expect(history.urls).toEqual([GRID, `${GRID}#now=bogus`]);
    expect(history.entries[0].state).toBeNull();
  });

  it('seeds from the live location, which the first write changes', () => {
    const history = new FakeHistory(WASHER_LINK, { root: true });
    const live = {
      get pathname() {
        return history.location.pathname;
      },
      get search() {
        return history.location.search;
      },
      get hash() {
        return history.location.hash;
      },
    };
    expect(settleNowEntry(history, live, 'load')).toBe('seeded');
    expect(history.urls).toEqual([GRID, WASHER_LINK]);
  });

  it('leaves other hashes alone', () => {
    for (const url of [GRID, `${GRID}#room=kitchen`, `${GRID}#energy=plan`]) {
      const history = new FakeHistory(url, { root: true });
      expect(settleNowEntry(history, history.location, 'load')).toBe('none');
      expect(history.entries).toEqual([{ url, state: { root: true } }]);
    }
  });
});

describe('warm #now link', () => {
  it('marks the entry the link pushed over the grid without adding a grid entry', () => {
    const history = new FakeHistory(GRID, { root: true });
    history.followLink('#now=ring-1791895872');

    expect(settleNowEntry(history, history.location, 'navigation', 'grid')).toBe('adopted');
    expect(history.urls).toEqual([GRID, `${GRID}#now=ring-1791895872`]);
    expect(history.state).toEqual({ [NOW_ENTRY_KEY]: 'grid' });
    expect(settleNowEntry(history, history.location, 'load')).toBe('none');

    history.back();
    expect(history.location.hash).toBe('');
    expect(history.state).toEqual({ root: true });
  });

  it('goes Back to the room it arrived over', () => {
    const history = new FakeHistory(GRID, { root: true });
    history.pushState({ room: 'kitchen' }, '', `${GRID}#room=kitchen`);
    history.followLink('#now=dish-1791787500');

    expect(settleNowEntry(history, history.location, 'navigation', 'other')).toBe('adopted');
    history.back();
    expect(history.location.hash).toBe('#room=kitchen');
  });

  it('stacks a repeated link on the first one and marks it once', () => {
    const history = new FakeHistory(GRID, { root: true });
    history.followLink('#now=ring-1791895872');
    settleNowEntry(history, history.location, 'navigation', 'grid');
    history.followLink('#now=washer-1791891464');

    expect(settleNowEntry(history, history.location, 'navigation', 'other')).toBe('adopted');
    history.back();
    expect(settleNowEntry(history, history.location, 'navigation', 'other')).toBe('none');
    expect(history.location.hash).toBe('#now=ring-1791895872');
    expect(history.length).toBe(3);
  });
});

describe('opening and leaving the timeline in the app', () => {
  it('pushes one entry over the grid and leaves it by going back', () => {
    const history = new FakeHistory(GRID, { root: true });
    pushNowEntry(history, history.location, { kind: 'evt', epochS: 1791891464 }, 'grid');
    expect(history.urls).toEqual([GRID, `${GRID}#now=evt-1791891464`]);

    expect(leaveNowEntry(history, history.location)).toBe('back');
    expect(history.location.hash).toBe('');
    expect(history.state).toEqual({ root: true });
    expect(history.length).toBe(2);
  });

  it('keeps the exact item an in-app tap opens on, through Back and Forward', () => {
    const history = new FakeHistory(GRID, { root: true });
    pushNowEntry(history, history.location, { kind: 'evt', epochS: 1791891464 }, 'grid', '1791891464775');
    expect(nowEntryItem(history.state)).toBe('1791891464775');
    expect(nowEntryBelow(history.state)).toBe('grid');
    history.back();
    expect(nowEntryItem(history.state)).toBeNull();
    history.forward();
    expect(nowEntryItem(history.state)).toBe('1791891464775');
    expect(settleNowEntry(history, history.location, 'navigation', 'grid')).toBe('none');

    pushNowEntry(history, history.location, null, 'other');
    expect(nowEntryItem(history.state)).toBeNull();
  });

  it('leaves a cold-opened timeline by going back to the seeded grid', () => {
    const history = new FakeHistory(WASHER_LINK, { root: true });
    settleNowEntry(history, history.location, 'load');

    expect(leaveNowEntry(history, history.location)).toBe('back');
    expect(history.urls).toEqual([GRID, WASHER_LINK]);
    expect(history.state).toEqual({ root: true });
  });

  it('turns an entry that arrived over something else into the grid, keeping HA state', () => {
    const history = new FakeHistory(GRID, { root: true });
    history.pushState({ room: 'kitchen' }, '', `${GRID}#room=kitchen`);
    history.pushState({ from: '/dashboard-rooftop/home' }, '', `${GRID}#now`);
    settleNowEntry(history, history.location, 'navigation', 'other');

    expect(leaveNowEntry(history, history.location)).toBe('replaced');
    expect(history.urls).toEqual([GRID, `${GRID}#room=kitchen`, GRID]);
    expect(history.state).toEqual({ from: '/dashboard-rooftop/home' });

    pushNowEntry(history, history.location, null, 'other', '1791891464775');
    expect(leaveNowEntry(history, history.location)).toBe('replaced');
    expect(history.state).toBeNull();
  });
});

describe('entry state', () => {
  it('treats only Home Assistant keys as an arriving link', () => {
    for (const state of [null, undefined, { root: true }, { from: '/lovelace/0' }, { root: true, from: '/x' }]) {
      expect(isArrivalState(state)).toBe(true);
    }
    for (const state of [{ [NOW_ENTRY_KEY]: 'grid' }, { modal: 'x' }, { timeline: null }, { room: null }, { dialog: 'more-info' }]) {
      expect(isArrivalState(state)).toBe(false);
    }
  });

  it('reads the below-marker only from entries this dashboard owns', () => {
    expect(nowEntryBelow({ [NOW_ENTRY_KEY]: 'grid', root: true })).toBe('grid');
    expect(nowEntryBelow({ [NOW_ENTRY_KEY]: 'other' })).toBe('other');
    for (const state of [null, { root: true }, { [NOW_ENTRY_KEY]: true }, 'grid']) expect(nowEntryBelow(state)).toBeNull();
  });

  it('knows a room entry pushed over the timeline, also after other keys were merged into it', () => {
    expect(isRoomOverNow({ room: 'kitchen', [ROOM_OVER_NOW_KEY]: true })).toBe(true);
    expect(isRoomOverNow({ room: 'kitchen', [ROOM_OVER_NOW_KEY]: true, timeline: null })).toBe(true);
    for (const state of [null, { room: 'kitchen' }, { [ROOM_OVER_NOW_KEY]: 'true' }, 'room']) expect(isRoomOverNow(state)).toBe(false);
  });
});
