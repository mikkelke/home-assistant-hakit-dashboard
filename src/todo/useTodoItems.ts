import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { addTodoItem, clearDoneItems, removeTodoItem, renameTodoItem, setTodoItemDone, subscribeTodoItems } from './api';
import {
  applyRemoved,
  applyRenamed,
  applyWanted,
  settleRenamed,
  settleWanted,
  splitItems,
  withoutRenamed,
  withoutWanted,
  type Renamed,
  type TodoItem,
  type TodoStatus,
  type Wanted,
} from './items';

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
  /** Does nothing for a blank name, or for the one the item already shows. */
  rename: (uid: string, summary: string) => void;
  remove: (uid: string) => void;
  clearDone: () => void;
  retry: () => void;
}

/** One to-do list, live. A check-off, a rename and a deletion show at once and give way to Home Assistant's list as soon as that agrees. */
export function useTodoItems(entityId: string): TodoListView {
  const connection = useHass(state => state.connection) as Connection | null;
  const [feed, setFeed] = useState<Feed | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [wanted, setWanted] = useState<Wanted>({});
  const [renamed, setRenamed] = useState<Renamed>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);

  const current = feed && feed.connection === connection && feed.attempt === attempt ? feed : null;
  const shown = applyRemoved(applyRenamed(applyWanted(current?.items ?? [], wanted), renamed), removed);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    subscribeTodoItems(connection, entityId, items => {
      if (cancelled) return;
      setFeed({ connection, attempt, items });
      setWanted(previous => settleWanted(previous, items));
      setRenamed(previous => settleRenamed(previous, items));
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

  const rename = useCallback(
    (uid: string, summary: string) => {
      const listed = current?.items?.find(item => item.uid === uid);
      const showing = shown.find(item => item.uid === uid);
      const next = summary.trim();
      if (!connection || !listed || !showing || next === '' || next === showing.summary) return;
      setFailed(false);
      setRenamed(previous => ({ ...previous, [uid]: { summary: next, base: listed.summary } }));
      renameTodoItem(connection, entityId, uid, next).catch(() => {
        setFailed(true);
        setRenamed(previous => withoutRenamed(previous, uid));
      });
    },
    [connection, entityId, current, shown]
  );

  const remove = useCallback(
    (uid: string) => {
      if (!connection) return;
      setFailed(false);
      setRemoved(previous => new Set(previous).add(uid));
      removeTodoItem(connection, entityId, uid).catch(() => {
        setFailed(true);
        setRemoved(previous => new Set([...previous].filter(removedUid => removedUid !== uid)));
      });
    },
    [connection, entityId]
  );

  const clearDone = useCallback(() => {
    if (!connection) return;
    setFailed(false);
    clearDoneItems(connection, entityId).catch(() => setFailed(true));
  }, [connection, entityId]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);

  const status = current === null ? 'loading' : current.items === null ? 'error' : 'ready';
  const { open, done } = splitItems(shown);
  return { status, open, done, failed, check, add, rename, remove, clearDone, retry };
}
