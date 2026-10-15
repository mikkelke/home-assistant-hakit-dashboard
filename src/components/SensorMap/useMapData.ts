import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { getSystemData, setSystemData, subscribeSystemData } from '../../sensorMap/haSystemData';
import {
  DocError,
  FINGERPRINTS_KEY,
  MAP_KEY,
  SUGGEST_KEY,
  emptyFingerprintDoc,
  parseFingerprintDoc,
  parseMapDoc,
  parseSuggestDoc,
  type SuggestDoc,
} from '../../sensorMap/mapDoc';
import { SaveQueue, type QueueDocs } from '../../sensorMap/saveQueue';

export type MapLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; queue: SaveQueue };

export interface SuggestState {
  doc: SuggestDoc | null;
  problem: string | null;
}

const messageOf = (error: unknown) => (error instanceof DocError ? error.message : error instanceof Error ? error.message : String(error));

async function readDocs(connection: Connection): Promise<QueueDocs | null> {
  const [rawMap, rawPrints] = await Promise.all([getSystemData(connection, MAP_KEY), getSystemData(connection, FINGERPRINTS_KEY)]);
  if (rawMap === null) return null;
  return {
    map: parseMapDoc(rawMap),
    fingerprints: rawPrints === null ? emptyFingerprintDoc(new Date().toISOString()) : parseFingerprintDoc(rawPrints),
  };
}

/**
 * Loads the map and fingerprint documents into a save queue, and follows the suggestion document live. The queue
 * outlives a replaced connection: after a reconnect the documents are read again and the edits Home Assistant
 * has not acknowledged go on top of them.
 */
export function useMapData(): { load: MapLoad; suggest: SuggestState; retry: () => void } {
  const connection = useHass(state => state.connection) as Connection | null;
  const [load, setLoad] = useState<MapLoad>({ status: 'loading' });
  const [suggest, setSuggest] = useState<SuggestState>({ doc: null, problem: null });
  const [attempt, setAttempt] = useState(0);
  const queueRef = useRef<SaveQueue | null>(null);
  const connectionRef = useRef<Connection | null>(connection);

  useEffect(() => {
    connectionRef.current = connection;
  });

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const run = async () => {
      try {
        const docs = await readDocs(connection);
        if (cancelled) return;
        if (docs === null) {
          setLoad(previous => (previous.status === 'ready' ? previous : { status: 'empty' }));
          return;
        }
        if (queueRef.current) {
          void queueRef.current.reconnect(docs);
          const queue = queueRef.current;
          setLoad(previous => (previous.status === 'ready' ? previous : { status: 'ready', queue }));
          return;
        }
        const queue = new SaveQueue({ write: (key, value) => setSystemData(connectionRef.current ?? connection, key, value) }, docs);
        queueRef.current = queue;
        setLoad({ status: 'ready', queue });
      } catch (error) {
        if (!cancelled) setLoad(previous => (previous.status === 'ready' ? previous : { status: 'error', message: messageOf(error) }));
      }
    };
    void run();
    const onReady = () => void run();
    connection.addEventListener('ready', onReady);
    return () => {
      cancelled = true;
      connection.removeEventListener('ready', onReady);
    };
  }, [connection, attempt]);

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
      if (queue) void queue.flush().finally(() => queue.dispose());
    },
    []
  );

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt(count => count + 1);
  }, []);

  return { load, suggest, retry };
}
