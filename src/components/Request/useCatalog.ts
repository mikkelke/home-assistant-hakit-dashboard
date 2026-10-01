import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { fetchCatalogPage } from './api';
import { itemKey, withStatus } from './display';
import type { Item, Status } from './types';

const SEARCH_DEBOUNCE_MS = 300;
// Paging stops here however many pages the backend reports, so a filter that matches nothing cannot walk them all.
const MAX_PAGES = 10;

interface Feed {
  term: string;
  items: Item[];
  page: number;
  totalPages: number;
  more: 'idle' | 'loading' | 'failed';
}

export interface Catalog {
  /** Null until the first page has arrived; belongs to an older search term while `busy`. */
  items: Item[] | null;
  /** The current search term has no results on screen yet. */
  busy: boolean;
  failed: boolean;
  /** Every page of the current term has been loaded. */
  exhausted: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
  /** Sets one loaded item's status (by `itemKey`); the next fetch that returns the item replaces it. */
  setStatus: (key: string, status: Status) => void;
}

function hasMorePages(feed: Feed): boolean {
  return feed.page < Math.min(feed.totalPages, MAX_PAGES);
}

function mergeItems(current: Item[], incoming: Item[]): Item[] {
  const seen = new Set(current.map(itemKey));
  const added = incoming.filter(item => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...added];
}

/** Discover (empty query) or search, paged. Typing is debounced and a response for a superseded term is dropped. */
export function useCatalog(query: string): Catalog {
  const connection = useHass(s => s.connection);
  const term = query.trim();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failedTerm, setFailedTerm] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        fetchCatalogPage(connection, term, 1).then(
          first => {
            if (cancelled) return;
            setFeed({ term, items: mergeItems([], first.results), page: 1, totalPages: first.totalPages, more: 'idle' });
            setFailedTerm(null);
          },
          () => {
            if (!cancelled) setFailedTerm(term);
          }
        );
      },
      term === '' ? 0 : SEARCH_DEBOUNCE_MS
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection, term, attempt]);

  const settled = feed !== null && feed.term === term;

  const loadMore = useCallback(() => {
    if (!connection || !feed || feed.term !== term || feed.more === 'loading' || !hasMorePages(feed)) return;
    const { term: feedTerm, page } = feed;
    // A response only lands on the exact page it was requested from; anything newer has moved on.
    const patch = (change: (current: Feed) => Feed) =>
      setFeed(current => (current && current.term === feedTerm && current.page === page ? change(current) : current));
    patch(current => ({ ...current, more: 'loading' }));
    fetchCatalogPage(connection, feedTerm, page + 1).then(
      next =>
        patch(current => ({
          ...current,
          items: mergeItems(current.items, next.results),
          page: page + 1,
          totalPages: next.totalPages,
          more: 'idle',
        })),
      () => patch(current => ({ ...current, more: 'failed' }))
    );
  }, [connection, feed, term]);

  const retry = useCallback(() => {
    setFeed(null);
    setFailedTerm(null);
    setAttempt(n => n + 1);
  }, []);

  const setStatus = useCallback((key: string, status: Status) => {
    setFeed(current => {
      if (!current) return current;
      const items = withStatus(current.items, key, status);
      return items === current.items ? current : { ...current, items };
    });
  }, []);

  const failed = failedTerm === term;

  return {
    items: feed?.items ?? null,
    busy: !settled && !failed,
    failed,
    exhausted: settled && !hasMorePages(feed),
    canLoadMore: settled && feed.more === 'idle' && hasMorePages(feed),
    loadingMore: settled && feed.more === 'loading',
    moreFailed: settled && feed.more === 'failed',
    loadMore,
    retry,
    setStatus,
  };
}
