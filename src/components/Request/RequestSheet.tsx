import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { DrDetail } from './DrDetail';
import { DrFollowedRow, DrResultsRow } from './DrParts';
import { mergeDr, type DrFollowed, type DrOpen, type DrResult } from './drtv';
import { itemKey, STATUS_LABEL } from './display';
import { Poster, StateBlock, StatusIcon } from './parts';
import { Sheet } from './Sheet';
import { TitleDetail } from './TitleDetail';
import { useCatalog } from './useCatalog';
import { useDrtvFollowing, useDrtvSearch } from './useDrtv';
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
  /** DR series can be followed from here. */
  drtv: boolean;
  onClose: () => void;
}

export function RequestSheet({ drtv, onClose }: RequestSheetProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'request-sheet' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [opened, setOpened] = useState<Item | null>(null);
  const [openedDr, setOpenedDr] = useState<DrOpen | null>(null);
  const catalog = useCatalog(query);
  const mine = useMine(filter === 'mine');
  const dr = useDrtvSearch(query, drtv && (filter === 'all' || filter === 'tv'));
  const following = useDrtvFollowing(drtv && filter === 'mine');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { canLoadMore, loadMore, setStatus: setCatalogStatus } = catalog;
  const { setStatus: setMineStatus } = mine;
  const { setFollowing: setDrFollowing } = dr;
  const { drop: dropFollowing } = following;
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

  const handleDrFollowing = useCallback(
    (id: string, isFollowing: boolean) => {
      setDrFollowing(id, isFollowing);
      if (!isFollowing) dropFollowing(id);
    },
    [setDrFollowing, dropFollowing]
  );

  const openDrResult = (result: DrResult) => setOpenedDr({ show: result, following: result.following, entry: null });
  const openDrFollowed = (entry: DrFollowed) => setOpenedDr({ show: entry, following: true, entry });

  const mediaFilter = filter === 'movie' || filter === 'tv' ? filter : null;
  const byMedia =
    catalog.items === null ? null : mediaFilter ? catalog.items.filter(item => item.mediaType === mediaFilter) : catalog.items;
  const merged = byMedia && mergeDr(byMedia, dr.results);
  const visible = merged && merged.items;
  const drShown = merged ? merged.dr : dr.results;

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
    const seerrRows = mine.items ?? [];
    const drRows = following.items ?? [];
    const empty = seerrRows.length + drRows.length === 0;
    const failed = (mine.items === null && mine.failed) || (following.items === null && following.failed);
    const loading = (mine.items === null && !mine.failed) || (drtv && following.items === null && !following.failed);
    const retry = () => {
      mine.retry();
      following.retry();
    };
    let note: ReactNode = null;
    if (failed) {
      note = <StateBlock icon='mdi:cloud-off-outline' onRetry={retry} />;
    } else if (empty && loading) {
      note = (
        <div className='rq-state'>
          <Icon icon='mdi:loading' className='rq-spin' aria-hidden='true' />
        </div>
      );
    } else if (empty) {
      note = <StateBlock icon='mdi:inbox-outline' onRetry={retry} />;
    }
    body = (
      <>
        {!empty && (
          <div className='rq-rows'>
            {seerrRows.map(renderRow)}
            {drRows.map(entry => (
              <DrFollowedRow key={entry.id} entry={entry} onOpen={openDrFollowed} />
            ))}
          </div>
        )}
        {note}
      </>
    );
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
  } else if (visible.length === 0 && catalog.exhausted && drShown.length === 0) {
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
          {drShown.length > 0 && <DrResultsRow results={drShown} stale={dr.stale} onOpen={openDrResult} />}
          {body}
        </div>
      </Sheet>

      {opened && <TitleDetail item={opened} onClose={() => setOpened(null)} onStatus={handleStatus} />}
      {openedDr && <DrDetail open={openedDr} onClose={() => setOpenedDr(null)} onFollowing={handleDrFollowing} />}
    </>
  );
}
