// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { connection: object | null };
  let state: State = { connection: null };
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

const { useDrtvFollowing, useDrtvSearch } = await import('../useDrtv');
const { SEARCH_DEBOUNCE_MS } = await import('../useCatalog');

type Send = (message: { type: string; query?: string }) => Promise<unknown>;
const send = vi.fn<Send>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => (resolve = done));
  return { promise, resolve };
}

const show = (id: string, title: string, following = false) => ({
  id,
  title,
  path: `/serie/${title.toLowerCase()}_${id}`,
  poster: `https://dr.example/${id}.jpg`,
  overview: '',
  following,
});
const answer = (...results: ReturnType<typeof show>[]) => ({ results });

let root: Root;
const searches: Array<ReturnType<typeof useDrtvSearch>> = [];
const followings: Array<ReturnType<typeof useDrtvFollowing>> = [];
/** What the probes saw on their latest render. */
const search = () => searches[searches.length - 1];
const followed = () => followings[followings.length - 1];

function SearchProbe({ query, enabled }: { query: string; enabled: boolean }) {
  searches.push(useDrtvSearch(query, enabled));
  return null;
}

function FollowingProbe({ active }: { active: boolean }) {
  followings.push(useDrtvFollowing(active));
  return null;
}

const typing = (query: string, enabled = true) => act(async () => root.render(createElement(SearchProbe, { query, enabled })));
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const ids = () => search().results.map(result => result.id);

beforeEach(() => {
  vi.useFakeTimers();
  searches.length = 0;
  followings.length = 0;
  send.mockReset();
  store.setState({ connection: { sendMessagePromise: send } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('searching DR', () => {
  it('searches the trimmed term once typing pauses for the catalog debounce', async () => {
    send.mockResolvedValue(answer());
    await typing('kon');
    await wait(100);
    await typing('kont ');
    await wait(SEARCH_DEBOUNCE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await wait(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'media_requests/drtv_search', query: 'kont' });
  });

  it('asks nothing for an empty term or while disabled', async () => {
    await typing('   ');
    await wait(SEARCH_DEBOUNCE_MS * 2);
    await typing('kontant', false);
    await wait(SEARCH_DEBOUNCE_MS * 2);
    expect(send).not.toHaveBeenCalled();
    expect(search().results).toEqual([]);
  });

  it('drops the answer to a superseded term', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    send.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await typing('kon');
    await wait(SEARCH_DEBOUNCE_MS);
    await typing('kont');
    await wait(SEARCH_DEBOUNCE_MS);
    await act(async () => first.resolve(answer(show('1', 'Kon'))));
    expect(ids()).toEqual([]);
    await act(async () => second.resolve(answer(show('2', 'Kontant'))));
    expect(ids()).toEqual(['2']);
  });

  it('shows the older answer as stale while a newer term is on its way', async () => {
    send.mockResolvedValueOnce(answer(show('1', 'Kon'))).mockResolvedValueOnce(answer(show('2', 'Kontant')));
    await typing('kon');
    await wait(SEARCH_DEBOUNCE_MS);
    expect(search().stale).toBe(false);
    await typing('kont');
    expect(ids()).toEqual(['1']);
    expect(search().stale).toBe(true);
    await wait(SEARCH_DEBOUNCE_MS);
    expect(ids()).toEqual(['2']);
    expect(search().stale).toBe(false);
  });

  it('treats a failed search as an empty answer', async () => {
    send.mockRejectedValue({ code: 'upstream_unavailable' });
    await typing('kontant');
    await wait(SEARCH_DEBOUNCE_MS);
    expect(search().results).toEqual([]);
    expect(search().stale).toBe(false);
  });

  it('starts from nothing after the search was emptied or switched off', async () => {
    send.mockResolvedValueOnce(answer(show('1', 'Kontant'))).mockResolvedValueOnce(answer(show('2', 'Ramasjang')));
    await typing('kontant');
    await wait(SEARCH_DEBOUNCE_MS);
    expect(ids()).toEqual(['1']);
    await typing('');
    expect(ids()).toEqual([]);
    await wait(0);
    await typing('ra');
    expect(ids()).toEqual([]);
    await wait(SEARCH_DEBOUNCE_MS);
    expect(ids()).toEqual(['2']);
  });

  it('flips one result flag, and leaves the results alone when nothing changes', async () => {
    send.mockResolvedValue(answer(show('1', 'Kontant'), show('2', 'Kon', true)));
    await typing('kon');
    await wait(SEARCH_DEBOUNCE_MS);
    act(() => search().setFollowing('1', true));
    expect(search().results.map(result => result.following)).toEqual([true, true]);
    const before = search().results;
    act(() => search().setFollowing('1', true));
    act(() => search().setFollowing('9', true));
    expect(search().results).toBe(before);
  });
});

describe('the followed series', () => {
  const series = (...titles: string[]) => ({
    series: titles.map((title, index) => ({ ...show(String(index + 1), title), listed: 3, downloaded: 1 })),
  });
  const rendering = (active: boolean) => act(async () => root.render(createElement(FollowingProbe, { active })));

  it('is fetched only while active, and afresh every time it turns on', async () => {
    send.mockResolvedValue(series('Kontant'));
    await rendering(false);
    expect(send).not.toHaveBeenCalled();
    expect(followed().items).toBeNull();
    await rendering(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ type: 'media_requests/drtv_following' });
    expect(followed().items?.map(entry => entry.title)).toEqual(['Kontant']);
    await rendering(false);
    await rendering(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports a failed load and loads again on retry', async () => {
    send.mockRejectedValueOnce({ code: 'upstream_unavailable' }).mockResolvedValueOnce(series('Kontant'));
    await rendering(true);
    expect(followed().failed).toBe(true);
    expect(followed().items).toBeNull();
    await act(async () => followed().retry());
    expect(followed().failed).toBe(false);
    expect(followed().items).toHaveLength(1);
  });

  it('drops one series from the loaded list', async () => {
    send.mockResolvedValue(series('Kontant', 'Kon'));
    await rendering(true);
    act(() => followed().drop('1'));
    expect(followed().items?.map(entry => entry.id)).toEqual(['2']);
    const before = followed().items;
    act(() => followed().drop('1'));
    expect(followed().items).toBe(before);
  });
});
