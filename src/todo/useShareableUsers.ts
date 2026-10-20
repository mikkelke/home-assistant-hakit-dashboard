import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { fetchAuthUsers } from './api';
import { shareableUsers, type ListUser } from './users';

interface Loaded {
  connection: Connection;
  /** null: Home Assistant would not list its users. */
  users: ListUser[] | null;
}

/** The people and devices a list can be shared with, asked of Home Assistant once, which only an administrator may. */
export function useShareableUsers(selfId: string | null): { status: 'loading' | 'ready' | 'error'; users: ListUser[] } {
  const connection = useHass(state => state.connection) as Connection | null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    fetchAuthUsers(connection).then(
      reply => {
        if (!cancelled) setLoaded({ connection, users: shareableUsers(reply, selfId) });
      },
      () => {
        if (!cancelled) setLoaded({ connection, users: null });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, selfId]);

  const current = loaded && loaded.connection === connection ? loaded : null;
  if (current === null) return { status: 'loading', users: [] };
  return current.users === null ? { status: 'error', users: [] } : { status: 'ready', users: current.users };
}
