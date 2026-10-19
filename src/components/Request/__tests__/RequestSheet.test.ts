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
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon, className }: { icon: string; className?: string }) => h('i', { 'data-icon': icon, className }) };
});

const { RequestSheet } = await import('../RequestSheet');
const { SEARCH_DEBOUNCE_MS } = await import('../useCatalog');

type Message = { type: string; [key: string]: unknown };
interface DrShow {
  id: string;
  title: string;
  path: string;
  poster: string;
  overview: string;
}
interface Followed extends DrShow {
  listed: number | null;
  downloaded: number;
}

const drShow = (id: string, title: string, slug: string): DrShow => ({
  id,
  title,
  path: `/serie/${slug}_${id}`,
  poster: `https://dr.example/${id}.jpg`,
  overview: `${title} handler om noget.`,
});
const KONTANT = drShow('7132', 'Kontant', 'kontant');
const GIFT = drShow('7310', 'Gift ved første blik', 'gift-ved-foerste-blik');
const seerr = (mediaType: 'tv' | 'movie', tmdbId: number, title: string) => ({
  mediaType,
  tmdbId,
  title,
  year: 2020,
  posterPath: null,
  status: 'none',
});

/** A backend that remembers what is followed, with hooks for the answers a test wants to break. */
const fake = {
  seerr: [] as unknown[],
  mine: [] as unknown[],
  drSearch: [] as DrShow[],
  following: [] as Followed[],
  failDrSearch: false,
  failFollowing: false,
  follow: undefined as undefined | ((show: DrShow) => Followed),
};
const send = vi.fn(async (message: Message): Promise<unknown> => {
  switch (message.type) {
    case 'media_requests/discover':
      return { results: [], page: 1, totalPages: 1 };
    case 'media_requests/search':
      return { results: fake.seerr, page: 1, totalPages: 1 };
    case 'media_requests/mine':
      return { items: fake.mine };
    case 'media_requests/drtv_search':
      if (fake.failDrSearch) throw { code: 'upstream_unavailable' };
      return { results: fake.drSearch.map(show => ({ ...show, following: fake.following.some(entry => entry.id === show.id) })) };
    case 'media_requests/drtv_following':
      if (fake.failFollowing) throw { code: 'upstream_unavailable' };
      return { series: fake.following };
    case 'media_requests/drtv_follow': {
      const show = fake.drSearch.find(candidate => candidate.path === message.path)!;
      if (fake.follow) return fake.follow(show);
      const entry = { ...show, listed: null, downloaded: 0 };
      fake.following.push(entry);
      return entry;
    }
    case 'media_requests/drtv_unfollow':
      fake.following = fake.following.filter(entry => entry.id !== message.seriesId);
      return { ok: true };
    default:
      throw new Error(`unexpected ${message.type}`);
  }
});
const sent = (type: string) => send.mock.calls.filter(([message]) => message.type === type);

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  send.mockClear();
  Object.assign(fake, { seerr: [], mine: [], drSearch: [], following: [], failDrSearch: false, failFollowing: false, follow: undefined });
  store.setState({ connection: { sendMessagePromise: send } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const tap = async (element: Element | null | undefined) => {
  await act(async () => (element as HTMLElement).click());
  await wait(0);
};
const openSheet = async (drtv: boolean) => {
  await act(async () => root.render(createElement(RequestSheet, { drtv, onClose: vi.fn() })));
  await wait(0);
};
const type = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('.rq-search input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(SEARCH_DEBOUNCE_MS);
};
const filter = (label: string) => tap(document.querySelector(`.rq-filter[aria-label="${label}"]`));

const drCells = () => [...document.querySelectorAll<HTMLElement>('.rq-dr .rq-cell')];
const gridLabels = () => [...document.querySelectorAll('.rq-grid .rq-cell')].map(cell => cell.getAttribute('aria-label'));
const detail = () => document.querySelector('.rq-sheet--detail');
const cta = () => detail()?.querySelector<HTMLButtonElement>('.rq-cta');
const stop = () => detail()?.querySelector<HTMLButtonElement>('.rq-stop');
const chips = () => [...(detail()?.querySelectorAll('.rq-chip') ?? [])].map(chip => chip.textContent);
const hasCheck = (cell: Element) => cell.querySelector('.rq-badge [data-icon="mdi:check"]') !== null;

describe('without DR access', () => {
  it('neither asks DR anything nor drops Seerr titles', async () => {
    fake.seerr = [seerr('tv', 1, 'Kontant')];
    fake.drSearch = [KONTANT];
    await openSheet(false);
    await type('kontant');
    expect(sent('media_requests/search')).toHaveLength(1);
    expect(send.mock.calls.filter(([message]) => message.type.startsWith('media_requests/drtv'))).toEqual([]);
    expect(document.querySelector('.rq-dr')).toBeNull();
    expect(gridLabels()).toEqual(['Kontant (2020)']);
    await filter('My requests');
    expect(sent('media_requests/drtv_following')).toEqual([]);
  });
});

describe('searching with DR access', () => {
  it('puts DR shows in a row above the grid, marks the followed one, and lets DR win on titles', async () => {
    fake.seerr = [seerr('tv', 1, 'Kontant'), seerr('movie', 2, 'Kontant'), seerr('tv', 3, 'Kontant 2')];
    fake.drSearch = [KONTANT, GIFT];
    fake.following = [{ ...KONTANT, listed: 12, downloaded: 5 }];
    await openSheet(true);
    await type('  kontant ');
    expect(sent('media_requests/drtv_search').at(-1)?.[0]).toEqual({ type: 'media_requests/drtv_search', query: 'kontant' });
    expect(drCells().map(cell => cell.getAttribute('aria-label'))).toEqual(['Kontant, DR, following', 'Gift ved første blik, DR']);
    expect(drCells().map(cell => cell.querySelector('.rq-mark')?.textContent)).toEqual(['DR', 'DR']);
    expect(drCells().map(hasCheck)).toEqual([true, false]);
    expect(drCells()[0].querySelector('img')?.getAttribute('src')).toBe(KONTANT.poster);
    expect(document.querySelector('.rq-dr')?.nextElementSibling?.className).toContain('rq-grid');
    expect(document.querySelector('.rq-dr')?.getAttribute('data-interactive')).toBe('true');
    expect(gridLabels()).toEqual(['Kontant (2020)', 'Kontant 2 (2020)']);
  });

  it('keeps the row for movies off and brings it back for TV shows', async () => {
    fake.drSearch = [KONTANT];
    await openSheet(true);
    await type('kontant');
    expect(drCells()).toHaveLength(1);
    await filter('Movies');
    expect(document.querySelector('.rq-dr')).toBeNull();
    await filter('TV shows');
    await wait(SEARCH_DEBOUNCE_MS);
    expect(drCells()).toHaveLength(1);
  });

  it('shows no empty state when only DR has something, and ignores a failed DR search', async () => {
    fake.drSearch = [KONTANT];
    await openSheet(true);
    await type('kontant');
    expect(drCells()).toHaveLength(1);
    expect(document.querySelector('.rq-state')).toBeNull();

    fake.failDrSearch = true;
    fake.seerr = [seerr('tv', 3, 'Kontant 2')];
    await type('kontant 2');
    expect(document.querySelector('.rq-dr')).toBeNull();
    expect(gridLabels()).toEqual(['Kontant 2 (2020)']);
  });
});

describe('the DR detail sheet', () => {
  const openKontant = async () => {
    fake.drSearch = [KONTANT];
    await openSheet(true);
    await type('kontant');
    await tap(drCells()[0]);
  };

  it('shows the show with one Follow action', async () => {
    await openKontant();
    expect(detail()?.querySelector('.rq-title')?.textContent).toBe('Kontant');
    expect(detail()?.querySelector('.rq-overview')?.textContent).toBe('Kontant handler om noget.');
    expect(detail()?.querySelector('.rq-hero-bg')?.getAttribute('src')).toBe(KONTANT.poster);
    expect(chips()).toEqual(['DR']);
    expect(cta()?.textContent).toBe('Follow');
    expect(stop()).toBeNull();
    expect(sent('media_requests/drtv_following')).toEqual([]);
  });

  it('follows, waits for the first download, and stops following again', async () => {
    await openKontant();
    await tap(cta());
    expect(sent('media_requests/drtv_follow')[0][0]).toEqual({ type: 'media_requests/drtv_follow', path: '/serie/kontant_7132' });
    expect(cta()?.textContent).toBe('Following');
    expect(cta()?.disabled).toBe(true);
    expect(chips()).toEqual(['DR', 'Waiting for first download']);
    expect(hasCheck(drCells()[0])).toBe(true);

    await tap(stop());
    expect(sent('media_requests/drtv_unfollow')[0][0]).toEqual({ type: 'media_requests/drtv_unfollow', seriesId: '7132' });
    expect(cta()?.textContent).toBe('Follow');
    expect(stop()).toBeNull();
    expect(chips()).toEqual(['DR']);
    expect(hasCheck(drCells()[0])).toBe(false);
  });

  it('reads an already followed show as followed and fetches how far it is', async () => {
    fake.following = [{ ...KONTANT, listed: 12, downloaded: 5 }];
    await openKontant();
    expect(cta()?.textContent).toBe('Following');
    expect(chips()).toEqual(['DR', '5 of 12 episodes in Plex']);
    expect(sent('media_requests/drtv_following')).toHaveLength(1);
  });

  it('takes "already requested" as following and refetches the progress', async () => {
    await openKontant();
    fake.follow = show => {
      fake.following.push({ ...show, listed: 12, downloaded: 5 });
      throw { code: 'already_requested' };
    };
    await tap(cta());
    expect(cta()?.textContent).toBe('Following');
    expect(chips()).toEqual(['DR', '5 of 12 episodes in Plex']);
    expect(sent('media_requests/drtv_following')).toHaveLength(1);
    expect(hasCheck(drCells()[0])).toBe(true);
  });

  it('offers a retry when following fails, and no retry when DR does not have it', async () => {
    await openKontant();
    fake.follow = () => {
      throw { code: 'upstream_unavailable' };
    };
    await tap(cta());
    expect(cta()?.textContent).toBe('Try again');
    expect(cta()?.className).toContain('rq-cta--error');
    expect(cta()?.disabled).toBe(false);

    fake.follow = undefined;
    await tap(cta());
    expect(cta()?.textContent).toBe('Following');

    await tap(stop());
    fake.follow = () => {
      throw { code: 'not_found' };
    };
    await tap(cta());
    expect(cta()?.textContent).toBe('Not available');
    expect(cta()?.disabled).toBe(true);
  });

  it('keeps Following and marks Stop following when stopping fails, and treats "not found" as stopped', async () => {
    await openKontant();
    await tap(cta());
    send.mockImplementationOnce(async () => {
      throw { code: 'upstream_unavailable' };
    });
    await tap(stop());
    expect(cta()?.textContent).toBe('Following');
    expect(stop()?.className).toContain('is-error');

    send.mockImplementationOnce(async () => {
      throw { code: 'not_found' };
    });
    await tap(stop());
    expect(cta()?.textContent).toBe('Follow');
  });
});

describe('My requests with DR access', () => {
  const seerrRow = { requestId: 5, mediaType: 'movie', tmdbId: 9, title: 'Furiosa', posterPath: null, status: 'pending' };

  it('lists the followed series below the Seerr rows and opens the same detail', async () => {
    fake.mine = [seerrRow];
    fake.following = [
      { ...KONTANT, listed: 12, downloaded: 5 },
      { ...GIFT, listed: null, downloaded: 0 },
    ];
    await openSheet(true);
    await filter('My requests');
    const rows = [...document.querySelectorAll('.rq-rows .rq-row')];
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual([
      'Furiosa, Requested',
      'Kontant, DR, 5 of 12 episodes in Plex',
      'Gift ved første blik, DR, Waiting for first download',
    ]);
    expect(rows.map(row => row.querySelector('.rq-ring [data-icon]')?.getAttribute('data-icon'))).toEqual([
      'mdi:clock-outline',
      'mdi:circle-half-full',
      'mdi:clock-outline',
    ]);

    await tap(rows[1]);
    expect(detail()?.querySelector('.rq-title')?.textContent).toBe('Kontant');
    expect(cta()?.textContent).toBe('Following');
    expect(chips()).toEqual(['DR', '5 of 12 episodes in Plex']);
    expect(sent('media_requests/drtv_following')).toHaveLength(1);

    await tap(stop());
    expect([...document.querySelectorAll('.rq-rows .rq-row')].map(row => row.getAttribute('aria-label'))).toEqual([
      'Furiosa, Requested',
      'Gift ved første blik, DR, Waiting for first download',
    ]);
  });

  it('shows the empty state only when neither Seerr nor DR has a request', async () => {
    await openSheet(true);
    await filter('My requests');
    expect(document.querySelector('.rq-rows')).toBeNull();
    expect(document.querySelector('.rq-state [data-icon="mdi:inbox-outline"]')).not.toBeNull();

    fake.following = [{ ...KONTANT, listed: 1, downloaded: 1 }];
    await filter('All');
    await filter('My requests');
    expect(document.querySelectorAll('.rq-rows .rq-row')).toHaveLength(1);
    expect(document.querySelector('.rq-state')).toBeNull();
  });

  it('keeps the Seerr rows and shows a retry when only the DR list fails', async () => {
    fake.mine = [seerrRow];
    fake.failFollowing = true;
    await openSheet(true);
    await filter('My requests');
    expect(document.querySelectorAll('.rq-rows .rq-row')).toHaveLength(1);
    expect(document.querySelector('.rq-state [data-icon="mdi:cloud-off-outline"]')).not.toBeNull();
  });
});
