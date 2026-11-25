import { afterEach, describe, expect, it, vi } from 'vitest';
import { hassApiFetch } from '../hassApiFetch';

/** An Auth whose token is `token-1` until it is refreshed, then `token-2`, and so on. */
function fakeAuth(expired = false) {
  let generation = 1;
  let isExpired = expired;
  return {
    get accessToken() {
      return `token-${generation}`;
    },
    get expired() {
      return isExpired;
    },
    refreshAccessToken: vi.fn(async () => {
      generation += 1;
      isExpired = false;
    }),
  };
}

/** Answers each request with the next status; the last one repeats. */
function stubFetch(...statuses: number[]) {
  let calls = 0;
  const fetchMock = vi.fn<typeof fetch>(async () => new Response('[]', { status: statuses[Math.min(calls++, statuses.length - 1)] }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bearer = (fetchMock: ReturnType<typeof stubFetch>, call: number) =>
  new Headers(fetchMock.mock.calls[call][1]?.headers).get('Authorization');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hassApiFetch', () => {
  it('signs the request with the current access token and keeps the options it was given', async () => {
    const fetchMock = stubFetch(200);
    const auth = fakeAuth();
    const response = await hassApiFetch({ options: { auth } }, 'https://ha.example/api/config', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    expect(response.status).toBe(200);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toBe('https://ha.example/api/config');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(bearer(fetchMock, 0)).toBe('Bearer token-1');
  });

  it('refreshes an expired token before the request goes out', async () => {
    const fetchMock = stubFetch(200);
    const auth = fakeAuth(true);
    await hassApiFetch({ options: { auth } }, '/api/config');
    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(auth.refreshAccessToken.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bearer(fetchMock, 0)).toBe('Bearer token-2');
  });

  it('refreshes once and retries once after a 401, with the new token', async () => {
    const fetchMock = stubFetch(401, 200);
    const auth = fakeAuth();
    const response = await hassApiFetch({ options: { auth } }, '/api/config');
    expect(response.status).toBe(200);
    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([bearer(fetchMock, 0), bearer(fetchMock, 1)]).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('stops after the one retry and returns the second 401', async () => {
    const fetchMock = stubFetch(401);
    const auth = fakeAuth();
    const response = await hassApiFetch({ options: { auth } }, '/api/config');
    expect(response.status).toBe(401);
    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('leaves every other failure alone', async () => {
    for (const status of [403, 404, 500]) {
      const fetchMock = stubFetch(status);
      const auth = fakeAuth();
      const response = await hassApiFetch({ options: { auth } }, '/api/config');
      expect(response.status).toBe(status);
      expect(auth.refreshAccessToken).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it('hands back the 401 itself when the token cannot be refreshed', async () => {
    const fetchMock = stubFetch(401);
    const auth = fakeAuth();
    auth.refreshAccessToken.mockRejectedValue(new Error('No refresh_token'));
    const response = await hassApiFetch({ options: { auth } }, '/api/config');
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('still sends the request when refreshing an expired token fails', async () => {
    const fetchMock = stubFetch(200);
    const auth = fakeAuth(true);
    auth.refreshAccessToken.mockRejectedValue(new Error('Unable to fetch tokens'));
    const response = await hassApiFetch({ options: { auth } }, '/api/config');
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bearer(fetchMock, 0)).toBe('Bearer token-1');
  });

  it('sends a plain request without a connection or auth, and does not retry its 401', async () => {
    for (const connection of [null, undefined, {}, { options: {} }]) {
      const fetchMock = stubFetch(401);
      const response = await hassApiFetch(connection, '/api/config');
      expect(response.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(bearer(fetchMock, 0)).toBeNull();
    }
  });
});
