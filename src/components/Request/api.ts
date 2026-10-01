import type { Connection } from 'home-assistant-js-websocket';
import type { CreateParams, CreateResult, Detail, MediaType, MineItem, ResultPage } from './types';

// Connection.sendMessagePromise assigns the message id itself — never set `id` here.

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** The backend refuses a viewer it does not know with `forbidden`: that is an answer (false). Any other failure rejects. */
export async function fetchAccess(conn: Connection): Promise<boolean> {
  try {
    const reply = await conn.sendMessagePromise<{ allowed?: unknown } | null>({ type: 'media_requests/me' });
    return reply?.allowed === true;
  } catch (error) {
    if (requestErrorCode(error) === 'forbidden') return false;
    throw error;
  }
}

async function fetchResultPage(conn: Connection, message: { type: string; query?: string; page: number }): Promise<ResultPage> {
  const raw = await conn.sendMessagePromise<Partial<ResultPage>>(message);
  return { results: list(raw.results), page: raw.page ?? message.page, totalPages: raw.totalPages ?? 1 };
}

/** An empty `query` browses (discover); anything else searches. */
export function fetchCatalogPage(conn: Connection, query: string, page: number): Promise<ResultPage> {
  return query === ''
    ? fetchResultPage(conn, { type: 'media_requests/discover', page })
    : fetchResultPage(conn, { type: 'media_requests/search', query, page });
}

export async function fetchDetail(conn: Connection, mediaType: MediaType, tmdbId: number): Promise<Detail> {
  const raw = await conn.sendMessagePromise<Detail>({ type: 'media_requests/detail', mediaType, tmdbId });
  return { ...raw, overview: raw.overview ?? '', seasons: list(raw.seasons) };
}

export async function fetchMine(conn: Connection): Promise<MineItem[]> {
  const raw = await conn.sendMessagePromise<{ items?: unknown }>({ type: 'media_requests/mine' });
  return list<MineItem>(raw.items);
}

export function createRequest(conn: Connection, params: CreateParams): Promise<CreateResult> {
  return conn.sendMessagePromise<CreateResult>({ type: 'media_requests/create', ...params });
}

/** The `code` of a rejected Home Assistant websocket command, or null for transport failures. */
export function requestErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}
