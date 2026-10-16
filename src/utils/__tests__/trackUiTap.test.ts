import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ state: { connection: undefined as unknown } }));
vi.mock('@hakit/core', () => ({ useHass: { getState: () => store.state } }));

const { APP_OPEN_MIN_GAP_MS, UI_TAP_MIN_GAP_MS, appOpenDetail, createAppOpenTracker, createUiTapTracker, trackUiTap } =
  await import('../trackUiTap');

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, set: (ms: number) => (at = ms), advance: (ms: number) => (at += ms) };
}

describe('createUiTapTracker', () => {
  it('hands the tap to the sender with its detail', () => {
    const send = vi.fn();
    const track = createUiTapTracker(send, clock().now);
    track('qa.media');
    track('home.room', 'kitchen');
    expect(send.mock.calls).toEqual([
      ['qa.media', undefined],
      ['home.room', 'kitchen'],
    ]);
  });

  it('counts a key once per window and again when the window has passed', () => {
    const send = vi.fn();
    const time = clock();
    const track = createUiTapTracker(send, time.now);
    track('qa.timeline');
    time.advance(UI_TAP_MIN_GAP_MS - 1);
    track('qa.timeline');
    expect(send).toHaveBeenCalledTimes(1);
    time.advance(1);
    track('qa.timeline');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('measures the window from the tap that was counted, not from one that was dropped', () => {
    const send = vi.fn();
    const time = clock();
    const track = createUiTapTracker(send, time.now);
    track('qa.weather');
    for (let i = 0; i < 3; i += 1) {
      time.advance(UI_TAP_MIN_GAP_MS / 2 - 1);
      track('qa.weather');
    }
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps the keys apart', () => {
    const send = vi.fn();
    const track = createUiTapTracker(send, clock().now);
    track('qa.media');
    track('qa.transit');
    track('qa.media.volume');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('is not muted by a clock that moved backwards', () => {
    const send = vi.fn();
    const time = clock(5_000_000);
    const track = createUiTapTracker(send, time.now);
    track('qa.access');
    time.set(1_000_000);
    track('qa.access');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never throws, whatever the sender or the clock does', async () => {
    const failures = [
      () => {
        throw new Error('socket closed');
      },
      () => Promise.reject(new Error('refused')),
      () => ({ then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error('thenable')) }),
    ];
    for (const send of failures) {
      const track = createUiTapTracker(send, clock().now);
      expect(() => track('qa.media')).not.toThrow();
    }
    expect(() =>
      createUiTapTracker(vi.fn(), () => {
        throw new Error('no clock');
      })('qa.media')
    ).not.toThrow();
    // A rejection nobody handled would fail the run once the microtasks have drained.
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('does not wait for the sender', () => {
    const track = createUiTapTracker(() => new Promise(() => {}), clock().now);
    expect(track('qa.media')).toBeUndefined();
  });
});

describe('trackUiTap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-16T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    store.state.connection = undefined;
  });

  it('calls script.dashboard_ui_tap over the connection', () => {
    const sendMessagePromise = vi.fn(async () => ({}));
    store.state.connection = { sendMessagePromise };
    trackUiTap('home.room', 'kitchen');
    trackUiTap('qa.access');
    expect(sendMessagePromise.mock.calls).toEqual([
      [{ type: 'call_service', domain: 'script', service: 'dashboard_ui_tap', service_data: { ui: 'home.room', detail: 'kitchen' } }],
      [{ type: 'call_service', domain: 'script', service: 'dashboard_ui_tap', service_data: { ui: 'qa.access' } }],
    ]);
  });

  it('counts a key once within the window', () => {
    const sendMessagePromise = vi.fn(async () => ({}));
    store.state.connection = { sendMessagePromise };
    vi.setSystemTime(Date.parse('2026-10-16T09:00:00Z'));
    trackUiTap('qa.timeline');
    vi.advanceTimersByTime(UI_TAP_MIN_GAP_MS - 1);
    trackUiTap('qa.timeline');
    expect(sendMessagePromise).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a connection, and does not throw', () => {
    store.state.connection = undefined;
    vi.setSystemTime(Date.parse('2026-10-16T10:00:00Z'));
    expect(() => trackUiTap('qa.weather')).not.toThrow();
  });

  it('does not throw when the connection throws or rejects', async () => {
    vi.setSystemTime(Date.parse('2026-10-16T11:00:00Z'));
    store.state.connection = {
      sendMessagePromise: () => {
        throw new Error('connection closed');
      },
    };
    expect(() => trackUiTap('qa.transit')).not.toThrow();
    vi.setSystemTime(Date.parse('2026-10-16T12:00:00Z'));
    store.state.connection = { sendMessagePromise: () => Promise.reject(new Error('not found')) };
    expect(() => trackUiTap('qa.transit')).not.toThrow();
    vi.useRealTimers();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

describe('createAppOpenTracker', () => {
  /** A localStorage stand-in; `blocked` makes every touch throw, as a locked-down WebView does. */
  const storage = (blocked = false) => {
    const items = new Map<string, string>();
    const touch = () => {
      if (blocked) throw new Error('SecurityError');
    };
    return {
      items,
      getItem: (key: string) => (touch(), items.get(key) ?? null),
      setItem: (key: string, value: string) => (touch(), void items.set(key, value)),
    };
  };

  it('counts the first open with where it was', () => {
    const track = vi.fn();
    createAppOpenTracker(track, clock().now, () => storage())('home');
    expect(track).toHaveBeenCalledExactlyOnceWith('app.open', 'home');
  });

  it('counts an open again only after the gap', () => {
    const track = vi.fn();
    const time = clock();
    const open = createAppOpenTracker(track, time.now, () => storage());
    open('home');
    time.advance(APP_OPEN_MIN_GAP_MS - 1);
    open('room=kitchen');
    expect(track).toHaveBeenCalledTimes(1);
    time.advance(1);
    open('room=kitchen');
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith('app.open', 'room=kitchen');
  });

  it('shares the count with a reload or another tab of the device', () => {
    const track = vi.fn();
    const time = clock();
    const shared = storage();
    createAppOpenTracker(track, time.now, () => shared)('home');
    time.advance(60_000);
    createAppOpenTracker(track, time.now, () => shared)('home');
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('still keeps the gap when storage is blocked', () => {
    const track = vi.fn();
    const time = clock();
    const open = createAppOpenTracker(track, time.now, () => storage(true));
    open('home');
    time.advance(60_000);
    open('home');
    expect(track).toHaveBeenCalledTimes(1);
    time.advance(APP_OPEN_MIN_GAP_MS);
    open('home');
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('counts an open when what storage holds is not a time, or lies in the future', () => {
    for (const saved of ['garbage', '', String(2_000_000_000_000)]) {
      const track = vi.fn();
      const shared = storage();
      shared.items.set('ha-dashboard:app-open', saved);
      createAppOpenTracker(track, clock().now, () => shared)('home');
      expect(track).toHaveBeenCalledTimes(1);
    }
  });

  it('never throws', () => {
    const open = createAppOpenTracker(
      () => {
        throw new Error('sender broke');
      },
      clock().now,
      () => storage()
    );
    expect(() => open('home')).not.toThrow();
    const noStorage = createAppOpenTracker(vi.fn(), clock().now, () => {
      throw new Error('no window');
    });
    expect(() => noStorage('home')).not.toThrow();
  });
});

describe('appOpenDetail', () => {
  it('names the route the dashboard opens on, or home', () => {
    expect(appOpenDetail('')).toBe('home');
    expect(appOpenDetail('#')).toBe('home');
    expect(appOpenDetail('#something-else')).toBe('home');
    expect(appOpenDetail('#room=kitchen')).toBe('room=kitchen');
    expect(appOpenDetail('#room=kitchen&climate=1')).toBe('room=kitchen');
    expect(appOpenDetail('#room=')).toBe('home');
    expect(appOpenDetail('#energy')).toBe('energy');
    expect(appOpenDetail('#energy=plan')).toBe('energy');
    expect(appOpenDetail('#map')).toBe('map');
    expect(appOpenDetail('#now')).toBe('now');
    expect(appOpenDetail('#now=ring-1760600000')).toBe('now');
  });
});
