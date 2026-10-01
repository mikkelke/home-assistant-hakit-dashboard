import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { fetchAccess } from './api';

const RETRY_DELAY_MS = 10_000;

/**
 * Whether this viewer may use media requests. False until the backend says yes, and asked again on every reconnect.
 * A check that fails instead of answering keeps the previous answer and is retried once.
 */
export function useRequestAccess(): boolean {
  const connection = useHass(s => s.connection);
  const [resolved, setResolved] = useState<{ connection: Connection; allowed: boolean } | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const check = (retryOnFailure: boolean) => {
      clearTimeout(retryTimer);
      fetchAccess(connection).then(
        allowed => {
          if (!cancelled) setResolved({ connection, allowed });
        },
        () => {
          if (!cancelled && retryOnFailure) retryTimer = setTimeout(() => check(false), RETRY_DELAY_MS);
        }
      );
    };
    const onReady = () => check(true);

    check(true);
    connection.addEventListener('ready', onReady);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      connection.removeEventListener('ready', onReady);
    };
  }, [connection]);

  return resolved !== null && resolved.connection === connection && resolved.allowed;
}
