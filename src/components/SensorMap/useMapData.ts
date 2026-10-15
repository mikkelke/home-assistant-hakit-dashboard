import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { getSystemData, setSystemData, subscribeSystemData } from '../../sensorMap/haSystemData';
import { DocError, SUGGEST_KEY, parseSuggestDoc, type SuggestDoc } from '../../sensorMap/mapDoc';
import { SaveQueue, loadDocs, type Draft } from '../../sensorMap/saveQueue';
import { browserDrafts, findDrafts } from './drafts';

export type MapLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  /** `drafts` are the unsaved documents of an earlier visit; `current` says Home Assistant still holds what they were edited from. */
  | { status: 'ready'; queue: SaveQueue; drafts: (Draft & { current: boolean })[] };

export interface SuggestState {
  doc: SuggestDoc | null;
  problem: string | null;
}

const messageOf = (error: unknown) => (error instanceof DocError ? error.message : error instanceof Error ? error.message : String(error));

/**
 * Loads the map and fingerprint documents into a save queue, and follows the suggestion document live. The queue
 * belongs to the page: when the page goes, what Home Assistant has not acknowledged is kept as a draft.
 */
export function useMapData(): { load: MapLoad; suggest: SuggestState; retry: () => void; settleDrafts: () => void } {
  const connection = useHass(state => state.connection) as Connection | null;
  const [load, setLoad] = useState<MapLoad>({ status: 'loading' });
  const [suggest, setSuggest] = useState<SuggestState>({ doc: null, problem: null });
  const [attempt, setAttempt] = useState(0);
  const queueRef = useRef<SaveQueue | null>(null);
  const connectionRef = useRef<Connection | null>(connection);

  useEffect(() => {
    connectionRef.current = connection;
  });

  const retry = useCallback(() => {
    queueRef.current?.dispose();
    queueRef.current = null;
    setLoad({ status: 'loading' });
    setAttempt(count => count + 1);
  }, []);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const current = () => connectionRef.current ?? connection;
    const read = (key: Parameters<typeof getSystemData>[1]) => getSystemData(current(), key);
    if (!queueRef.current) {
      loadDocs(read).then(
        docs => {
          if (cancelled) return;
          if (docs === null) return setLoad({ status: 'empty' });
          const queue = new SaveQueue({ read, write: (key, value) => setSystemData(current(), key, value), drafts: browserDrafts }, docs);
          queueRef.current = queue;
          // Another writer changed the document: keep what this page has as drafts, and load again to offer them back.
          queue.subscribe(() => queue.getSnapshot().state === 'conflict' && retry());
          const drafts = findDrafts().map(draft => ({ ...draft, current: draft.base === (docs[draft.key].write_id ?? null) }));
          setLoad({ status: 'ready', queue, drafts });
        },
        error => !cancelled && setLoad({ status: 'error', message: messageOf(error) })
      );
    }
    const onReady = () => {
      if (queueRef.current?.getSnapshot().state === 'failed') void queueRef.current.flush();
    };
    connection.addEventListener('ready', onReady);
    return () => {
      cancelled = true;
      connection.removeEventListener('ready', onReady);
    };
  }, [connection, attempt, retry]);

  useEffect(() => {
    if (!connection) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    subscribeSystemData(connection, SUGGEST_KEY, value => {
      if (value === null) return setSuggest({ doc: null, problem: null });
      try {
        setSuggest({ doc: parseSuggestDoc(value), problem: null });
      } catch (error) {
        setSuggest({ doc: null, problem: messageOf(error) });
      }
    }).then(
      unsubscribe => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      },
      error => setSuggest({ doc: null, problem: messageOf(error) })
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [connection]);

  useEffect(
    () => () => {
      const queue = queueRef.current;
      queueRef.current = null;
      if (queue) {
        void queue.flush();
        queue.dispose();
      }
    },
    []
  );

  const settleDrafts = useCallback(() => setLoad(current => (current.status === 'ready' ? { ...current, drafts: [] } : current)), []);

  return { load, suggest, retry, settleDrafts };
}
