import { useState } from 'react';
import { Icon } from '@iconify/react';
import { placeholderGradient, posterUrl, STATUS_ICON } from './display';
import type { Item, Status } from './types';

export function Poster({ tmdbId, title, posterPath }: Pick<Item, 'tmdbId' | 'title' | 'posterPath'>) {
  const [failed, setFailed] = useState(false);
  return (
    <span className='rq-poster' style={{ background: placeholderGradient(tmdbId) }}>
      {posterPath && !failed ? (
        <img src={posterUrl(posterPath)} alt='' loading='lazy' decoding='async' draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className='rq-poster-title'>{title}</span>
      )}
    </span>
  );
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
