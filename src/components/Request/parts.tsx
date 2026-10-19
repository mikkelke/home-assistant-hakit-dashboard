import { useState } from 'react';
import { Icon } from '@iconify/react';
import { placeholderGradient, posterUrl, STATUS_ICON } from './display';
import type { Item, Status } from './types';

interface PosterArtProps {
  /** Picks the placeholder colour. */
  seed: number;
  title: string;
  /** A full image URL. */
  src: string | null;
}

/** The artwork, or the title over a stable gradient while there is none or it fails to load. */
export function PosterArt({ seed, title, src }: PosterArtProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span className='rq-poster' style={{ background: placeholderGradient(seed) }}>
      {src && !failed ? (
        <img src={src} alt='' loading='lazy' decoding='async' draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className='rq-poster-title'>{title}</span>
      )}
    </span>
  );
}

export function Poster({ tmdbId, title, posterPath }: Pick<Item, 'tmdbId' | 'title' | 'posterPath'>) {
  return <PosterArt seed={tmdbId} title={title} src={posterPath ? posterUrl(posterPath) : null} />;
}

export function StatusIcon({ status, className }: { status: Status; className: string }) {
  if (status === 'none') return null;
  return (
    <span className={`${className} rq-tone--${status}`}>
      <Icon icon={STATUS_ICON[status]} aria-hidden='true' />
    </span>
  );
}

export function StateBlock({ icon, onRetry }: { icon: string; onRetry: () => void }) {
  return (
    <div className='rq-state'>
      <Icon icon={icon} aria-hidden='true' />
      <button type='button' className='rq-retry' onClick={onRetry}>
        <Icon icon='mdi:refresh' aria-hidden='true' />
        Retry
      </button>
    </div>
  );
}
