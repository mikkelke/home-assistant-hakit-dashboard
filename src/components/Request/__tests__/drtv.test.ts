import type { Connection } from 'home-assistant-js-websocket';
import { describe, expect, it, vi } from 'vitest';
import { fetchAccess, NO_ACCESS } from '../api';
import {
  drSeed,
  drStatus,
  fetchDrFollowing,
  followDr,
  mergeDr,
  normalizeTitle,
  progressText,
  searchDr,
  unfollowDr,
  type DrResult,
} from '../drtv';
import type { Item, Status } from '../types';

/** A connection that answers every command with `reply`, or rejects with it when it is an Error or `{ code }`. */
function answering(reply: unknown) {
  const sendMessagePromise = vi.fn<(message: object) => Promise<unknown>>(async () => {
    if (reply instanceof Error || (typeof reply === 'object' && reply !== null && 'code' in reply)) throw reply;
    return reply;
  });
  return { sendMessagePromise, connection: { sendMessagePromise } as unknown as Connection };
}

const raw = { id: '7132', title: 'Kontant', path: '/serie/kontant_7132', poster: 'https://dr.example/7132.jpg', overview: 'Penge.' };

describe('fetchAccess', () => {
  it('reads whether DR series can be followed', async () => {
    await expect(fetchAccess(answering({ allowed: true, drtv: true }).connection)).resolves.toEqual({ allowed: true, drtv: true });
  });

  it('treats a backend that does not mention DR as one without it', async () => {
    await expect(fetchAccess(answering({ allowed: true }).connection)).resolves.toEqual({ allowed: true, drtv: false });
  });

  it('never grants DR to a viewer who may not use requests', async () => {
    await expect(fetchAccess(answering({ allowed: false, drtv: true }).connection)).resolves.toEqual(NO_ACCESS);
    await expect(fetchAccess(answering(null).connection)).resolves.toEqual(NO_ACCESS);
  });

  it('answers forbidden with no access and rejects any other failure', async () => {
    await expect(fetchAccess(answering({ code: 'forbidden' }).connection)).resolves.toEqual(NO_ACCESS);
    await expect(fetchAccess(answering({ code: 'upstream_unavailable' }).connection)).rejects.toEqual({ code: 'upstream_unavailable' });
  });
});

describe('the DR commands', () => {
  it('searches with the query and fills in what DR leaves out', async () => {
    const ha = answering({
      results: [
        { ...raw, following: true },
        { ...raw, id: '1', poster: '', overview: undefined },
      ],
    });
    const results = await searchDr(ha.connection, 'kontant');
    expect(ha.sendMessagePromise).toHaveBeenCalledWith({ type: 'media_requests/drtv_search', query: 'kontant' });
    expect(results.map(result => [result.id, result.following, result.poster, result.overview])).toEqual([
      ['7132', true, 'https://dr.example/7132.jpg', 'Penge.'],
      ['1', false, null, ''],
    ]);
  });

  it('lists the followed series, with progress unknown until the first sync', async () => {
    const ha = answering({
      series: [
        { ...raw, listed: 12, downloaded: 5 },
        { ...raw, id: '2' },
      ],
    });
    const series = await fetchDrFollowing(ha.connection);
    expect(ha.sendMessagePromise).toHaveBeenCalledWith({ type: 'media_requests/drtv_following' });
    expect(series.map(entry => [entry.id, entry.listed, entry.downloaded])).toEqual([
      ['7132', 12, 5],
      ['2', null, 0],
    ]);
    await expect(fetchDrFollowing(answering({}).connection)).resolves.toEqual([]);
  });

  it('follows by the path DR gave, whatever its slug holds', async () => {
    const path = '/serie/tv_ansjosen_436999';
    const ha = answering({ ...raw, id: '436999', path, listed: null, downloaded: 0 });
    await expect(followDr(ha.connection, path)).resolves.toMatchObject({ id: '436999', path, listed: null, downloaded: 0 });
    expect(ha.sendMessagePromise).toHaveBeenCalledWith({ type: 'media_requests/drtv_follow', path });
  });

  it('unfollows by seriesId, because the message id belongs to the connection', async () => {
    const ha = answering({ ok: true });
    await unfollowDr(ha.connection, '7132');
    expect(ha.sendMessagePromise).toHaveBeenCalledWith({ type: 'media_requests/drtv_unfollow', seriesId: '7132' });
    expect(ha.sendMessagePromise.mock.calls[0][0]).not.toHaveProperty('id');
  });
});

