import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import type { GuestRole, GuestUser, Period } from './types';

export function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'Could not reach the lock. Try again.';
}

function requireConnection(connection: Connection) {
  if (connection.connected === false) throw new Error('The connection is offline. Try again when connected.');
}

export async function fetchRole(connection: Connection): Promise<GuestRole | null> {
  requireConnection(connection);
  const reply = await connection.sendMessagePromise<{ role?: unknown } | null>({ type: 'yale_access/me' });
  return reply?.role === 'admin' || reply?.role === 'guests' ? reply.role : null;
}

export async function fetchUsers(connection: Connection): Promise<GuestUser[]> {
  requireConnection(connection);
  const reply = await connection.sendMessagePromise<{ users: GuestUser[] }>({ type: 'yale_access/users' });
  if (!Array.isArray(reply?.users)) throw new Error('The lock returned an invalid user list.');
  return reply.users.map(({ user_id, name, slot, kind, from, to, status, last_use, created_by }) => ({
    user_id,
    name,
    slot,
    kind,
    from,
    to,
    status,
    last_use,
    created_by,
  }));
}

function requireCurrentConnection(connection: Connection) {
  requireConnection(connection);
  if (useHass.getState().connection !== connection) throw new Error('The connection has changed. Open Guest codes again.');
}

export async function createGuest(connection: Connection, name: string, period: Period) {
  requireCurrentConnection(connection);
  return connection.sendMessagePromise<{ user: GuestUser; pin: string }>({ type: 'yale_access/create', name, ...period });
}

export async function setValidity(connection: Connection, user_id: string, period: Period) {
  requireCurrentConnection(connection);
  return connection.sendMessagePromise<{ user: GuestUser }>({ type: 'yale_access/set_validity', user_id, ...period });
}

export async function endAccess(connection: Connection, user_id: string) {
  requireCurrentConnection(connection);
  return connection.sendMessagePromise<{ ok: boolean }>({ type: 'yale_access/end', user_id });
}
