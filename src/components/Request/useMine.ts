import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { fetchMine } from './api';
import { withStatus } from './display';
import type { MineItem, Status } from './types';

export interface Mine {
  /** Null until the first load; kept while a later refresh is in flight. */
  items: MineItem[] | null;
  failed: boolean;
  retry: () => void;
  /** Sets one loaded request's status (by `itemKey`); the next fetch that returns it replaces it. */
  setStatus: (key: string, status: Status) => void;
}

/** The viewer's own requests, fetched fresh every time `active` turns on. */
export function useMine(active: boolean): Mine {
  const connection = useHass(s => s.connection);
  const [items, setItems] = useState<MineItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !connection) return;
    let cancelled = false;
    fetchMine(connection).then(
      next => {
        if (cancelled) return;
        setItems(next);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [active, connection, attempt]);

  const retry = useCallback(() => {
    setItems(null);
    setFailed(false);
    setAttempt(n => n + 1);
  }, []);

  const setStatus = useCallback((key: string, status: Status) => {
    setItems(current => (current ? withStatus(current, key, status) : current));
  }, []);

  return { items, failed, retry, setStatus };
}
