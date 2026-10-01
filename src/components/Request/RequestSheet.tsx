import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { itemKey, STATUS_LABEL } from './display';
import { Poster, StateBlock, StatusIcon } from './parts';
import { Sheet } from './Sheet';
import { TitleDetail } from './TitleDetail';
import { useCatalog } from './useCatalog';
import { useMine } from './useMine';
import type { Item, MineItem, Status } from './types';
import './Request.css';

type Filter = 'all' | 'movie' | 'tv' | 'mine';

const FILTERS: ReadonlyArray<{ id: Filter; icon: string; label: string }> = [
  { id: 'all', icon: 'mdi:star-four-points-outline', label: 'All' },
  { id: 'movie', icon: 'mdi:movie-open-outline', label: 'Movies' },
  { id: 'tv', icon: 'mdi:television-classic', label: 'TV shows' },
  { id: 'mine', icon: 'mdi:account-outline', label: 'My requests' },
];

const SKELETON_CELLS = Array.from({ length: 9 }, (_, index) => index);

function cellLabel(title: string, year: number | null, status: Status): string {
  const base = year ? `${title} (${year})` : title;
  return status === 'none' ? base : `${base}, ${STATUS_LABEL[status]}`;
}

interface RequestSheetProps {
  onClose: () => void;
}

export function RequestSheet({ onClose }: RequestSheetProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'request-sheet' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [opened, setOpened] = useState<Item | null>(null);
  const catalog = useCatalog(query);
  const mine = useMine(filter === 'mine');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { canLoadMore, loadMore, setStatus: setCatalogStatus } = catalog;
  const { setStatus: setMineStatus } = mine;
  const watchEnd = filter !== 'mine' && canLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!watchEnd || !sentinel) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore();
      },
      { root: bodyRef.current, rootMargin: '0px 0px 320px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [watchEnd, loadMore]);

  const scrollToTop = () => bodyRef.current?.scrollTo({ top: 0 });

  const handleStatus = useCallback(
    (item: Item, status: Status) => {
      const key = itemKey(item);
      setCatalogStatus(key, status);
      setMineStatus(key, status);
    },
    [setCatalogStatus, setMineStatus]
  );

  const mediaFilter = filter === 'movie' || filter === 'tv' ? filter : null;
  const visible =
    catalog.items === null ? null : mediaFilter ? catalog.items.filter(item => item.mediaType === mediaFilter) : catalog.items;

  const renderCell = (item: Item) => {
    const { status } = item;
    return (
      <button
        key={itemKey(item)}
        type='button'
        className='rq-cell'
        aria-label={cellLabel(item.title, item.year, status)}
        onClick={() => setOpened(item)}
      >
        <Poster tmdbId={item.tmdbId} title={item.title} posterPath={item.posterPath} />
        <StatusIcon status={status} className='rq-badge' />
      </button>
    );
  };

  const renderRow = (entry: MineItem) => {
    const { status } = entry;
    return (
      <button
        key={entry.requestId}
        type='button'
        className='rq-row'
        aria-label={cellLabel(entry.title, null, status)}
        onClick={() =>
          setOpened({
            mediaType: entry.mediaType,
            tmdbId: entry.tmdbId,
            title: entry.title,
            year: null,
            posterPath: entry.posterPath,
            status,
          })
        }
      >
        <Poster tmdbId={entry.tmdbId} title={entry.title} posterPath={entry.posterPath} />
        <span className='rq-row-title'>{entry.title}</span>
        <StatusIcon status={status} className='rq-ring' />
      </button>
    );
  };

  let body: ReactNode;
  if (filter === 'mine') {
    if (mine.items === null) {
      body = mine.failed ? (
        <StateBlock icon='mdi:cloud-off-outline' onRetry={mine.retry} />
      ) : (
        <div className='rq-state'>
          <Icon icon='mdi:loading' className='rq-spin' aria-hidden='true' />
        </div>
      );
    } else if (mine.items.length === 0) {
      body = <StateBlock icon='mdi:inbox-outline' onRetry={mine.retry} />;
    } else {
      body = <div className='rq-rows'>{mine.items.map(renderRow)}</div>;
    }
  } else if (catalog.failed) {
    body = <StateBlock icon='mdi:cloud-off-outline' onRetry={catalog.retry} />;
  } else if (visible === null) {
    body = (
      <div className='rq-grid' aria-hidden='true'>
        {SKELETON_CELLS.map(index => (
          <span key={index} className='rq-skeleton' />
        ))}
      </div>
    );
  } else if (visible.length === 0 && catalog.exhausted) {
    body = <StateBlock icon='mdi:movie-search-outline' onRetry={catalog.retry} />;
  } else {
    body = (
      <>
        <div className={`rq-grid ${catalog.busy ? 'is-stale' : ''}`}>{visible.map(renderCell)}</div>
        {(canLoadMore || catalog.loadingMore || catalog.moreFailed) && (
          <div ref={sentinelRef} className='rq-more'>
            {catalog.moreFailed ? (
              <button type='button' className='rq-retry' onClick={loadMore}>
                <Icon icon='mdi:refresh' aria-hidden='true' />
                Retry
              </button>
            ) : (
              catalog.loadingMore && <Icon icon='mdi:loading' className='rq-spin' aria-hidden='true' />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Sheet
        label='Request a movie or show'
        variant='search'
        onRequestClose={requestClose}
        swipe={{ onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd }}
      >
        <div className='rq-head'>
          <span className='rq-head-title'>
            <Icon icon='mdi:movie-open-plus-outline' aria-hidden='true' />
            Request
          </span>
          <button type='button' className='modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>

        <div className='rq-tools'>
          <label className='rq-search'>
            <Icon icon={catalog.busy ? 'mdi:loading' : 'mdi:magnify'} className={catalog.busy ? 'rq-spin' : undefined} aria-hidden='true' />
            <input
              type='search'
              value={query}
              placeholder='Search'
              aria-label='Search movies and shows'
              enterKeyHint='search'
              autoComplete='off'
              autoCorrect='off'
              spellCheck={false}
              onChange={e => {
                setQuery(e.target.value);
                if (filter === 'mine') setFilter('all');
                scrollToTop();
              }}
            />
          </label>
          <div className='rq-filters' role='group' aria-label='Filter'>
            {FILTERS.map(option => (
              <button
                key={option.id}
                type='button'
                className={`rq-filter ${filter === option.id ? 'is-active' : ''}`}
                aria-pressed={filter === option.id}
                aria-label={option.label}
                onClick={() => {
                  setFilter(option.id);
                  scrollToTop();
                }}
              >
                <Icon icon={option.icon} aria-hidden='true' />
              </button>
            ))}
          </div>
        </div>

        <div ref={bodyRef} className='rq-body'>
          {body}
        </div>
      </Sheet>

      {opened && <TitleDetail item={opened} onClose={() => setOpened(null)} onStatus={handleStatus} />}
    </>
  );
}
