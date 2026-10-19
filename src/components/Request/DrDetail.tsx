import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { requestErrorCode } from './api';
import { placeholderGradient, STATUS_ICON } from './display';
import { drSeed, drStatus, fetchDrFollowing, followDr, progressText, unfollowDr, type DrFollowed, type DrOpen } from './drtv';
import { PosterArt } from './parts';
import { Sheet } from './Sheet';

// The action in flight or failed is always the one the current state offers: Follow when not following, else Stop following.
type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; code: string | null };

interface Cta {
  className: string;
  icon: string;
  label: string;
  spin?: boolean;
  onClick?: () => void;
}

function failedCta(code: string | null, retry: () => void): Cta {
  switch (code) {
    case 'forbidden':
    case 'not_configured':
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:lock-outline', label: 'Not allowed' };
    case 'not_found':
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:alert-circle-outline', label: 'Not available' };
    case 'upstream_unavailable':
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:cloud-off-outline', label: 'Try again', onClick: retry };
    default:
      return { className: 'rq-cta rq-cta--error', icon: 'mdi:alert-circle-outline', label: 'Try again', onClick: retry };
  }
}

interface Follow {
  following: boolean;
  /** The series' progress; null while unknown. */
  entry: DrFollowed | null;
}

interface DrDetailProps {
  open: DrOpen;
  onClose: () => void;
  /** Tells the lists behind the sheet what the viewer ended up with. */
  onFollowing: (id: string, following: boolean) => void;
}

export function DrDetail({ open, onClose, onFollowing }: DrDetailProps) {
  const { show } = open;
  const connection = useHass(s => s.connection);
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'request-dr-detail' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [follow, setFollow] = useState<Follow>({ following: open.following, entry: open.entry });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [overviewOpen, setOverviewOpen] = useState(false);

  // Following, but how far along is not known yet: a search result said so, or the backend answered "already following".
  const progressUnknown = follow.following && follow.entry === null;
  useEffect(() => {
    if (!connection || !progressUnknown) return;
    let cancelled = false;
    fetchDrFollowing(connection).then(
      followed => {
        if (cancelled) return;
        const found = followed.find(item => item.id === show.id) ?? null;
        setFollow({ following: found !== null, entry: found });
        if (!found) onFollowing(show.id, false);
      },
      () => {
        // A failed look-up leaves the progress unknown.
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, progressUnknown, show.id, onFollowing]);

  const { following, entry } = follow;
  const locked = phase.kind === 'working';

  const followShow = () => {
    if (!connection || locked) return;
    setPhase({ kind: 'working' });
    followDr(connection, show.path).then(
      followed => {
        setFollow({ following: true, entry: followed });
        setPhase({ kind: 'idle' });
        onFollowing(show.id, true);
      },
      (error: unknown) => {
        const code = requestErrorCode(error);
        if (code === 'already_requested') {
          setFollow({ following: true, entry: null });
          setPhase({ kind: 'idle' });
          onFollowing(show.id, true);
        } else {
          setPhase({ kind: 'failed', code });
        }
      }
    );
  };

  const stopFollowing = () => {
    if (!connection || locked) return;
    setPhase({ kind: 'working' });
    const stopped = () => {
      setFollow({ following: false, entry: null });
      setPhase({ kind: 'idle' });
      onFollowing(show.id, false);
    };
    unfollowDr(connection, show.id).then(stopped, (error: unknown) => {
      const code = requestErrorCode(error);
      if (code === 'not_found') stopped();
      else setPhase({ kind: 'failed', code });
    });
  };

  let cta: Cta;
  if (following) cta = { className: 'rq-cta rq-cta--static rq-tone--available', icon: 'mdi:check', label: 'Following' };
  else if (phase.kind === 'working') cta = { className: 'rq-cta is-dim', icon: 'mdi:loading', label: 'Follow', spin: true };
  else if (phase.kind === 'failed') cta = failedCta(phase.code, followShow);
  else cta = { className: 'rq-cta', icon: 'mdi:plus', label: 'Follow', onClick: followShow };

  let stopIcon = 'mdi:minus-circle-outline';
  if (phase.kind === 'working') stopIcon = 'mdi:loading';
  else if (phase.kind === 'failed') stopIcon = 'mdi:alert-circle-outline';

  const seed = drSeed(show.id);
  const progress = following && entry ? { status: drStatus(entry), text: progressText(entry) } : null;
  const overview = show.overview.trim();

  return (
    <Sheet
      label={show.title}
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
        <div className='rq-hero' style={show.poster ? undefined : { background: placeholderGradient(seed) }}>
          {show.poster && <img className='rq-hero-bg' src={show.poster} alt='' aria-hidden='true' />}
          <PosterArt seed={seed} title={show.title} src={show.poster} />
        </div>

        <h2 className='rq-title'>{show.title}</h2>

        <div className='rq-chips'>
          <span className='rq-chip'>
            <Icon icon='mdi:television-classic' aria-hidden='true' />
            DR
          </span>
          {progress && (
            <span className={`rq-chip rq-chip--tone rq-tone--${progress.status}`}>
              <Icon icon={STATUS_ICON[progress.status]} aria-hidden='true' />
              {progress.text}
            </span>
          )}
        </div>

        {overview && (
          <button
            type='button'
            className={`rq-overview ${overviewOpen ? 'is-open' : ''}`}
            aria-expanded={overviewOpen}
            onClick={() => setOverviewOpen(isOpen => !isOpen)}
          >
            {overview}
          </button>
        )}
      </div>

      <div className='rq-foot rq-foot--stack'>
        <button type='button' className={cta.className} disabled={!cta.onClick} onClick={cta.onClick}>
          <Icon icon={cta.icon} className={cta.spin ? 'rq-spin' : undefined} aria-hidden='true' />
          {cta.label}
        </button>
        {following && (
          <button
            type='button'
            className={`rq-stop ${phase.kind === 'failed' ? 'is-error' : ''}`}
            disabled={locked}
            onClick={stopFollowing}
          >
            <Icon icon={stopIcon} className={locked ? 'rq-spin' : undefined} aria-hidden='true' />
            Stop following
          </button>
        )}
      </div>
    </Sheet>
  );
}
