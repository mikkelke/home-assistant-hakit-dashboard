// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoorbellImage } from '../doorbellArchive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { connection: object };
  let state: State = { connection: {} };
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
vi.mock('@iconify/react', () => ({ Icon: () => null }));

const { DoorbellGallery } = await import('../DoorbellGallery');

/** The archive at the bridge's max_files: 2,000 rings, photo-only, clip-only and both in turn. */
const RINGS: DoorbellImage[] = Array.from({ length: 2000 }, (_, i) => {
  const ts = 1_791_000_000 - i * 3600;
  const photo = i % 3 !== 1 ? `abb_ring_${i}_front_ring_auto_opened.jpg` : '';
  const clip = i % 3 !== 0 ? `abb_ringclip_${i}_100000002.mp4` : '';
  return {
    ts: String(ts),
    datetime: new Date(ts * 1000).toISOString(),
    station: '100000002',
    door: 'front door',
    event_type: 'ring_auto_opened',
    filename: photo,
    url: photo && `/media/local/abb_doorbell/${photo}`,
    clip_filename: clip,
    clip_url: clip && `/media/local/abb_doorbell/${clip}`,
  };
});

/** The viewport: only the elements `reveal` names ever intersect. */
class FakeIntersectionObserver {
  static current: FakeIntersectionObserver | undefined;
  observed: Element[] = [];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.current = this;
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve(element: Element) {
    this.observed = this.observed.filter(observed => observed !== element);
  }
  disconnect() {
    this.observed = [];
  }
  /** Scrolls the next `count` watched elements into view. */
  reveal(count: number) {
    const entries = this.observed.slice(0, count).map(target => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** auth/sign_path answered by hand, so the test sees how many signatures are in flight at once. */
function signer() {
  const waiting: { path: string; answer: () => void }[] = [];
  const ready = new Set<() => void>();
  let inFlight = 0;
  let most = 0;
  let count = 0;
  const sendMessagePromise = vi.fn(
    (message: { type: string; path: string }) =>
      new Promise<{ path: string }>(resolve => {
        const n = ++count;
        inFlight += 1;
        most = Math.max(most, inFlight);
        waiting.push({
          path: message.path,
          answer: () => {
            inFlight -= 1;
            resolve({ path: `${message.path}?authSig=${n}` });
          },
        });
      })
  );
  return {
    connection: {
      sendMessagePromise,
      addEventListener: (_event: string, listener: () => void) => ready.add(listener),
      removeEventListener: (_event: string, listener: () => void) => ready.delete(listener),
    },
    signed: () => sendMessagePromise.mock.calls.map(([message]) => message.path),
    /** The signed paths, sorted: a viewer signs its clip and its photo in no promised order. */
    signedSorted: () => sendMessagePromise.mock.calls.map(([message]) => message.path).sort(),
    most: () => most,
    reconnect: () => ready.forEach(listener => listener()),
    /** Answers every signature, including those that queued behind them. */
    async answerAll() {
      while (waiting.length > 0) {
        await act(async () => {
          waiting.shift()!.answer();
        });
      }
    },
  };
}

let root: Root;
let ha: ReturnType<typeof signer>;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  ha = signer();
  store.setState({ connection: ha.connection });
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function openGallery() {
  await act(async () => root.render(createElement(DoorbellGallery, { images: RINGS, onClose: () => {} })));
}

const tiles = () => [...document.querySelectorAll<HTMLButtonElement>('.doorbell-tile')];
const viewer = () => document.querySelector('.doorbell-photo');

describe('the who-rang gallery at 2,000 rings', () => {
  it('signs only the tiles that scroll into view, four at a time', async () => {
    await openGallery();
    expect(tiles()).toHaveLength(2000);
    expect(ha.signed()).toEqual([]);

    await act(async () => FakeIntersectionObserver.current!.reveal(12));
    await ha.answerAll();
    expect(ha.signed()).toHaveLength(12);
    expect(ha.most()).toBe(4);
    const firstTile = tiles()[0].querySelector('img');
    expect(firstTile?.getAttribute('src')).toBe(`${RINGS[0].url}?authSig=1`);
    const clipOnly = tiles()[1].querySelector('video');
    expect(clipOnly?.getAttribute('src')).toMatch(/^\/media\/local\/abb_doorbell\/abb_ringclip_1_100000002\.mp4\?authSig=\d+#t=0\.1$/);

    await act(async () => FakeIntersectionObserver.current!.reveal(12));
    await ha.answerAll();
    expect(ha.signed()).toHaveLength(24);
    expect(new Set(ha.signed()).size).toBe(24);
  });

  it('signs the opened clip and its photo afresh every time the viewer opens', async () => {
    await openGallery();
    const both = RINGS[2];
    await act(async () => tiles()[2].click());
    await ha.answerAll();
    expect(ha.signedSorted()).toEqual([both.clip_url, both.url].sort());
    expect(viewer()?.querySelector('video')?.getAttribute('src')).toMatch(
      /^\/media\/local\/abb_doorbell\/abb_ringclip_2_100000002\.mp4\?authSig=\d$/
    );

    await act(async () => void window.dispatchEvent(new CustomEvent('modalBackButton', { cancelable: true })));
    expect(viewer()).toBeNull();
    await act(async () => tiles()[2].click());
    await ha.answerAll();
    expect(ha.signedSorted()).toEqual([both.clip_url, both.clip_url, both.url, both.url].sort());
  });

  it('signs a failed file once more, and no further', async () => {
    await openGallery();
    await act(async () => tiles()[0].click());
    await ha.answerAll();
    const still = () => viewer()!.querySelector('img')!;
    await act(async () => void still().dispatchEvent(new Event('error')));
    await ha.answerAll();
    expect(ha.signed()).toEqual([RINGS[0].url, RINGS[0].url]);
    expect(still().getAttribute('src')).toBe(`${RINGS[0].url}?authSig=2`);

    await act(async () => void still().dispatchEvent(new Event('error')));
    await ha.answerAll();
    expect(ha.signed()).toHaveLength(2);
  });

  it('signs again after a reconnect only what had not loaded yet', async () => {
    await openGallery();
    await act(async () => tiles()[2].click());
    await ha.answerAll();
    await act(async () => void viewer()!.querySelector('img')!.dispatchEvent(new Event('load')));
    await act(async () => ha.reconnect());
    await ha.answerAll();
    const both = RINGS[2];
    expect(ha.signedSorted()).toEqual([both.clip_url, both.clip_url, both.url].sort());
  });
});
