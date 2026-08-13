import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { doorWord, formatRingTime, outcomeTag, type DoorbellImage } from './doorbellArchive';
import './IntercomCard.css';

// "Who rang" - the doorbell snapshot archive as a sheet. Portaled to <body> like the Rober2
// map modal: the mobile room-detail panel animates with a transform, and a transformed
// ancestor becomes the containing block for position:fixed - rendered in place, the sheet
// would land a full viewport off-screen.

function RingTag({ eventType }: { eventType: string | undefined }) {
  const tag = outcomeTag(eventType);
  if (!tag) return null;
  return <span className={`doorbell-tag ${tag.kind}`}>{tag.word}</span>;
}

/** Full-size viewer for one snapshot - a second portaled layer above the sheet with its own
 * back-button entry (distinct historyKey, so back closes the photo first, then the sheet). */
function DoorbellPhoto({ image, onClose }: { image: DoorbellImage; onClose: () => void }) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'doorbell-photo' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  return createPortal(
    <>
      <div className='doorbell-overlay doorbell-overlay--photo' onClick={requestClose} />
      <div className='doorbell-photo' onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className='doorbell-sheet-header'>
          <span className='doorbell-sheet-glyph'>
            <Icon icon='mdi:bell-ring-outline' aria-hidden='true' />
          </span>
          <div className='doorbell-sheet-title'>
            <span className='main'>
              {doorWord(image.door) || 'Ring'}
              <RingTag eventType={image.event_type} />
            </span>
            <span className='sub'>{formatRingTime(image)}</span>
          </div>
          <button type='button' className='doorbell-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' aria-hidden='true' />
          </button>
        </div>
        <div className='doorbell-photo-content'>
          {image.clip_url ? (
            <video controls autoPlay playsInline poster={image.url} src={image.clip_url} />
          ) : (
            <img src={image.url} alt={`Ring at the ${image.door || 'door'}, ${formatRingTime(image)}`} />
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

export function DoorbellGallery({ images, onClose }: { images: DoorbellImage[]; onClose: () => void }) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'doorbell-gallery' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [photo, setPhoto] = useState<DoorbellImage | null>(null);

  return createPortal(
    <>
      <div className='doorbell-overlay' onClick={requestClose} />
      <div className='doorbell-sheet' onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className='doorbell-sheet-header'>
          <span className='doorbell-sheet-glyph'>
            <Icon icon='mdi:history' aria-hidden='true' />
          </span>
          <div className='doorbell-sheet-title'>
            <span className='main'>Who rang</span>
            <span className='sub'>{images.length === 1 ? '1 snapshot' : `${images.length} snapshots`}</span>
          </div>
          <button type='button' className='doorbell-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' aria-hidden='true' />
          </button>
        </div>
        <div className='doorbell-grid'>
          {images.map(img => (
            <button
              key={img.filename || `${img.ts}-${img.station}`}
              type='button'
              className='doorbell-tile'
              onClick={e => {
                e.stopPropagation();
                setPhoto(img);
              }}
            >
              <span className='doorbell-tile-image'>
                <img src={img.url} alt={`Ring at the ${img.door || 'door'}, ${formatRingTime(img)}`} loading='lazy' />
                {img.clip_url && (
                  <span className='doorbell-play-badge'>
                    <Icon icon='mdi:play' aria-hidden='true' />
                  </span>
                )}
              </span>
              <span className='doorbell-tile-meta'>
                <span className='doorbell-tile-when'>{formatRingTime(img)}</span>
                <span className='doorbell-tile-door'>{doorWord(img.door)}</span>
                <RingTag eventType={img.event_type} />
              </span>
            </button>
          ))}
        </div>
      </div>
      {photo && <DoorbellPhoto image={photo} onClose={() => setPhoto(null)} />}
    </>,
    document.body
  );
}
