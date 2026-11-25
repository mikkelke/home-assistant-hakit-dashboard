import type { Auth } from 'home-assistant-js-websocket';

type RefreshableAuth = Pick<Auth, 'accessToken' | 'expired' | 'refreshAccessToken'>;

/** The part of the hakit connection that carries the websocket's `Auth`. */
export type HassApiConnection = { options?: { auth?: RefreshableAuth } } | null | undefined;

async function refresh(auth: RefreshableAuth): Promise<boolean> {
  try {
    await auth.refreshAccessToken();
    return true;
  } catch {
    return false;
  }
}

/**
 * `fetch` for Home Assistant's REST API, signed with the connection's access token. That token lasts 30 minutes while the
 * websocket stays authenticated far longer, so an expired token is refreshed before the request, and a 401 refreshes once
 * and retries once. A failed refresh is not thrown: the caller gets the request's own response.
 */
export async function hassApiFetch(connection: HassApiConnection, input: string | URL, init: RequestInit = {}): Promise<Response> {
  const auth = connection?.options?.auth;
  const send = () => {
    const headers = new Headers(init.headers);
    if (auth) headers.set('Authorization', `Bearer ${auth.accessToken}`);
    return fetch(input, { ...init, headers });
  };
  if (auth?.expired) await refresh(auth);
  const response = await send();
  if (response.status !== 401 || !auth || !(await refresh(auth))) return response;
  return send();
}
