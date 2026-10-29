import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { fetchRole } from './api';
import type { GuestRole } from './types';

/** Only a successful answer on the current connection grants access. Reconnects revoke it while checking. */
export function useGuestAccess(): GuestRole | null {
  const connection = useHass(state => state.connection);
  const [resolved, setResolved] = useState<{ connection: Connection; role: GuestRole | null } | null>(null);
  useEffect(() => {
    if (!connection) return;
    let generation = 0;
    let disposed = false;
    const check = () => {
      const request = ++generation;
      return fetchRole(connection).then(
        role => {
          if (!disposed && request === generation) setResolved({ connection, role });
        },
        () => {
          if (!disposed && request === generation) setResolved(null);
        }
      );
    };
    const revoke = () => {
      ++generation;
      setResolved(null);
    };
    const ready = () => {
      revoke();
      void check();
    };
    void check();
    connection.addEventListener?.('ready', ready);
    connection.addEventListener?.('disconnected', revoke);
    return () => {
      disposed = true;
      ++generation;
      connection.removeEventListener?.('ready', ready);
      connection.removeEventListener?.('disconnected', revoke);
    };
  }, [connection]);
  return connection?.connected !== false && resolved?.connection === connection ? (resolved?.role ?? null) : null;
}
