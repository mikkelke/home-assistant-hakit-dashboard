import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { addTodoItem, clearDoneItems, setTodoItemDone, subscribeTodoItems } from './api';
import { applyWanted, settleWanted, splitItems, withoutWanted, type TodoItem, type TodoStatus, type Wanted } from './items';

/** How long a check-off shows before Home Assistant's own list is believed again, if that list never says the same. */
const WANTED_MS = 5000;

interface Feed {
  connection: Connection;
  attempt: number;
  /** null: Home Assistant refused the subscription. */
  items: TodoItem[] | null;
}

export interface TodoListView {
  status: 'loading' | 'ready' | 'error';
  open: TodoItem[];
  done: TodoItem[];
  /** The last change Home Assistant did not take. */
  failed: boolean;
  check: (uid: string, done: boolean) => void;
  /** Rejects when Home Assistant does not take the item. */
  add: (summary: string) => Promise<void>;
  clearDone: () => void;
  retry: () => void;
}

/** One to-do list, live. A check-off shows at once and gives way to Home Assistant's list as soon as that agrees. */
export function useTodoItems(entityId: string): TodoListView {
  const connection = useHass(state => state.connection) as Connection | null;
  const [feed, setFeed] = useState<Feed | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [wanted, setWanted] = useState<Wanted>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    subscribeTodoItems(connection, entityId, items => {
      if (cancelled) return;
      setFeed({ connection, attempt, items });
      setWanted(previous => settleWanted(previous, items));
    }).then(
      unsubscribe => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      },
      () => {
        if (!cancelled) setFeed({ connection, attempt, items: null });
      }
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [connection, entityId, attempt]);

  const check = useCallback(
    (uid: string, done: boolean) => {
      if (!connection) return;
      const status: TodoStatus = done ? 'completed' : 'needs_action';
      setFailed(false);
      setWanted(previous => ({ ...previous, [uid]: status }));
      window.setTimeout(() => setWanted(previous => (previous[uid] === status ? withoutWanted(previous, uid) : previous)), WANTED_MS);
      setTodoItemDone(connection, entityId, uid, done).catch(() => {
        setFailed(true);
        setWanted(previous => withoutWanted(previous, uid));
      });
    },
    [connection, entityId]
  );

  const add = useCallback(
    async (summary: string) => {
      if (!connection) throw new Error('No connection to Home Assistant');
      setFailed(false);
      try {
        await addTodoItem(connection, entityId, summary);
      } catch (error) {
        setFailed(true);
        throw error;
      }
    },
    [connection, entityId]
  );

  const clearDone = useCallback(() => {
    if (!connection) return;
    setFailed(false);
    clearDoneItems(connection, entityId).catch(() => setFailed(true));
  }, [connection, entityId]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);

  const current = feed && feed.connection === connection && feed.attempt === attempt ? feed : null;
  const status = current === null ? 'loading' : current.items === null ? 'error' : 'ready';
  const { open, done } = splitItems(applyWanted(current?.items ?? [], wanted));
  return { status, open, done, failed, check, add, clearDone, retry };
}
