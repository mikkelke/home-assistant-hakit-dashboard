import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { createRequest, fetchDetail, requestErrorCode } from './api';
import { formatRuntime, placeholderGradient, posterUrl, STATUS_ICON, STATUS_LABEL } from './display';
import { Poster, StateBlock, StatusIcon } from './parts';
import { Sheet } from './Sheet';
import type { Detail, Item, SeasonSelection, Status } from './types';

const SENT_LINGER_MS = 900;

type Phase = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; code: string | null };

interface Cta {
  className: string;
  icon: string;
  label: string;
  spin?: boolean;
  onClick?: () => void;
}

function staticCta(status: Exclude<Status, 'none'>): Cta {
  return { className: `rq-cta rq-cta--static rq-tone--${status}`, icon: STATUS_ICON[status], label: STATUS_LABEL[status] };
}

function failedCta(code: string | null, retry: () => void): Cta {
  switch (code) {
    case 'quota_exceeded':
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:gauge-full', label: 'Limit reached' };
    case 'forbidden':
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:lock-outline', label: 'Not allowed' };
    case 'upstream_unavailable':
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:cloud-off-outline', label: 'Try again', onClick: retry };
    default:
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:alert-circle-outline', label: 'Try again', onClick: retry };
  }
}

function seasonLabel(number: number, status: Status): string {
  return status === 'none' ? `Season ${number}` : `Season ${number}, ${STATUS_LABEL[status]}`;
}

interface TitleDetailProps {
  item: Item;
  onClose: () => void;
  onStatus: (item: Item, status: Status) => void;
}

