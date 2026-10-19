import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { fetchDrFollowing, searchDr, type DrFollowed, type DrResult } from './drtv';
import { SEARCH_DEBOUNCE_MS } from './useCatalog';

interface Feed {
  term: string;
  results: DrResult[];
}

export interface DrSearch {
  /** The latest answer while searching, else empty. Belongs to an older term while `stale`. */
  results: DrResult[];
  stale: boolean;
  /** Sets one result's follow flag (by show id); the next search that returns the show replaces it. */
  setFollowing: (id: string, following: boolean) => void;
}

const NO_RESULTS: DrResult[] = [];

/**
 * DR shows for a non-empty `query` while `enabled`, debounced like the catalog. A response for a superseded term is
 * dropped, and a failed search is an empty answer: the DR part just goes missing.
 */
export function useDrtvSearch(query: string, enabled: boolean): DrSearch {
  const connection = useHass(s => s.connection);
  const term = query.trim();
  const searching = enabled && term !== '';
  const [feed, setFeed] = useState<Feed | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (!searching) {
          setFeed(null);
          return;
        }
        searchDr(connection, term).then(
          results => {
            if (!cancelled) setFeed({ term, results });
          },
          () => {
            if (!cancelled) setFeed({ term, results: [] });
          }
        );
      },
      searching ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection, term, searching]);

  const setFollowing = useCallback((id: string, following: boolean) => {
    setFeed(current => {
      if (!current?.results.some(result => result.id === id && result.following !== following)) return current;
      return { ...current, results: current.results.map(result => (result.id === id ? { ...result, following } : result)) };
    });
  }, []);

  return {
    results: searching && feed ? feed.results : NO_RESULTS,
    stale: searching && feed?.term !== term,
    setFollowing,
  };
}

export interface DrFollowing {
  /** Null until the first load; kept while a later refresh is in flight. */
  items: DrFollowed[] | null;
  failed: boolean;
  retry: () => void;
  /** Takes one series (by id) off the loaded list; the next fetch is authoritative again. */
  drop: (id: string) => void;
}

/** The followed DR series, fetched fresh every time `active` turns on. */
export function useDrtvFollowing(active: boolean): DrFollowing {
  const connection = useHass(s => s.connection);
  const [items, setItems] = useState<DrFollowed[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !connection) return;
    let cancelled = false;
    fetchDrFollowing(connection).then(
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

  const drop = useCallback((id: string) => {
    setItems(current => (current?.some(item => item.id === id) ? current.filter(item => item.id !== id) : current));
  }, []);

  return { items, failed, retry, drop };
}
