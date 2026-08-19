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
 * back-button entry (distinct historyKey, so back closes the photo first, then the sheet).
 *
 * When a ring has BOTH a photo and a clip, the PHOTO shows first with a play disc
 * (user 2026-08-19: "the video is not from the ring, it's after - there is often no
 * person; it should be possible to view the still"). The station only streams while
 * dialed, so the clip physically starts seconds after the ring - the snapshot is the
 * ring-moment artifact, the clip is the aftermath. Clip-only entries (no snapshot
 * arrived) still open the video directly. */
function DoorbellPhoto({ image, onClose }: { image: DoorbellImage; onClose: () => void }) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'doorbell-photo' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const [playing, setPlaying] = useState(false);
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
          {image.clip_url && (playing || !image.url) ? (
            <video controls autoPlay playsInline poster={image.url || undefined} src={image.clip_url} />
          ) : (
            <>
              <img src={image.url} alt={`Ring at the ${image.door || 'door'}, ${formatRingTime(image)}`} />
              {image.clip_url && (
                <button
                  type='button'
                  className='doorbell-photo-play'
                  onClick={() => setPlaying(true)}
                  aria-label='Play the clip (starts seconds after the ring)'
                >
                  <Icon icon='mdi:play' aria-hidden='true' />
                </button>
              )}
            </>
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
                {img.url ? (
                  <img src={img.url} alt={`Ring at the ${img.door || 'door'}, ${formatRingTime(img)}`} loading='lazy' />
                ) : img.clip_url ? (
                  // Clip-only entry (the bridge got a recording but no snapshot): the clip's
                  // own first frame is the thumbnail. muted + preload=metadata paints the
                  // frame without downloading the whole file; #t=0.1 nudges Safari, which
                  // won't paint anything at t=0 with metadata-only preload. Never plays -
                  // the pointer-events:none span sits under the tile <button>'s tap.
                  <video
                    className='doorbell-tile-clipframe'
                    src={`${img.clip_url}#t=0.1`}
                    preload='metadata'
                    muted
                    playsInline
                    tabIndex={-1}
                    aria-label={`Ring clip at the ${img.door || 'door'}, ${formatRingTime(img)}`}
                  />
                ) : (
                  // Neither photo nor clip should not exist (the bridge drops such rings),
                  // but a hand-edited index must degrade to the plain placeholder, not break.
                  <span className='doorbell-tile-cliponly' aria-label={`Ring at the ${img.door || 'door'}, ${formatRingTime(img)}`}>
                    <Icon icon='mdi:video-outline' aria-hidden='true' />
                  </span>
                )}
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
      {/* Keyed so switching photos remounts the viewer and resets its play state. */}
      {photo && <DoorbellPhoto key={photo.filename || `${photo.ts}-${photo.station}`} image={photo} onClose={() => setPhoto(null)} />}
    </>,
    document.body
  );
}
