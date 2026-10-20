import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { setSystemData, subscribeSystemData } from '../sensorMap/haSystemData';
import { TODO_LISTS_KEY, parseTodoListsDoc, type TodoListsDoc } from './visibility';

interface Shown {
  connection: Connection;
  doc: TodoListsDoc | null;
  failed: boolean;
}

/** What one connection has told this hook. `local` is the document the next change builds on: Home Assistant's own, or the one
 * written last while a write is still in flight. */
interface Session {
  connection: Connection;
  server: TodoListsDoc | null;
  local: TodoListsDoc | null;
  writes: number;
}

export interface ListVisibility {
  /** null until Home Assistant has answered. A document nobody has written reads as an empty one. */
  doc: TodoListsDoc | null;
  /** Home Assistant refused to hand the document over. */
  failed: boolean;
  /** Writes the document `update` makes of the current one. It shows at once; the answer of Home Assistant replaces it when the
   * write settles. Rejects when Home Assistant does not take it, which it does not from anyone but an administrator. */
  change: (update: (doc: TodoListsDoc) => TodoListsDoc) => Promise<void>;
}

export function useListVisibility(): ListVisibility {
  const connection = useHass(state => state.connection) as Connection | null;
  const [shown, setShown] = useState<Shown | null>(null);
  const session = useRef<Session | null>(null);

  useEffect(() => {
    if (!connection) return;
    const mine: Session = { connection, server: null, local: null, writes: 0 };
    session.current = mine;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const show = (doc: TodoListsDoc | null, failed: boolean) => {
      if (!cancelled) setShown({ connection, doc, failed });
    };
    subscribeSystemData(connection, TODO_LISTS_KEY, value => {
      mine.server = parseTodoListsDoc(value);
      if (mine.writes > 0) return;
      mine.local = mine.server;
      show(mine.server, false);
    }).then(
      unsubscribe => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      },
      () => show(null, true)
    );
    return () => {
      cancelled = true;
      stop?.();
      if (session.current === mine) session.current = null;
    };
  }, [connection]);

  const change = useCallback((update: (doc: TodoListsDoc) => TodoListsDoc) => {
    const mine = session.current;
    if (!mine || !mine.local) return Promise.reject(new Error('The list visibility is not loaded'));
    const next = update(mine.local);
    mine.local = next;
    mine.writes += 1;
    setShown({ connection: mine.connection, doc: next, failed: false });
    return setSystemData(mine.connection, TODO_LISTS_KEY, next).finally(() => {
      mine.writes -= 1;
      if (mine.writes > 0 || !mine.server) return;
      mine.local = mine.server;
      setShown({ connection: mine.connection, doc: mine.server, failed: false });
    });
  }, []);

  const current = shown && shown.connection === connection ? shown : null;
  return { doc: current?.doc ?? null, failed: current?.failed ?? false, change };
}
