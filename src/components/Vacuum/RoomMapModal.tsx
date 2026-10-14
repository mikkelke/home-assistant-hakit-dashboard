import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { ArchiveImage } from '../Archive/ArchiveMedia';
import { formatRoberRoomName } from './rooms';
import { formatMapDate, type MapEntry } from './maps';
import './VacuumCard.css';
import './RoomMapModal.css';

const defaultWhen = (map: MapEntry) => formatMapDate(map.datetime, map.timestamp);

/** The archived-run viewer: a room's map over everything, with its own Back entry, stepping through `maps` when there
 * are several. Portaled to <body>: the mobile room-detail panel animates with a transform, and a transformed ancestor
 * becomes the containing block for position:fixed - rendered in place, the modal would land a full viewport below the
 * screen. */
export default function RoomMapModal({
  maps,
  start = 0,
  historyKey,
  when = defaultWhen,
  onClose,
}: {
  maps: readonly MapEntry[];
  start?: number;
  historyKey: string;
  when?: (map: MapEntry) => string;
  onClose: () => void;
}) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [index, setIndex] = useState(start);
  const map = maps[index];
  const room = formatRoberRoomName(map.room) || map.room || 'Unknown room';
  return createPortal(
    <>
      <div className='vacuum-map-overlay' onClick={requestClose} />
      <div
        className={maps.length > 1 ? 'vacuum-map-modal has-steps' : 'vacuum-map-modal'}
        role='dialog'
        aria-modal='true'
        aria-label={`${room} map`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='vacuum-map-modal-header'>
          <div className='vacuum-map-modal-title'>
            <Icon icon='mdi:map' />
            <div>
              <span className='room'>{room}</span>
              <span className='date'>{when(map)}</span>
            </div>
          </div>
          <button className='vacuum-map-modal-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='vacuum-map-modal-content'>
          <ArchiveImage path={map.url} alt={`${room} map`} />
        </div>
        {maps.length > 1 && (
          <div className='vacuum-map-steps'>
            <button
              type='button'
              className='vacuum-map-step'
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
              aria-label='Previous room'
            >
              <Icon icon='mdi:chevron-left' aria-hidden='true' />
            </button>
            <span className='vacuum-map-step-count'>
              {index + 1} / {maps.length}
            </span>
            <button
              type='button'
              className='vacuum-map-step'
              disabled={index === maps.length - 1}
              onClick={() => setIndex(index + 1)}
              aria-label='Next room'
            >
              <Icon icon='mdi:chevron-right' aria-hidden='true' />
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
