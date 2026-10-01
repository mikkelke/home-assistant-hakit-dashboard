import { Icon } from '@iconify/react';
import './Request.css';

export function RequestTile({ onOpen }: { onOpen: () => void }) {
  return (
    <button type='button' className='rq-tile' onClick={onOpen}>
      <span className='rq-tile-glyph'>
        <Icon icon='mdi:movie-open-plus-outline' aria-hidden='true' />
      </span>
      <span className='rq-tile-title'>Request</span>
      <Icon icon='mdi:chevron-right' className='rq-tile-chevron' aria-hidden='true' />
    </button>
  );
}
