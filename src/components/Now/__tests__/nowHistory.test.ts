// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeDayKey } from '../../../energy/homeTime';
import {
  fakeRecorder,
  HISTORY_MESSAGE,
  historyRequests,
  HOUSE_EVENTS_ID,
  loggedRows,
  type LoggedRow,
} from '../../../home/__tests__/houseEventsRecorder';
import { HISTORY_OVERLAP_MS, HISTORY_PAGE_MS } from '../../../home/houseEventsHistory';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; hassUrl: string; connection: object };
  let state: State = { entities: {}, hassUrl: '', connection: {} };
  const listeners = new Set<(state: State) => void>();
  return {
    getState: () => state,
    setState(patch: Partial<State>) {
      state = { ...state, ...patch };
      listeners.forEach(listener => listener(state));
    },
    subscribe(listener: (state: State) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return { useHass: Object.assign(useHass, store) };
});
vi.mock('@iconify/react', async () => {
  const { createElement } = await import('react');
  return { Icon: ({ icon, className }: { icon: string; className?: string }) => createElement('i', { 'data-icon': icon, className }) };
});
const user = vi.hoisted(() => ({ current: { is_admin: true, name: 'Mikkel' } }));
vi.mock('home-assistant-js-websocket', () => ({ getUser: async () => user.current }));

const { NowView } = await import('../NowView');

