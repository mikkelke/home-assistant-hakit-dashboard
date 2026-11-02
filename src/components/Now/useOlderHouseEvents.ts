import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import type { HouseEvent } from '../../home/houseEvents';
import { fetchHouseEventsPage, mergeHouseEvents } from '../../home/houseEventsHistory';

export interface OlderHouseEvents {
  /** Rows read back from the recorder, newest first. Some are also in the live feed, whose copy is the one to show. */
  older: HouseEvent[];
  /** Loads the next page back and returns true, or returns false and does nothing while one loads or once the history is out. */
  loadOlder: () => boolean;
  loading: boolean;
  /** How many pages have landed. */
  pages: number;
  /** The recorder holds nothing older. */
  exhausted: boolean;
  /** The last load failed; nothing loads on its own until `loadOlder` is called again. */
  failed: boolean;
}

interface Feed {
  older: HouseEvent[];
  /** A page has landed, so the rows the live feed drops from here on are kept. */
  started: boolean;
  loading: boolean;
  pages: number;
  exhausted: boolean;
  failed: boolean;
}

const IDLE: Feed = { older: [], started: false, loading: false, pages: 0, exhausted: false, failed: false };

/** Where the loading stands, which the callbacks read and write: where the next page ends, whether one is under way,
 * and whether the recorder has nothing more. */
interface Paging {
  endMs: number | null;
  busy: boolean;
  done: boolean;
}

const oldestMs = (events: readonly HouseEvent[]): number | null =>
  events.length === 0 ? null : events.reduce((oldest, event) => Math.min(oldest, event.tsMs), Infinity);

/** The `sensor.house_events` history behind the live feed, one page of days at a time, back from the oldest live row.
 * `live` is the whole live feed, whoever may see its rows. */
export function useOlderHouseEvents(live: HouseEvent[]): OlderHouseEvents {
  const connection = useHass(s => s.connection) as Connection | null;
  const [feed, setFeed] = useState<Feed>(IDLE);
  const paging = useRef<Paging>({ endMs: null, busy: false, done: false });
  const mounted = useRef(true);
  const anchorMs = oldestMs(live);

  // The live feed moves on as rows arrive and its oldest fall off; they stay here once the history reaches them.
  const [seenLive, setSeenLive] = useState(live);
  if (seenLive !== live) {
    setSeenLive(live);
    if (feed.started) setFeed({ ...feed, older: mergeHouseEvents(feed.older, seenLive) });
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadOlder = useCallback(() => {
    const position = paging.current;
    if (!connection || position.busy || position.done) return false;
    position.busy = true;
    setFeed(current => ({ ...current, loading: true, failed: false }));
    fetchHouseEventsPage(connection, HOUSE_EVENTS_ENTITY, position.endMs ?? anchorMs ?? Date.now()).then(
      page => {
        position.busy = false;
        if (!mounted.current) return;
        position.endMs = page.nextCursorMs;
        position.done = page.states === 0;
        setFeed(current => ({
          older: mergeHouseEvents(current.older, page.events),
          started: true,
          loading: false,
          pages: current.pages + 1,
          exhausted: position.done,
          failed: false,
        }));
      },
      () => {
        position.busy = false;
        if (mounted.current) setFeed(current => ({ ...current, loading: false, failed: true }));
      }
    );
    return true;
  }, [connection, anchorMs]);

  return { older: feed.older, loadOlder, loading: feed.loading, pages: feed.pages, exhausted: feed.exhausted, failed: feed.failed };
}