describe('DR and Seerr results for one search', () => {
  const item = (mediaType: Item['mediaType'], tmdbId: number, title: string, status: Status = 'none'): Item => ({
    mediaType,
    tmdbId,
    title,
    year: null,
    posterPath: null,
    status,
  });
  const show = (id: string, title: string, following = false) => ({ id, title, following }) as DrResult;

  it('normalises titles by case, edges and inner whitespace', () => {
    expect(normalizeTitle('  Gift   ved\tførste  Blik ')).toBe('gift ved første blik');
  });

  it('drops TV items with the title of a DR result and keeps everything else', () => {
    const items = [item('tv', 1, ' KONTANT '), item('movie', 2, 'Kontant'), item('tv', 3, 'Kontant 2'), item('tv', 4, 'Other')];
    const merged = mergeDr(items, [show('1', 'Kontant')]);
    expect(merged.items.map(entry => entry.tmdbId)).toEqual([2, 3, 4]);
    expect(merged.dr.map(entry => entry.id)).toEqual(['1']);
  });

  it('keeps a show already in Plex with Seerr and drops it from DR', () => {
    for (const status of ['available', 'partial'] as const) {
      const items = [item('tv', 1, 'Matador', status), item('tv', 2, 'Matador')];
      const merged = mergeDr(items, [show('1', 'Matador'), show('2', 'Borgen')]);
      expect(merged.items).toBe(items);
      expect(merged.dr.map(entry => entry.id)).toEqual(['2']);
    }
  });

  it('matches a DR title against the original title too', () => {
    const inPlex = { ...item('tv', 1, 'Unit One', 'available'), originalTitle: 'Rejseholdet' };
    const merged = mergeDr([inPlex], [show('1', 'Rejseholdet')]);
    expect(merged.dr).toEqual([]);
    const notInPlex = { ...item('tv', 2, 'The Kingdom'), originalTitle: 'Riget' };
    expect(mergeDr([notInPlex], [show('2', 'Riget')]).items).toEqual([]);
  });

  it('keeps a followed DR show even when Plex has it', () => {
    const items = [item('tv', 1, 'Kontant', 'available'), item('movie', 2, 'Kontant', 'available')];
    const dr = [show('1', 'Kontant', true)];
    const merged = mergeDr(items, dr);
    expect(merged.items.map(entry => entry.tmdbId)).toEqual([2]);
    expect(merged.dr).toBe(dr);
  });

  it('returns the very same arrays when nothing is dropped', () => {
    const items = [item('tv', 3, 'Kontant 2')];
    const dr = [show('1', 'Kontant')];
    expect(mergeDr(items, dr)).toEqual({ items, dr });
    expect(mergeDr(items, dr).items).toBe(items);
    expect(mergeDr(items, dr).dr).toBe(dr);
    expect(mergeDr(items, []).items).toBe(items);
  });
});

describe('progress of a followed series', () => {
  it.each([
    [{ listed: null, downloaded: 0 }, 'pending', 'Waiting for first download'],
    [{ listed: 12, downloaded: 0 }, 'processing', '0 of 12 episodes in Plex'],
    [{ listed: 12, downloaded: 5 }, 'partial', '5 of 12 episodes in Plex'],
    [{ listed: 12, downloaded: 12 }, 'available', '12 of 12 episodes in Plex'],
  ] as const)('%j is %s', (entry, status, text) => {
    expect(drStatus(entry)).toBe(status);
    expect(progressText(entry)).toBe(text);
  });

  it('turns an id into a placeholder seed, and a non-numeric one into 0', () => {
    expect(drSeed('7132')).toBe(7132);
    expect(drSeed('abc')).toBe(0);
  });
});