/** The browser's observer, as far as the view uses it: like the browser's, each one reports once as it starts watching. */
class FakeIntersectionObserver {
  static live = new Set<FakeIntersectionObserver>();
  /** Whether the watched element is in range, which the browser works out from the layout. */
  static inRange: () => boolean = () => false;
  private readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
  }
  observe(target: Element) {
    FakeIntersectionObserver.live.add(this);
    setTimeout(() => {
      if (!FakeIntersectionObserver.live.has(this)) return;
      const entry = { target, isIntersecting: FakeIntersectionObserver.inRange() } as IntersectionObserverEntry;
      this.callback([entry], this as unknown as IntersectionObserver);
    }, 0);
  }
  disconnect() {
    FakeIntersectionObserver.live.delete(this);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

/** No layout in a fake DOM, so every row is this tall: an element's offset is its place among the rows. */
const ROW_PX = 40;
const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');

const MIN = 60_000;
const END = '2026-10-13T14:00:00Z';
const NOW = Date.parse(END) + 30 * MIN;
/** 300 rows 40 minutes apart, a little over 8 days, named "Door opened 1" to "Door opened 300". */
const log = loggedRows(300, END, 40 * MIN);
const text = (index: number) => `Door opened ${index}`;

type Entities = Record<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>;

/** The entity as it holds the newest 40 of `rows`, newest first. */
function feedOf(rows: readonly LoggedRow[]): Entities {
  return {
    [HOUSE_EVENTS_ID]: { entity_id: HOUSE_EVENTS_ID, state: 'x', attributes: { events: rows.slice(-40).reverse() } },
  };
}

let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(NOW);
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 }))
  );
  FakeIntersectionObserver.live.clear();
  FakeIntersectionObserver.inRange = () => false;
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return Math.max(0, [...document.querySelectorAll('[data-row-id]')].indexOf(this)) * ROW_PX;
    },
  });
  user.current = { is_admin: true, name: 'Mikkel' };
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  if (offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Lets the chain behind a load run: the observer reports, the request lands, the view renders, the next observer reports. */
async function settle(rounds = 24) {
  for (let round = 0; round < rounds; round++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function open(connection: object, rows: readonly LoggedRow[] = log) {
  store.setState({ entities: feedOf(rows), connection });
  await act(async () => {
    root.render(createElement(NowView, { focus: null, arrival: 'cold', onBack: () => {}, onOpenRoom: () => {} }));
  });
  await settle();
}

const scroller = () => document.querySelector<HTMLElement>('.now-scroll') as HTMLElement;
const touch = async () => {
  await act(async () => {
    scroller().dispatchEvent(new Event('pointerdown'));
  });
  await settle();
};
const pastRows = () => [...document.querySelectorAll('.now-ev.is-past')];
const pastTexts = () => pastRows().map(row => row.querySelector('.now-chip-text')?.textContent);
const status = () => document.querySelector('.now-more');
/** The sentinel counts as in range while the list is shorter than this. */
const rangeUntil = (rows: number) => {
  FakeIntersectionObserver.inRange = () => pastRows().length < rows;
};

describe('scrolling back past the live feed', () => {
  it('loads nothing while the view settles on the NOW line, and watches the rail once the viewer touches the list', async () => {
    FakeIntersectionObserver.inRange = () => true;
    const recorder = fakeRecorder(log);
    await open(recorder.connection);
    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(0);
    expect(FakeIntersectionObserver.live.size).toBe(0);
    expect(pastTexts()).toHaveLength(40);

    FakeIntersectionObserver.inRange = () => false;
    await touch();
    expect(FakeIntersectionObserver.live.size).toBe(1);
    const [observer] = [...FakeIntersectionObserver.live];
    expect(observer.options).toEqual({ root: scroller(), rootMargin: '300px 0px 0px 0px' });
    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(0);
    expect(document.querySelector('.now-rail')?.firstElementChild).toBe(status());
  });

  it('asks for the 3 days before the oldest live row when the sentinel comes in range', async () => {
    const recorder = fakeRecorder(log);
    await open(recorder.connection);
    rangeUntil(60);
    await touch();

    const requests = historyRequests(recorder.sendMessagePromise);
    expect(requests).toHaveLength(1);
    const oldestLiveMs = Date.parse(log[260].ts);
    expect(requests[0]).toMatchObject({
      type: 'history/history_during_period',
      start_time: new Date(oldestLiveMs - HISTORY_PAGE_MS).toISOString(),
      end_time: new Date(oldestLiveMs + HISTORY_OVERLAP_MS).toISOString(),
      entity_ids: [HOUSE_EVENTS_ID],
    });
  });

  it('puts the older rows above the list, in order, and moves the view down by their height', async () => {
    const recorder = fakeRecorder(log);
    await open(recorder.connection);
    expect(scroller().scrollTop).toBe(40 * ROW_PX);

    rangeUntil(60);
    await touch();
    const texts = pastTexts();
    const added = texts.length - 40;
    expect(added).toBeGreaterThan(100);
    expect(texts).toEqual(texts.map((_, i) => text(300 - texts.length + 1 + i)));
    expect(scroller().scrollTop).toBe((40 + added) * ROW_PX);
    expect(status()?.textContent).toBe('');
  });

  it('holds the view when the top row joins an older row in one episode and takes its id', async () => {
    const pair = { cause: 'Doorbell', effect: 'Opened for them' };
    const straddling = log.map((row, index) => {
      if (index === 259) return { ...row, ...pair, ts: new Date(Date.parse(log[260].ts) - 4_000).toISOString() };
      return index === 260 ? { ...row, ...pair } : row;
    });
    const recorder = fakeRecorder(straddling);
    await open(recorder.connection, straddling);
    const first = document.querySelector('.now-ev.is-past')?.getAttribute('data-row-id');
    expect(first).toBe(String(Date.parse(log[260].ts)));

    rangeUntil(60);
    await touch();
    expect(document.querySelector(`[data-row-id="${first}"]`)).toBeNull();
    const added = pastRows().length - 40;
    expect(added).toBeGreaterThan(100);
    expect(scroller().scrollTop).toBe((40 + added) * ROW_PX);
  });

  it('keeps loading pages until the sentinel is out of range, then stops', async () => {
    const recorder = fakeRecorder(log);
    await open(recorder.connection);
    rangeUntil(200);
    await touch();
    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(2);
    expect(pastRows().length).toBeGreaterThanOrEqual(200);
    expect(FakeIntersectionObserver.live.size).toBe(1);

    await settle();
    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(2);
  });

  it('draws a day label wherever the day changes and fades only the older rows, with 300 rows', async () => {
    const recorder = fakeRecorder(log);
    await open(recorder.connection);
    FakeIntersectionObserver.inRange = () => true;
    await touch();

    expect(pastTexts()).toEqual(log.map((_, i) => text(i + 1)));
    const groups = [...document.querySelectorAll('.now-rail > .now-group')];
    expect(groups).toHaveLength(300);
    const dayOf = (index: number) => homeDayKey(Date.parse(log[index].ts));
    const expected = log.map((_, index) => (index === 0 ? dayOf(0) !== homeDayKey(NOW) : dayOf(index) !== dayOf(index - 1)));
    expect(groups.map(group => group.querySelector('.now-day') != null)).toEqual(expected);
    const labels = [...document.querySelectorAll('.now-day')].map(label => label.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.slice(-2)).toEqual(['Yesterday', 'Today']);

    expect(document.querySelectorAll('.now-ev.is-past.age-3')).toHaveLength(297);
    expect(
      pastRows()
        .slice(-3)
        .map(row => row.className.match(/age-\d/)?.[0])
    ).toEqual(['age-2', 'age-1', 'age-0']);
  });

  it('says the history starts here once the recorder has nothing older, and stops asking', async () => {
    const recorder = fakeRecorder(log.slice(-60));
    await open(recorder.connection, log.slice(-60));
    FakeIntersectionObserver.inRange = () => true;
    await touch();

    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(2);
    expect(pastTexts()).toHaveLength(60);
    expect(status()?.textContent).toBe('Start of history');
    expect(FakeIntersectionObserver.live.size).toBe(0);
    await settle();
    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(2);
  });

  it('keeps the rows the live feed drops while the older ones are on screen', async () => {
    const recorder = fakeRecorder(log);
    await open(recorder.connection);
    rangeUntil(60);
    await touch();
    expect(pastTexts()).not.toContain(text(301));

    const newer = [
      ...log,
      ...[301, 302].map(n => ({
        ts: new Date(Date.parse(END) + (n - 300) * 40 * MIN).toISOString(),
        icon: 'mdi:door-open',
        text: text(n),
      })),
    ];
    await act(async () => store.setState({ entities: feedOf(newer) }));
    await settle();
    const texts = pastTexts();
    expect(texts.slice(-4)).toEqual([text(299), text(300), text(301), text(302)]);
    expect(texts).toContain(text(261));
    expect(texts).toContain(text(262));
    expect(texts).toEqual(texts.map((_, i) => text(302 - texts.length + 1 + i)));
  });
});

describe('a stretch the viewer may not see', () => {
  /** The 200 rows before the live feed, a page and a half, are for the administrator only. */
  const restricted = log.map((row, index) => (index >= 60 && index < 260 ? { ...row, audience: 'admin' } : row));

  it('loads on through pages that add nothing to see, until rows appear', async () => {
    user.current = { is_admin: false, name: 'Kristine' };
    const recorder = fakeRecorder(restricted);
    await open(recorder.connection, restricted);
    rangeUntil(60);
    await touch();

    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(2);
    const texts = pastTexts();
    expect(texts.length).toBeGreaterThan(60);
    expect(texts).toContain(text(30));
    expect(texts).not.toContain(text(100));
    expect(texts).not.toContain(text(200));
    expect(texts.slice(-40)).toEqual(log.slice(-40).map((_, i) => text(261 + i)));
  });

  it('shows the administrator those rows from the first page', async () => {
    const recorder = fakeRecorder(restricted);
    await open(recorder.connection, restricted);
    rangeUntil(60);
    await touch();

    expect(historyRequests(recorder.sendMessagePromise)).toHaveLength(1);
    expect(pastTexts()).toContain(text(200));
  });
});

describe('a load that goes wrong', () => {
  it('stops, offers a retry, and loads again when it is tapped', async () => {
    const recorder = fakeRecorder(log);
    let failures = 1;
    const send = vi.fn(async (message: Parameters<typeof recorder.sendMessagePromise>[0]) => {
      if (message.type === HISTORY_MESSAGE && failures-- > 0) throw new Error('offline');
      return recorder.sendMessagePromise(message);
    });
    await open({ sendMessagePromise: send });
    FakeIntersectionObserver.inRange = () => true;
    await touch();

    expect(historyRequests(send)).toHaveLength(1);
    expect(pastTexts()).toHaveLength(40);
    const retry = document.querySelector<HTMLButtonElement>('.now-retry');
    expect(retry?.textContent).toBe('Retry');
    expect(FakeIntersectionObserver.live.size).toBe(0);
    await settle();
    expect(historyRequests(send)).toHaveLength(1);

    rangeUntil(60);
    await act(async () => retry?.click());
    await settle();
    expect(historyRequests(send)).toHaveLength(2);
    expect(pastTexts().length).toBeGreaterThan(100);
    expect(document.querySelector('.now-retry')).toBeNull();
  });

  it('shows a spinner while a page is on its way, and drops a page that lands after the view is gone', async () => {
    const recorder = fakeRecorder(log);
    let release: () => void = () => {};
    const send = vi.fn((message: Parameters<typeof recorder.sendMessagePromise>[0]) =>
      message.type === HISTORY_MESSAGE
        ? new Promise(resolve => {
            release = () => resolve(recorder.sendMessagePromise(message));
          })
        : recorder.sendMessagePromise(message)
    );
    await open({ sendMessagePromise: send });
    FakeIntersectionObserver.inRange = () => true;
    await touch();
    expect(historyRequests(send)).toHaveLength(1);
    expect(status()?.querySelector('.now-spin')).not.toBeNull();
    expect(FakeIntersectionObserver.live.size).toBe(0);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => root.unmount());
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(historyRequests(send)).toHaveLength(1);
    errors.mockRestore();
  });
});