export function TitleDetail({ item, onClose, onStatus }: TitleDetailProps) {
  const connection = useHass(s => s.connection);
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'request-detail' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [load, setLoad] = useState<{ detail: Detail | null; failed: boolean }>({ detail: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<number> | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [overviewOpen, setOverviewOpen] = useState(false);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    fetchDetail(connection, item.mediaType, item.tmdbId).then(
      detail => {
        if (!cancelled) setLoad({ detail, failed: false });
      },
      () => {
        if (!cancelled) setLoad({ detail: null, failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, item.mediaType, item.tmdbId, attempt]);

  const detailStatus = load.detail?.status;
  useEffect(() => {
    if (detailStatus) onStatus(item, detailStatus);
  }, [detailStatus, item, onStatus]);

  useEffect(() => {
    if (phase.kind !== 'sent') return;
    const timer = setTimeout(requestClose, SENT_LINGER_MS);
    return () => clearTimeout(timer);
  }, [phase.kind, requestClose]);

  const { detail } = load;
  const isTv = item.mediaType === 'tv';
  const status = detail?.status ?? item.status;
  const seasons = detail?.seasons ?? [];
  const openSeasons = seasons.filter(season => season.status === 'none').map(season => season.number);
  const selected: ReadonlySet<number> = picked ?? new Set(openSeasons);
  const nothingToRequest = status !== 'none' && !(isTv && openSeasons.length > 0);
  const needsSeason = isTv && seasons.length > 0 && selected.size === 0;
  const locked = phase.kind === 'sending' || phase.kind === 'sent';

  const toggleSeason = (number: number) => {
    setPhase(current => (current.kind === 'failed' ? { kind: 'idle' } : current));
    setPicked(current => {
      const next = new Set(current ?? openSeasons);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  const send = () => {
    if (!connection || !detail || locked) return;
    let seasonSelection: SeasonSelection | undefined;
    if (isTv) seasonSelection = seasons.length === 0 || selected.size === seasons.length ? 'all' : [...selected].sort((a, b) => a - b);
    setPhase({ kind: 'sending' });
    createRequest(connection, { mediaType: item.mediaType, tmdbId: item.tmdbId, seasons: seasonSelection }).then(
      result => {
        setPhase({ kind: 'sent' });
        onStatus(item, result.status);
      },
      (error: unknown) => {
        const code = requestErrorCode(error);
        if (code === 'already_requested') {
          setPhase({ kind: 'sent' });
          onStatus(item, 'pending');
        } else {
          setPhase({ kind: 'failed', code });
        }
      }
    );
  };

  const reloadDetail = () => {
    setLoad({ detail: null, failed: false });
    setAttempt(n => n + 1);
  };

  let cta: Cta;
  if (phase.kind === 'sent') cta = { className: 'rq-cta rq-cta--sent', icon: 'mdi:check', label: 'Sent' };
  else if (phase.kind === 'sending') cta = { className: 'rq-cta is-dim', icon: 'mdi:loading', label: 'Request', spin: true };
  else if (phase.kind === 'failed') cta = failedCta(phase.code, send);
  else if (!detail)
    cta = { className: 'rq-cta is-dim', icon: load.failed ? 'mdi:plus' : 'mdi:loading', label: 'Request', spin: !load.failed };
  else if (nothingToRequest) cta = staticCta(status);
  else
    cta = {
      className: needsSeason ? 'rq-cta is-dim' : 'rq-cta',
      icon: 'mdi:plus',
      label: 'Request',
      onClick: needsSeason ? undefined : send,
    };

  const year = detail?.year ?? item.year;
  const rating = detail?.rating;
  const runtime = detail?.runtimeMinutes;
  const seasonCount = detail?.seasonCount;
  const overview = detail?.overview.trim();

  return (
    <Sheet
      label={item.title}
      variant='detail'
      onRequestClose={requestClose}
      swipe={{ onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd }}
    >
      <div className='rq-head'>
        <button type='button' className='modal-close-button' onClick={requestClose} aria-label='Back'>
          <Icon icon='mdi:chevron-left' />
        </button>
        <button type='button' className='modal-close-button' onClick={requestClose} aria-label='Close'>
          <Icon icon='mdi:close' />
        </button>
      </div>

      <div className='rq-body rq-body--detail'>
        <div className='rq-hero' style={item.posterPath ? undefined : { background: placeholderGradient(item.tmdbId) }}>
          {item.posterPath && <img className='rq-hero-bg' src={posterUrl(item.posterPath)} alt='' aria-hidden='true' />}
          <Poster tmdbId={item.tmdbId} title={item.title} posterPath={item.posterPath} />
        </div>

        <h2 className='rq-title'>{item.title}</h2>

        <div className='rq-chips'>
          {year != null && (
            <span className='rq-chip'>
              <Icon icon='mdi:calendar-blank-outline' aria-hidden='true' />
              {year}
            </span>
          )}
          {rating != null && rating > 0 && (
            <span className='rq-chip rq-chip--rating'>
              <Icon icon='mdi:star' aria-hidden='true' />
              {rating.toFixed(1)}
            </span>
          )}
          {runtime != null && runtime > 0 && (
            <span className='rq-chip'>
              <Icon icon='mdi:clock-outline' aria-hidden='true' />
              {formatRuntime(runtime)}
            </span>
          )}
          {seasonCount != null && seasonCount > 0 && (
            <span className='rq-chip'>
              <Icon icon='mdi:layers-outline' aria-hidden='true' />
              {seasonCount}
            </span>
          )}
        </div>

        {load.failed && <StateBlock icon='mdi:cloud-off-outline' onRetry={reloadDetail} />}

        {overview && (
          <button
            type='button'
            className={`rq-overview ${overviewOpen ? 'is-open' : ''}`}
            aria-expanded={overviewOpen}
            onClick={() => setOverviewOpen(open => !open)}
          >
            {overview}
          </button>
        )}

        {isTv && seasons.length > 0 && (
          <div className='rq-seasons' role='group' aria-label='Seasons'>
            {seasons.map(season => {
              const selectable = season.status === 'none';
              const on = selectable && selected.has(season.number);
              return (
                <button
                  key={season.number}
                  type='button'
                  className={`rq-season ${on ? 'is-on' : ''} ${selectable ? '' : `rq-season--status rq-tone--${season.status}`}`}
                  disabled={!selectable || locked}
                  aria-pressed={selectable ? on : undefined}
                  aria-label={seasonLabel(season.number, season.status)}
                  onClick={() => toggleSeason(season.number)}
                >
                  {season.number}
                  {!selectable && <StatusIcon status={season.status} className='rq-season-mark' />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className='rq-foot'>
        <button type='button' className={cta.className} disabled={!cta.onClick} onClick={cta.onClick}>
          <Icon icon={cta.icon} className={cta.spin ? 'rq-spin' : undefined} aria-hidden='true' />
          {cta.label}
        </button>
      </div>
    </Sheet>
  );
}
